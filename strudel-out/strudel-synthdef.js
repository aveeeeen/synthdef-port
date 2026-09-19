/**
 * Strudel SynthDef Ports
 * Ported from SuperCollider SynthDefs (./synthdef/SynthDefs.scd)
 *
 * Requirements:
 * - registerSound custom synth definitions matching SuperCollider SynthDefs
 * - Web Audio API based synthesis
 * - Envelope scheduling and AudioNode cleanup on 'ended'
 * - Noise and distortion helper functions
 */

// Safe fallback for standalone / test environments
if (typeof createParam === 'undefined') {
  globalThis.createParam = (name) => name;
}
if (typeof registerSound === 'undefined') {
  globalThis.registerSound = () => {};
}
if (typeof getAudioContext === 'undefined') {
  globalThis.getAudioContext = () => ({ sampleRate: 44100 });
}

// ============================================================================
// Custom Parameters
// ============================================================================
const atk = createParam('atk');
const clr = createParam('clr');
const contour = createParam('contour');
const cutoff = createParam('cutoff');
const detune = createParam('detune');
const index = createParam('index');
const len = createParam('len');
const lpfend = createParam('lpfend');
const lpfstart = createParam('lpfstart');
const modrate = createParam('modrate');
const noiseamp = createParam('noiseamp');
const patk = createParam('patk');
const plen = createParam('plen');
const prate = createParam('prate');
const q = createParam('q');
const shp = createParam('shp');
const sust = createParam('sust');
const sweep = createParam('sweep');
const unison = createParam('unison');
const voices = createParam('voices');

// Digitone Parameters
const algo = createParam('algo');
const atkA = createParam('atkA');
const atkB = createParam('atkB');
const base = createParam('base');
const decA = createParam('decA');
const decB = createParam('decB');
const drv = createParam('drv');
const dtun = createParam('dtun');
const endA = createParam('endA');
const endB = createParam('endB');
const fdbk = createParam('fdbk');
const fltr_atk = createParam('fltr_atk');
const fltr_dec = createParam('fltr_dec');
const fltr_del = createParam('fltr_del');
const fltr_env = createParam('fltr_env');
const fltr_freq = createParam('fltr_freq');
const fltr_rel = createParam('fltr_rel');
const fltr_reso = createParam('fltr_reso');
const fltr_sus = createParam('fltr_sus');
const fltr_type = createParam('fltr_type');
const harm = createParam('harm');
const levA = createParam('levA');
const levB = createParam('levB');
const mix = createParam('mix');
const ratioA = createParam('ratioA');
const ratioB = createParam('ratioB');
const ratioC = createParam('ratioC');
const width = createParam('width');

// ============================================================================
// Helper Functions & Noise Nodes
// ============================================================================

/**
 * Note and Frequency Conversion Helpers
 * Ported from Strudel superdough (util.mjs, helpers.mjs)
 */
const noteToMidi = (note, defaultOctave = 3) => {
  if (typeof note !== 'string') {
    throw new Error('not a note: "' + note + '"');
  }
  const match = note.match(/^([a-gA-G])([#bsf]*)(-?[0-9]*)$/);
  const [pc, acc = '', octStr] = match?.slice(1) || [];
  if (!pc) {
    throw new Error('not a note: "' + note + '"');
  }
  const oct = octStr !== '' && octStr !== undefined ? Number(octStr) : defaultOctave;
  const chromas = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const accs = { '#': 1, b: -1, s: 1, f: -1 };
  const offset = acc.split('').reduce((o, char) => o + (accs[char] || 0), 0);
  const chroma = chromas[pc.toLowerCase()];
  return (Number(oct) + 1) * 12 + chroma + offset;
};

const midiToFreq = (n) => {
  return Math.pow(2, (n - 69) / 12) * 440;
};

const getFrequencyFromValue = (value, defaultNote = 36) => {
  let { note, freq, octave = 0 } = value;
  note = note || defaultNote;
  if (typeof note === 'string') {
    note = noteToMidi(note); // e.g. c3 => 48
  }
  // get frequency
  if (!freq && typeof note === 'number') {
    freq = midiToFreq(note); // + 48);
  }
  freq *= Math.pow(2, octave);
  return Number(freq);
};

/**
 * Gain adjustment helper ported from Strudel superdough (synth.mjs)
 * Applies base attenuation (0.3) and voice scaling (1 / Math.sqrt(voices))
 * to prevent clipping when playing polyphonic chords.
 *
 * References:
 * - https://codeberg.org/uzu/strudel/src/branch/main/packages/superdough/synth.mjs
 *   - const g = gainNode(0.3); // turn down
 *   - const gainAdjustment = 1 / Math.sqrt(voices);
 */
const getGainAdjustment = (value, baseGain = 0.3) => {
  const v = Number(value?.voices ?? value?.unison ?? 1);
  const numVoices = Math.max(1, Math.min(100, isNaN(v) ? 1 : v));
  const gainAdjustment = 1 / Math.sqrt(numVoices);
  return baseGain * gainAdjustment;
};



/**
 * White Noise Generator Node
 */
const whiteNoiseNode = (ctx, gain = 0.4) => {
  const audioCtx = ctx;
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);

  for (let channel = 0; channel < noiseBuffer.numberOfChannels; channel++) {
    const channelData = noiseBuffer.getChannelData(channel);
    for (let i = 0; i < bufferSize; i++) {
      channelData[i] = Math.random() * 2 - 1;
    }
  }

  const source = audioCtx.createBufferSource();
  const gainNode = new GainNode(audioCtx, { gain: gain });
  source.buffer = noiseBuffer;
  source.loop = true;
  source.connect(gainNode);

  return {
    noise: source,
    node: gainNode,
    disconnect: () => {
      source.disconnect();
      gainNode.disconnect();
    },
  };
};

/**
 * Pink Noise Generator Node (Paul Kellet's filtered white noise algorithm)
 */
const pinkNoiseNode = (ctx, gain = 0.4) => {
  const audioCtx = ctx;
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);

  for (let channel = 0; channel < noiseBuffer.numberOfChannels; channel++) {
    const channelData = noiseBuffer.getChannelData(channel);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      channelData[i] =
        (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }

  const source = audioCtx.createBufferSource();
  const gainNode = new GainNode(audioCtx, { gain: gain });
  source.buffer = noiseBuffer;
  source.loop = true;
  source.connect(gainNode);

  return {
    noise: source,
    node: gainNode,
    disconnect: () => {
      source.disconnect();
      gainNode.disconnect();
    },
  };
};

/**
 * Clip Noise Generator Node (Random values of -1 or +1)
 */
const clipNoiseNode = (ctx, gain = 0.4) => {
  const audioCtx = ctx;
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);

  for (let channel = 0; channel < noiseBuffer.numberOfChannels; channel++) {
    const channelData = noiseBuffer.getChannelData(channel);
    for (let i = 0; i < bufferSize; i++) {
      channelData[i] = Math.random() < 0.5 ? -1 : 1;
    }
  }

  const source = audioCtx.createBufferSource();
  const gainNode = new GainNode(audioCtx, { gain: gain });
  source.buffer = noiseBuffer;
  source.loop = true;
  source.connect(gainNode);

  return {
    noise: source,
    node: gainNode,
    disconnect: () => {
      source.disconnect();
      gainNode.disconnect();
    },
  };
};

/**
 * Low Frequency / Stepped Noise Generator Node (LFNoise0 simulation)
 */
const lfNoise0Node = (ctx, stepFreq = 1000, gain = 0.4) => {
  const audioCtx = ctx;
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const channelData = noiseBuffer.getChannelData(0);
  const stepSamples = Math.max(1, Math.floor(audioCtx.sampleRate / stepFreq));

  let currentVal = Math.random() * 2 - 1;
  for (let i = 0; i < bufferSize; i++) {
    if (i % stepSamples === 0) {
      currentVal = Math.random() * 2 - 1;
    }
    channelData[i] = currentVal;
  }

  const source = audioCtx.createBufferSource();
  const gainNode = new GainNode(audioCtx, { gain: gain });
  source.buffer = noiseBuffer;
  source.loop = true;
  source.connect(gainNode);

  return {
    noise: source,
    node: gainNode,
    disconnect: () => {
      source.disconnect();
      gainNode.disconnect();
    },
  };
};

// Cached distortion curves
let _tanhCurveCache = null;
const getTanhCurve = () => {
  if (_tanhCurveCache) return _tanhCurveCache;
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * 2.5);
  }
  _tanhCurveCache = curve;
  return curve;
};

let _softClipCurveCache = null;
const getSoftClipCurve = () => {
  if (_softClipCurveCache) return _softClipCurveCache;
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = 1.5 * x * (1 - (x * x) / 3);
  }
  _softClipCurveCache = curve;
  return curve;
};

let _crossoverCurveCache = null;
const getCrossoverCurve = (threshold = 0.2) => {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    if (Math.abs(x) < threshold) {
      curve[i] = 0;
    } else {
      curve[i] =
        x > 0
          ? (x - threshold) / (1 - threshold)
          : (x + threshold) / (1 - threshold);
    }
  }
  return curve;
};

/**
 * WaveShaper Distortion Node
 */
const waveShaperNode = (ctx, type = 'tanh', amount = 1) => {
  const shaper = new WaveShaperNode(ctx, { oversample: '2x' });
  if (type === 'tanh') {
    shaper.curve = getTanhCurve();
  } else if (type === 'softclip') {
    shaper.curve = getSoftClipCurve();
  } else if (type === 'crossover') {
    shaper.curve = getCrossoverCurve(0.2 * amount);
  } else {
    shaper.curve = getTanhCurve();
  }
  return shaper;
};

/**
 * Comb Filter Node
 */
const combFilterNode = (ctx, delaySec = 0.02, feedback = 0.5) => {
  const input = new GainNode(ctx, { gain: 1 });
  const delay = new DelayNode(ctx, { delayTime: Math.min(delaySec, 1.0) });
  const feedbackGain = new GainNode(ctx, { gain: feedback });
  const output = new GainNode(ctx, { gain: 1 });

  input.connect(delay);
  input.connect(output);
  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(output);

  return {
    input: input,
    output: output,
    disconnect: () => {
      input.disconnect();
      delay.disconnect();
      feedbackGain.disconnect();
      output.disconnect();
    },
  };
};

/**
 * Klang (Additive Synthesis Partials) Helper Node
 */
const createKlangNode = (ctx, baseFreq, ratios, amps, time, dur) => {
  const count = Math.min(ratios.length, amps.length);
  const outGain = new GainNode(ctx, { gain: 1 / Math.max(1, count) });
  const oscs = [];
  const gains = [];
  for (let i = 0; i < count; i++) {
    const f = Math.max(10, Math.min(22000, Number(baseFreq) * ratios[i]));
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    const g = new GainNode(ctx, { gain: Number(amps[i]) });
    osc.connect(g);
    g.connect(outGain);
    osc.start(time);
    osc.stop(time + dur - 0.001);
    oscs.push(osc);
    gains.push(g);
  }

  return {
    node: outGain,
    oscillators: oscs,
    gains: gains,
    disconnect: () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      gains.forEach((g) => {
        try {
          g.disconnect();
        } catch (e) {}
      });
      outGain.disconnect();
    },
    stop: (t) => {
      oscs.forEach((o) => {
        try {
          o.stop(t);
        } catch (e) {}
      });
    },
  };
};

// ============================================================================
// SynthDef Ports (51 Synthesizers)
// ============================================================================

