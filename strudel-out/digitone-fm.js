/**
 * Digitone FM Synthesis Engine
 * Faithfully ports the Elektron Digitone FM synthesizer engine to Strudel / Web Audio API.
 *
 * References:
 * - digitone-manual/elektron-digitone-fm-synthesis-overview.pdf (Appendix A: The Digitone FM Synthesis)
 * - digitone-manual/elektron-digitone-synth-track-parameters.pdf (Section 11: Synth Track Parameters)
 *
 * Engine Architecture:
 * - 4 Operators: C (Carrier base), A (Modulator/Carrier, Env A), B1 & B2 (Macro-controlled, Env B)
 * - 8 Algorithms (A.3) with distinct modulation routings and carrier X/Y outputs (dotted vs solid)
 * - LEV B macro-mapping (A.5)
 * - Additive harmonics table with PeriodicWave (A.6)
 * - Full signal chain: FM Engine -> Overdrive (DRV) -> Base-Width Filter -> Multimode Filter -> Amp Stage
 */

// ============================================================================
// Mathematical & Parameter Conversion Helpers
// ============================================================================

/**
 * Maps Digitone 0-127 time parameter to seconds.
 * Digitone envelopes offer fast attacks (~0.5ms) up to long decays (~10-18s).
 */
export const paramToTimeSec = (val, minSec = 0.001, maxSec = 12.0) => {
  const v = Math.max(0, Math.min(127, Number(val ?? 0)));
  if (v === 0) return minSec;
  // Exponential scaling for natural musical envelope times
  return minSec * Math.pow(maxSec / minSec, v / 127);
};

/**
 * Maps Digitone 0-127 frequency parameter to Hz (exponential 20Hz - 20000Hz).
 */
export const paramToFrequency = (val, minFreq = 20, maxFreq = 20000) => {
  const v = Math.max(0, Math.min(127, Number(val ?? 127)));
  return minFreq * Math.pow(maxFreq / minFreq, v / 127);
};

/**
 * Maps Digitone 0-127 resonance parameter to BiquadFilter Q.
 */
export const paramToQ = (val, minQ = 0.707, maxQ = 24.0) => {
  const v = Math.max(0, Math.min(127, Number(val ?? 0)));
  return minQ + (maxQ - minQ) * Math.pow(v / 127, 2);
};

/**
 * Detune calculation for Operator A and B2.
 * Reference: Section 11.3.6 DTUN
 * "Up until a parameter value of around 64, the offset is very slight to achieve subtle movement
 * and drifting. Above 64 the operators start to detune more heavily."
 */
export const calculateDetuneOffset = (dtun) => {
  const d = Math.max(0, Math.min(127, Number(dtun ?? 0)));
  if (d <= 64) {
    return (d / 64) * 0.015;
  }
  return 0.015 + Math.pow((d - 64) / 63, 2) * 0.35;
};

/**
 * LEV B Macro-Mapping
 * Reference: Appendix A.5 & Section 11.5.8 LEV B (p.93 / p.50 graph)
 * - 0 to 43: B1 increases linearly from 0 to 127, B2 stays 0.
 * - 43 to 85: B1 decreases from 127 to 0, B2 increases from 0 to 127 (equal at 64).
 * - 85 to 127: B1 increases from 0 to 127, B2 stays at 127.
 */
export const calculateLevB = (v) => {
  const clamped = Math.max(0, Math.min(127, Number(v ?? 0)));
  let b1 = 0;
  let b2 = 0;
  if (clamped <= 43) {
    b1 = 127 * (clamped / 43);
    b2 = 0;
  } else if (clamped <= 85) {
    b1 = 127 * (1 - (clamped - 43) / 42);
    b2 = 127 * ((clamped - 43) / 42);
  } else {
    b1 = 127 * ((clamped - 85) / 42);
    b2 = 127;
  }
  return { b1, b2 };
};

// ============================================================================
// Additive Harmonics & PeriodicWave Generator
// ============================================================================

/**
 * Digitone Additive Harmonics Generator
 * Reference: Appendix A.6 HARMONICS (p.93-94)
 * - HARM is bipolar: -26.00 to +26.00
 * - Negative values change harmonics of Operator C
 * - Positive values change harmonics of Operators A and B1
 * - Interpolates between:
 *   - 0: Sine (fundamental only)
 *   - ~6.5: Sawtooth (all harmonics 1/n)
 *   - ~13: Saw reduction / Odd-even mix
 *   - ~19.5: Square (odd harmonics 1/n)
 *   - 26: Bell spectrum
 */
