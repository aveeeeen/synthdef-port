// Safe fallback for standalone / test environments
if (typeof createParam === 'undefined') {
  globalThis.createParam = (name) => name;
}
if (
  typeof createParameter === 'function' &&
  typeof createParam === 'undefined'
) {
  globalThis.createParam = createParameter;
}
if (
  typeof createParam === 'function' &&
  typeof createParameter === 'undefined'
) {
  globalThis.createParameter = createParam;
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
createParam('atk');
createParam('clr');
createParam('contour');
createParam('cutoff');
createParam('detune');
createParam('index');
createParam('len');
createParam('lpfend');
createParam('lpfstart');
createParam('modrate');
createParam('noiseamp');
createParam('patk');
createParam('plen');
createParam('prate');
createParam('pmode');
createParam('q');
createParam('shp');
createParam('sust');
createParam('sweep');
createParam('unison');
createParam('voices');

// Digitone Parameters
createParam('algo');
createParam('atkA');
createParam('atkB');
createParam('base');
createParam('decA');
createParam('decB');
createParam('drv');
createParam('dtun');
createParam('endA');
createParam('endB');
createParam('fdbk');
createParam('fltr_atk');
createParam('fltr_dec');
createParam('fltr_del');
createParam('fltr_env');
createParam('fltr_freq');
createParam('fltr_rel');
createParam('fltr_reso');
createParam('fltr_sus');
createParam('fltr_type');
createParam('fltAtk');
createParam('fltDec');
createParam('fltDel');
createParam('fltEnv');
createParam('fltFreq');
createParam('fltRel');
createParam('fltQ');
createParam('fltSus');
createParam('fltType');
createParam('harm');
createParam('levA');
createParam('levB');
createParam('mix');
createParam('ratioA');
createParam('ratioB');
createParam('ratioC');
createParam('stereoDetune');
createParam('width');

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
  const oct =
    octStr !== '' && octStr !== undefined ? Number(octStr) : defaultOctave;
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

// ============================================================================
// Digitone FM Synthesis Engine Helpers & 8 Algorithms
// References:
// - digitone-manual/elektron-digitone-fm-synthesis-overview.pdf (Appendix A)
// - digitone-manual/elektron-digitone-synth-track-parameters.pdf (Section 11)
// ============================================================================

// ============================================================================
// Digitone FM Synthesis Engine Helpers & 8 Algorithms
// References:
// - digitone-manual/elektron-digitone-fm-synthesis-overview.pdf (Appendix A)
// - digitone-manual/elektron-digitone-synth-track-parameters.pdf (Section 11)
// ============================================================================

const parseSeconds = (val, defaultSec = 0) => {
  if (val === undefined || val === null) return defaultSec;
  const n = Number(val);
  if (isNaN(n)) return defaultSec;
  return Math.max(0, n);
};

const parseLevel = (val, defaultLev = 127) => {
  if (val === undefined || val === null) return defaultLev;
  const n = Number(val);
  if (isNaN(n)) return defaultLev;
  if (n >= 0 && n <= 1) return n * 127;
  return Math.max(0, Math.min(127, n));
};

const paramToFrequency = (val, minFreq = 20, maxFreq = 20000) => {
  const v = Math.max(0, Math.min(127, Number(val ?? 127)));
  return minFreq * Math.pow(maxFreq / minFreq, v / 127);
};

const paramToQ = (val, minQ = 0.707, maxQ = 24.0) => {
  const v = Math.max(0, Math.min(127, Number(val ?? 0)));
  return minQ + (maxQ - minQ) * Math.pow(v / 127, 2);
};

const calculateDetuneOffset = (dtun) => {
  const val = Number(dtun ?? 0);
  if (isNaN(val) || val === 0) return 0;
  // 最小ステップ 0.01 (1セント単位) に丸める
  const stepped = Math.round(val * 100) / 100;
  // -12 < x < 12 の範囲にクランプ (ステップ 0.01 のため有効範囲は -11.99 〜 11.99)
  const semitones = Math.max(-11.99, Math.min(11.99, stepped));
  if (semitones === 0) return 0;
  // 半音単位から周波数オフセット比率 (2^(semitones / 12) - 1) に変換
  return Math.pow(2, semitones / 12) - 1;
};

const calculateLevB = (v) => {
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

const besselJ = (n, x) => {
  if (x === 0) return n === 0 ? 1 : 0;
  let sum = 0;
  let term = Math.pow(x / 2, n);
  for (let i = 1; i <= n; i++) term /= i;
  sum = term;
  const x2 = (x * x) / 4;
  for (let k = 1; k < 30; k++) {
    term = (-term * x2) / (k * (n + k));
    sum += term;
    if (Math.abs(term) < 1e-14) break;
  }
  return sum;
};

const getEffectiveHarm = (harm, opName) => {
  const h = Math.round(Number(harm ?? 0) * 10) / 10;
  if (opName === 'C') {
    return h < 0 ? Math.min(26, Math.abs(h)) : 0;
  }
  if (opName === 'A' || opName === 'B1') {
    return h > 0 ? Math.min(26, h) : 0;
  }
  return 0;
};

const getHarmonicPartials = (harm, opName, fdbk = 0) => {
  const numPartials = 32;
  const partials = new Float32Array(numPartials);
  partials[0] = 0;
  partials[1] = 1.0;

  const effectiveHarm = getEffectiveHarm(harm, opName);

  if (effectiveHarm > 0) {
    const segment = (effectiveHarm / 26) * 4;
    const segIndex = Math.min(3, Math.floor(segment));
    const t = segment - segIndex;

    for (let n = 2; n < numPartials; n++) {
      const isOdd = n % 2 !== 0;
      const sawAmp = 1.0 / n;
      const squareAmp = isOdd ? 1.0 / n : 0.0;
      const oddEvenAmp = isOdd ? 1.0 / n : 0.5 / n;
      const bellAmp =
        n === 3 || n === 5 || n === 8 || n === 11
          ? 0.8 / Math.sqrt(n)
          : 0.1 / n;

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
  }

  const fbVal = Math.round(Math.max(0, Math.min(127, Number(fdbk ?? 0))));
  if (fbVal > 0) {
    const beta = Math.min(1.0, fbVal / 64.0);
    for (let n = 1; n < numPartials; n++) {
      const fbAmp = (2.0 / (n * beta)) * besselJ(n, n * beta);
      if (n === 1) {
        partials[1] = fbAmp * (partials[1] > 0 ? partials[1] : 1.0);
      } else {
        partials[n] = Math.max(partials[n] ?? 0, fbAmp);
      }
    }
  }

  return partials;
};

const _periodicWaveCacheByCtx = new WeakMap();
const MAX_PERIODIC_WAVE_CACHE_SIZE = 64;

const createDigitonePeriodicWave = (ctx, harm, opName, fdbk = 0) => {
  if (typeof ctx?.createPeriodicWave !== 'function') {
    return null;
  }
  const effectiveHarm = getEffectiveHarm(harm, opName);
  const fbVal = Math.round(Math.max(0, Math.min(127, Number(fdbk ?? 0))));

  // 純粋なサイン波（effectiveHarm=0 かつ fbVal=0）の場合は null を返し、
  // OscillatorNode のデフォルト波形 ('sine') をそのまま利用してメモリ生成を回避する
  if (effectiveHarm === 0 && fbVal === 0) {
    return null;
  }

  let ctxCache = _periodicWaveCacheByCtx.get(ctx);
  if (!ctxCache) {
    ctxCache = new Map();
    _periodicWaveCacheByCtx.set(ctx, ctxCache);
  }

  const cacheKey = `${effectiveHarm.toFixed(1)}_${fbVal}`;
  if (ctxCache.has(cacheKey)) {
    const wave = ctxCache.get(cacheKey);
    ctxCache.delete(cacheKey);
    ctxCache.set(cacheKey, wave);
    return wave;
  }

  const partials = getHarmonicPartials(harm, opName, fdbk);
  const real = new Float32Array(partials.length);
  const imag = new Float32Array(partials.length);
  for (let i = 1; i < partials.length; i++) {
    imag[i] = partials[i];
  }
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

  if (ctxCache.size >= MAX_PERIODIC_WAVE_CACHE_SIZE) {
    const oldestKey = ctxCache.keys().next().value;
    ctxCache.delete(oldestKey);
  }
  ctxCache.set(cacheKey, wave);
  return wave;
};

const baseEnvLinear = (
  param,
  time,
  duration,
  { atk = 0.001, dec = 0.1, sust = 0.0, rel = 0.1, value = 1.0 },
) => {
  const peakVal = Number(value ?? 1.0);
  const aSec = Math.max(0.0005, Number(atk ?? 0.001));
  const dSec = Math.max(0.0005, Number(dec ?? 0.1));
  const rSec = Math.max(0.0005, Number(rel ?? 0.1));
  const sRatio = Math.max(0, Number(sust ?? 0));
  const sustVal = sRatio <= 1.0 ? peakVal * sRatio : sRatio;
  const totalEnvTime = aSec + dSec + rSec;

  const durSec = Math.max(0.001, Number(duration ?? totalEnvTime));
  const tEnd = time + durSec;

  const t1 = time + aSec;
  const t2 = t1 + dSec;
  const t3 = t2 + rSec;

  param.cancelScheduledValues(time);
  param.setValueAtTime(0, time);

  // ポップ音（クリックノイズ）防止のためのフェード窓
  const fadeSec = Math.min(0.005, Math.max(0.001, durSec * 0.4));
  const tFadeStart = Math.max(time, tEnd - fadeSec);

  if (tEnd >= t3) {
    // 通常完走: atk -> dec(sust) -> rel(0)
    param.linearRampToValueAtTime(peakVal, t1);
    param.linearRampToValueAtTime(sustVal, t2);
    param.linearRampToValueAtTime(0, t3);
    if (tEnd > t3) {
      param.setValueAtTime(0, tEnd);
    }
  } else if (tFadeStart <= t1) {
    // durationが短くAttack途中で終了
    const lev = Math.max(0, ((tFadeStart - time) / aSec) * peakVal);
    if (tFadeStart > time) {
      param.linearRampToValueAtTime(lev, tFadeStart);
    }
    param.linearRampToValueAtTime(0, tEnd);
  } else if (tFadeStart <= t2) {
    // durationが短くDecay途中で終了
    param.linearRampToValueAtTime(peakVal, t1);
    const decRatio = (tFadeStart - t1) / dSec;
    const lev = Math.max(0, peakVal - decRatio * (peakVal - sustVal));
    if (tFadeStart > t1) {
      param.linearRampToValueAtTime(lev, tFadeStart);
    }
    param.linearRampToValueAtTime(0, tEnd);
  } else {
    // durationが短くRelease途中で終了
    param.linearRampToValueAtTime(peakVal, t1);
    param.linearRampToValueAtTime(sustVal, t2);
    const relRatio = (tFadeStart - t2) / rSec;
    const lev = Math.max(0, sustVal * (1 - relRatio));
    if (tFadeStart > t2) {
      param.linearRampToValueAtTime(lev, tFadeStart);
    }
    param.linearRampToValueAtTime(0, tEnd);
  }
};

const baseEnvExp = (
  param,
  time,
  duration,
  { atk = 0.001, dec = 0.1, sust = 0.0, rel = 0.1, value = 1.0 },
) => {
  const floorVal = 0.0001;
  const peakVal = Math.max(floorVal, Number(value ?? 1.0));
  const aSec = Math.max(0.0005, Number(atk ?? 0.001));
  const dSec = Math.max(0.0005, Number(dec ?? 0.1));
  const rSec = Math.max(0.0005, Number(rel ?? 0.1));
  const sRatio = Math.max(0, Number(sust ?? 0));
  const rawSust = sRatio <= 1.0 ? peakVal * sRatio : sRatio;
  const sustVal = Math.max(floorVal, rawSust);
  const totalEnvTime = aSec + dSec + rSec;

  const durSec = Math.max(0.001, Number(duration ?? totalEnvTime));
  const tEnd = time + durSec;

  const t1 = time + aSec;
  const t2 = t1 + dSec;
  const t3 = t2 + rSec;

  param.cancelScheduledValues(time);
  param.setValueAtTime(floorVal, time);

  // ポップ音（クリックノイズ）防止のためのフェード窓
  const fadeSec = Math.min(0.005, Math.max(0.001, durSec * 0.4));
  const tFadeStart = Math.max(time, tEnd - fadeSec);

  if (tEnd >= t3 + 0.002) {
    // 通常完走: atk -> dec(sust) -> rel(floorVal) -> 0
    param.exponentialRampToValueAtTime(peakVal, t1);
    param.exponentialRampToValueAtTime(sustVal, t2);
    param.exponentialRampToValueAtTime(floorVal, t3);
    param.linearRampToValueAtTime(0, t3 + 0.002);
    if (tEnd > t3 + 0.002) {
      param.setValueAtTime(0, tEnd);
    }
  } else if (tFadeStart <= t1) {
    // durationが短くAttack途中で終了
    const ratio = Math.max(0, (tFadeStart - time) / aSec);
    const lev = Math.max(
      floorVal,
      floorVal * Math.pow(peakVal / floorVal, ratio),
    );
    if (tFadeStart > time) {
      param.exponentialRampToValueAtTime(lev, tFadeStart);
    }
    param.linearRampToValueAtTime(0, tEnd);
  } else if (tFadeStart <= t2) {
    // durationが短くDecay途中で終了
    param.exponentialRampToValueAtTime(peakVal, t1);
    const decRatio = (tFadeStart - t1) / dSec;
    const lev = Math.max(
      floorVal,
      peakVal * Math.pow(sustVal / peakVal, decRatio),
    );
    if (tFadeStart > t1) {
      param.exponentialRampToValueAtTime(lev, tFadeStart);
    }
    param.linearRampToValueAtTime(0, tEnd);
  } else {
    // durationが短くRelease途中で終了
    param.exponentialRampToValueAtTime(peakVal, t1);
    param.exponentialRampToValueAtTime(sustVal, t2);
    const relRatio = (tFadeStart - t2) / rSec;
    const lev = Math.max(
      floorVal,
      sustVal * Math.pow(floorVal / sustVal, relRatio),
    );
    if (tFadeStart > t2) {
      param.exponentialRampToValueAtTime(lev, tFadeStart);
    }
    param.linearRampToValueAtTime(0, tEnd);
  }
};

const scheduleAmpEnv = (
  param,
  time,
  duration,
  { atk, dec, sust, rel, amp },
) => {
  baseEnvLinear(param, time, duration, {
    atk: atk,
    dec: dec,
    sust: sust,
    rel: rel,
    value: amp,
  });
};

const scheduleAmpEnvExp = (
  param,
  time,
  duration,
  { atk, dec, sust, rel, amp },
) => {
  baseEnvExp(param, time, duration, {
    atk: atk,
    dec: dec,
    sust: sust,
    rel: rel,
    value: amp,
  });
};

const scheduleOperatorEnv = (
  param,
  time,
  {
    delSec = 0,
    atkSec = 0.001,
    decSec = 0.5,
    delayVal,
    atkVal,
    decVal,
    endVal = 0,
    levVal = 0,
    duration = 1.0,
    maxDeviation = 1000,
  },
) => {
  // --- ADSR対応パラメータの正規化 ---
  // Delay: dSec (ADSR前の遅延)
  // Attack時間: aSec
  // Decay時間: dDecSec
  // Sustainレベル相当: endLevel (DigitoneのEnd Level)
  // ピークレベル: peakLevel (Attack到達目標値)
  const dSec = Math.max(0, Number(delSec ?? delayVal ?? 0));
  const aSec = Math.max(0.0005, Number(atkSec ?? atkVal ?? 0.001));
  const dDecSec = Math.max(0.001, Number(decSec ?? decVal ?? 0.5));
  const normLev =
    levVal > 1 ? Math.min(127, levVal) / 127 : Math.max(0, levVal);
  const normEnd =
    endVal > 1 ? Math.min(127, endVal) / 127 : Math.max(0, endVal);
  const peakLevel = normLev * maxDeviation;
  const endLevel = normEnd * maxDeviation;

  const clipDur = Math.max(0.002, duration - 0.01);
  const tEnd = time + clipDur;

  // --- 初期化 & [Delay] フェーズ ---
  param.cancelScheduledValues(time);
  param.setValueAtTime(0, time);

  // ポップ音防止用フェード窓
  const fadeSec = Math.min(0.005, Math.max(0.001, clipDur * 0.4));
  const tFadeStart = Math.max(time, tEnd - fadeSec);

  const tStart = time + dSec;
  if (tStart >= tFadeStart) {
    // Delay中にノートオフが来た場合: 発音せず終了
    param.setValueAtTime(0, tEnd);
    return;
  }

  if (dSec > 0) {
    param.setValueAtTime(0, tStart);
  }

  // --- [Attack] フェーズ ---
  const tPeakIdeal = tStart + aSec;

  if (tFadeStart <= tPeakIdeal) {
    // [Attack中断]: Attack完了前にノートオフが来た場合
    const actualPeak =
      ((tFadeStart - tStart) / Math.max(0.0001, aSec)) * peakLevel;
    if (tFadeStart > tStart) {
      param.linearRampToValueAtTime(actualPeak, tFadeStart);
    }
    param.linearRampToValueAtTime(0, tEnd);
    return;
  }

  // [Attack通常完了]: tStartからtPeakIdealにかけてpeakLevelへ立ち上がり
  param.linearRampToValueAtTime(peakLevel, tPeakIdeal);

  // --- [Decay / Sustain / Release] フェーズ ---
  const tEndIdeal = tPeakIdeal + dDecSec;
  if (tFadeStart <= tEndIdeal) {
    // [Decay中断]: Decay完了前にノートオフが来た場合
    const decRatio = (tFadeStart - tPeakIdeal) / Math.max(0.0001, dDecSec);
    const levAtOff = peakLevel - decRatio * (peakLevel - endLevel);
    if (tFadeStart > tPeakIdeal) {
      param.linearRampToValueAtTime(levAtOff, tFadeStart);
    }
    param.linearRampToValueAtTime(0, tEnd);
  } else {
    // [Decay通常完了]: peakLevelからendLevel（Sustainレベル相当）へ減衰
    param.linearRampToValueAtTime(endLevel, tEndIdeal);

    if (tFadeStart > tEndIdeal && endLevel > 0) {
      param.setValueAtTime(endLevel, tFadeStart);
    }
    // ノート終了時に0へスムーズにフェード
    param.linearRampToValueAtTime(0, tEnd);
  }
};

const schedulePitchEnvelope = (
  opFreqParam,
  time,
  baseFreq,
  { patk = 0, plen = 0.1, prate = 1.0, duration = 1.0 } = {},
) => {
  const rate = Number(prate ?? 1.0);
  const len = Math.max(0, Number(plen ?? 0));
  const atk = Math.max(0, Number(patk ?? 0));

  opFreqParam.cancelScheduledValues(time);

  if (rate === 1.0 || len <= 0 || baseFreq <= 0) {
    opFreqParam.setValueAtTime(baseFreq, time);
    return;
  }

  const peakFreq = Math.max(1, baseFreq * Math.max(0.01, rate));
  const durSec = Math.max(0.002, Number(duration ?? 1.0));
  const clipDur = Math.max(0.002, durSec - 0.01);
  const tEnd = time + clipDur;

  if (atk > 0) {
    opFreqParam.setValueAtTime(baseFreq, time);
    if (tEnd <= time + atk) {
      // 短いノート: 前半で途中までベンドし、後半でbaseFreqに着地
      const tMid = time + Math.max(0.0005, (tEnd - time) * 0.5);
      const ratio = (tMid - time) / atk;
      const intermFreq = Math.max(
        1,
        baseFreq * Math.pow(peakFreq / baseFreq, ratio),
      );
      opFreqParam.exponentialRampToValueAtTime(intermFreq, tMid);
      opFreqParam.exponentialRampToValueAtTime(baseFreq, tEnd);
    } else {
      const tPeak = time + atk;
      opFreqParam.exponentialRampToValueAtTime(peakFreq, tPeak);
      const tDecay = Math.max(tPeak + 0.0005, Math.min(tPeak + len, tEnd));
      opFreqParam.exponentialRampToValueAtTime(baseFreq, tDecay);
      if (tEnd > tDecay) {
        opFreqParam.setValueAtTime(baseFreq, tEnd);
      }
    }
  } else {
    opFreqParam.setValueAtTime(peakFreq, time);
    const tDecay = Math.max(time + 0.0005, Math.min(time + len, tEnd));
    opFreqParam.exponentialRampToValueAtTime(baseFreq, tDecay);
    if (tEnd > tDecay) {
      opFreqParam.setValueAtTime(baseFreq, tEnd);
    }
  }
};

const _feedbackBufferCacheByCtx = new WeakMap();
const MAX_FEEDBACK_BUFFER_CACHE_SIZE = 32;

const getCachedFeedbackBuffer = (ctx, freq) => {
  if (typeof ctx?.createBuffer !== 'function') {
    return null;
  }
  const sampleRate = ctx.sampleRate ?? 44100;
  const roundedFreq = Math.round(Math.max(20, Number(freq ?? 440)) * 10) / 10;
  const cacheKey = `${sampleRate}_${roundedFreq.toFixed(1)}`;

  let ctxCache = _feedbackBufferCacheByCtx.get(ctx);
  if (!ctxCache) {
    ctxCache = new Map();
    _feedbackBufferCacheByCtx.set(ctx, ctxCache);
  }

  if (ctxCache.has(cacheKey)) {
    const buf = ctxCache.get(cacheKey);
    ctxCache.delete(cacheKey);
    ctxCache.set(cacheKey, buf);
    return buf;
  }

  const bufLen = sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufLen, sampleRate);
  const data = buffer.getChannelData(0);
  let y = 0.1;
  const dTheta = (2 * Math.PI * roundedFreq) / sampleRate;
  let theta = 0;
  for (let i = 0; i < bufLen; i++) {
    y = Math.sin(theta + 2.5 * y);
    theta += dTheta;
    data[i] = y;
  }

  if (ctxCache.size >= MAX_FEEDBACK_BUFFER_CACHE_SIZE) {
    const oldestKey = ctxCache.keys().next().value;
    ctxCache.delete(oldestKey);
  }
  ctxCache.set(cacheKey, buffer);
  return buffer;
};

const createDigitoneFeedbackOperator = (
  ctx,
  time,
  freq,
  harm,
  opName,
  fdbk,
  duration,
) => {
  const f = Math.max(0, Math.min(127, Number(fdbk ?? 0)));
  const osc = new OscillatorNode(ctx, { frequency: freq });
  const wave = createDigitonePeriodicWave(ctx, harm, opName, f);
  if (wave) osc.setPeriodicWave(wave);

  if (f <= 64) {
    return {
      node: osc,
      osc,
      noiseSource: null,
      start: (t) => osc.start(t),
      stop: (t) => {
        try {
          osc.stop(t);
        } catch (e) {}
      },
      disconnect: () => {
        try {
          osc.disconnect();
        } catch (e) {}
      },
    };
  }

  const alpha = (f - 64) / 63.0;
  const oscGainVal = Math.cos(alpha * 0.5 * Math.PI);
  const noiseGainVal = Math.sin(alpha * 0.5 * Math.PI);

  const oscGainNode = new GainNode(ctx, { gain: oscGainVal });
  const noiseGainNode = new GainNode(ctx, { gain: noiseGainVal });
  const fdbkOut = new GainNode(ctx, { gain: 1.0 });

  osc.connect(oscGainNode);
  oscGainNode.connect(fdbkOut);

  let noiseSource = null;
  if (typeof ctx?.createBufferSource === 'function') {
    const buffer = getCachedFeedbackBuffer(ctx, freq);
    if (buffer) {
      noiseSource = ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;
      noiseSource.connect(noiseGainNode);
      noiseGainNode.connect(fdbkOut);
    }
  }

  return {
    node: fdbkOut,
    osc,
    noiseSource,
    start: (t) => {
      osc.start(t);
      if (noiseSource && typeof noiseSource.start === 'function') {
        noiseSource.start(t);
      }
    },
    stop: (t) => {
      try {
        osc.stop(t);
      } catch (e) {}
      if (noiseSource && typeof noiseSource.stop === 'function') {
        try {
          noiseSource.stop(t);
        } catch (e) {}
      }
    },
    disconnect: () => {
      try {
        osc.disconnect();
      } catch (e) {}
      try {
        oscGainNode.disconnect();
      } catch (e) {}
      if (noiseSource) {
        try {
          noiseSource.disconnect();
        } catch (e) {}
      }
      try {
        noiseGainNode.disconnect();
      } catch (e) {}
      try {
        fdbkOut.disconnect();
      } catch (e) {}
    },
  };
};

const createFeedbackLoop = (ctx, targetOp, fdbkGainValue) => {
  return {
    targetOp,
    gain: fdbkGainValue,
    disconnect: () => {},
  };
};

const digitoneAlgo1 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB2, carrierGainB1 } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);

  if (carrierGainB1) {
    opB1.connect(carrierGainB1);
    carrierGainB1.connect(outY);
  } else {
    opB1.connect(outY);
  }

  return {
    outX,
    outY,
    feedbackOp: 'A',
    disconnect: () => {
      fb.disconnect();
      try {
        opB2.disconnect(gainB2);
      } catch (e) {}
      try {
        gainB2.disconnect();
      } catch (e) {}
      try {
        opA.disconnect(gainA);
      } catch (e) {}
      try {
        gainA.disconnect();
      } catch (e) {}
      try {
        opC.disconnect(outX);
      } catch (e) {}
      if (carrierGainB1) {
        try {
          opB1.disconnect(carrierGainB1);
        } catch (e) {}
        try {
          carrierGainB1.disconnect();
        } catch (e) {}
      } else {
        try {
          opB1.disconnect(outY);
        } catch (e) {}
      }
      try {
        outX.disconnect();
      } catch (e) {}
      try {
        outY.disconnect();
      } catch (e) {}
    },
  };
};