// ----------------------------------------------------------------------------
// 1. sbd2 - Bass Drum 2
// ----------------------------------------------------------------------------
registerSound(
  'sbd2',
  (time, value, onended) => {
    let { freq, amp, attack, decay, duration, sustain, release } = value;
    const ctx = getAudioContext();

    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultAttack = Number(attack ?? value.atk ?? 0.005);
    const defaultLen = Number(decay ?? value.len ?? 0.2);
    const defaultSust = Number(sustain ?? value.sust ?? 0.1);
    const clipDur = duration - 0.01;

    const defaultFreq = getFrequencyFromValue(value, 60);
    const ratio = defaultFreq / 261;

    // Body: pitch drop 261 -> 150 -> 50 Hz (scaled by ratio)
    const bodyOsc = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    bodyOsc.frequency.setValueAtTime(defaultFreq, time);
    bodyOsc.frequency.exponentialRampToValueAtTime(
      Math.max(20, 150 * ratio),
      time + 0.02,
    );
    bodyOsc.frequency.exponentialRampToValueAtTime(
      Math.max(20, 50 * ratio),
      time + 0.12,
    );

    const bodyGain = new GainNode(ctx, { gain: 0 });
    bodyGain.gain.setValueAtTime(0, time);
    bodyGain.gain.linearRampToValueAtTime(1.4, time + defaultAttack);
    bodyGain.gain.setValueAtTime(1.4, time + defaultAttack + defaultSust);
    bodyGain.gain.linearRampToValueAtTime(
      0,
      time + defaultAttack + defaultSust + defaultLen,
    );
    bodyGain.gain.linearRampToValueAtTime(0, time + clipDur);

    // Pop: 750 -> 261 Hz sweep (scaled by ratio)
    const popOsc = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: Math.max(20, 750 * ratio),
    });
    popOsc.frequency.setValueAtTime(Math.max(20, 750 * ratio), time);
    popOsc.frequency.exponentialRampToValueAtTime(defaultFreq, time + 0.01);

    const popGain = new GainNode(ctx, { gain: 0 });
    popGain.gain.setValueAtTime(0, time);
    popGain.gain.linearRampToValueAtTime(0.15, time + 0.001);
    popGain.gain.setValueAtTime(0.15, time + 0.021);
    popGain.gain.linearRampToValueAtTime(0, time + 0.022);

    // Click: highpass pulse burst
    const clickOsc = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: 910,
    });
    const clickFilter = new BiquadFilterNode(ctx, {
      type: 'bandpass',
      frequency: 2110,
      Q: 3,
    });
    const clickGain = new GainNode(ctx, { gain: 0 });
    clickGain.gain.setValueAtTime(0, time);
    clickGain.gain.linearRampToValueAtTime(0.4, time + 0.001);
    clickGain.gain.linearRampToValueAtTime(0, time + 0.003);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: defaultAmp });

    bodyOsc.connect(bodyGain);
    bodyGain.connect(shaper);
    popOsc.connect(popGain);
    popGain.connect(shaper);
    clickOsc.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(shaper);
    shaper.connect(masterGain);

    bodyOsc.start(time);
    popOsc.start(time);
    clickOsc.start(time);

    bodyOsc.stop(time + duration - 0.001);
    popOsc.stop(time + duration - 0.001);
    clickOsc.stop(time + duration - 0.001);

    bodyOsc.addEventListener('ended', () => {
      bodyOsc.disconnect();
      bodyGain.disconnect();
      popOsc.disconnect();
      popGain.disconnect();
      clickOsc.disconnect();
      clickFilter.disconnect();
      clickGain.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        bodyOsc.stop(t);
        popOsc.stop(t);
        clickOsc.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 2. sbd - Bass Drum (Sub/Punch)
// ----------------------------------------------------------------------------
registerSound(
  'sbd',
  (time, value, onended) => {
    let { freq, amp, attack, decay, duration, sustain, release } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 29);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultLen = Number(decay ?? value.len ?? 0.5);
    const clipDur = duration - 0.01;

    // Body
    const bodyOsc = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 6,
    });
    bodyOsc.frequency.setValueAtTime(defaultFreq * 6, time);
    bodyOsc.frequency.exponentialRampToValueAtTime(
      Math.max(20, defaultFreq * 3),
      time + 0.01,
    );
    bodyOsc.frequency.exponentialRampToValueAtTime(
      Math.max(20, defaultFreq),
      time + 0.09,
    );

    const bodyGain = new GainNode(ctx, { gain: 0 });
    bodyGain.gain.setValueAtTime(0, time);
    bodyGain.gain.linearRampToValueAtTime(1.0, time + 0.001);
    bodyGain.gain.linearRampToValueAtTime(0.75, time + 0.001 + defaultLen / 4);
    bodyGain.gain.linearRampToValueAtTime(
      0,
      time + 0.001 + defaultLen / 4 + defaultLen / 2,
    );
    bodyGain.gain.linearRampToValueAtTime(0, time + clipDur);

    // Pop
    const popOsc = new OscillatorNode(ctx, { type: 'sine', frequency: 750 });
    popOsc.frequency.setValueAtTime(750, time);
    popOsc.frequency.exponentialRampToValueAtTime(250, time + 0.01);
    const popGain = new GainNode(ctx, { gain: 0 });
    popGain.gain.setValueAtTime(0, time);
    popGain.gain.linearRampToValueAtTime(0.3, time + 0.001);
    popGain.gain.setValueAtTime(0.3, time + 0.02);
    popGain.gain.linearRampToValueAtTime(0, time + 0.022);

    // FM Click
    const clickMod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 4,
    });
    const clickModGain = new GainNode(ctx, { gain: defaultFreq * 4 * 80 });
    clickModGain.gain.setValueAtTime(defaultFreq * 4 * 80, time);
    clickModGain.gain.exponentialRampToValueAtTime(
      defaultFreq * 4 * 0.1,
      time + 0.02,
    );

    const clickCar = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const clickGain = new GainNode(ctx, { gain: 0 });
    clickGain.gain.setValueAtTime(0, time);
    clickGain.gain.linearRampToValueAtTime(0.4, time + 0.001);
    clickGain.gain.linearRampToValueAtTime(0, time + 0.002);

    clickMod.connect(clickModGain);
    clickModGain.connect(clickCar.frequency);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: defaultAmp * 1.2 });

    bodyOsc.connect(bodyGain);
    bodyGain.connect(shaper);
    popOsc.connect(popGain);
    popGain.connect(shaper);
    clickCar.connect(clickGain);
    clickGain.connect(shaper);
    shaper.connect(masterGain);

    bodyOsc.start(time);
    popOsc.start(time);
    clickMod.start(time);
    clickCar.start(time);

    bodyOsc.stop(time + duration - 0.001);
    popOsc.stop(time + duration - 0.001);
    clickMod.stop(time + duration - 0.001);
    clickCar.stop(time + duration - 0.001);

    bodyOsc.addEventListener('ended', () => {
      bodyOsc.disconnect();
      bodyGain.disconnect();
      popOsc.disconnect();
      popGain.disconnect();
      clickMod.disconnect();
      clickModGain.disconnect();
      clickCar.disconnect();
      clickGain.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        bodyOsc.stop(t);
        popOsc.stop(t);
        clickMod.stop(t);
        clickCar.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 3. shh - Closed Hi-Hat
// ----------------------------------------------------------------------------
registerSound(
  'shh',
  (time, value, onended) => {
    let { freq, amp, attack, decay, duration, modrate, index } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 111);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1);
    const defaultIndex = Number(index ?? 3);
    const defaultLen = Number(decay ?? value.len ?? 0.1);
    const clipDur = duration - 0.01;

    // Carrier & Modulator
    const car = new OscillatorNode(ctx, {
      type: 'square',
      frequency: defaultFreq,
    });
    const mod = new OscillatorNode(ctx, {
      type: 'square',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });

    // Ring mod source simulation
    const ring = new OscillatorNode(ctx, { type: 'square', frequency: 700 });
    const ringGain = new GainNode(ctx, { gain: 1 });

    const filter = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 6000,
      Q: 3.33,
    });
    const masterGain = new GainNode(ctx, { gain: 0 });

    mod.connect(modGain);
    modGain.connect(car.frequency);
    car.connect(filter);
    ring.connect(ringGain);
    ringGain.connect(filter);
    filter.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);
    ring.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);
    ring.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      ring.disconnect();
      ringGain.disconnect();
      filter.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
        ring.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 4. soh - Open Hi-Hat
// ----------------------------------------------------------------------------
registerSound(
  'soh',
  (time, value, onended) => {
    let { freq, amp, attack, decay, duration, modrate, index } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 111);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1);
    const defaultIndex = Number(index ?? 3);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'square',
      frequency: defaultFreq,
    });
    const mod = new OscillatorNode(ctx, {
      type: 'square',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });

    const ring = new OscillatorNode(ctx, { type: 'square', frequency: 700 });
    const ringGain = new GainNode(ctx, { gain: 1 });

    const filter = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 6000,
      Q: 3.33,
    });
    const masterGain = new GainNode(ctx, { gain: 0 });

    mod.connect(modGain);
    modGain.connect(car.frequency);
    car.connect(filter);
    ring.connect(ringGain);
    ringGain.connect(filter);
    filter.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);
    ring.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);
    ring.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      ring.disconnect();
      ringGain.disconnect();
      filter.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
        ring.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 5. mchbd - Microtonal/Complex Kick
// ----------------------------------------------------------------------------
registerSound(
  'mchbd',
  (time, value, onended) => {
    let { freq, amp, duration, clr, shp, sweep, contour, len, plen } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 31);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultLen = Number(len ?? 0.4);
    const defaultPlen = Number(plen ?? 0.1);
    const defaultSweep = Number(sweep ?? 1);
    const defaultClr = Number(clr ?? 0);
    const defaultShp = Number(shp ?? 0.5);
    const clipDur = duration - 0.01;

    // Carrier
    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * (1 + defaultSweep * 6), time);
    car.frequency.exponentialRampToValueAtTime(
      defaultFreq * (1 + defaultSweep * 1.2),
      time + 0.03,
    );
    car.frequency.exponentialRampToValueAtTime(
      defaultFreq,
      time + 0.03 + defaultPlen,
    );

    // Modulator
    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * 32 * defaultSweep,
    });
    modGain.gain.setValueAtTime(defaultFreq * 32 * defaultSweep, time);
    modGain.gain.exponentialRampToValueAtTime(0.1, time + 0.002);
    mod.connect(modGain);
    modGain.connect(car.frequency);

    // Harmonics
    const h3 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 3,
    });
    const h3Gain = new GainNode(ctx, { gain: Math.max(0, defaultClr * 0.3) });
    h3.connect(h3Gain);

    // Triangle component
    const tri = new OscillatorNode(ctx, {
      type: 'triangle',
      frequency: defaultFreq,
    });
    const triGain = new GainNode(ctx, { gain: defaultShp * 0.9 });
    tri.connect(triGain);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(shaper);
    h3Gain.connect(shaper);
    triGain.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 0.63, time + 0.001);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.31,
      time + 0.001 + defaultLen / 4,
    );
    masterGain.gain.linearRampToValueAtTime(
      0,
      time + 0.001 + defaultLen * 1.25,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);
    h3.start(time);
    tri.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);
    h3.stop(time + duration - 0.001);
    tri.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      h3.disconnect();
      h3Gain.disconnect();
      tri.disconnect();
      triGain.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
        h3.stop(t);
        tri.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 6. mchtone - Microtonal Feedback Tone