export const getHarmonicPartials = (harm, opName) => {
  const numPartials = 32;
  const partials = new Float32Array(numPartials);
  partials[0] = 0; // DC offset
  partials[1] = 1.0; // Fundamental is always kept at full volume (keeps base octave intact)

  const h = Number(harm ?? 0);
  let effectiveHarm = 0;

  if (opName === 'C') {
    if (h < 0) {
      effectiveHarm = Math.min(26, Math.abs(h));
    }
  } else if (opName === 'A' || opName === 'B1') {
    if (h > 0) {
      effectiveHarm = Math.min(26, h);
    }
  }

  if (effectiveHarm === 0) {
    return partials;
  }

  // Segment index 0..3 (0: Sine->Saw, 1: Saw->Odd/Even, 2: Odd/Even->Square, 3: Square->Bell)
  const segment = (effectiveHarm / 26) * 4;
  const segIndex = Math.min(3, Math.floor(segment));
  const t = segment - segIndex;

  for (let n = 2; n < numPartials; n++) {
    const isOdd = n % 2 !== 0;
    const sawAmp = 1.0 / n;
    const squareAmp = isOdd ? 1.0 / n : 0.0;
    const oddEvenAmp = isOdd ? 1.0 / n : 0.5 / n;
    const bellAmp = (n === 3 || n === 5 || n === 8 || n === 11) ? 0.8 / Math.sqrt(n) : 0.1 / n;

    let amp = 0;
    if (segIndex === 0) {
      // Sine (0) to Saw
      amp = t * sawAmp;
    } else if (segIndex === 1) {
      // Saw to Odd/Even mix
      amp = (1 - t) * sawAmp + t * oddEvenAmp;
    } else if (segIndex === 2) {
      // Odd/Even mix to Square
      amp = (1 - t) * oddEvenAmp + t * squareAmp;
    } else {
      // Square to Bell
      amp = (1 - t) * squareAmp + t * bellAmp;
    }
    partials[n] = amp;
  }

  return partials;
};

/**
 * Creates a Web Audio PeriodicWave for the given operator and harmonic setting.
 */
export const createDigitonePeriodicWave = (ctx, harm, opName) => {
  if (typeof ctx?.createPeriodicWave !== 'function') {
    return null;
  }
  const partials = getHarmonicPartials(harm, opName);
  const real = new Float32Array(partials.length);
  const imag = new Float32Array(partials.length);
  for (let i = 1; i < partials.length; i++) {
    imag[i] = partials[i];
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
};

// ============================================================================
// Operator Envelope Helper (ADE / ASDE)
// ============================================================================

/**
 * Schedules an operator envelope (ADE triggered or ASDE gated) onto a target AudioParam.
 * Reference: Section A.5 & Section 11.5 / 11.6
 */
export const scheduleOperatorEnv = (
  param,
  time,
  {
    delayVal = 0,
    atkVal = 0,
    decVal = 64,
    endVal = 0,
    levVal = 127,
    trigMode = 1, // 1: Triggered (ADE), 0: Gated (ASDE)
    duration = 1.0,
    maxDeviation = 1000,
  }
) => {
  const delSec = paramToTimeSec(delayVal, 0, 2.0);
  const atkSec = paramToTimeSec(atkVal, 0.001, 8.0);
  const decSec = paramToTimeSec(decVal, 0.005, 12.0);
  const peakLevel = (Math.max(0, Math.min(127, levVal)) / 127) * maxDeviation;
  const endLevel = (Math.max(0, Math.min(127, endVal)) / 127) * maxDeviation;

  const tStart = time + delSec;
  const tPeak = tStart + atkSec;

  param.cancelScheduledValues(time);
  param.setValueAtTime(0, time);

  if (delSec > 0) {
    param.setValueAtTime(0, tStart);
  }

  // Attack phase: 0 -> peakLevel
  param.linearRampToValueAtTime(peakLevel, tPeak);

  if (trigMode === 1) {
    // Triggered (ADE): Attack -> Decay to End level
    const tEnd = tPeak + decSec;
    param.linearRampToValueAtTime(endLevel, tEnd);
  } else {
    // Gated (ASDE): Attack -> Sustain at LEV until note off -> Decay to End level
    const sustainEnd = Math.max(tPeak, time + duration);
    param.setValueAtTime(peakLevel, sustainEnd);
    const tEnd = sustainEnd + decSec;
    param.linearRampToValueAtTime(endLevel, tEnd);
  }
};

// ============================================================================
// Feedback Loop Helper
// ============================================================================

/**
 * Creates an audio-rate self-modulation feedback loop for a target operator.
 * Uses a 1-sample DelayNode to break zero-delay cycle in Web Audio graph.
 */
export const createFeedbackLoop = (ctx, targetOp, fdbkGainValue) => {
  if (!fdbkGainValue || fdbkGainValue <= 0) {
    return {
      disconnect: () => {},
    };
  }

  const sampleRate = ctx.sampleRate ?? 44100;
  const fbDelay = new DelayNode(ctx, { delayTime: 1 / sampleRate });
  const fbGain = new GainNode(ctx, { gain: fdbkGainValue });

  targetOp.connect(fbDelay);
  fbDelay.connect(fbGain);
  fbGain.connect(targetOp.frequency);

  return {
    fbDelay,
    fbGain,
    disconnect: () => {
      try {
        targetOp.disconnect(fbDelay);
      } catch (e) {}
      try {
        fbDelay.disconnect();
      } catch (e) {}
      try {
        fbGain.disconnect();
      } catch (e) {}
    },
  };
};

// ============================================================================
// 8 FM Algorithms (Appendix A.3)
// ============================================================================

/**
 * Algorithm 1:
 * - Modulation: B2 -> B1 -> C, A -> C
 * - Feedback on: A
 * - Carrier outputs: X = C (dotted), Y = B1 (dotted)
 */
export const digitoneAlgo1 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  // Modulation: B2 -> B1
  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  // Modulation: B1 -> C
  opB1.connect(gainB1);
  gainB1.connect(opC.frequency);

  // Modulation: A -> C
  opA.connect(gainA);
  gainA.connect(opC.frequency);

  // Carriers: X = C (dotted), Y = B1 (dotted)
  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  opB1.connect(outY);

  return {
    outX,
    outY,
    feedbackOp: 'A',
    disconnect: () => {
      fb.disconnect();
      try { opB2.disconnect(gainB2); } catch (e) {}
      try { gainB2.disconnect(); } catch (e) {}
      try { opB1.disconnect(gainB1); } catch (e) {}
      try { gainB1.disconnect(); } catch (e) {}
      try { opA.disconnect(gainA); } catch (e) {}
      try { gainA.disconnect(); } catch (e) {}
      try { opC.disconnect(outX); } catch (e) {}
      try { opB1.disconnect(outY); } catch (e) {}
      try { outX.disconnect(); } catch (e) {}
      try { outY.disconnect(); } catch (e) {}
    },
  };
};