const digitoneAlgo2 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB2, carrierGainB1 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB2, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);

  if (carrierGainB1) {
    opB1.connect(carrierGainB1);
    carrierGainB1.connect(outY);
  } else {
    opB1.connect(outY);
  }

  return {
    outX,
    outY,
    feedbackOp: 'B2',
    disconnect: () => {
      fb.disconnect();
      try {
        opA.disconnect(gainA);
      } catch (e) {}
      try {
        gainA.disconnect();
      } catch (e) {}
      try {
        opB2.disconnect(gainB2);
      } catch (e) {}
      try {
        gainB2.disconnect();
      } catch (e) {}
      try {
        opC.disconnect(outX);
      } catch (e) {}
      if (carrierGainB1) {
        try {
          opB1.disconnect(carrierGainB1);
        } catch (e) {}
        try {
          carrierGainB1.disconnect();
        } catch (e) {}
      } else {
        try {
          opB1.disconnect(outY);
        } catch (e) {}
      }
      try {
        outX.disconnect();
      } catch (e) {}
      try {
        outY.disconnect();
      } catch (e) {}
    },
  };
};

const digitoneAlgo3 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, carrierGainB1, carrierGainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);
  gainA.connect(opB2.frequency);
  gainA.connect(opB1.frequency);

  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });
  opC.connect(outX);

  if (carrierGainB2) {
    opB2.connect(carrierGainB2);
    carrierGainB2.connect(outX);
  } else {
    opB2.connect(outX);
  }

  if (carrierGainB1) {
    opB1.connect(carrierGainB1);
    carrierGainB1.connect(outY);
  } else {
    opB1.connect(outY);
  }

  return {
    outX,
    outY,
    feedbackOp: 'A',
    disconnect: () => {
      fb.disconnect();
      try {
        opA.disconnect(gainA);
      } catch (e) {}
      try {
        gainA.disconnect();
      } catch (e) {}
      try {
        opC.disconnect(outX);
      } catch (e) {}
      if (carrierGainB2) {
        try {
          opB2.disconnect(carrierGainB2);
        } catch (e) {}
        try {
          carrierGainB2.disconnect();
        } catch (e) {}
      } else {
        try {
          opB2.disconnect(outX);
        } catch (e) {}
      }
      if (carrierGainB1) {
        try {
          opB1.disconnect(carrierGainB1);
        } catch (e) {}
        try {
          carrierGainB1.disconnect();
        } catch (e) {}
      } else {
        try {
          opB1.disconnect(outY);
        } catch (e) {}
      }
      try {
        outX.disconnect();
      } catch (e) {}
      try {
        outY.disconnect();
      } catch (e) {}
    },
  };
};