// ----------------------------------------------------------------------------
registerSound(
  'mchtone',
  (time, value, onended) => {
    let { freq, amp, duration, clr, shp, sweep, len } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 31);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultLen = Number(len ?? 0.4);
    const defaultClr = Number(clr ?? 1);
    const defaultShp = Number(shp ?? 0.5);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultClr,
    });
    const modGain = new GainNode(ctx, { gain: defaultFreq * defaultShp * 16 });

    mod.connect(modGain);
    modGain.connect(car.frequency);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 0.63, time + 0.001);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.31,
      time + 0.001 + defaultLen / 4,
    );
    masterGain.gain.linearRampToValueAtTime(
      0,
      time + 0.001 + defaultLen * 1.25,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 7. skik - FM Kick (from instruction.md reference)
// ----------------------------------------------------------------------------
registerSound(
  'skik',
  (time, value, onended) => {
    let { freq, amp, prate, attack, decay, duration, sustain, release } = value;
    const ctx = getAudioContext();

    const pitchRate = prate ?? 4;
    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAttack = attack ?? 0.001;
    const defaultLen = decay ?? 1;
    const defaultSustain = sustain ?? 0.3;
    const defaultRelease = release ?? 0.9;

    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value, 0.4);
    const maxGain = defaultAmp;
    const index = 128 * 12;
    const clipDur = duration - 0.01;

    const o = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: Number(defaultFreq),
    });
    const a = new GainNode(ctx, {
      gain: maxGain,
    });

    const m = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: Number(defaultFreq * 2),
    });
    const ma = new GainNode(ctx, {
      gain: index,
    });

    const highpass = new BiquadFilterNode(ctx, {
      type: 'highpass',
      Q: 2,
      frequency: 30,
    });

    m.connect(ma);
    ma.connect(o.frequency);
    o.connect(a);
    highpass.connect(a);

    const pEnv = { a: 0.001, d: 0.04 };
    const mpEnv = { a: 0.001, d: 0.002 };

    const oFreq = o.frequency.value;
    const mFreq = m.frequency.value;

    o.frequency.cancelScheduledValues(time);
    o.frequency.setValueAtTime(oFreq * pitchRate, time);
    o.frequency.setTargetAtTime(oFreq, time, pEnv.d);

    m.frequency.cancelScheduledValues(time);
    m.frequency.setValueAtTime(8000, time);
    m.frequency.setTargetAtTime(mFreq, time, mpEnv.d);

    const aEnv = {
      a: defaultAttack,
      d: defaultLen,
      s: defaultSustain,
      r: defaultRelease,
    };

    a.gain.cancelScheduledValues(time);
    a.gain.setValueAtTime(0, time);
    a.gain.linearRampToValueAtTime(maxGain, time + aEnv.a);
    a.gain.linearRampToValueAtTime(aEnv.s, time + aEnv.a + aEnv.d);
    a.gain.linearRampToValueAtTime(0, time + aEnv.a + aEnv.d + aEnv.r);
    a.gain.linearRampToValueAtTime(0, time + clipDur);

    const maEnv = {
      a: 0.001,
      d: 0.002,
      s: 48,
      r: defaultRelease,
    };

    ma.gain.cancelScheduledValues(time);
    ma.gain.setValueAtTime(0, time);
    ma.gain.linearRampToValueAtTime(index, time + maEnv.a);
    ma.gain.linearRampToValueAtTime(maEnv.s, time + maEnv.a + maEnv.d);
    ma.gain.linearRampToValueAtTime(0, time + maEnv.a + maEnv.d + maEnv.r);
    ma.gain.linearRampToValueAtTime(0, time + clipDur);

    o.start(time);
    m.start(time);

    o.stop(time + duration - 0.001);
    m.stop(time + duration - 0.001);

    o.addEventListener('ended', () => {
      m.disconnect();
      ma.disconnect();
      o.disconnect();
      a.disconnect();
      highpass.disconnect();
      onended();
    });

    return {
      node: a,
      stop: (t) => {
        o.stop(t);
        m.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 8. skik2 - Dual FM Kick with Click
// ----------------------------------------------------------------------------
registerSound(
  'skik2',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, plen, prate, index, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 31);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1);
    const defaultPlen = Number(plen ?? 0.01);
    const defaultPrate = Number(prate ?? 8);
    const defaultIndex = Number(index ?? 42);
    const defaultLen = Number(decay ?? value.len ?? 0.4);
    const clipDur = duration - 0.01;

    // Carrier
    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * defaultPrate, time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    // Mod 1
    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    // Click
    const click = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 4,
    });
    const clickGain = new GainNode(ctx, { gain: 0 });
    clickGain.gain.setValueAtTime(0.5, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
    click.connect(clickGain);

    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 50,
      Q: 1.4,
    });
    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(hpf);
    clickGain.connect(hpf);
    hpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 0.6, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);
    click.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);
    click.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      click.disconnect();
      clickGain.disconnect();
      hpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
        click.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 9. sak - Attack / Snare / Kick Hybrid
// ----------------------------------------------------------------------------
registerSound(
  'sak',
  (time, value, onended) => {
    let { freq, amp, duration, plen, prate, index, modrate, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 31);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.12);
    const defaultPrate = Number(prate ?? 6);
    const defaultLen = Number(decay ?? value.len ?? 1.4);
    const defaultIndex = Number(index ?? 32);
    const defaultModrate = Number(modrate ?? 1);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * defaultPrate, time);
    car.frequency.exponentialRampToValueAtTime(
      defaultFreq * (defaultPrate / 2),
      time + defaultPlen / 8,
    );
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultModrate * defaultIndex * 50,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 50,
      Q: 3.33,
    });
    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(hpf);
    hpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      hpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 10. sak2 - Additive Hit
// ----------------------------------------------------------------------------
registerSound(
  'sak2',
  (time, value, onended) => {
    let { freq, amp, duration, plen, decay } = value;
    const ctx = getAudioContext();

    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.1);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const clipDur = duration - 0.01;

    const defaultFreq = getFrequencyFromValue(value, 31);
    const ratio =
      value.note !== undefined || value.freq !== undefined
        ? defaultFreq / 49
        : 1;

    const oscs = [];
    const mixer = new GainNode(ctx, { gain: 1 / 18 });

    for (let i = 0; i < 18; i++) {
      const baseF = (20 + ((i * 73) % 80)) * ratio; // Deterministic pseudo-hash 20-100Hz
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: baseF });
      osc.frequency.setValueAtTime(baseF * 12, time);
      osc.frequency.exponentialRampToValueAtTime(
        baseF * 4,
        time + defaultPlen / 4,
      );
      osc.frequency.exponentialRampToValueAtTime(baseF, time + defaultPlen);
      osc.connect(mixer);
      osc.start(time);
      osc.stop(time + duration - 0.001);
      oscs.push(osc);
    }

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    mixer.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 2, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    oscs[0].addEventListener('ended', () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      mixer.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        oscs.forEach((o) => {
          try {
            o.stop(t);
          } catch (e) {}
        });
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 11. ssn - Snare (from instruction.md reference)
// ----------------------------------------------------------------------------
registerSound(
  'ssn',
  (time, value, onended) => {
    let { freq, amp, prate, attack, decay, duration, sustain, release } = value;
    const ctx = getAudioContext();

    const pitchRate = prate ?? 4;
    const defaultFreq = getFrequencyFromValue(value, 47);
    const defaultAttack = attack ?? 0.001;
    const defaultLen = decay ?? 0.5;
    const defaultSustain = sustain ?? 0;
    const defaultRelease = release ?? 0.9;

    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value, 0.6);
    const maxGain = defaultAmp;
    const index = 128 * 8;
    const clipDur = duration - 0.01;

    const o = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: Number(defaultFreq),
    });

    const {
      noise,
      node: noiseNode,
      disconnect: disconnectNoise,
    } = whiteNoiseNode(ctx);

    const a = new GainNode(ctx, {
      gain: maxGain,
    });

    const m = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: Number(defaultFreq),
    });

    const ma = new GainNode(ctx, {
      gain: index,
    });

    const highpass = new BiquadFilterNode(ctx, {
      type: 'highpass',
      Q: 4,
      frequency: 120,
    });

    m.connect(ma);
    ma.connect(o.frequency);
    o.connect(a);
    noiseNode.connect(a);
    highpass.connect(a);

    const pEnv = { a: 0.001, d: 0.01 };
    const mpEnv = { a: 0.001, d: 0.09 };

    const oFreq = o.frequency.value;
    const mFreq = m.frequency.value;

    o.frequency.cancelScheduledValues(time);
    o.frequency.setValueAtTime(oFreq * pitchRate, time);
    o.frequency.setTargetAtTime(oFreq, time, pEnv.d);

    m.frequency.cancelScheduledValues(time);
    m.frequency.setValueAtTime(mFreq * pitchRate, time);
    m.frequency.setTargetAtTime(mFreq, time, mpEnv.d);

    const aEnv = {
      a: defaultAttack,
      d: defaultLen,
      s: defaultSustain,
      r: defaultRelease,
    };

    a.gain.cancelScheduledValues(time);
    a.gain.setValueAtTime(0, time);
    a.gain.linearRampToValueAtTime(maxGain, time + aEnv.a);
    a.gain.linearRampToValueAtTime(aEnv.s, time + aEnv.a + aEnv.d);
    a.gain.linearRampToValueAtTime(0, time + aEnv.a + aEnv.d + aEnv.r);
    a.gain.linearRampToValueAtTime(0, time + clipDur);

    const maEnv = {
      a: 0.001,
      d: 0.04,
      s: 0,
      r: defaultRelease,
    };

    ma.gain.cancelScheduledValues(time);
    ma.gain.setValueAtTime(0, time);
    ma.gain.linearRampToValueAtTime(index, time + maEnv.a);
    ma.gain.linearRampToValueAtTime(maEnv.s, time + maEnv.a + maEnv.d);
    ma.gain.linearRampToValueAtTime(0, time + maEnv.a + maEnv.d + maEnv.r);
    ma.gain.linearRampToValueAtTime(0, time + clipDur);

    o.start(time);
    noise.start(time);
    m.start(time);

    o.stop(time + duration - 0.001);
    noise.stop(time + duration - 0.001);
    m.stop(time + duration - 0.001);

    o.addEventListener('ended', () => {
      m.disconnect();
      ma.disconnect();
      disconnectNoise();
      o.disconnect();
      a.disconnect();
      highpass.disconnect();
      onended();
    });

    return {
      node: a,
      stop: (t) => {
        o.stop(t);
        noise.stop(t);
        m.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 12. scp - Handclap
// ----------------------------------------------------------------------------
registerSound(
  'scp',
  (time, value, onended) => {
    let { amp, attack, decay, duration, q } = value;
    const ctx = getAudioContext();

    const defaultAmp = Number(amp ?? 1.5) * getGainAdjustment(value);
    const defaultAtk = Number(attack ?? value.atk ?? 0.0001);
    const defaultLen = Number(decay ?? value.len ?? 0.3);
    const defaultQ = Number(q ?? 0.7);
    const clipDur = duration - 0.01;

    const {
      noise,
      node: noiseNode,
      disconnect: disconnectNoise,
    } = lfNoise0Node(ctx, 12000, 1.0);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 12000,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(12000, time);
    rlpf.frequency.exponentialRampToValueAtTime(4000, time + defaultLen);

    const bpf = new BiquadFilterNode(ctx, {
      type: 'bandpass',
      frequency: 8000,
      Q: 10,
    });
    bpf.frequency.setValueAtTime(8000, time);
    bpf.frequency.exponentialRampToValueAtTime(800, time + defaultLen);

    const rhpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 800,
      Q: 3.33,
    });

    // Double clap envelope (burst 1 at t, burst 2 at t + 0.02)
    const envGain = new GainNode(ctx, { gain: 0 });
    envGain.gain.setValueAtTime(0, time);
    envGain.gain.linearRampToValueAtTime(0.8, time + defaultAtk);
    envGain.gain.exponentialRampToValueAtTime(0.1, time + 0.018);
    envGain.gain.linearRampToValueAtTime(1.0, time + 0.02 + defaultAtk);
    envGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.02 + defaultLen);
    envGain.gain.linearRampToValueAtTime(0, time + clipDur);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: defaultAmp });

    noiseNode.connect(rlpf);
    rlpf.connect(bpf);
    bpf.connect(rhpf);
    rhpf.connect(envGain);
    envGain.connect(shaper);
    shaper.connect(masterGain);

    noise.start(time);
    noise.stop(time + duration - 0.001);

    noise.addEventListener('ended', () => {
      disconnectNoise();
      rlpf.disconnect();
      bpf.disconnect();
      rhpf.disconnect();
      envGain.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        noise.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 13. sperc - Percussion
// ----------------------------------------------------------------------------
registerSound(
  'sperc',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, plen, index, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 51);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 0.4);
    const defaultPlen = Number(plen ?? 0.1);
    const defaultIndex = Number(index ?? 5);
    const defaultLen = Number(decay ?? value.len ?? 0.8);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * 4, time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 80,
      Q: 1.0,
    });
    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(hpf);
    hpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      hpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 14. stom - Tom
// ----------------------------------------------------------------------------
registerSound(
  'stom',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, plen, index, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 41);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 2);
    const defaultPlen = Number(plen ?? 0.05);
    const defaultIndex = Number(index ?? 8);
    const defaultLen = Number(decay ?? value.len ?? 0.3);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * 4, time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 15. snoise - Filtered Noise Burst