/**
 * Algorithm 2:
 * - Modulation: A -> C, B2 -> B1
 * - Feedback on: B2
 * - Carrier outputs: X = C (dotted), Y = B1 (dotted)
 */
export const digitoneAlgo2 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB2, fdbkGain);

  // Modulation: A -> C
  opA.connect(gainA);
  gainA.connect(opC.frequency);

  // Modulation: B2 -> B1
  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  // Carriers: X = C (dotted), Y = B1 (dotted)
  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  opB1.connect(outY);

  return {
    outX,
    outY,
    feedbackOp: 'B2',
    disconnect: () => {
      fb.disconnect();
      try { opA.disconnect(gainA); } catch (e) {}
      try { gainA.disconnect(); } catch (e) {}
      try { opB2.disconnect(gainB2); } catch (e) {}
      try { gainB2.disconnect(); } catch (e) {}
      try { opC.disconnect(outX); } catch (e) {}
      try { opB1.disconnect(outY); } catch (e) {}
      try { outX.disconnect(); } catch (e) {}
      try { outY.disconnect(); } catch (e) {}
    },
  };
};

/**
 * Algorithm 3:
 * - Modulation: A -> C, A -> B2, A -> B1
 * - Feedback on: A
 * - Carrier outputs: X = C (dotted) + B2 (dotted), Y = B1 (dotted)
 */
export const digitoneAlgo3 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  // Modulation: A branches to C, B2, B1
  opA.connect(gainA);
  gainA.connect(opC.frequency);
  gainA.connect(opB2.frequency);
  gainA.connect(opB1.frequency);

  // Carriers: X = C (dotted) + B2 (dotted), Y = B1 (dotted)
  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  opB2.connect(outX);
  opB1.connect(outY);

  return {
    outX,
    outY,
    feedbackOp: 'A',
    disconnect: () => {
      fb.disconnect();
      try { opA.disconnect(gainA); } catch (e) {}
      try { gainA.disconnect(); } catch (e) {}
      try { opC.disconnect(outX); } catch (e) {}
      try { opB2.disconnect(outX); } catch (e) {}
      try { opB1.disconnect(outY); } catch (e) {}
      try { outX.disconnect(); } catch (e) {}
      try { outY.disconnect(); } catch (e) {}
    },
  };
};

/**
 * Algorithm 4:
 * - Modulation: B2 -> B1 -> A -> C
 * - Feedback on: B2
 * - Carrier outputs: X = C (dotted), Y = B1 (dotted)
 */
export const digitoneAlgo4 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB2, fdbkGain);

  // Modulation: B2 -> B1 -> A -> C
  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  opB1.connect(gainB1);
  gainB1.connect(opA.frequency);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

  // Carriers: X = C (dotted), Y = B1 (dotted)
  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  opB1.connect(outY);

  return {
    outX,
    outY,
    feedbackOp: 'B2',
    disconnect: () => {
      fb.disconnect();
      try { opB2.disconnect(gainB2); } catch (e) {}
      try { gainB2.disconnect(); } catch (e) {}
      try { opB1.disconnect(gainB1); } catch (e) {}
      try { gainB1.disconnect(); } catch (e) {}
      try { opA.disconnect(gainA); } catch (e) {}
      try { gainA.disconnect(); } catch (e) {}
      try { opC.disconnect(outX); } catch (e) {}
      try { opB1.disconnect(outY); } catch (e) {}
      try { outX.disconnect(); } catch (e) {}
      try { outY.disconnect(); } catch (e) {}
    },
  };
};

/**
 * Algorithm 5:
 * - Modulation: B1 -> A, B2 -> A, A -> C
 * - Feedback on: B1
 * - Carrier outputs: X = C (dotted), Y = A (dotted)
 */