const digitoneAlgo4 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2, carrierGainB1 } = envNodes;

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

  if (carrierGainB1) {
    opB1.connect(carrierGainB1);
    carrierGainB1.connect(outY);
  } else {
    opB1.connect(outY);
  }

  return {
    outX,
    outY,
    feedbackOp: 'B2',
    disconnect: () => {
      fb.disconnect();
      try {
        opB2.disconnect(gainB2);
      } catch (e) {}
      try {
        gainB2.disconnect();
      } catch (e) {}
      try {
        opB1.disconnect(gainB1);
      } catch (e) {}
      try {
        gainB1.disconnect();
      } catch (e) {}
      try {
        opA.disconnect(gainA);
      } catch (e) {}
      try {
        gainA.disconnect();
      } catch (e) {}
      try {
        opC.disconnect(outX);
      } catch (e) {}
      if (carrierGainB1) {
        try {
          opB1.disconnect(carrierGainB1);
        } catch (e) {}
        try {
          carrierGainB1.disconnect();
        } catch (e) {}
      } else {
        try {
          opB1.disconnect(outY);
        } catch (e) {}
      }
      try {
        outX.disconnect();
      } catch (e) {}
      try {
        outY.disconnect();
      } catch (e) {}
    },
  };
};

const digitoneAlgo5 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2, carrierGainA } = envNodes;

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

  if (carrierGainA) {
    opA.connect(carrierGainA);
    carrierGainA.connect(outY);
  } else {
    opA.connect(outY);
  }

  return {
    outX,
    outY,
    feedbackOp: 'B1',
    disconnect: () => {
      fb.disconnect();
      try {
        opB1.disconnect(gainB1);
      } catch (e) {}
      try {
        gainB1.disconnect();
      } catch (e) {}
      try {
        opB2.disconnect(gainB2);
      } catch (e) {}
      try {
        gainB2.disconnect();
      } catch (e) {}
      try {
        opA.disconnect(gainA);
      } catch (e) {}
      try {
        gainA.disconnect();
      } catch (e) {}
      try {
        opC.disconnect(outX);
      } catch (e) {}
      if (carrierGainA) {
        try {
          opA.disconnect(carrierGainA);
        } catch (e) {}
        try {
          carrierGainA.disconnect();
        } catch (e) {}
      } else {
        try {
          opA.disconnect(outY);
        } catch (e) {}
      }
      try {
        outX.disconnect();
      } catch (e) {}
      try {
        outY.disconnect();
      } catch (e) {}
    },
  };
};