// ----------------------------------------------------------------------------
registerSound(
  'snoise',
  (time, value, onended) => {
    let { amp, duration, decay } = value;
    const ctx = getAudioContext();

    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const {
      noise,
      node: noiseNode,
      disconnect: disconnectNoise,
    } = clipNoiseNode(ctx, 0.5);
    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 7000,
      Q: 1.0,
    });
    const masterGain = new GainNode(ctx, { gain: 0 });

    noiseNode.connect(hpf);
    hpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    noise.start(time);
    noise.stop(time + duration - 0.001);

    noise.addEventListener('ended', () => {
      disconnectNoise();
      hpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        noise.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 16. ssub - Sub Bass
// ----------------------------------------------------------------------------
registerSound(
  'ssub',
  (time, value, onended) => {
    let { freq, amp, duration, attack, decay, sustain, release } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultAtk = Number(attack ?? value.atk ?? 0.001);
    const defaultLen = Number(decay ?? value.len ?? 0.3);
    const defaultSust = Number(sustain ?? value.sust ?? 0.9);
    const defaultRel = Number(release ?? 0.1);
    const clipDur = duration - 0.01;

    const osc1 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const osc2 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 2,
    });
    const osc3 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 3,
    });

    const g1 = new GainNode(ctx, { gain: 0.3 });
    const g2 = new GainNode(ctx, { gain: 0.01 });
    const g3 = new GainNode(ctx, { gain: 0.05 });

    osc1.connect(g1);
    osc2.connect(g2);
    osc3.connect(g3);

    const lpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 200,
      Q: 1.0,
    });
    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    g1.connect(lpf);
    g2.connect(lpf);
    g3.connect(lpf);
    lpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 3, time + defaultAtk);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 3 * defaultSust,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(
      0,
      time + defaultAtk + defaultLen + defaultRel,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    osc1.start(time);
    osc2.start(time);
    osc3.start(time);

    osc1.stop(time + duration - 0.001);
    osc2.stop(time + duration - 0.001);
    osc3.stop(time + duration - 0.001);

    osc1.addEventListener('ended', () => {
      osc1.disconnect();
      osc2.disconnect();
      osc3.disconnect();
      g1.disconnect();
      g2.disconnect();
      g3.disconnect();
      lpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        osc1.stop(t);
        osc2.stop(t);
        osc3.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 17. s808 - 808 Bass
// ----------------------------------------------------------------------------
registerSound(
  's808',
  (time, value, onended) => {
    let { freq, amp, duration, plen, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.2);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const osc1 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const osc2 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 2,
    });
    const osc3 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 3,
    });

    [osc1, osc2, osc3].forEach((osc, idx) => {
      const mul = idx + 1;
      osc.frequency.setValueAtTime(defaultFreq * mul, time);
      osc.frequency.linearRampToValueAtTime(
        defaultFreq * mul * 1.5,
        time + 0.01,
      );
      osc.frequency.exponentialRampToValueAtTime(
        defaultFreq * mul,
        time + defaultPlen,
      );
    });

    const g1 = new GainNode(ctx, { gain: 0.3 });
    const g2 = new GainNode(ctx, { gain: 0.08 });
    const g3 = new GainNode(ctx, { gain: 0.14 });

    osc1.connect(g1);
    osc2.connect(g2);
    osc3.connect(g3);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    g1.connect(shaper);
    g2.connect(shaper);
    g3.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 1.6, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    osc1.start(time);
    osc2.start(time);
    osc3.start(time);

    osc1.stop(time + duration - 0.001);
    osc2.stop(time + duration - 0.001);
    osc3.stop(time + duration - 0.001);

    osc1.addEventListener('ended', () => {
      osc1.disconnect();
      osc2.disconnect();
      osc3.disconnect();
      g1.disconnect();
      g2.disconnect();
      g3.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        osc1.stop(t);
        osc2.stop(t);
        osc3.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 18. dist808 - Distorted 808 Bass
// ----------------------------------------------------------------------------
registerSound(
  'dist808',
  (time, value, onended) => {
    let { freq, amp, duration, plen, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.05);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const osc1 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const osc2 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 2,
    });
    const osc3 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 3,
    });

    [osc1, osc2, osc3].forEach((osc, idx) => {
      const mul = idx + 1;
      osc.frequency.setValueAtTime(defaultFreq * mul, time);
      osc.frequency.linearRampToValueAtTime(
        defaultFreq * mul * 1.5,
        time + 0.01,
      );
      osc.frequency.exponentialRampToValueAtTime(
        defaultFreq * mul,
        time + defaultPlen,
      );
    });

    const g1 = new GainNode(ctx, { gain: 0.3 });
    const g2 = new GainNode(ctx, { gain: 0.08 });
    const g3 = new GainNode(ctx, { gain: 0.14 });

    osc1.connect(g1);
    osc2.connect(g2);
    osc3.connect(g3);

    const xoverShaper = waveShaperNode(ctx, 'crossover', 1.0);
    const tanhShaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    g1.connect(xoverShaper);
    g2.connect(xoverShaper);
    g3.connect(xoverShaper);
    xoverShaper.connect(tanhShaper);
    tanhShaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 2, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    osc1.start(time);
    osc2.start(time);
    osc3.start(time);

    osc1.stop(time + duration - 0.001);
    osc2.stop(time + duration - 0.001);
    osc3.stop(time + duration - 0.001);

    osc1.addEventListener('ended', () => {
      osc1.disconnect();
      osc2.disconnect();
      osc3.disconnect();
      g1.disconnect();
      g2.disconnect();
      g3.disconnect();
      xoverShaper.disconnect();
      tanhShaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        osc1.stop(t);
        osc2.stop(t);
        osc3.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 19. randhit - Random Multitone Hit
// ----------------------------------------------------------------------------
registerSound(
  'randhit',
  (time, value, onended) => {
    let { amp, duration, decay } = value;
    const ctx = getAudioContext();

    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const defaultFreq = getFrequencyFromValue(value, 60);
    const ratio =
      value.note !== undefined || value.freq !== undefined
        ? defaultFreq / 261.63
        : 1;

    const oscs = [];
    const mixer = new GainNode(ctx, { gain: 1 / 18 });

    for (let i = 0; i < 18; i++) {
      const baseF = Math.max(
        10,
        Math.min(22000, (20 + ((i * 683) % 11980)) * ratio),
      );
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: baseF });
      osc.frequency.setValueAtTime(baseF * 4, time);
      osc.frequency.exponentialRampToValueAtTime(baseF * 20, time + 0.01);
      osc.frequency.exponentialRampToValueAtTime(baseF * 2, time + defaultLen);
      osc.connect(mixer);
      osc.start(time);
      osc.stop(time + duration - 0.001);
      oscs.push(osc);
    }

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    mixer.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 4, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    oscs[0].addEventListener('ended', () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      mixer.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        oscs.forEach((o) => {
          try {
            o.stop(t);
          } catch (e) {}
        });
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 20. boom - Hashed Sub Boom
// ----------------------------------------------------------------------------
registerSound(
  'boom',
  (time, value, onended) => {
    let { amp, duration, plen, decay } = value;
    const ctx = getAudioContext();

    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.2);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const defaultFreq = getFrequencyFromValue(value, 60);
    const ratio =
      value.note !== undefined || value.freq !== undefined
        ? defaultFreq / 261.63
        : 1;

    const oscs = [];
    const mixer = new GainNode(ctx, { gain: 1 / 18 });

    for (let i = 0; i < 18; i++) {
      const baseF = Math.max(
        10,
        Math.min(22000, (20 + ((i * 997) % 11980)) * ratio),
      );
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: baseF });
      osc.frequency.setValueAtTime(baseF * 4, time);
      osc.frequency.exponentialRampToValueAtTime(baseF * 10, time + 0.01);
      osc.frequency.exponentialRampToValueAtTime(baseF * 2, time + defaultPlen);
      osc.connect(mixer);
      osc.start(time);
      osc.stop(time + duration - 0.001);
      oscs.push(osc);
    }

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    mixer.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 4, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    oscs[0].addEventListener('ended', () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      mixer.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        oscs.forEach((o) => {
          try {
            o.stop(t);
          } catch (e) {}
        });
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 21. beam - Laser / Beam FX
// ----------------------------------------------------------------------------
registerSound(
  'beam',
  (time, value, onended) => {
    let { amp, duration, decay } = value;
    const ctx = getAudioContext();

    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const defaultFreq = getFrequencyFromValue(value, 60);
    const ratio =
      value.note !== undefined || value.freq !== undefined
        ? defaultFreq / 261.63
        : 1;

    const oscs = [];
    const mixer = new GainNode(ctx, { gain: 1 / 18 });

    for (let i = 0; i < 18; i++) {
      const baseF = Math.max(
        10,
        Math.min(22000, (20 + ((i * 443) % 11980)) * ratio),
      );
      const osc = new OscillatorNode(ctx, {
        type: 'sine',
        frequency: baseF * 2.4,
      });
      osc.frequency.setValueAtTime(baseF * 2.4, time);
      osc.frequency.exponentialRampToValueAtTime(
        baseF * 2.5,
        time + defaultLen,
      );
      osc.connect(mixer);
      osc.start(time);
      osc.stop(time + duration - 0.001);
      oscs.push(osc);
    }

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    mixer.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 4, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    oscs[0].addEventListener('ended', () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      mixer.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        oscs.forEach((o) => {
          try {
            o.stop(t);
          } catch (e) {}
        });
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 22. knife - Metallic Comb Slices
// ----------------------------------------------------------------------------
registerSound(
  'knife',
  (time, value, onended) => {
    let { freq, amp, duration, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 41);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const oscs = [];
    const mixer = new GainNode(ctx, { gain: 1 / 19 });

    for (let i = 0; i < 19; i++) {
      const norm = i / 19;
      const baseF =
        Math.max(
          20,
          Math.min(8000, 20 + Math.abs(Math.tan(Math.pow(norm, 4))) * 2000),
        ) *
        (defaultFreq / 88);
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: baseF });
      osc.connect(mixer);
      osc.start(time);
      osc.stop(time + duration - 0.001);
      oscs.push(osc);
    }

    const comb = combFilterNode(ctx, 1 / 100, 0.4);
    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 12000,
      Q: 2.0,
    });
    rlpf.frequency.setValueAtTime(12000, time);
    rlpf.frequency.exponentialRampToValueAtTime(1000, time + defaultLen / 2);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    mixer.connect(comb.input);
    comb.output.connect(rlpf);
    rlpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 3, time + 0.01);
    masterGain.gain.setValueAtTime(defaultAmp * 3, time + 0.11);
    masterGain.gain.linearRampToValueAtTime(0, time + 0.11 + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    oscs[0].addEventListener('ended', () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      mixer.disconnect();
      comb.disconnect();
      rlpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        oscs.forEach((o) => {
          try {
            o.stop(t);
          } catch (e) {}
        });
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 23. perc2 - Pitch Swept Percussion
// ----------------------------------------------------------------------------
registerSound(
  'perc2',
  (time, value, onended) => {
    let { freq, amp, duration, plen, prate, attack, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 35);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.01);
    const defaultPrate = Number(prate ?? 2);
    const defaultAtk = Number(attack ?? value.atk ?? 0.05);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const clipDur = duration - 0.01;

    const mainOsc = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultPrate,
    });
    mainOsc.frequency.setValueAtTime(defaultFreq * defaultPrate, time);
    mainOsc.frequency.linearRampToValueAtTime(defaultFreq, time + defaultPlen);

    const clickOsc = new OscillatorNode(ctx, { type: 'sine', frequency: 1000 });
    clickOsc.frequency.setValueAtTime(1000, time);
    clickOsc.frequency.linearRampToValueAtTime(defaultFreq, time + defaultPlen);

    const clickGain = new GainNode(ctx, { gain: 0 });
    clickGain.gain.setValueAtTime(0, time);
    clickGain.gain.linearRampToValueAtTime(0.5, time + 0.001);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.006);

    const shaper = waveShaperNode(ctx, 'softclip');
    const masterGain = new GainNode(ctx, { gain: 0 });

    mainOsc.connect(shaper);
    clickOsc.connect(clickGain);
    clickGain.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    mainOsc.start(time);
    clickOsc.start(time);

    mainOsc.stop(time + duration - 0.001);
    clickOsc.stop(time + duration - 0.001);

    mainOsc.addEventListener('ended', () => {
      mainOsc.disconnect();
      clickOsc.disconnect();
      clickGain.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        mainOsc.stop(t);
        clickOsc.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 24. sinpad - Sine Ambient Pad
// ----------------------------------------------------------------------------
registerSound(
  'sinpad',
  (time, value, onended) => {
    let { freq, amp, duration, plen, prate, attack, decay, sustain } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 35);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.01);
    const defaultPrate = Number(prate ?? 2);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const defaultSust = Number(sustain ?? value.sust ?? 1.0);
    const clipDur = duration - 0.01;

    // Dual Oscillators
    const osc1 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultPrate,
    });
    const osc2 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultPrate * 0.75,
    });

    osc1.frequency.setValueAtTime(defaultFreq * defaultPrate, time);
    osc1.frequency.linearRampToValueAtTime(defaultFreq, time + defaultPlen);
    osc2.frequency.setValueAtTime(defaultFreq * defaultPrate * 0.75, time);
    osc2.frequency.linearRampToValueAtTime(
      defaultFreq * 0.75,
      time + defaultPlen,
    );

    // LFO modulation for subtle movement
    const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 1.0 });
    const lfoGain = new GainNode(ctx, { gain: 0.15 });
    lfo.connect(lfoGain);

    const masterGain = new GainNode(ctx, { gain: 0 });
    osc1.connect(masterGain);
    osc2.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.5,
      time + defaultAtk,
    );
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.5 * defaultSust,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen + 0.1,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    osc1.start(time);
    osc2.start(time);
    lfo.start(time);

    osc1.stop(time + duration - 0.001);
    osc2.stop(time + duration - 0.001);
    lfo.stop(time + duration - 0.001);

    osc1.addEventListener('ended', () => {
      osc1.disconnect();
      osc2.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        osc1.stop(t);
        osc2.stop(t);
        lfo.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 25. fmmod - Modulated FM Synth
// ----------------------------------------------------------------------------
registerSound(
  'fmmod',
  (time, value, onended) => {
    let { freq, amp, duration, attack, decay, index, modrate } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultAtk = Number(attack ?? value.atk ?? 0.001);
    const defaultLen = Number(decay ?? value.len ?? 0.5);
    const defaultIndex = Number(index ?? 12);
    const defaultModrate = Number(modrate ?? 1);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate * 2,
    });
    const modGain = new GainNode(ctx, { gain: defaultFreq * defaultIndex });

    mod.connect(modGain);
    modGain.connect(car.frequency);

    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 60,
      Q: 0.9,
    });
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(hpf);
    hpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      hpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 26. fmkik - FM Kick