export const digitoneAlgo5 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB1, fdbkGain);

  // Modulation: B1 and B2 both modulate A
  opB1.connect(gainB1);
  gainB1.connect(opA.frequency);

  opB2.connect(gainB2);
  gainB2.connect(opA.frequency);

  // Modulation: A -> C
  opA.connect(gainA);
  gainA.connect(opC.frequency);

  // Carriers: X = C (dotted), Y = A (dotted)
  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  opA.connect(outY);

  return {
    outX,
    outY,
    feedbackOp: 'B1',
    disconnect: () => {
      fb.disconnect();
      try { opB1.disconnect(gainB1); } catch (e) {}
      try { gainB1.disconnect(); } catch (e) {}
      try { opB2.disconnect(gainB2); } catch (e) {}
      try { gainB2.disconnect(); } catch (e) {}
      try { opA.disconnect(gainA); } catch (e) {}
      try { gainA.disconnect(); } catch (e) {}
      try { opC.disconnect(outX); } catch (e) {}
      try { opA.disconnect(outY); } catch (e) {}
      try { outX.disconnect(); } catch (e) {}
      try { outY.disconnect(); } catch (e) {}
    },
  };
};

/**
 * Algorithm 6:
 * - Modulation: A -> C, A -> B1, B2 -> C, B2 -> B1
 * - Feedback on: A
 * - Carrier outputs: X = C (dotted), Y = B1 (dotted)
 */
export const digitoneAlgo6 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  // Modulation: A -> C and A -> B1
  opA.connect(gainA);
  gainA.connect(opC.frequency);
  gainA.connect(opB1.frequency);

  // Modulation: B2 -> C and B2 -> B1
  opB2.connect(gainB2);
  gainB2.connect(opC.frequency);
  gainB2.connect(opB1.frequency);

  // Carriers: X = C (dotted), Y = B1 (dotted)
  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  opB1.connect(outY);

  return {
    outX,
    outY,
    feedbackOp: 'A',
    disconnect: () => {
      fb.disconnect();
      try { opA.disconnect(gainA); } catch (e) {}
      try { gainA.disconnect(); } catch (e) {}
      try { opB2.disconnect(gainB2); } catch (e) {}
      try { gainB2.disconnect(); } catch (e) {}
      try { opC.disconnect(outX); } catch (e) {}
      try { opB1.disconnect(outY); } catch (e) {}
      try { outX.disconnect(); } catch (e) {}
      try { outY.disconnect(); } catch (e) {}
    },
  };
};

/**
 * Algorithm 7:
 * - Modulation: A -> C, B2 -> B1
 * - Feedback on: A
 * - Carrier outputs:
 *   - X = C (dotted) + A (solid, affected by Env A)
 *   - Y = B1 (solid, affected by Env B) + B2 (solid, affected by Env B)
 */
export const digitoneAlgo7 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  // Modulation: A -> C
  opA.connect(gainA);
  gainA.connect(opC.frequency);

  // Modulation: B2 -> B1
  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  // Carrier X = C (dotted) + A (solid, enveloped)
  const outX = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  gainA.connect(outX);

  // Carrier Y = B1 (solid, enveloped) + B2 (solid, enveloped)
  const outY = new GainNode(ctx, { gain: 1 });
  opB1.connect(gainB1);
  gainB1.connect(outY);
  gainB2.connect(outY);

  return {
    outX,
    outY,
    feedbackOp: 'A',
    disconnect: () => {
      fb.disconnect();
      try { opA.disconnect(gainA); } catch (e) {}
      try { gainA.disconnect(); } catch (e) {}
      try { opB2.disconnect(gainB2); } catch (e) {}
      try { gainB2.disconnect(); } catch (e) {}
      try { opC.disconnect(outX); } catch (e) {}
      try { opB1.disconnect(gainB1); } catch (e) {}
      try { gainB1.disconnect(); } catch (e) {}
      try { outX.disconnect(); } catch (e) {}
      try { outY.disconnect(); } catch (e) {}
    },
  };
};

/**
 * Algorithm 8:
 * - Modulation: A -> C, B1 and B2 are unmodulated carriers
 * - Feedback on: B1
 * - Carrier outputs:
 *   - X = C (dotted) + B2 (solid, affected by Env B)
 *   - Y = B1 (solid, affected by Env B)
 */
export const digitoneAlgo8 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB1, fdbkGain);

  // Modulation: A -> C
  opA.connect(gainA);
  gainA.connect(opC.frequency);

  // Carrier X = C (dotted) + B2 (solid, enveloped)
  const outX = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  opB2.connect(gainB2);
  gainB2.connect(outX);

  // Carrier Y = B1 (solid, enveloped)
  const outY = new GainNode(ctx, { gain: 1 });
  opB1.connect(gainB1);
  gainB1.connect(outY);

  return {
    outX,
    outY,
    feedbackOp: 'B1',
    disconnect: () => {
      fb.disconnect();
      try { opA.disconnect(gainA); } catch (e) {}
      try { gainA.disconnect(); } catch (e) {}
      try { opC.disconnect(outX); } catch (e) {}
      try { opB2.disconnect(gainB2); } catch (e) {}
      try { gainB2.disconnect(); } catch (e) {}
      try { opB1.disconnect(gainB1); } catch (e) {}
      try { gainB1.disconnect(); } catch (e) {}
      try { outX.disconnect(); } catch (e) {}
      try { outY.disconnect(); } catch (e) {}
    },
  };
};

/**
 * Registry of the 8 Digitone FM algorithms.
 */