const digitoneAlgo6 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB2, carrierGainB1 } = envNodes;

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

  if (carrierGainB1) {
    opB1.connect(carrierGainB1);
    carrierGainB1.connect(outY);
  } else {
    opB1.connect(outY);
  }

  return {
    outX,
    outY,
    feedbackOp: 'A',
    disconnect: () => {
      fb.disconnect();
      try {
        opA.disconnect(gainA);
      } catch (e) {}
      try {
        gainA.disconnect();
      } catch (e) {}
      try {
        opB2.disconnect(gainB2);
      } catch (e) {}
      try {
        gainB2.disconnect();
      } catch (e) {}
      try {
        opC.disconnect(outX);
      } catch (e) {}
      if (carrierGainB1) {
        try {
          opB1.disconnect(carrierGainB1);
        } catch (e) {}
        try {
          carrierGainB1.disconnect();
        } catch (e) {}
      } else {
        try {
          opB1.disconnect(outY);
        } catch (e) {}
      }
      try {
        outX.disconnect();
      } catch (e) {}
      try {
        outY.disconnect();
      } catch (e) {}
    },
  };
};

const digitoneAlgo7 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2, carrierGainA, carrierGainB1, carrierGainB2 } =
    envNodes;

  const fb = createFeedbackLoop(ctx, opA, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

  opB2.connect(gainB2);
  gainB2.connect(opB1.frequency);

  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });

  opC.connect(outX);

  if (carrierGainA) {
    opA.connect(carrierGainA);
    carrierGainA.connect(outX);
  } else {
    gainA.connect(outX);
  }

  if (carrierGainB1) {
    opB1.connect(carrierGainB1);
    carrierGainB1.connect(outY);
  } else {
    gainB1.connect(outY);
  }

  if (carrierGainB2) {
    opB2.connect(carrierGainB2);
    carrierGainB2.connect(outY);
  } else {
    gainB2.connect(outY);
  }

  return {
    outX,
    outY,
    feedbackOp: 'A',
    disconnect: () => {
      fb.disconnect();
      try {
        opA.disconnect(gainA);
      } catch (e) {}
      try {
        gainA.disconnect();
      } catch (e) {}
      try {
        opB2.disconnect(gainB2);
      } catch (e) {}
      try {
        gainB2.disconnect();
      } catch (e) {}
      try {
        opC.disconnect(outX);
      } catch (e) {}
      if (carrierGainA) {
        try {
          opA.disconnect(carrierGainA);
        } catch (e) {}
        try {
          carrierGainA.disconnect();
        } catch (e) {}
      }
      if (carrierGainB1) {
        try {
          opB1.disconnect(carrierGainB1);
        } catch (e) {}
        try {
          carrierGainB1.disconnect();
        } catch (e) {}
      }
      if (carrierGainB2) {
        try {
          opB2.disconnect(carrierGainB2);
        } catch (e) {}
        try {
          carrierGainB2.disconnect();
        } catch (e) {}
      }
      try {
        outX.disconnect();
      } catch (e) {}
      try {
        outY.disconnect();
      } catch (e) {}
    },
  };
};