// ----------------------------------------------------------------------------
registerSound(
  'fmkik',
  (time, value, onended) => {
    let {
      freq,
      amp,
      duration,
      modrate,
      index,
      patk,
      plen,
      prate,
      attack,
      decay,
      contour,
    } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 29);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1);
    const defaultIndex = Number(index ?? 0.7);
    const defaultPatk = Number(patk ?? 0.001);
    const defaultPlen = Number(plen ?? 0.07);
    const defaultPrate = Number(prate ?? 16);
    const defaultAtk = Number(attack ?? value.atk ?? 0.001);
    const defaultLen = Number(decay ?? value.len ?? 0.4);
    const defaultContour = Number(contour ?? 0.8);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex * defaultContour,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    // FM Click
    const clickMod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * 4,
    });
    const clickModGain = new GainNode(ctx, { gain: defaultFreq * 4 * 80 });
    clickModGain.gain.setValueAtTime(defaultFreq * 4 * 80, time);
    clickModGain.gain.exponentialRampToValueAtTime(
      defaultFreq * 4 * 0.1,
      time + 0.02,
    );

    const clickCar = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const clickGain = new GainNode(ctx, { gain: 0 });
    clickGain.gain.setValueAtTime(0, time);
    clickGain.gain.linearRampToValueAtTime(0.1, time + 0.001);
    clickGain.gain.linearRampToValueAtTime(0, time + 0.002);

    clickMod.connect(clickModGain);
    clickModGain.connect(clickCar.frequency);

    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 40,
      Q: 5.0,
    });
    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(hpf);
    clickCar.connect(clickGain);
    clickGain.connect(hpf);
    hpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 3, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);
    clickMod.start(time);
    clickCar.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);
    clickMod.stop(time + duration - 0.001);
    clickCar.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      clickMod.disconnect();
      clickModGain.disconnect();
      clickCar.disconnect();
      clickGain.disconnect();
      hpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
        clickMod.stop(t);
        clickCar.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 27. fmkik2 - FM Kick 2 (Saw Modulator)
// ----------------------------------------------------------------------------
registerSound(
  'fmkik2',
  (time, value, onended) => {
    let {
      freq,
      amp,
      duration,
      modrate,
      index,
      plen,
      prate,
      attack,
      decay,
      contour,
    } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 29);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1);
    const defaultIndex = Number(index ?? 15);
    const defaultPlen = Number(plen ?? 0.12);
    const defaultPrate = Number(prate ?? 6);
    const defaultAtk = Number(attack ?? value.atk ?? 0.001);
    const defaultLen = Number(decay ?? value.len ?? 3.0);
    const defaultContour = Number(contour ?? 0.2);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex * defaultContour,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 30,
      Q: 5.0,
    });
    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(hpf);
    hpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 4, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      hpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 28. fmsn - FM Snare (Pulse Mod + Noise)
// ----------------------------------------------------------------------------
registerSound(
  'fmsn',
  (time, value, onended) => {
    let {
      freq,
      amp,
      duration,
      modrate,
      index,
      plen,
      prate,
      attack,
      decay,
      noiseamp,
    } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 3);
    const defaultIndex = Number(index ?? 0.5);
    const defaultPlen = Number(plen ?? 0.15);
    const defaultPrate = Number(prate ?? 8);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 0.7);
    const defaultNoiseamp = Number(noiseamp ?? 0.5);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'square',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * (1 + defaultIndex),
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const {
      noise,
      node: noiseNode,
      disconnect: disconnectNoise,
    } = whiteNoiseNode(ctx, defaultNoiseamp);

    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 100,
      Q: 2.0,
    });
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(hpf);
    noiseNode.connect(hpf);
    hpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);
    noise.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);
    noise.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      disconnectNoise();
      hpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
        noise.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 29. fmsn2 - FM Snare 2 (Saw Mod into Pulse Carrier)
// ----------------------------------------------------------------------------
registerSound(
  'fmsn2',
  (time, value, onended) => {
    let {
      freq,
      amp,
      duration,
      modrate,
      index,
      plen,
      prate,
      attack,
      decay,
      contour,
    } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 43);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 3);
    const defaultIndex = Number(index ?? 12);
    const defaultPlen = Number(plen ?? 0.2);
    const defaultPrate = Number(prate ?? 8);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const defaultContour = Number(contour ?? 0.7);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'square',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex * defaultContour,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 8000,
      Q: 1.11,
    });
    rlpf.frequency.setValueAtTime(8000, time);
    rlpf.frequency.exponentialRampToValueAtTime(
      Math.min(20000, defaultFreq * 16),
      time + defaultLen * 0.5,
    );

    const rhpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 20,
      Q: 5.0,
    });
    rhpf.frequency.setValueAtTime(20, time);
    rhpf.frequency.exponentialRampToValueAtTime(200, time + 0.01);

    const shaper = waveShaperNode(ctx, 'softclip');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(rlpf);
    rlpf.connect(rhpf);
    rhpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      rlpf.disconnect();
      rhpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 30. fmfilter - FM Filter Sweep
// ----------------------------------------------------------------------------
registerSound(
  'fmfilter',
  (time, value, onended) => {
    let {
      freq,
      amp,
      duration,
      modrate,
      index,
      plen,
      prate,
      attack,
      decay,
      cutoff,
      q,
    } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1);
    const defaultIndex = Number(index ?? 1);
    const defaultPlen = Number(plen ?? 0.002);
    const defaultPrate = Number(prate ?? 4);
    const defaultAtk = Number(attack ?? value.atk ?? 0.001);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const defaultCutoff = Number(cutoff ?? 8000);
    const defaultQ = Number(q ?? 0.1);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultCutoff,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultCutoff, time);
    rlpf.frequency.exponentialRampToValueAtTime(20, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    car.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 31. fmbass - Dual Mod FM Bass
// ----------------------------------------------------------------------------
registerSound(
  'fmbass',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 45);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1.5);
    const defaultIndex = Number(index ?? 1);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });

    const mod1 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const mod1Gain = new GainNode(ctx, { gain: defaultIndex * 16 * 0.9 * 20 });

    const mod2 = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate * 4,
    });
    const mod2Gain = new GainNode(ctx, { gain: defaultIndex * 16 * 1.3 * 20 });

    mod1.connect(mod1Gain);
    mod1Gain.connect(car.frequency);

    mod2.connect(mod2Gain);
    mod2Gain.connect(car.frequency);

    const masterGain = new GainNode(ctx, { gain: 0 });
    car.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod1.start(time);
    mod2.start(time);

    car.stop(time + duration - 0.001);
    mod1.stop(time + duration - 0.001);
    mod2.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod1.disconnect();
      mod1Gain.disconnect();
      mod2.disconnect();
      mod2Gain.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod1.stop(t);
        mod2.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 32. fmpad - Stereo FM Pad