export const digitoneAlgorithms = [
  digitoneAlgo1,
  digitoneAlgo2,
  digitoneAlgo3,
  digitoneAlgo4,
  digitoneAlgo5,
  digitoneAlgo6,
  digitoneAlgo7,
  digitoneAlgo8,
];

export const getDigitoneAlgorithm = (algoNumber) => {
  const idx = Math.max(1, Math.min(8, Math.round(Number(algoNumber ?? 1)))) - 1;
  return digitoneAlgorithms[idx];
};

// ============================================================================
// Overdrive Helper (Section 11.9.5 DRV)
// ============================================================================

let _digitoneSoftClipCurve = null;
const getDigitoneSoftClipCurve = () => {
  if (_digitoneSoftClipCurve) return _digitoneSoftClipCurve;
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * 2.0);
  }
  _digitoneSoftClipCurve = curve;
  return curve;
};

/**
 * Creates an overdrive node representing Digitone DRV parameter (0.00 - 127.00).
 */
export const createDigitoneOverdriveNode = (ctx, drvVal = 0) => {
  const drv = Math.max(0, Math.min(127, Number(drvVal ?? 0)));
  if (drv <= 0) {
    const passthrough = new GainNode(ctx, { gain: 1 });
    return {
      input: passthrough,
      output: passthrough,
      disconnect: () => {
        try { passthrough.disconnect(); } catch (e) {}
      },
    };
  }

  const driveGain = 1.0 + (drv / 127.0) * 12.0;
  const inGainNode = new GainNode(ctx, { gain: driveGain });
  const shaper = new WaveShaperNode(ctx, {
    curve: getDigitoneSoftClipCurve(),
    oversample: '2x',
  });
  const outGainNode = new GainNode(ctx, {
    gain: 1.0 / Math.sqrt(driveGain),
  });

  inGainNode.connect(shaper);
  shaper.connect(outGainNode);

  return {
    input: inGainNode,
    output: outGainNode,
    disconnect: () => {
      try { inGainNode.disconnect(); } catch (e) {}
      try { shaper.disconnect(); } catch (e) {}
      try { outGainNode.disconnect(); } catch (e) {}
    },
  };
};

// ============================================================================
// Base-Width Filter (Section 11.8)
// ============================================================================

/**
 * Digitone 1-pole (6 dB) Base-Width filter connected in series:
 * Highpass (BASE) followed by Lowpass (WIDTH).
 * - BASE: 0..127 sets highpass cutoff
 * - WIDTH: 0..127 sets lowpass cutoff above base
 * - When BASE=0 and WIDTH=127, the filter is completely transparent.
 */
export const createBaseWidthFilterNode = (ctx, baseVal = 0, widthVal = 127) => {
  const base = Math.max(0, Math.min(127, Number(baseVal ?? 0)));
  const width = Math.max(0, Math.min(127, Number(widthVal ?? 127)));

  // If completely open, bypass filter processing
  if (base === 0 && width === 127) {
    const passthrough = new GainNode(ctx, { gain: 1 });
    return {
      input: passthrough,
      output: passthrough,
      disconnect: () => {
        try { passthrough.disconnect(); } catch (e) {}
      },
    };
  }

  const baseFreq = paramToFrequency(base, 20, 18000);
  // Width sets cutoff above base frequency
  const minLpFreq = baseFreq;
  const maxLpFreq = 20000;
  const lpFreq = Math.min(
    maxLpFreq,
    minLpFreq * Math.pow(maxLpFreq / Math.max(20, minLpFreq), width / 127)
  );

  const hpNode = new BiquadFilterNode(ctx, {
    type: 'highpass',
    frequency: baseFreq,
    Q: 0.707,
  });

  const lpNode = new BiquadFilterNode(ctx, {
    type: 'lowpass',
    frequency: lpFreq,
    Q: 0.707,
  });

  hpNode.connect(lpNode);

  return {
    input: hpNode,
    output: lpNode,
    disconnect: () => {
      try { hpNode.disconnect(); } catch (e) {}
      try { lpNode.disconnect(); } catch (e) {}
    },
  };
};

// ============================================================================
// Multimode Filter (Section 11.7)
// ============================================================================

/**
 * Digitone Multimode Filter:
 * - TYPE: 0 (OFF), 1 (12dB LP), 2 (12dB HP), 3 (24dB LP)
 * - Cutoff Frequency (FREQ 0..127)
 * - Resonance (RESO 0..127)
 * - Filter Envelope: ATK, DEC, SUS, REL, DEL (delay)
 * - Envelope Depth: ENV (-64..+63)
 */