const digitoneAlgo8 = (ctx, time, ops, envNodes, fdbkGain) => {
  const { opC, opA, opB1, opB2 } = ops;
  const { gainA, gainB1, gainB2, carrierGainB1, carrierGainB2 } = envNodes;

  const fb = createFeedbackLoop(ctx, opB1, fdbkGain);

  opA.connect(gainA);
  gainA.connect(opC.frequency);

  const outX = new GainNode(ctx, { gain: 1 });
  const outY = new GainNode(ctx, { gain: 1 });

  opC.connect(outX);

  if (carrierGainB2) {
    opB2.connect(carrierGainB2);
    carrierGainB2.connect(outX);
  } else {
    gainB2.connect(outX);
  }

  if (carrierGainB1) {
    opB1.connect(carrierGainB1);
    carrierGainB1.connect(outY);
  } else {
    gainB1.connect(outY);
  }

  return {
    outX,
    outY,
    feedbackOp: 'B1',
    disconnect: () => {
      fb.disconnect();
      try {
        opA.disconnect(gainA);
      } catch (e) {}
      try {
        gainA.disconnect();
      } catch (e) {}
      try {
        opC.disconnect(outX);
      } catch (e) {}
      if (carrierGainB2) {
        try {
          opB2.disconnect(carrierGainB2);
        } catch (e) {}
        try {
          carrierGainB2.disconnect();
        } catch (e) {}
      }
      if (carrierGainB1) {
        try {
          opB1.disconnect(carrierGainB1);
        } catch (e) {}
        try {
          carrierGainB1.disconnect();
        } catch (e) {}
      }
      try {
        outX.disconnect();
      } catch (e) {}
      try {
        outY.disconnect();
      } catch (e) {}
    },
  };
};

const digitoneAlgorithms = [
  digitoneAlgo1,
  digitoneAlgo2,
  digitoneAlgo3,
  digitoneAlgo4,
  digitoneAlgo5,
  digitoneAlgo6,
  digitoneAlgo7,
  digitoneAlgo8,
];

const getDigitoneAlgorithm = (algoNumber) => {
  const idx = Math.max(1, Math.min(8, Math.round(Number(algoNumber ?? 1)))) - 1;
  return digitoneAlgorithms[idx];
};