// ----------------------------------------------------------------------------
registerSound(
  'fmpad',
  (time, value, onended) => {
    let {
      freq,
      amp,
      duration,
      modrate,
      index,
      attack,
      decay,
      sustain,
      detune,
      cutoff,
      q,
    } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 0.5);
    const defaultIndex = Number(index ?? 1);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 4.0);
    const defaultSust = Number(sustain ?? value.sust ?? 1.0);
    const defaultDetune = Number(detune ?? 0.1);
    const defaultCutoff = Number(cutoff ?? 2000);
    const defaultQ = Number(q ?? 0.1);
    const clipDur = duration - 0.01;

    // Left and Right Carriers with Detune
    const carL = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq + defaultDetune * 0.1,
    });
    const carR = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq - defaultDetune * 0.1,
    });

    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });
    mod.connect(modGain);
    modGain.connect(carL.frequency);
    modGain.connect(carR.frequency);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultCutoff,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultCutoff, time);
    rlpf.frequency.exponentialRampToValueAtTime(500, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    carL.connect(rlpf);
    carR.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.5,
      time + defaultAtk,
    );
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.5 * defaultSust,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen + 0.1,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    carL.start(time);
    carR.start(time);
    mod.start(time);

    carL.stop(time + duration - 0.001);
    carR.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    carL.addEventListener('ended', () => {
      carL.disconnect();
      carR.disconnect();
      mod.disconnect();
      modGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        carL.stop(t);
        carR.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 33. fmsaw - Saw FM Synth
// ----------------------------------------------------------------------------
registerSound(
  'fmsaw',
  (time, value, onended) => {
    let {
      freq,
      amp,
      duration,
      modrate,
      attack,
      decay,
      sustain,
      cutoff,
      detune,
      q,
    } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const defaultSust = Number(sustain ?? value.sust ?? 0);
    const defaultCutoff = Number(cutoff ?? 8000);
    const defaultDetune = Number(detune ?? 0);
    const defaultQ = Number(q ?? 0.1);
    const clipDur = duration - 0.01;

    const carL = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq + defaultDetune,
    });
    const carR = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq - defaultDetune,
    });

    const mod = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, { gain: defaultFreq * defaultModrate });
    mod.connect(modGain);
    modGain.connect(carL.frequency);
    modGain.connect(carR.frequency);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultCutoff,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultCutoff, time);
    rlpf.frequency.exponentialRampToValueAtTime(20, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    carL.connect(rlpf);
    carR.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * defaultSust,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen + 0.1,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    carL.start(time);
    carR.start(time);
    mod.start(time);

    carL.stop(time + duration - 0.001);
    carR.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    carL.addEventListener('ended', () => {
      carL.disconnect();
      carR.disconnect();
      mod.disconnect();
      modGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        carL.stop(t);
        carR.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 34. fmperc - FM Percussion
// ----------------------------------------------------------------------------
registerSound(
  'fmperc',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, plen, prate, attack, decay } =
      value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 2);
    const defaultIndex = Number(index ?? 0.5);
    const defaultPlen = Number(plen ?? 0.05);
    const defaultPrate = Number(prate ?? 4);
    const defaultAtk = Number(attack ?? value.atk ?? 0.0001);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    car.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    car.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const masterGain = new GainNode(ctx, { gain: 0 });
    car.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 35. fmkey - FM Electric Keys
// ----------------------------------------------------------------------------
registerSound(
  'fmkey',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, plen, prate, attack, decay, q } =
      value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 1);
    const defaultIndex = Number(index ?? 2);
    const defaultPlen = Number(plen ?? 0.001);
    const defaultPrate = Number(prate ?? 4);
    const defaultAtk = Number(attack ?? value.atk ?? 0.0001);
    const defaultLen = Number(decay ?? value.len ?? 4.0);
    const defaultQ = Number(q ?? 0.1);
    const clipDur = duration - 0.01;

    // Slight stereo detuning simulation
    const carL = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const carR = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq + 2,
    });

    [carL, carR].forEach((c) => {
      c.frequency.setValueAtTime(c.frequency.value * (1 + defaultPrate), time);
      c.frequency.exponentialRampToValueAtTime(
        c.frequency.value,
        time + defaultPlen,
      );
    });

    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate * 2,
    });
    const modGain = new GainNode(ctx, {
      gain: defaultFreq * defaultModrate * defaultIndex,
    });
    mod.connect(modGain);
    modGain.connect(carL.frequency);
    modGain.connect(carR.frequency);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 12000,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(12000, time);
    rlpf.frequency.exponentialRampToValueAtTime(1000, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    carL.connect(rlpf);
    carR.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.8,
      time + defaultAtk,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    carL.start(time);
    carR.start(time);
    mod.start(time);

    carL.stop(time + duration - 0.001);
    carR.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    carL.addEventListener('ended', () => {
      carL.disconnect();
      carR.disconnect();
      mod.disconnect();
      modGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        carL.stop(t);
        carR.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 36. fmcp - FM Clap
// ----------------------------------------------------------------------------
registerSound(
  'fmcp',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, plen, prate, attack, decay, q } =
      value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 74);
    const defaultAmp = Number(amp ?? 1.5) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 4);
    const defaultIndex = Number(index ?? 24);
    const defaultPlen = Number(plen ?? 0.1);
    const defaultPrate = Number(prate ?? 8);
    const defaultAtk = Number(attack ?? value.atk ?? 0.0001);
    const defaultLen = Number(decay ?? value.len ?? 0.4);
    const defaultQ = Number(q ?? 0.5);
    const clipDur = duration - 0.01;

    const fr = 1000;
    const car = new OscillatorNode(ctx, { type: 'sine', frequency: fr });
    car.frequency.setValueAtTime(fr * (1 + defaultPrate), time);
    car.frequency.exponentialRampToValueAtTime(fr, time + defaultPlen);

    const mod = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: fr * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: fr * defaultModrate * defaultIndex,
    });
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 10000,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(10000, time);
    rlpf.frequency.exponentialRampToValueAtTime(6000, time + 0.5);

    const rhpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: defaultFreq,
      Q: 3.33,
    });
    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(rlpf);
    rlpf.connect(rhpf);
    rhpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 3, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      rlpf.disconnect();
      rhpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 37. fmhat - FM Closed Hat