export const createMultimodeFilterNode = (ctx, time, value) => {
  const filterType = Math.round(Number(value.fltr_type ?? value.ftype ?? 1));
  const fFreqVal = Number(value.fltr_freq ?? value.ffreq ?? value.cutoff ?? 127);
  const fResoVal = Number(value.fltr_reso ?? value.freso ?? value.q ?? 0);
  const fEnvDepthVal = Number(value.fltr_env ?? value.fenv ?? 0);

  const baseFreq = paramToFrequency(fFreqVal, 20, 20000);
  const filterQ = paramToQ(fResoVal, 0.707, 24);

  // Type 0: Filter is OFF
  if (filterType === 0) {
    const passthrough = new GainNode(ctx, { gain: 1 });
    return {
      input: passthrough,
      output: passthrough,
      disconnect: () => {
        try { passthrough.disconnect(); } catch (e) {}
      },
    };
  }

  const fAtkSec = paramToTimeSec(value.fltr_atk ?? value.fatk ?? 0, 0.001, 8.0);
  const fDecSec = paramToTimeSec(value.fltr_dec ?? value.fdec ?? 64, 0.005, 12.0);
  const fSusLevel = Math.max(0, Math.min(127, Number(value.fltr_sus ?? value.fsus ?? 127))) / 127;
  const fRelSec = paramToTimeSec(value.fltr_rel ?? value.frel ?? 32, 0.005, 12.0);
  const fDelSec = paramToTimeSec(value.fltr_del ?? value.fdel ?? 0, 0, 2.0);
  const duration = Number(value.duration ?? 1.0);

  // Calculate frequency modulation multiplier from envelope depth (-64 to +63)
  // +63 gives up to ~5 octaves sweep, -64 sweeps downwards
  const octaveSweep = (fEnvDepthVal / 64.0) * 5.0;

  const scheduleFilterFreq = (filterNode) => {
    const tStart = time + fDelSec;
    const tPeak = tStart + fAtkSec;
    const peakFreq = Math.max(20, Math.min(20000, baseFreq * Math.pow(2, octaveSweep)));
    const susFreq = Math.max(20, Math.min(20000, baseFreq * Math.pow(2, octaveSweep * fSusLevel)));
    const endFreq = baseFreq;

    filterNode.frequency.cancelScheduledValues(time);
    filterNode.frequency.setValueAtTime(baseFreq, time);

    if (fDelSec > 0) {
      filterNode.frequency.setValueAtTime(baseFreq, tStart);
    }
    // Attack
    filterNode.frequency.exponentialRampToValueAtTime(Math.max(20, peakFreq), tPeak);

    // Decay to Sustain
    const tSus = tPeak + fDecSec;
    filterNode.frequency.exponentialRampToValueAtTime(Math.max(20, susFreq), tSus);

    // Sustain until note off
    const tNoteOff = Math.max(tSus, time + duration);
    filterNode.frequency.setValueAtTime(Math.max(20, susFreq), tNoteOff);

    // Release to base frequency
    filterNode.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), tNoteOff + fRelSec);
  };

  let inputNode;
  let outputNode;
  const nodesToDisconnect = [];

  if (filterType === 1) {
    // 2-pole (12 dB) Lowpass
    const lp = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: baseFreq,
      Q: filterQ,
    });
    scheduleFilterFreq(lp);
    inputNode = lp;
    outputNode = lp;
    nodesToDisconnect.push(lp);
  } else if (filterType === 2) {
    // 2-pole (12 dB) Highpass
    const hp = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: baseFreq,
      Q: filterQ,
    });
    scheduleFilterFreq(hp);
    inputNode = hp;
    outputNode = hp;
    nodesToDisconnect.push(hp);
  } else if (filterType === 3) {
    // 4-pole (24 dB) Lowpass (two 2-pole filters cascaded in series)
    const lp1 = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: baseFreq,
      Q: Math.sqrt(filterQ),
    });
    const lp2 = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: baseFreq,
      Q: Math.sqrt(filterQ),
    });
    scheduleFilterFreq(lp1);
    scheduleFilterFreq(lp2);
    lp1.connect(lp2);
    inputNode = lp1;
    outputNode = lp2;
    nodesToDisconnect.push(lp1, lp2);
  } else {
    // Fallback: 2-pole LP
    const lp = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: baseFreq,
      Q: filterQ,
    });
    scheduleFilterFreq(lp);
    inputNode = lp;
    outputNode = lp;
    nodesToDisconnect.push(lp);
  }

  return {
    input: inputNode,
    output: outputNode,
    disconnect: () => {
      for (const n of nodesToDisconnect) {
        try { n.disconnect(); } catch (e) {}
      }
    },
  };
};

// ============================================================================
// Core Digitone Synth Track Definition ('syn')
// ============================================================================

/**
 * Creates and plays a Digitone FM Synth Voice.
 *
 * Implements:
 * - SYN1: ALGO, RATIO C, RATIO A, RATIO B, HARM, DTUN, FDBK, MIX, Offsets
 * - SYN2: ATK A/B, DEC A/B, END A/B, LEV A/B, ADEL/BDEL, ATRG/BTRG
 * - FLTR: Multimode Filter (4 types + ADSR Env + DEL) & Base-Width Filter
 * - AMP: Amp ADSR Envelope, Overdrive (DRV), Pan (-64..+63), Vol (0..127)
 */