const getNeededEnvNodesForAlgo = (algo) => {
  switch (algo) {
    case 1:
    case 2:
    case 6:
      return {
        gainA: true,
        gainB1: false,
        gainB2: true,
        carrierGainA: false,
        carrierGainB1: true,
        carrierGainB2: false,
      };
    case 3:
      return {
        gainA: true,
        gainB1: false,
        gainB2: false,
        carrierGainA: false,
        carrierGainB1: true,
        carrierGainB2: true,
      };
    case 4:
      return {
        gainA: true,
        gainB1: true,
        gainB2: true,
        carrierGainA: false,
        carrierGainB1: true,
        carrierGainB2: false,
      };
    case 5:
      return {
        gainA: true,
        gainB1: true,
        gainB2: true,
        carrierGainA: true,
        carrierGainB1: false,
        carrierGainB2: false,
      };
    case 7:
      return {
        gainA: true,
        gainB1: false,
        gainB2: true,
        carrierGainA: true,
        carrierGainB1: true,
        carrierGainB2: true,
      };
    case 8:
      return {
        gainA: true,
        gainB1: false,
        gainB2: false,
        carrierGainA: false,
        carrierGainB1: true,
        carrierGainB2: true,
      };
    default:
      return {
        gainA: true,
        gainB1: true,
        gainB2: true,
        carrierGainA: true,
        carrierGainB1: true,
        carrierGainB2: true,
      };
  }
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

const createDigitoneOverdriveNode = (ctx, drvVal = 0) => {
  const drv = Math.max(0, Math.min(127, Number(drvVal ?? 0)));
  if (drv <= 0) {
    const passthrough = new GainNode(ctx, { gain: 1 });
    return {
      input: passthrough,
      output: passthrough,
      disconnect: () => {
        try {
          passthrough.disconnect();
        } catch (e) {}
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
      try {
        inGainNode.disconnect();
      } catch (e) {}
      try {
        shaper.disconnect();
      } catch (e) {}
      try {
        outGainNode.disconnect();
      } catch (e) {}
    },
  };
};

const createBaseWidthFilterNode = (ctx, baseVal = 0, widthVal = 127) => {
  const base = Math.max(0, Math.min(127, Number(baseVal ?? 0)));
  const width = Math.max(0, Math.min(127, Number(widthVal ?? 127)));

  if (base === 0 && width === 127) {
    const passthrough = new GainNode(ctx, { gain: 1 });
    return {
      input: passthrough,
      output: passthrough,
      disconnect: () => {
        try {
          passthrough.disconnect();
        } catch (e) {}
      },
    };
  }

  const baseFreq = paramToFrequency(base, 20, 18000);
  const minLpFreq = baseFreq;
  const maxLpFreq = 20000;
  const lpFreq = Math.min(
    maxLpFreq,
    minLpFreq * Math.pow(maxLpFreq / Math.max(20, minLpFreq), width / 127),
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
      try {
        hpNode.disconnect();
      } catch (e) {}
      try {
        lpNode.disconnect();
      } catch (e) {}
    },
  };
};

const createMultimodeFilterNode = (ctx, time, value) => {
  const filterType = value.fltr_type ?? value.fltType ?? value.ftype ?? 'lpf';
  const fTypeStr = String(filterType).toLowerCase();

  const isHpf =
    fTypeStr === 'hpf' ||
    fTypeStr === 'highpass' ||
    fTypeStr === 'hp' ||
    filterType === 2;
  const isLpf2 =
    fTypeStr === 'lpf2' ||
    fTypeStr === 'steeplowpass' ||
    fTypeStr === 'lp2' ||
    filterType === 3;
  const isOff =
    filterType === 0 ||
    fTypeStr === '0' ||
    fTypeStr === 'off' ||
    fTypeStr === 'none' ||
    fTypeStr === 'bypass';

  // デフォルト値: lpf/lpf2およびそのバリアントは18000Hz, hpfおよびそのバリアントは20Hz
  const defaultFreq = isHpf ? 20 : 18000;

  const rawFreq =
    value.fltr_freq ?? value.ffreq ?? value.fltFreq ?? value.cutoff;
  const baseFreq =
    rawFreq !== undefined && rawFreq !== null && !isNaN(Number(rawFreq))
      ? Math.max(20, Math.min(18000, Number(rawFreq)))
      : defaultFreq;

  const fResoVal = Number(
    value.fltr_reso ?? value.freso ?? value.fltQ ?? value.q ?? 0,
  );
  const fEnvDepthVal = Number(
    value.fltr_env ?? value.fenv ?? value.fltEnv ?? 0,
  );

  const filterQ = paramToQ(fResoVal, 0.707, 24);

  if (isOff) {
    const passthrough = new GainNode(ctx, { gain: 1 });
    return {
      input: passthrough,
      output: passthrough,
      disconnect: () => {
        try {
          passthrough.disconnect();
        } catch (e) {}
      },
    };
  }

  const fAtkSec = Math.max(
    0.0005,
    parseSeconds(value.fltr_atk ?? value.fatk ?? value.fltAtk, 0.001),
  );
  const fDecSec = Math.max(
    0.001,
    parseSeconds(value.fltr_dec ?? value.fdec ?? value.fltDec, 0.5),
  );
  const rawSus = value.fltr_sus ?? value.fsus ?? value.fltSus;
  const fSusLevel =
    rawSus !== undefined && rawSus !== null && !isNaN(Number(rawSus))
      ? Math.max(20, Math.min(18000, Number(rawSus)))
      : baseFreq;
  const fRelSec = Math.max(
    0.001,
    parseSeconds(value.fltr_rel ?? value.frel ?? value.fltRel, 0.1),
  );
  const fDelSec = parseSeconds(
    value.fltr_del ?? value.fdel ?? value.fltDel,
    0.0,
  );
  const duration = Number(value.duration ?? 1.0);

  const octaveSweep = (fEnvDepthVal / 64.0) * 5.0;

  const scheduleFilterFreq = (filterNode) => {
    const clipDur = Math.max(0.002, duration - 0.01);
    const tEnd = time + clipDur;

    const tStart = time + fDelSec;
    const peakFreq = Math.max(
      20,
      Math.min(18000, baseFreq * Math.pow(2, octaveSweep)),
    );
    const susFreq = Math.max(20, Math.min(18000, fSusLevel));

    filterNode.frequency.cancelScheduledValues(time);
    filterNode.frequency.setValueAtTime(baseFreq, time);

    const fadeSec = Math.min(0.005, clipDur * 0.3);
    const tFadeStart = Math.max(time, tEnd - fadeSec);

    if (tStart >= tFadeStart) {
      filterNode.frequency.setValueAtTime(baseFreq, tEnd);
      return;
    }

    if (fDelSec > 0) {
      filterNode.frequency.setValueAtTime(baseFreq, tStart);
    }

    const tPeakIdeal = tStart + fAtkSec;
    if (tFadeStart <= tPeakIdeal) {
      const atkRatio = (tFadeStart - tStart) / Math.max(0.0001, fAtkSec);
      const actualPeakFreq = Math.max(
        20,
        Math.min(18000, baseFreq * Math.pow(2, octaveSweep * atkRatio)),
      );
      if (tFadeStart > tStart) {
        filterNode.frequency.exponentialRampToValueAtTime(
          actualPeakFreq,
          tFadeStart,
        );
      }
      return;
    }

    filterNode.frequency.exponentialRampToValueAtTime(peakFreq, tPeakIdeal);

    const tDecIdeal = tPeakIdeal + fDecSec;
    if (tFadeStart <= tDecIdeal) {
      const decRatio = (tFadeStart - tPeakIdeal) / Math.max(0.0001, fDecSec);
      const freqAtOff = Math.max(
        20,
        Math.min(18000, peakFreq * Math.pow(susFreq / peakFreq, decRatio)),
      );
      filterNode.frequency.exponentialRampToValueAtTime(freqAtOff, tFadeStart);
    } else {
      filterNode.frequency.exponentialRampToValueAtTime(susFreq, tDecIdeal);
    }
  };

  let inputNode;
  let outputNode;
  const nodesToDisconnect = [];

  if (isHpf) {
    const hp = new BiquadFilterNode(ctx, {
      type: 'highpass',
      frequency: baseFreq,
      Q: filterQ,
    });
    scheduleFilterFreq(hp);
    inputNode = hp;
    outputNode = hp;
    nodesToDisconnect.push(hp);
  } else if (isLpf2) {
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
    // デフォルトおよび lpf / lowpass / lp
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
        try {
          n.disconnect();
        } catch (e) {}
      }
    },
  };
};