// ----------------------------------------------------------------------------
registerSound(
  'fmhat',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, attack, decay, sustain } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 107);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 4.1);
    const defaultIndex = Number(index ?? 24.1);
    const defaultAtk = Number(attack ?? value.atk ?? 0.0001);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const defaultSust = Number(sustain ?? value.sust ?? 0);
    const clipDur = duration - 0.01;

    const fr = 2000;
    const car = new OscillatorNode(ctx, { type: 'sine', frequency: fr });
    const mod = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: fr * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: fr * defaultModrate * defaultIndex,
    });

    mod.connect(modGain);
    modGain.connect(car.frequency);

    const rhpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: defaultFreq,
      Q: 3.33,
    });
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(rhpf);
    rhpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.7,
      time + defaultAtk,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, defaultAmp * 0.7 * defaultSust),
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      rhpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 38. fmhh - FM Short Hi-Hat
// ----------------------------------------------------------------------------
registerSound(
  'fmhh',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, attack, decay, sustain } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 111);
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 4.1);
    const defaultIndex = Number(index ?? 24.1);
    const defaultAtk = Number(attack ?? value.atk ?? 0.0001);
    const defaultLen = Number(decay ?? value.len ?? 0.1);
    const defaultSust = Number(sustain ?? value.sust ?? 0);
    const clipDur = duration - 0.01;

    const fr = 4000;
    const car = new OscillatorNode(ctx, { type: 'sine', frequency: fr });
    const mod = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: fr * defaultModrate,
    });
    const modGain = new GainNode(ctx, {
      gain: fr * defaultModrate * defaultIndex,
    });

    mod.connect(modGain);
    modGain.connect(car.frequency);

    const rhpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: defaultFreq,
      Q: 3.33,
    });
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(rhpf);
    rhpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 0.7,
      time + defaultAtk,
    );
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      rhpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 39. swub - Wobble Bass
// ----------------------------------------------------------------------------
registerSound(
  'swub',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, decay, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 39);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 0.5);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const defaultQ = Number(q ?? 0.2);
    const clipDur = duration - 0.01;

    const partials = [0, 2, 4, 6, 8];
    const oscs = [];
    const mixer = new GainNode(ctx, { gain: 8 / 5 });

    partials.forEach((p) => {
      const f = p * defaultFreq * defaultModrate + 1;
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: f });
      osc.connect(mixer);
      osc.start(time);
      osc.stop(time + duration - 0.001);
      oscs.push(osc);
    });

    // Wobble LPF sweep
    const lpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 200,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    lpf.frequency.setValueAtTime(200, time);
    lpf.frequency.linearRampToValueAtTime(5000, time + defaultLen * 0.5);
    lpf.frequency.linearRampToValueAtTime(200, time + defaultLen);

    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    mixer.connect(lpf);
    lpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 0.6, time + 0.01);
    masterGain.gain.linearRampToValueAtTime(0, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    oscs[0].addEventListener('ended', () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      mixer.disconnect();
      lpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        oscs.forEach((o) => {
          try {
            o.stop(t);
          } catch (e) {}
        });
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 40. swub2 - Wobble Bass 2 (Comb + Distortion)
// ----------------------------------------------------------------------------
registerSound(
  'swub2',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, decay, cutoff, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 39);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 5);
    const defaultIndex = Number(index ?? 32);
    const defaultLen = Number(decay ?? value.len ?? 0.7);
    const defaultCutoff = Number(cutoff ?? 7000);
    const defaultQ = Number(q ?? 0.1);
    const clipDur = duration - 0.01;

    const mults = [0.5, 1.5, 2.5, 3.5, 4.5];
    const oscs = [];
    const mixer = new GainNode(ctx, { gain: 1 / mults.length });

    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, { gain: defaultFreq * defaultIndex });
    mod.connect(modGain);

    mults.forEach((m) => {
      const osc = new OscillatorNode(ctx, {
        type: 'sine',
        frequency: defaultFreq * m,
      });
      modGain.connect(osc.frequency);
      osc.connect(mixer);
      osc.start(time);
      osc.stop(time + duration - 0.001);
      oscs.push(osc);
    });

    const comb = combFilterNode(ctx, 0.1, 0.5);
    const softclip = waveShaperNode(ctx, 'softclip');
    const xover = waveShaperNode(ctx, 'crossover', 0.5);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 100,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(100, time);
    rlpf.frequency.linearRampToValueAtTime(100 + defaultCutoff, time + 0.02);
    rlpf.frequency.exponentialRampToValueAtTime(100, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });

    mixer.connect(comb.input);
    comb.output.connect(softclip);
    softclip.connect(xover);
    xover.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    mod.start(time);
    mod.stop(time + duration - 0.001);

    oscs[0].addEventListener('ended', () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      mod.disconnect();
      modGain.disconnect();
      mixer.disconnect();
      comb.disconnect();
      softclip.disconnect();
      xover.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        oscs.forEach((o) => {
          try {
            o.stop(t);
          } catch (e) {}
        });
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 41. sbass - Distorted Dual FM Bass
// ----------------------------------------------------------------------------
registerSound(
  'sbass',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, decay } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 24);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultModrate = Number(modrate ?? 8);
    const defaultIndex = Number(index ?? 3);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const clipDur = duration - 0.01;

    const car = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    const mod = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq * defaultModrate,
    });
    const modGain = new GainNode(ctx, { gain: defaultFreq * defaultIndex * 4 });

    mod.connect(modGain);
    modGain.connect(car.frequency);

    const xover = waveShaperNode(ctx, 'crossover', 1.0);
    const tanhShaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    car.connect(xover);
    xover.connect(tanhShaper);
    tanhShaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp * 2, time + 0.001);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, time + defaultLen);
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    car.start(time);
    mod.start(time);

    car.stop(time + duration - 0.001);
    mod.stop(time + duration - 0.001);

    car.addEventListener('ended', () => {
      car.disconnect();
      mod.disconnect();
      modGain.disconnect();
      xover.disconnect();
      tanhShaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        car.stop(t);
        mod.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 42. modsaw - Modulated Saw Lead
// ----------------------------------------------------------------------------
registerSound(
  'modsaw',
  (time, value, onended) => {
    let { freq, amp, duration, plen, prate, attack, decay, cutoff, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.001);
    const defaultPrate = Number(prate ?? 2);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const defaultCutoff = Number(cutoff ?? 6000);
    const defaultQ = Number(q ?? 0.1);
    const clipDur = duration - 0.01;

    const saw = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: defaultFreq,
    });
    saw.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    saw.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultCutoff,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultCutoff, time);
    rlpf.frequency.exponentialRampToValueAtTime(20, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    saw.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    saw.start(time);
    saw.stop(time + duration - 0.001);

    saw.addEventListener('ended', () => {
      saw.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        saw.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 43. detsaw - Detuned Dual Saw
// ----------------------------------------------------------------------------
registerSound(
  'detsaw',
  (time, value, onended) => {
    let { freq, amp, duration, attack, decay, sustain, detune, cutoff, q } =
      value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const defaultSust = Number(sustain ?? value.sust ?? 0);
    const defaultDetune = Number(detune ?? 0.01);
    const defaultCutoff = Number(cutoff ?? 6000);
    const defaultQ = Number(q ?? 0.1);
    const clipDur = duration - 0.01;

    const sawL = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: defaultFreq + defaultDetune * defaultFreq,
    });
    const sawR = new OscillatorNode(ctx, {
      type: 'sawtooth',
      frequency: defaultFreq - defaultDetune * defaultFreq,
    });

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultCutoff,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultCutoff, time);
    rlpf.frequency.exponentialRampToValueAtTime(200, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    sawL.connect(rlpf);
    sawR.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, defaultAmp * defaultSust),
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    sawL.start(time);
    sawR.start(time);

    sawL.stop(time + duration - 0.001);
    sawR.stop(time + duration - 0.001);

    sawL.addEventListener('ended', () => {
      sawL.disconnect();
      sawR.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        sawL.stop(t);
        sawR.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 44. sawpad - 8-Oscillator SuperSaw Pad
// ----------------------------------------------------------------------------
registerSound(
  'sawpad',
  (time, value, onended) => {
    let {
      freq,
      amp,
      duration,
      attack,
      decay,
      sustain,
      detune,
      lpfstart,
      lpfend,
      q,
    } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const defaultSust = Number(sustain ?? value.sust ?? 1.0);
    const defaultDetune = Number(detune ?? 0.02);
    const defaultLpfstart = Number(lpfstart ?? 10000);
    const defaultLpfend = Number(lpfend ?? 500);
    const defaultQ = Number(q ?? 0.1);
    const clipDur = duration - 0.01;

    const n = 8;
    const oscs = [];
    const mixer = new GainNode(ctx, { gain: 1.2 / n });

    for (let i = 0; i < n; i++) {
      const scale = i % 2 === 0 ? 1 : -1;
      const det = (i + 1) * scale * defaultDetune * defaultFreq;
      const osc = new OscillatorNode(ctx, {
        type: 'sawtooth',
        frequency: defaultFreq + det,
      });
      osc.connect(mixer);
      osc.start(time);
      osc.stop(time + duration - 0.001);
      oscs.push(osc);
    }

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultLpfstart,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultLpfstart, time);
    rlpf.frequency.exponentialRampToValueAtTime(
      defaultLpfend,
      time + defaultLen,
    );

    const masterGain = new GainNode(ctx, { gain: 0 });
    mixer.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * defaultSust,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen + 0.1,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    oscs[0].addEventListener('ended', () => {
      oscs.forEach((o) => {
        try {
          o.disconnect();
        } catch (e) {}
      });
      mixer.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        oscs.forEach((o) => {
          try {
            o.stop(t);
          } catch (e) {}
        });
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 45. chirp - High-Speed Pitch Chirp
// ----------------------------------------------------------------------------
registerSound(
  'chirp',
  (time, value, onended) => {
    let { freq, amp, duration, plen, prate, attack, decay, cutoff, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.1);
    const defaultPrate = Number(prate ?? 300);
    const defaultAtk = Number(attack ?? value.atk ?? 0.001);
    const defaultLen = Number(decay ?? value.len ?? 0.5);
    const defaultCutoff = Number(cutoff ?? 12000);
    const defaultQ = Number(q ?? 0.5);
    const clipDur = duration - 0.01;

    const osc = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    osc.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    osc.frequency.exponentialRampToValueAtTime(defaultFreq, time + defaultPlen);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultCutoff,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultCutoff, time);
    rlpf.frequency.exponentialRampToValueAtTime(20, time + defaultLen);

    const hpf = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: 30,
      Q: 1.0,
    });
    const shaper = waveShaperNode(ctx, 'tanh');
    const masterGain = new GainNode(ctx, { gain: 0 });

    osc.connect(rlpf);
    rlpf.connect(hpf);
    hpf.connect(shaper);
    shaper.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 1.2,
      time + defaultAtk,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    osc.start(time);
    osc.stop(time + duration - 0.001);

    osc.addEventListener('ended', () => {
      osc.disconnect();
      rlpf.disconnect();
      hpf.disconnect();
      shaper.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        osc.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 46. chirp2 - Noise Chirp Sweep
// ----------------------------------------------------------------------------
registerSound(
  'chirp2',
  (time, value, onended) => {
    let { freq, amp, duration, attack, decay, cutoff, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const ratio =
      value.note !== undefined || value.freq !== undefined
        ? defaultFreq / 41.2
        : 1;
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 1.0);
    const defaultCutoff = Math.min(22000, Number(cutoff ?? 12000) * ratio);
    const defaultQ = Number(q ?? 1.0);
    const clipDur = duration - 0.01;

    const {
      noise,
      node: noiseNode,
      disconnect: disconnectNoise,
    } = whiteNoiseNode(ctx, 0.3);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultCutoff,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultCutoff, time);
    rlpf.frequency.exponentialRampToValueAtTime(20, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    noiseNode.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(defaultAmp, time + defaultAtk);
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    noise.start(time);
    noise.stop(time + duration - 0.001);

    noise.addEventListener('ended', () => {
      disconnectNoise();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        noise.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 47. mplk - Metallic Pluck (Klang Additive Synthesis)
// ----------------------------------------------------------------------------
registerSound(
  'mplk',
  (time, value, onended) => {
    let { freq, amp, duration, plen, prate, attack, decay, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 1) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.01);
    const defaultPrate = Number(prate ?? 8);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 4.0);
    const defaultQ = Number(q ?? 0.8);
    const clipDur = duration - 0.01;

    const basefreqs = [
      469, 938, 1199, 1406, 1984, 2334, 2454, 2814, 2922, 3388, 3859,
    ];
    const ratios = basefreqs.map((f) => f / basefreqs[0]);
    const amps = ratios.map(() => Math.pow(1 / basefreqs.length, 0.8));

    const klang = createKlangNode(
      ctx,
      defaultFreq,
      ratios,
      amps,
      time,
      duration,
    );

    // Sine transient with pitch drop
    const transient = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    transient.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    transient.frequency.exponentialRampToValueAtTime(
      defaultFreq,
      time + defaultPlen,
    );
    const transGain = new GainNode(ctx, { gain: 0.2 });
    transient.connect(transGain);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 12000,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(12000, time);
    rlpf.frequency.exponentialRampToValueAtTime(1000, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    klang.node.connect(rlpf);
    transGain.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 1.58,
      time + defaultAtk,
    ); // 4 dB
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    transient.start(time);
    transient.stop(time + duration - 0.001);

    transient.addEventListener('ended', () => {
      klang.disconnect();
      transient.disconnect();
      transGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        klang.stop(t);
        transient.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 48. mplk2 - Metallic Pluck 2 (Ratio-Weighted Partials)
// ----------------------------------------------------------------------------
registerSound(
  'mplk2',
  (time, value, onended) => {
    let { freq, amp, duration, plen, prate, attack, decay, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.01);
    const defaultPrate = Number(prate ?? 8);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 4.0);
    const defaultQ = Number(q ?? 0.5);
    const clipDur = duration - 0.01;

    const ratios = [
      1.0, 2.0, 2.5565, 2.9978, 4.2302, 4.9765, 5.2324, 6.0, 6.2302, 7.2238,
      8.2281,
    ];
    const amps = ratios.map((_, i) => Math.pow(0.5, i * 0.7));

    const klang = createKlangNode(
      ctx,
      defaultFreq,
      ratios,
      amps,
      time,
      duration,
    );

    const transient = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    transient.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    transient.frequency.exponentialRampToValueAtTime(
      defaultFreq,
      time + defaultPlen,
    );
    const transGain = new GainNode(ctx, { gain: 0.1 });
    transient.connect(transGain);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 12000,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(12000, time);
    rlpf.frequency.exponentialRampToValueAtTime(1000, time + defaultLen);

    const masterGain = new GainNode(ctx, { gain: 0 });
    klang.node.connect(rlpf);
    transGain.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 2.5,
      time + defaultAtk,
    ); // 8 dB
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    transient.start(time);
    transient.stop(time + duration - 0.001);

    transient.addEventListener('ended', () => {
      klang.disconnect();
      transient.disconnect();
      transGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        klang.stop(t);
        transient.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 49. mkey - Metallic Keys (14 Partials)
// ----------------------------------------------------------------------------
registerSound(
  'mkey',
  (time, value, onended) => {
    let { freq, amp, duration, plen, prate, attack, decay, q, cutoff } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultPlen = Number(plen ?? 0.005);
    const defaultPrate = Number(prate ?? 8);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 4.0);
    const defaultQ = Number(q ?? 0.5);
    const defaultCutoff = Number(cutoff ?? 10000);
    const clipDur = duration - 0.01;

    const basefreqs = [
      312, 623, 935, 1247, 1557, 1870, 2183, 2496, 2805, 3118, 3432, 4054, 4356,
      4727,
    ];
    const ratios = basefreqs.map((f) => f / basefreqs[0]);
    const amps = ratios.map(() => Math.pow(1 / basefreqs.length, 0.7));

    const klang = createKlangNode(
      ctx,
      defaultFreq,
      ratios,
      amps,
      time,
      duration,
    );

    const transient = new OscillatorNode(ctx, {
      type: 'sine',
      frequency: defaultFreq,
    });
    transient.frequency.setValueAtTime(defaultFreq * (1 + defaultPrate), time);
    transient.frequency.exponentialRampToValueAtTime(
      defaultFreq,
      time + defaultPlen,
    );
    const transGain = new GainNode(ctx, { gain: 0.2 });
    transient.connect(transGain);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: defaultCutoff,
      Q: 1 / Math.max(0.01, 1 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(defaultCutoff, time);
    rlpf.frequency.exponentialRampToValueAtTime(4000, time + 0.9);

    const masterGain = new GainNode(ctx, { gain: 0 });
    klang.node.connect(rlpf);
    transGain.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 1.58,
      time + defaultAtk,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    transient.start(time);
    transient.stop(time + duration - 0.001);

    transient.addEventListener('ended', () => {
      klang.disconnect();
      transient.disconnect();
      transGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        klang.stop(t);
        transient.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 50. ep - Electric Piano
// ----------------------------------------------------------------------------
registerSound(
  'ep',
  (time, value, onended) => {
    let { freq, amp, duration, attack, decay, sustain, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const defaultSust = Number(sustain ?? value.sust ?? 0.7);
    const defaultQ = Number(q ?? 0);
    const clipDur = duration - 0.01;

    // Base Partials (10 partials)
    const basefreqs = [
      261.5, 522.8, 784.2, 1046, 1307, 1568, 1803, 2091, 2353, 2614,
    ];
    const ratios = basefreqs.map((f) => f / basefreqs[0]);
    const amps = [
      1.0, 0.9, 0.6, 0.1, 0.001, 0.0001, 0.0001, 0.0001, 0.01, 0.005,
    ];
    const klang = createKlangNode(
      ctx,
      defaultFreq,
      ratios,
      amps,
      time,
      duration,
    );

    // Harmonic Partials (fast percussive decay)
    const basefreqsHarm = [401.4, 664.1, 923.7, 1185, 1901];
    const ratiosHarm = basefreqsHarm.map((f) => f / basefreqsHarm[0]);
    const ampsHarm = ratiosHarm.map(() =>
      Math.pow(1 / basefreqsHarm.length, 2),
    );
    const klangHarm = createKlangNode(
      ctx,
      defaultFreq,
      ratiosHarm,
      ampsHarm,
      time,
      duration,
    );

    const harmGain = new GainNode(ctx, { gain: 1 });
    harmGain.gain.setValueAtTime(1, time);
    harmGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    klangHarm.node.connect(harmGain);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 10000,
      Q: 1 / Math.max(0.01, 1.01 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(10000, time);
    rlpf.frequency.exponentialRampToValueAtTime(1000, time + 1.0);

    const masterGain = new GainNode(ctx, { gain: 0 });
    klang.node.connect(rlpf);
    harmGain.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 2.5,
      time + defaultAtk,
    ); // 8 dB
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 2.5 * defaultSust,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen + 0.1,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    klang.oscillators[0].addEventListener('ended', () => {
      klang.disconnect();
      klangHarm.disconnect();
      harmGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        klang.stop(t);
        klangHarm.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 51. ep2 - Electric Piano 2
// ----------------------------------------------------------------------------
registerSound(
  'ep2',
  (time, value, onended) => {
    let { freq, amp, duration, attack, decay, sustain, q } = value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 0.9) * getGainAdjustment(value);
    const defaultAtk = Number(attack ?? value.atk ?? 0.01);
    const defaultLen = Number(decay ?? value.len ?? 2.0);
    const defaultSust = Number(sustain ?? value.sust ?? 0.7);
    const defaultQ = Number(q ?? 0);
    const clipDur = duration - 0.01;

    // Base Partials with exponential decay across partial index
    const basefreqs = [
      261.5, 522.8, 784.2, 1046, 1307, 1568, 1803, 2091, 2353, 2614,
    ];
    const ratios = basefreqs.map((f) => f / basefreqs[0]);
    const amps = ratios.map((_, i) => Math.pow(0.4, i));
    const klang = createKlangNode(
      ctx,
      defaultFreq,
      ratios,
      amps,
      time,
      duration,
    );

    // Harmonic Partials
    const basefreqsHarm = [401.4, 664.1, 923.7, 1185, 1901];
    const ratiosHarm = basefreqsHarm.map((f) => f / basefreqsHarm[0]);
    const ampsHarm = ratiosHarm.map(() =>
      Math.pow(1 / basefreqsHarm.length, 2),
    );
    const klangHarm = createKlangNode(
      ctx,
      defaultFreq,
      ratiosHarm,
      ampsHarm,
      time,
      duration,
    );

    const harmGain = new GainNode(ctx, { gain: 1 });
    harmGain.gain.setValueAtTime(1, time);
    harmGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    klangHarm.node.connect(harmGain);

    const rlpf = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: 10000,
      Q: 1 / Math.max(0.01, 1.01 - defaultQ),
    });
    rlpf.frequency.setValueAtTime(10000, time);
    rlpf.frequency.exponentialRampToValueAtTime(1000, time + 1.0);

    const masterGain = new GainNode(ctx, { gain: 0 });
    klang.node.connect(rlpf);
    harmGain.connect(rlpf);
    rlpf.connect(masterGain);

    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 2.5,
      time + defaultAtk,
    );
    masterGain.gain.linearRampToValueAtTime(
      defaultAmp * 2.5 * defaultSust,
      time + defaultAtk + defaultLen,
    );
    masterGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + defaultAtk + defaultLen + 0.1,
    );
    masterGain.gain.linearRampToValueAtTime(0, time + clipDur);

    klang.oscillators[0].addEventListener('ended', () => {
      klang.disconnect();
      klangHarm.disconnect();
      harmGain.disconnect();
      rlpf.disconnect();
      masterGain.disconnect();
      onended();
    });

    return {
      node: masterGain,
      stop: (t) => {
        klang.stop(t);
        klangHarm.stop(t);
      },
    };
  },
  { type: 'synth' },
);

// ============================================================================
// Digitone FM Synthesis Engine Helpers & 8 Algorithms
// References:
// - digitone-manual/elektron-digitone-fm-synthesis-overview.pdf (Appendix A)
// - digitone-manual/elektron-digitone-synth-track-parameters.pdf (Section 11)
// ============================================================================

export const paramToTimeSec = (val, minSec = 0.001, maxSec = 12.0) => {
  const v = Math.max(0, Math.min(127, Number(val ?? 0)));
  if (v === 0) return minSec;
  return minSec * Math.pow(maxSec / minSec, v / 127);
};

export const paramToFrequency = (val, minFreq = 20, maxFreq = 20000) => {
  const v = Math.max(0, Math.min(127, Number(val ?? 127)));
  return minFreq * Math.pow(maxFreq / minFreq, v / 127);
};

export const paramToQ = (val, minQ = 0.707, maxQ = 24.0) => {
  const v = Math.max(0, Math.min(127, Number(val ?? 0)));
  return minQ + (maxQ - minQ) * Math.pow(v / 127, 2);
};

export const calculateDetuneOffset = (dtun) => {
  const d = Math.max(0, Math.min(127, Number(dtun ?? 0)));
  if (d <= 64) {
    return (d / 64) * 0.015;
  }
  return 0.015 + Math.pow((d - 64) / 63, 2) * 0.35;
};

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

export const getHarmonicPartials = (harm, opName) => {
  const numPartials = 32;
  const partials = new Float32Array(numPartials);
  partials[0] = 0;
  partials[1] = 1.0;

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
      amp = t * sawAmp;
    } else if (segIndex === 1) {
      amp = (1 - t) * sawAmp + t * oddEvenAmp;
    } else if (segIndex === 2) {
      amp = (1 - t) * oddEvenAmp + t * squareAmp;
    } else {
      amp = (1 - t) * squareAmp + t * bellAmp;
    }
    partials[n] = amp;
  }

  return partials;
};

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

export const scheduleOperatorEnv = (
  param,
  time,
  {
    delayVal = 0,
    atkVal = 0,
    decVal = 64,
    endVal = 0,
    levVal = 127,
    trigMode = 1,
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

  param.linearRampToValueAtTime(peakLevel, tPeak);

  if (trigMode === 1) {
    const tEnd = tPeak + decSec;
    param.linearRampToValueAtTime(endLevel, tEnd);
  } else {
    const sustainEnd = Math.max(tPeak, time + duration);
    param.setValueAtTime(peakLevel, sustainEnd);
    const tEnd = sustainEnd + decSec;
    param.linearRampToValueAtTime(endLevel, tEnd);
  }
};

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
      try { targetOp.disconnect(fbDelay); } catch (e) {}
      try { fbDelay.disconnect(); } catch (e) {}
      try { fbGain.disconnect(); } catch (e) {}
    },
  };
};

export const digitoneAlgo1 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  opB1.connect(gainB1);
  gainB1.connect(opC.frequency);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

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

export const digitoneAlgo2 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB2, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

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

export const digitoneAlgo3 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);
  gainA.connect(opB2.frequency);
  gainA.connect(opB1.frequency);

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

export const digitoneAlgo4 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB2, fdbkGain);

  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  opB1.connect(gainB1);
  gainB1.connect(opA.frequency);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

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

export const digitoneAlgo5 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB1, fdbkGain);

  opB1.connect(gainB1);
  gainB1.connect(opA.frequency);

  opB2.connect(gainB2);
  gainB2.connect(opA.frequency);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

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

export const digitoneAlgo6 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);
  gainA.connect(opB1.frequency);

  opB2.connect(gainB2);
  gainB2.connect(opC.frequency);
  gainB2.connect(opB1.frequency);

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

export const digitoneAlgo7 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  const outX = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  gainA.connect(outX);

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

export const digitoneAlgo8 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB1, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

  const outX = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);
  opB2.connect(gainB2);
  gainB2.connect(outX);

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

export const createBaseWidthFilterNode = (ctx, baseVal = 0, widthVal = 127) => {
  const base = Math.max(0, Math.min(127, Number(baseVal ?? 0)));
  const width = Math.max(0, Math.min(127, Number(widthVal ?? 127)));

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

export const createMultimodeFilterNode = (ctx, time, value) => {
  const filterType = Math.round(Number(value.fltr_type ?? value.ftype ?? 1));
  const fFreqVal = Number(value.fltr_freq ?? value.ffreq ?? value.cutoff ?? 127);
  const fResoVal = Number(value.fltr_reso ?? value.freso ?? value.q ?? 0);
  const fEnvDepthVal = Number(value.fltr_env ?? value.fenv ?? 0);

  const baseFreq = paramToFrequency(fFreqVal, 20, 20000);
  const filterQ = paramToQ(fResoVal, 0.707, 24);

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
    filterNode.frequency.exponentialRampToValueAtTime(Math.max(20, peakFreq), tPeak);

    const tSus = tPeak + fDecSec;
    filterNode.frequency.exponentialRampToValueAtTime(Math.max(20, susFreq), tSus);

    const tNoteOff = Math.max(tSus, time + duration);
    filterNode.frequency.setValueAtTime(Math.max(20, susFreq), tNoteOff);

    filterNode.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), tNoteOff + fRelSec);
  };

  let inputNode;
  let outputNode;
  const nodesToDisconnect = [];

  if (filterType === 1) {
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

  const baseFreq = getFrequencyHelper
    ? getFrequencyHelper(value, 48)
    : Number(value.freq ?? 130.81);
  const voiceGainAdjustment = gainAdjustmentHelper
    ? gainAdjustmentHelper(value, 0.25)
    : 0.25;

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

  const dtunOffset = calculateDetuneOffset(dtun);

  const freqC = baseFreq * Math.max(0.01, ratioC + offsetC);
  const freqA = baseFreq * Math.max(0.01, (ratioA + offsetA) * (1 + dtunOffset));
  const freqB1 = baseFreq * Math.max(0.01, ratioB1 + offsetB1);
  const freqB2 = baseFreq * Math.max(0.01, (ratioB2 + offsetB2) * (1 + dtunOffset));

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

  const atkA = value.atkA ?? value.atattackA ?? 0;
  const decA = value.decA ?? 64;
  const endA = value.endA ?? 0;
  const levA = value.levA ?? 64;
  const adel = value.adel ?? 0;
  const atrg = value.atrg !== undefined ? Number(value.atrg) : 1;

  const atkB = value.atkB ?? 0;
  const decB = value.decB ?? 64;
  const endB = value.endB ?? 0;
  const levBVal = value.levB ?? 64;
  const bdel = value.bdel ?? 0;
  const btrg = value.btrg !== undefined ? Number(value.btrg) : 1;

  const { b1: levB1, b2: levB2 } = calculateLevB(levBVal);

  const gainA = new GainNode(ctx, { gain: 0 });
  const gainB1 = new GainNode(ctx, { gain: 0 });
  const gainB2 = new GainNode(ctx, { gain: 0 });

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

  const algoFunc = getDigitoneAlgorithm(algoNum);
  const fdbkGainHz = (fdbk / 120.0) * baseFreq * 2.0;

  const algoResult = algoFunc(
    ctx,
    time,
    { opC, opA, opB1, opB2 },
    { gainA, gainB1, gainB2 },
    fdbkGainHz
  );

  const normMix = (mix + 64) / 127;
  const mixGainX = Math.cos(normMix * 0.5 * Math.PI);
  const mixGainY = Math.sin(normMix * 0.5 * Math.PI);

  const mixedOut = new GainNode(ctx, { gain: 1 });
  const xGain = new GainNode(ctx, { gain: mixGainX });
  const yGain = new GainNode(ctx, { gain: mixGainY });

  algoResult.outX.connect(xGain);
  algoResult.outY.connect(yGain);
  xGain.connect(mixedOut);
  yGain.connect(mixedOut);

  const drvVal = Number(value.drv ?? value.overdrive ?? 0);
  const overdriveNode = createDigitoneOverdriveNode(ctx, drvVal);
  mixedOut.connect(overdriveNode.input);

  const baseVal = Number(value.base ?? 0);
  const widthVal = Number(value.width ?? 127);
  const baseWidthNode = createBaseWidthFilterNode(ctx, baseVal, widthVal);
  overdriveNode.output.connect(baseWidthNode.input);

  const multimodeNode = createMultimodeFilterNode(ctx, time, value);
  baseWidthNode.output.connect(multimodeNode.input);

  const ampAtkSec = paramToTimeSec(value.amp_atk ?? value.attack ?? value.atk ?? 0, 0.001, 8.0);
  const ampDecSec = paramToTimeSec(value.amp_dec ?? value.decay ?? value.dec ?? 64, 0.005, 12.0);
  const ampSusLevel = Math.max(0, Math.min(127, Number(value.amp_sus ?? value.sustain ?? value.sus ?? 127))) / 127;
  const ampRelSec = paramToTimeSec(value.amp_rel ?? value.release ?? value.rel ?? 32, 0.005, 12.0);
  const volVal = Math.max(0, Math.min(127, Number(value.vol ?? value.volume ?? 100)));
  const masterAmp = (volVal / 127.0) * Number(value.amp ?? 1.0) * voiceGainAdjustment;

  const ampGainNode = new GainNode(ctx, { gain: 0 });
  multimodeNode.output.connect(ampGainNode);

  ampGainNode.gain.cancelScheduledValues(time);
  ampGainNode.gain.setValueAtTime(0, time);
  ampGainNode.gain.linearRampToValueAtTime(masterAmp, time + ampAtkSec);
  ampGainNode.gain.linearRampToValueAtTime(masterAmp * ampSusLevel, time + ampAtkSec + ampDecSec);

  const tAmpNoteOff = Math.max(time + ampAtkSec + ampDecSec, time + clipDur);
  ampGainNode.gain.setValueAtTime(masterAmp * ampSusLevel, tAmpNoteOff);
  ampGainNode.gain.exponentialRampToValueAtTime(0.0001, tAmpNoteOff + ampRelSec);
  ampGainNode.gain.linearRampToValueAtTime(0, tAmpNoteOff + ampRelSec + 0.01);

  const panVal = Math.max(-64, Math.min(63, Number(value.pan ?? 0)));
  const normPan = panVal / 64.0;
  let finalOutNode = ampGainNode;
  let pannerNode = null;

  if (typeof StereoPannerNode !== 'undefined') {
    pannerNode = new StereoPannerNode(ctx, { pan: normPan });
    ampGainNode.connect(pannerNode);
    finalOutNode = pannerNode;
  }

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

// ============================================================================
// 52. syn - Elektron Digitone FM Synth Track
// References:
// - digitone-manual/elektron-digitone-fm-synthesis-overview.pdf (A.1 - A.7)
// - digitone-manual/elektron-digitone-synth-track-parameters.pdf (11.1 - 11.10)
// ============================================================================
registerSound(
  'syn',
  (time, value, onended) => {
    const ctx = getAudioContext();
    return playDigitoneSynVoice(
      ctx,
      time,
      value,
      onended,
      getFrequencyFromValue,
      getGainAdjustment
    );
  },
  { type: 'synth' },
);