export const playDigitoneSynVoice = (
  ctx,
  time,
  value,
  onended,
  getFrequencyHelper,
  gainAdjustmentHelper
) => {
  const duration = Number(value.duration ?? 1.0);
  const clipDur = Math.max(0.01, duration - 0.005);

  // 1. Base Frequency & Voice Gain Adjustment
  const baseFreq = getFrequencyHelper
    ? getFrequencyHelper(value, 48) // default C3
    : Number(value.freq ?? 130.81);
  const voiceGainAdjustment = gainAdjustmentHelper
    ? gainAdjustmentHelper(value, 0.25)
    : 0.25;

  // 2. SYN1 Parameters
  const algoNum = Math.max(1, Math.min(8, Math.round(Number(value.algo ?? 1))));
  const ratioC = Number(value.ratioC ?? value.rc ?? 1.0);
  const ratioA = Number(value.ratioA ?? value.ra ?? 1.0);
  const ratioBVal = Number(value.ratioB ?? value.rb ?? 1.0);
  const ratioB1 = Number(value.ratioB1 ?? ratioBVal);
  const ratioB2 = Number(value.ratioB2 ?? ratioBVal);

  const offsetC = Number(value.offsetC ?? 0);
  const offsetA = Number(value.offsetA ?? 0);
  const offsetB1 = Number(value.offsetB1 ?? 0);
  const offsetB2 = Number(value.offsetB2 ?? 0);

  const harm = Number(value.harm ?? 0);
  const dtun = Number(value.dtun ?? value.detune ?? 0);
  const fdbk = Math.max(0, Math.min(120, Number(value.fdbk ?? value.feedback ?? 0)));
  const mix = Math.max(-64, Math.min(63, Number(value.mix ?? 0)));

  // Detune ratio applies to A and B2
  const dtunOffset = calculateDetuneOffset(dtun);

  // Calculate operator frequencies
  const freqC = baseFreq * Math.max(0.01, ratioC + offsetC);
  const freqA = baseFreq * Math.max(0.01, (ratioA + offsetA) * (1 + dtunOffset));
  const freqB1 = baseFreq * Math.max(0.01, ratioB1 + offsetB1);
  const freqB2 = baseFreq * Math.max(0.01, (ratioB2 + offsetB2) * (1 + dtunOffset));

  // 3. Create 4 Operator Oscillators with Harmonics PeriodicWaves
  const opC = new OscillatorNode(ctx, { frequency: freqC });
  const opA = new OscillatorNode(ctx, { frequency: freqA });
  const opB1 = new OscillatorNode(ctx, { frequency: freqB1 });
  const opB2 = new OscillatorNode(ctx, { frequency: freqB2 });

  const waveC = createDigitonePeriodicWave(ctx, harm, 'C');
  const waveA = createDigitonePeriodicWave(ctx, harm, 'A');
  const waveB1 = createDigitonePeriodicWave(ctx, harm, 'B1');
  if (waveC) opC.setPeriodicWave(waveC);
  if (waveA) opA.setPeriodicWave(waveA);
  if (waveB1) opB1.setPeriodicWave(waveB1);

  // 4. Operator Envelopes & Modulation Gains (SYN2)
  const atkA = value.atkA ?? value.atattackA ?? 0;
  const decA = value.decA ?? 64;
  const endA = value.endA ?? 0;
  const levA = value.levA ?? 64;
  const adel = value.adel ?? 0;
  const atrg = value.atrg !== undefined ? Number(value.atrg) : 1; // default triggered ADE

  const atkB = value.atkB ?? 0;
  const decB = value.decB ?? 64;
  const endB = value.endB ?? 0;
  const levBVal = value.levB ?? 64;
  const bdel = value.bdel ?? 0;
  const btrg = value.btrg !== undefined ? Number(value.btrg) : 1;

  // Compute LEV B macro split for B1 and B2
  const { b1: levB1, b2: levB2 } = calculateLevB(levBVal);

  const gainA = new GainNode(ctx, { gain: 0 });
  const gainB1 = new GainNode(ctx, { gain: 0 });
  const gainB2 = new GainNode(ctx, { gain: 0 });

  // Modulation index scale in Hz
  const maxModDeviationA = freqA * 8.0;
  const maxModDeviationB1 = freqB1 * 8.0;
  const maxModDeviationB2 = freqB2 * 8.0;

  scheduleOperatorEnv(gainA.gain, time, {
    delayVal: adel,
    atkVal: atkA,
    decVal: decA,
    endVal: endA,
    levVal: levA,
    trigMode: atrg,
    duration,
    maxDeviation: maxModDeviationA,
  });

  scheduleOperatorEnv(gainB1.gain, time, {
    delayVal: bdel,
    atkVal: atkB,
    decVal: decB,
    endVal: endB,
    levVal: levB1,
    trigMode: btrg,
    duration,
    maxDeviation: maxModDeviationB1,
  });

  scheduleOperatorEnv(gainB2.gain, time, {
    delayVal: bdel,
    atkVal: atkB,
    decVal: decB,
    endVal: endB,
    levVal: levB2,
    trigMode: btrg,
    duration,
    maxDeviation: maxModDeviationB2,
  });

  // 5. Connect Algorithm Routing
  const algoFunc = getDigitoneAlgorithm(algoNum);
  const fdbkGainHz = (fdbk / 120.0) * baseFreq * 2.0;

  const algoResult = algoFunc(
    ctx,
    time,
    { opC, opA, opB1, opB2 },
    { gainA, gainB1, gainB2 },
    fdbkGainHz
  );

  // 6. Carrier MIX Stage (-64 to +63)
  // -64 is full X, 0 is 50/50, +63 is full Y
  const normMix = (mix + 64) / 127; // 0..1
  const mixGainX = Math.cos(normMix * 0.5 * Math.PI);
  const mixGainY = Math.sin(normMix * 0.5 * Math.PI);

  const mixedOut = new GainNode(ctx, { gain: 1 });
  const xGain = new GainNode(ctx, { gain: mixGainX });
  const yGain = new GainNode(ctx, { gain: mixGainY });

  algoResult.outX.connect(xGain);
  algoResult.outY.connect(yGain);
  xGain.connect(mixedOut);
  yGain.connect(mixedOut);

  // 7. Overdrive (DRV, Section 11.9.5)
  const drvVal = Number(value.drv ?? value.overdrive ?? 0);
  const overdriveNode = createDigitoneOverdriveNode(ctx, drvVal);
  mixedOut.connect(overdriveNode.input);

  // 8. Base-Width Filter (FLTR Page 2, Section 11.8)
  const baseVal = Number(value.base ?? 0);
  const widthVal = Number(value.width ?? 127);
  const baseWidthNode = createBaseWidthFilterNode(ctx, baseVal, widthVal);
  overdriveNode.output.connect(baseWidthNode.input);

  // 9. Multimode Filter (FLTR Page 1, Section 11.7)
  const multimodeNode = createMultimodeFilterNode(ctx, time, value);
  baseWidthNode.output.connect(multimodeNode.input);

  // 10. Amp Stage (AMP Page 1, Section 11.9)
  // Amp ADSR Envelope
  const ampAtkSec = paramToTimeSec(value.amp_atk ?? value.attack ?? value.atk ?? 0, 0.001, 8.0);
  const ampDecSec = paramToTimeSec(value.amp_dec ?? value.decay ?? value.dec ?? 64, 0.005, 12.0);
  const ampSusLevel = Math.max(0, Math.min(127, Number(value.amp_sus ?? value.sustain ?? value.sus ?? 127))) / 127;
  const ampRelSec = paramToTimeSec(value.amp_rel ?? value.release ?? value.rel ?? 32, 0.005, 12.0);
  const volVal = Math.max(0, Math.min(127, Number(value.vol ?? value.volume ?? 100)));
  const masterAmp = (volVal / 127.0) * Number(value.amp ?? 1.0) * voiceGainAdjustment;

  const ampGainNode = new GainNode(ctx, { gain: 0 });
  multimodeNode.output.connect(ampGainNode);

  // Amp Envelope Scheduling
  ampGainNode.gain.cancelScheduledValues(time);
  ampGainNode.gain.setValueAtTime(0, time);
  ampGainNode.gain.linearRampToValueAtTime(masterAmp, time + ampAtkSec);
  ampGainNode.gain.linearRampToValueAtTime(masterAmp * ampSusLevel, time + ampAtkSec + ampDecSec);

  const tAmpNoteOff = Math.max(time + ampAtkSec + ampDecSec, time + clipDur);
  ampGainNode.gain.setValueAtTime(masterAmp * ampSusLevel, tAmpNoteOff);
  ampGainNode.gain.exponentialRampToValueAtTime(0.0001, tAmpNoteOff + ampRelSec);
  ampGainNode.gain.linearRampToValueAtTime(0, tAmpNoteOff + ampRelSec + 0.01);

  // Stereo Panning (PAN: -64 to +63, Section 11.9.6)
  const panVal = Math.max(-64, Math.min(63, Number(value.pan ?? 0)));
  const normPan = panVal / 64.0; // -1.0 to +1.0
  let finalOutNode = ampGainNode;
  let pannerNode = null;

  if (typeof StereoPannerNode !== 'undefined') {
    pannerNode = new StereoPannerNode(ctx, { pan: normPan });
    ampGainNode.connect(pannerNode);
    finalOutNode = pannerNode;
  }

  // 11. Playback & Stop Lifecycles
  const stopTime = tAmpNoteOff + ampRelSec + 0.02;

  opC.start(time);
  opA.start(time);
  opB1.start(time);
  opB2.start(time);

  opC.stop(stopTime);
  opA.stop(stopTime);
  opB1.stop(stopTime);
  opB2.stop(stopTime);

  const cleanup = () => {
    algoResult.disconnect();
    try { opC.disconnect(); } catch (e) {}
    try { opA.disconnect(); } catch (e) {}
    try { opB1.disconnect(); } catch (e) {}
    try { opB2.disconnect(); } catch (e) {}
    try { xGain.disconnect(); } catch (e) {}
    try { yGain.disconnect(); } catch (e) {}
    try { mixedOut.disconnect(); } catch (e) {}
    overdriveNode.disconnect();
    baseWidthNode.disconnect();
    multimodeNode.disconnect();
    try { ampGainNode.disconnect(); } catch (e) {}
    if (pannerNode) {
      try { pannerNode.disconnect(); } catch (e) {}
    }
  };

  opC.addEventListener('ended', () => {
    cleanup();
    if (typeof onended === 'function') {
      onended();
    }
  });

  return {
    node: finalOutNode,
    stop: (t) => {
      try { opC.stop(t); } catch (e) {}
      try { opA.stop(t); } catch (e) {}
      try { opB1.stop(t); } catch (e) {}
      try { opB2.stop(t); } catch (e) {}
    },
  };
};