const playDigitoneSynVoice = (
  ctx,
  time,
  value,
  onended,
  getFrequencyHelper,
  gainAdjustmentHelper,
) => {
  // Web Audio の 128 サンプル (Render Quantum) 境界に発音時刻をスナップし、
  // ピッチエンベロープの離散化誤差やオシレータ初期位相のジッターを防止
  const sampleRate = ctx?.sampleRate || 44100;
  const blockDuration = 128 / sampleRate;
  time = Math.round(Number(time ?? 0) / blockDuration) * blockDuration;

  const duration = Number(value.duration ?? 1.0);
  const clipDur = Math.max(0.002, duration - 0.01);

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
  const fdbk = Math.max(
    0,
    Math.min(127, Number(value.fdbk ?? value.feedback ?? 0)),
  );
  const mix = Math.max(-64, Math.min(63, Number(value.mix ?? 0)));

  const dtunOffset = calculateDetuneOffset(dtun);

  const rawStereoDetune = Number(value.stereoDetune ?? value.stereodetune ?? 0);
  const stereoDetune = Math.max(
    0,
    Math.min(127, isNaN(rawStereoDetune) ? 0 : rawStereoDetune),
  );
  // stereoDetune は 0 - 127 で最大 1 セミトーン (1 / 12 オクターブ) のレンジ
  const detuneSemitones = (stereoDetune / 127.0) * 1.0;
  const baseFreqL = baseFreq;
  const baseFreqR =
    stereoDetune === 0
      ? baseFreqL
      : baseFreqL * Math.pow(2, detuneSemitones / 12.0);

  const getOpFreqs = (bFreq) => ({
    freqC: bFreq * Math.max(0.01, ratioC + offsetC),
    freqA: bFreq * Math.max(0.01, (ratioA + offsetA) * (1 + dtunOffset)),
    freqB1: bFreq * Math.max(0.01, ratioB1 + offsetB1),
    freqB2: bFreq * Math.max(0.01, (ratioB2 + offsetB2) * (1 + dtunOffset)),
  });

  const patkSec = parseSeconds(value.patk, 0.0);
  const plenSec = parseSeconds(value.plen, 0.1);
  const prate = Math.max(0.01, Number(value.prate ?? 1.0));
  const pmodeStr = String(
    value.pmode ?? value.pitch_mode ?? 'carrier',
  ).toLowerCase();
  const isAllMode =
    pmodeStr === 'all' || pmodeStr === 'both' || pmodeStr === '1';

  const getCarrierOpsForAlgo = (algo) => {
    switch (algo) {
      case 1:
      case 2:
      case 4:
      case 6:
        return ['C', 'B1'];
      case 3:
      case 8:
        return ['C', 'B2', 'B1'];
      case 5:
        return ['C', 'A'];
      case 7:
        return ['C', 'A', 'B1', 'B2'];
      default:
        return ['C', 'B1'];
    }
  };

  const carrierOpNames = getCarrierOpsForAlgo(algoNum);
  const shouldApplyPitchEnv = (opName) => {
    if (isAllMode) return true;
    return carrierOpNames.includes(opName);
  };

  const getFeedbackOpForAlgo = (algo) => {
    switch (algo) {
      case 2:
      case 4:
        return 'B2';
      case 5:
      case 8:
        return 'B1';
      case 1:
      case 3:
      case 6:
      case 7:
      default:
        return 'A';
    }
  };

  const fdbkOpName = getFeedbackOpForAlgo(algoNum);

  const atkA = Math.max(
    0.0005,
    parseSeconds(value.atkA ?? value.atattackA, 0.001),
  );
  const decA = Math.max(0.001, parseSeconds(value.decA, 0.5));
  const endA = parseLevel(value.endA, 0);
  const levA = parseLevel(value.levA, 64);
  const adel = parseSeconds(value.adel, 0.0);
  const atrg = value.atrg !== undefined ? Number(value.atrg) : 1;

  const atkB = Math.max(0.0005, parseSeconds(value.atkB, 0.001));
  const decB = Math.max(0.001, parseSeconds(value.decB, 0.5));
  const endB = parseLevel(value.endB, 0);
  const levBVal = parseLevel(value.levB, 64);
  const bdel = parseSeconds(value.bdel, 0.0);
  const btrg = value.btrg !== undefined ? Number(value.btrg) : 1;

  const { b1: levB1, b2: levB2 } = calculateLevB(levBVal);

  const algoFunc = getDigitoneAlgorithm(algoNum);
  const normMix = (mix + 64) / 127;
  const mixGainX = Math.cos(normMix * 0.5 * Math.PI);
  const mixGainY = Math.sin(normMix * 0.5 * Math.PI);

  const createFmCore = (bFreq) => {
    const { freqC, freqA, freqB1, freqB2 } = getOpFreqs(bFreq);

    // Create Op C
    const opC = new OscillatorNode(ctx, { frequency: freqC });
    const waveC = createDigitonePeriodicWave(ctx, harm, 'C');
    if (waveC) opC.setPeriodicWave(waveC);
    if (shouldApplyPitchEnv('C')) {
      schedulePitchEnvelope(opC.frequency, time, freqC, {
        patk: patkSec,
        plen: plenSec,
        prate,
        duration,
      });
    } else {
      opC.frequency.setValueAtTime(freqC, time);
    }

    const createOp = (opName, freq) => {
      const isFeedbackOp = opName === fdbkOpName;
      if (isFeedbackOp) {
        const fbController = createDigitoneFeedbackOperator(
          ctx,
          time,
          freq,
          harm,
          opName,
          fdbk,
          duration,
        );
        if (shouldApplyPitchEnv(opName)) {
          schedulePitchEnvelope(fbController.osc.frequency, time, freq, {
            patk: patkSec,
            plen: plenSec,
            prate,
            duration,
          });
        } else {
          fbController.osc.frequency.setValueAtTime(freq, time);
        }
        return fbController;
      }

      const osc = new OscillatorNode(ctx, { frequency: freq });
      const wave = createDigitonePeriodicWave(ctx, harm, opName, 0);
      if (wave) osc.setPeriodicWave(wave);
      if (shouldApplyPitchEnv(opName)) {
        schedulePitchEnvelope(osc.frequency, time, freq, {
          patk: patkSec,
          plen: plenSec,
          prate,
          duration,
        });
      } else {
        osc.frequency.setValueAtTime(freq, time);
      }

      return {
        node: osc,
        osc,
        start: (t) => osc.start(t),
        stop: (t) => {
          try {
            osc.stop(t);
          } catch (e) {}
        },
        disconnect: () => {
          try {
            osc.disconnect();
          } catch (e) {}
        },
      };
    };

    const opAController = createOp('A', freqA);
    const opB1Controller = createOp('B1', freqB1);
    const opB2Controller = createOp('B2', freqB2);

    const needed = getNeededEnvNodesForAlgo(algoNum);

    const gainA = needed.gainA ? new GainNode(ctx, { gain: 0 }) : null;
    const gainB1 = needed.gainB1 ? new GainNode(ctx, { gain: 0 }) : null;
    const gainB2 = needed.gainB2 ? new GainNode(ctx, { gain: 0 }) : null;

    if (gainA) {
      scheduleOperatorEnv(gainA.gain, time, {
        delSec: adel,
        atkSec: atkA,
        decSec: decA,
        endVal: endA,
        levVal: levA,
        trigMode: atrg,
        duration,
        maxDeviation: freqA * 8.0,
      });
    }

    if (gainB1) {
      scheduleOperatorEnv(gainB1.gain, time, {
        delSec: bdel,
        atkSec: atkB,
        decSec: decB,
        endVal: endB,
        levVal: levB1,
        trigMode: btrg,
        duration,
        maxDeviation: freqB1 * 8.0,
      });
    }

    if (gainB2) {
      scheduleOperatorEnv(gainB2.gain, time, {
        delSec: bdel,
        atkSec: atkB,
        decSec: decB,
        endVal: endB,
        levVal: levB2,
        trigMode: btrg,
        duration,
        maxDeviation: freqB2 * 8.0,
      });
    }

    const carrierGainA = needed.carrierGainA ? new GainNode(ctx, { gain: 0 }) : null;
    const carrierGainB1 = needed.carrierGainB1 ? new GainNode(ctx, { gain: 0 }) : null;
    const carrierGainB2 = needed.carrierGainB2 ? new GainNode(ctx, { gain: 0 }) : null;

    if (carrierGainA) {
      scheduleOperatorEnv(carrierGainA.gain, time, {
        delSec: adel,
        atkSec: atkA,
        decSec: decA,
        endVal: endA,
        levVal: levA,
        trigMode: atrg,
        duration,
        maxDeviation: 1.0,
      });
    }

    if (carrierGainB1) {
      scheduleOperatorEnv(carrierGainB1.gain, time, {
        delSec: bdel,
        atkSec: atkB,
        decSec: decB,
        endVal: endB,
        levVal: levB1,
        trigMode: btrg,
        duration,
        maxDeviation: 1.0,
      });
    }

    if (carrierGainB2) {
      scheduleOperatorEnv(carrierGainB2.gain, time, {
        delSec: bdel,
        atkSec: atkB,
        decSec: decB,
        endVal: endB,
        levVal: levB2,
        trigMode: btrg,
        duration,
        maxDeviation: 1.0,
      });
    }

    const fdbkGainHz = (fdbk / 120.0) * bFreq * 2.0;

    const algoResult = algoFunc(
      ctx,
      time,
      {
        opC,
        opA: opAController.node,
        opB1: opB1Controller.node,
        opB2: opB2Controller.node,
      },
      {
        gainA,
        gainB1,
        gainB2,
        carrierGainA,
        carrierGainB1,
        carrierGainB2,
      },
      fdbkGainHz,
    );

    const xGain = new GainNode(ctx, { gain: mixGainX });
    const yGain = new GainNode(ctx, { gain: mixGainY });
    const outGain = new GainNode(ctx, { gain: 1.0 });

    algoResult.outX.connect(xGain);
    algoResult.outY.connect(yGain);
    xGain.connect(outGain);
    yGain.connect(outGain);

    return {
      output: outGain,
      opC,
      opAController,
      opB1Controller,
      opB2Controller,
      start: (t) => {
        opC.start(t);
        opAController.start(t);
        opB1Controller.start(t);
        opB2Controller.start(t);
      },
      stop: (t) => {
        try {
          opC.stop(t);
        } catch (e) {}
        try {
          opAController.stop(t);
        } catch (e) {}
        try {
          opB1Controller.stop(t);
        } catch (e) {}
        try {
          opB2Controller.stop(t);
        } catch (e) {}
      },
      disconnect: () => {
        algoResult.disconnect();
        try {
          opC.disconnect();
        } catch (e) {}
        opAController.disconnect();
        opB1Controller.disconnect();
        opB2Controller.disconnect();
        try {
          carrierGainA?.disconnect();
        } catch (e) {}
        try {
          carrierGainB1?.disconnect();
        } catch (e) {}
        try {
          carrierGainB2?.disconnect();
        } catch (e) {}
        try {
          xGain.disconnect();
        } catch (e) {}
        try {
          yGain.disconnect();
        } catch (e) {}
        try {
          outGain.disconnect();
        } catch (e) {}
      },
    };
  };

  const coreL = createFmCore(baseFreqL);
  let coreR = null;
  let mergerNode = null;

  const drvVal = Number(value.drv ?? value.overdrive ?? 0);
  const overdriveNode = createDigitoneOverdriveNode(ctx, drvVal);

  if (stereoDetune !== 0) {
    coreR = createFmCore(baseFreqR);
    if (typeof ChannelMergerNode !== 'undefined') {
      mergerNode = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
      coreL.output.connect(mergerNode, 0, 0);
      coreR.output.connect(mergerNode, 0, 1);
      mergerNode.connect(overdriveNode.input);
    } else {
      coreL.output.connect(overdriveNode.input);
      coreR.output.connect(overdriveNode.input);
    }
  } else {
    coreL.output.connect(overdriveNode.input);
  }

  const baseVal = Number(value.base ?? 0);
  const widthVal = Number(value.width ?? 127);
  const baseWidthNode = createBaseWidthFilterNode(ctx, baseVal, widthVal);
  overdriveNode.output.connect(baseWidthNode.input);

  const multimodeNode = createMultimodeFilterNode(ctx, time, value);
  baseWidthNode.output.connect(multimodeNode.input);

  const ampAtkSec = Math.max(
    0.0005,
    parseSeconds(value.amp_atk ?? value.attack ?? value.atk, 0.001),
  );
  const ampDecSec = Math.max(
    0.001,
    parseSeconds(value.amp_dec ?? value.decay ?? value.dec, 0.5),
  );
  const ampSusLevel =
    parseLevel(value.amp_sus ?? value.sustain ?? value.sus, 127) / 127.0;
  const ampRelSec = Math.max(
    0.001,
    parseSeconds(value.amp_rel ?? value.release ?? value.rel, 0.1),
  );
  const volVal = Math.max(
    0,
    Math.min(127, Number(value.vol ?? value.volume ?? 100)),
  );
  const masterAmp =
    (volVal / 127.0) * Number(value.amp ?? 1.0) * voiceGainAdjustment;

  const ampGainNode = new GainNode(ctx, { gain: 0 });
  multimodeNode.output.connect(ampGainNode);

  ampGainNode.gain.cancelScheduledValues(time);
  scheduleAmpEnv(ampGainNode.gain, time, clipDur, {
    atk: ampAtkSec,
    dec: ampDecSec,
    sust: ampSusLevel,
    rel: ampRelSec,
    amp: masterAmp,
  });

  const panVal = Math.max(-64, Math.min(63, Number(value.pan ?? 0)));
  const normPan = panVal / 64.0;
  let finalOutNode = ampGainNode;
  let pannerNode = null;

  if (typeof StereoPannerNode !== 'undefined') {
    pannerNode = new StereoPannerNode(ctx, { pan: normPan });
    ampGainNode.connect(pannerNode);
    finalOutNode = pannerNode;
  }

  const totalAmpEnvTime = ampAtkSec + ampDecSec + ampRelSec;
  const actualVoiceDur = Math.min(clipDur, totalAmpEnvTime);
  const actualStopTime = time + actualVoiceDur + 0.02;

  coreL.start(time);
  if (coreR) {
    coreR.start(time);
  }

  coreL.stop(actualStopTime);
  if (coreR) {
    coreR.stop(actualStopTime);
  }

  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    coreL.disconnect();
    if (coreR) {
      coreR.disconnect();
    }
    if (mergerNode) {
      try {
        mergerNode.disconnect();
      } catch (e) {}
    }
    overdriveNode.disconnect();
    baseWidthNode.disconnect();
    multimodeNode.disconnect();
    try {
      ampGainNode.disconnect();
    } catch (e) {}
    if (pannerNode) {
      try {
        pannerNode.disconnect();
      } catch (e) {}
    }
    if (typeof onended === 'function') {
      try {
        onended();
      } catch (e) {}
    }
  };

  if (typeof coreL.opC.addEventListener === 'function') {
    coreL.opC.addEventListener('ended', cleanup, { once: true });
  } else {
    coreL.opC.onended = cleanup;
  }

  return {
    node: finalOutNode,
    stop: (t) => {
      coreL.stop(t);
      if (coreR) {
        coreR.stop(t);
      }
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
      getGainAdjustment,
    );
  },
  { type: 'synth' },
);

// ----------------------------------------------------------------------------
// 2. skik - Bass Drum (Sub/Punch)
// ----------------------------------------------------------------------------
registerSound(
  'skik',
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
      frequency: defaultFreq * 16,
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
// 43. detsaw - Detuned Dual Saw
// ----------------------------------------------------------------------------
registerSound(
  'detsaw',
  (time, value, onended) => {
    let { freq, amp, duration, attack, decay, sustain, detune, cutoff, q } =
      value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 69);
    const defaultAmp = Number(amp ?? 0.6) * getGainAdjustment(value);
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
// 35. fmkey - FM Electric Keys
// ----------------------------------------------------------------------------
registerSound(
  'fmkey',
  (time, value, onended) => {
    let { freq, amp, duration, modrate, index, plen, prate, attack, decay, q } =
      value;
    const ctx = getAudioContext();

    const defaultFreq = getFrequencyFromValue(value, 28);
    const defaultAmp = Number(amp ?? 0.7) * getGainAdjustment(value);
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
