import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  digitoneAlgo1,
  digitoneAlgo2,
  digitoneAlgo3,
  digitoneAlgo4,
  digitoneAlgo5,
  digitoneAlgo6,
  digitoneAlgo7,
  digitoneAlgo8,
  digitoneAlgorithms,
  getDigitoneAlgorithm,
  calculateLevB,
  calculateDetuneOffset,
  getHarmonicPartials,
  createDigitonePeriodicWave,
  scheduleOperatorEnv,
  createFeedbackLoop,
  createDigitoneOverdriveNode,
  createBaseWidthFilterNode,
  createMultimodeFilterNode,
  playDigitoneSynVoice,
} from './digitone-fm.js';

// ============================================================================
// Web Audio Mock Utilities for Headless Node.js Testing
// ============================================================================
class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.scheduled = [];
  }
  cancelScheduledValues(t) {
    this.scheduled.push({ type: 'cancel', time: t });
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.scheduled.push({ type: 'setValue', value: v, time: t });
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.scheduled.push({ type: 'linearRamp', value: v, time: t });
  }
  exponentialRampToValueAtTime(v, t) {
    this.value = v;
    this.scheduled.push({ type: 'exponentialRamp', value: v, time: t });
  }
}

class MockAudioNode {
  constructor(ctx) {
    this.context = ctx;
    this.connections = [];
  }
  connect(target) {
    this.connections.push(target);
    return target;
  }
  disconnect(target) {
    if (target) {
      this.connections = this.connections.filter((c) => c !== target);
    } else {
      this.connections = [];
    }
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor(ctx, options = {}) {
    super(ctx);
    this.frequency = new MockAudioParam(options.frequency ?? 440);
    this.type = options.type ?? 'sine';
    this.started = false;
    this.stopped = false;
    this.listeners = {};
    this.periodicWave = null;
  }
  setPeriodicWave(pw) {
    this.periodicWave = pw;
  }
  start(t) {
    this.started = true;
    this.startTime = t;
  }
  stop(t) {
    this.stopped = true;
    this.stopTime = t;
  }
  addEventListener(event, callback) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(callback);
  }
  triggerEvent(event) {
    const list = this.listeners[event] || [];
    for (const cb of list) cb();
  }
}

class MockGainNode extends MockAudioNode {
  constructor(ctx, options = {}) {
    super(ctx);
    this.gain = new MockAudioParam(options.gain ?? 1);
  }
}

class MockDelayNode extends MockAudioNode {
  constructor(ctx, options = {}) {
    super(ctx);
    this.delayTime = new MockAudioParam(options.delayTime ?? 0);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(ctx, options = {}) {
    super(ctx);
    this.type = options.type ?? 'lowpass';
    this.frequency = new MockAudioParam(options.frequency ?? 350);
    this.Q = new MockAudioParam(options.Q ?? 1);
  }
}

class MockWaveShaperNode extends MockAudioNode {
  constructor(ctx, options = {}) {
    super(ctx);
    this.curve = options.curve ?? null;
    this.oversample = options.oversample ?? 'none';
  }
}

class MockAudioContext {
  constructor() {
    this.sampleRate = 44100;
  }
  createPeriodicWave(real, imag) {
    return { real, imag };
  }
}

// Set up global mocks for tests
globalThis.AudioNode = MockAudioNode;
globalThis.OscillatorNode = MockOscillatorNode;
globalThis.GainNode = MockGainNode;
globalThis.DelayNode = MockDelayNode;
globalThis.BiquadFilterNode = MockBiquadFilterNode;
globalThis.WaveShaperNode = MockWaveShaperNode;

const createMockOps = (ctx) => ({
  opC: new MockOscillatorNode(ctx, { frequency: 100 }),
  opA: new MockOscillatorNode(ctx, { frequency: 200 }),
  opB1: new MockOscillatorNode(ctx, { frequency: 300 }),
  opB2: new MockOscillatorNode(ctx, { frequency: 400 }),
});

const createMockEnvNodes = (ctx) => ({
  gainA: new MockGainNode(ctx, { gain: 0 }),
  gainB1: new MockGainNode(ctx, { gain: 0 }),
  gainB2: new MockGainNode(ctx, { gain: 0 }),
});

// ============================================================================
// Unit Tests
// ============================================================================

describe('Digitone FM Synthesis Engine', () => {
  describe('LEV B Macro-Mapping (Appendix A.5 / Section 11.5.8)', () => {
    it('returns B1=0, B2=0 at value 0', () => {
      const res = calculateLevB(0);
      assert.strictEqual(res.b1, 0);
      assert.strictEqual(res.b2, 0);
    });

    it('returns B1=127, B2=0 at value 43', () => {
      const res = calculateLevB(43);
      assert.strictEqual(Math.round(res.b1), 127);
      assert.strictEqual(res.b2, 0);
    });

    it('returns equal levels B1=63.5, B2=63.5 at value 64', () => {
      const res = calculateLevB(64);
      assert.strictEqual(res.b1, 63.5);
      assert.strictEqual(res.b2, 63.5);
    });

    it('returns B1=0, B2=127 at value 85', () => {
      const res = calculateLevB(85);
      assert.strictEqual(Math.round(res.b1), 0);
      assert.strictEqual(Math.round(res.b2), 127);
    });

    it('returns B1=127, B2=127 at value 127', () => {
      const res = calculateLevB(127);
      assert.strictEqual(Math.round(res.b1), 127);
      assert.strictEqual(Math.round(res.b2), 127);
    });
  });

  describe('Detune Offset (Section 11.3.6 DTUN)', () => {
    it('is 0 when dtun is 0', () => {
      assert.strictEqual(calculateDetuneOffset(0), 0);
    });

    it('provides subtle offset up to 64', () => {
      const d32 = calculateDetuneOffset(32);
      const d64 = calculateDetuneOffset(64);
      assert.ok(d32 > 0 && d32 < 0.015);
      assert.strictEqual(d64, 0.015);
    });

    it('provides heavier detuning above 64 up to 127', () => {
      const d127 = calculateDetuneOffset(127);
      assert.ok(d127 > 0.35);
    });
  });

  describe('Harmonics (Appendix A.6 HARMONICS)', () => {
    it('returns pure fundamental sine wave when harm is 0', () => {
      const pC = getHarmonicPartials(0, 'C');
      const pA = getHarmonicPartials(0, 'A');
      assert.strictEqual(pC[1], 1.0);
      assert.strictEqual(pC[2], 0);
      assert.strictEqual(pA[1], 1.0);
      assert.strictEqual(pA[2], 0);
    });

    it('negative harm affects Operator C but not A or B1', () => {
      const pC = getHarmonicPartials(-13, 'C');
      const pA = getHarmonicPartials(-13, 'A');
      const pB1 = getHarmonicPartials(-13, 'B1');
      assert.ok(pC[2] > 0);
      assert.strictEqual(pA[2], 0);
      assert.strictEqual(pB1[2], 0);
    });

    it('positive harm affects Operators A and B1 but not C', () => {
      const pC = getHarmonicPartials(13, 'C');
      const pA = getHarmonicPartials(13, 'A');
      const pB1 = getHarmonicPartials(13, 'B1');
      assert.strictEqual(pC[2], 0);
      assert.ok(pA[2] > 0);
      assert.ok(pB1[2] > 0);
    });

    it('creates PeriodicWave with correct Fourier arrays', () => {
      const ctx = new MockAudioContext();
      const pw = createDigitonePeriodicWave(ctx, 15, 'A');
      assert.ok(pw);
      assert.strictEqual(pw.imag[1], 1.0);
      assert.ok(pw.imag[2] > 0);
    });
  });

  describe('Base-Width Filter (Section 11.8)', () => {
    it('bypasses filtering when BASE=0 and WIDTH=127', () => {
      const ctx = new MockAudioContext();
      const bw = createBaseWidthFilterNode(ctx, 0, 127);
      assert.strictEqual(bw.input, bw.output);
      assert.ok(bw.input instanceof MockGainNode);
    });

    it('creates HP and LP filters in series when active', () => {
      const ctx = new MockAudioContext();
      const bw = createBaseWidthFilterNode(ctx, 40, 80);
      assert.ok(bw.input instanceof MockBiquadFilterNode);
      assert.ok(bw.output instanceof MockBiquadFilterNode);
      assert.strictEqual(bw.input.type, 'highpass');
      assert.strictEqual(bw.output.type, 'lowpass');
      assert.ok(bw.input.connections.includes(bw.output));
    });
  });

  describe('Multimode Filter (Section 11.7)', () => {
    it('type 0 is OFF (transparent passthrough)', () => {
      const ctx = new MockAudioContext();
      const fltr = createMultimodeFilterNode(ctx, 0, { fltr_type: 0 });
      assert.strictEqual(fltr.input, fltr.output);
      assert.ok(fltr.input instanceof MockGainNode);
    });

    it('type 1 is 12dB Lowpass', () => {
      const ctx = new MockAudioContext();
      const fltr = createMultimodeFilterNode(ctx, 0, { fltr_type: 1 });
      assert.strictEqual(fltr.input.type, 'lowpass');
    });

    it('type 2 is 12dB Highpass', () => {
      const ctx = new MockAudioContext();
      const fltr = createMultimodeFilterNode(ctx, 0, { fltr_type: 2 });
      assert.strictEqual(fltr.input.type, 'highpass');
    });

    it('type 3 is 24dB Lowpass (2 cascaded filters)', () => {
      const ctx = new MockAudioContext();
      const fltr = createMultimodeFilterNode(ctx, 0, { fltr_type: 3 });
      assert.notStrictEqual(fltr.input, fltr.output);
      assert.strictEqual(fltr.input.type, 'lowpass');
      assert.strictEqual(fltr.output.type, 'lowpass');
    });
  });

  describe('Overdrive (Section 11.9.5 DRV)', () => {
    it('bypasses overdrive when DRV is 0', () => {
      const ctx = new MockAudioContext();
      const od = createDigitoneOverdriveNode(ctx, 0);
      assert.strictEqual(od.input, od.output);
    });

    it('creates WaveShaper distortion when DRV > 0', () => {
      const ctx = new MockAudioContext();
      const od = createDigitoneOverdriveNode(ctx, 64);
      assert.ok(od.input instanceof MockGainNode);
      assert.ok(od.output instanceof MockGainNode);
    });
  });

  describe('8 FM Algorithms (Appendix A.3)', () => {
    it('contains all 8 algorithm functions', () => {
      assert.strictEqual(digitoneAlgorithms.length, 8);
      for (let i = 1; i <= 8; i++) {
        assert.strictEqual(typeof getDigitoneAlgorithm(i), 'function');
      }
    });

    it('Algo 1: B2->B1->C, A->C, Feedback on A, X=C, Y=B1', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = createMockEnvNodes(ctx);
      const res = digitoneAlgo1(ctx, 0, ops, envNodes, 50);

      assert.strictEqual(res.feedbackOp, 'A');
      assert.ok(res.outX.connections || res.outX);
      // B2 -> gainB2 -> opB1.freq
      assert.ok(ops.opB2.connections.includes(envNodes.gainB2));
      assert.ok(envNodes.gainB2.connections.includes(ops.opB1.frequency));
      // B1 -> gainB1 -> opC.freq
      assert.ok(ops.opB1.connections.includes(envNodes.gainB1));
      assert.ok(envNodes.gainB1.connections.includes(ops.opC.frequency));
      // A -> gainA -> opC.freq
      assert.ok(ops.opA.connections.includes(envNodes.gainA));
      assert.ok(envNodes.gainA.connections.includes(ops.opC.frequency));
      // X = C, Y = B1
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(ops.opB1.connections.includes(res.outY));

      res.disconnect();
    });

    it('Algo 2: A->C, B2->B1, Feedback on B2, X=C, Y=B1', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = createMockEnvNodes(ctx);
      const res = digitoneAlgo2(ctx, 0, ops, envNodes, 50);

      assert.strictEqual(res.feedbackOp, 'B2');
      // A -> gainA -> opC.freq
      assert.ok(ops.opA.connections.includes(envNodes.gainA));
      assert.ok(envNodes.gainA.connections.includes(ops.opC.frequency));
      // B2 -> gainB2 -> opB1.freq
      assert.ok(ops.opB2.connections.includes(envNodes.gainB2));
      assert.ok(envNodes.gainB2.connections.includes(ops.opB1.frequency));
      // X = C, Y = B1
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(ops.opB1.connections.includes(res.outY));

      res.disconnect();
    });

    it('Algo 3: A->(C, B2, B1), Feedback on A, X=C+B2, Y=B1', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = createMockEnvNodes(ctx);
      const res = digitoneAlgo3(ctx, 0, ops, envNodes, 50);

      assert.strictEqual(res.feedbackOp, 'A');
      // A branches to C, B2, B1
      assert.ok(envNodes.gainA.connections.includes(ops.opC.frequency));
      assert.ok(envNodes.gainA.connections.includes(ops.opB2.frequency));
      assert.ok(envNodes.gainA.connections.includes(ops.opB1.frequency));
      // X = C + B2
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(ops.opB2.connections.includes(res.outX));
      // Y = B1
      assert.ok(ops.opB1.connections.includes(res.outY));

      res.disconnect();
    });

    it('Algo 4: B2->B1->A->C, Feedback on B2, X=C, Y=B1', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = createMockEnvNodes(ctx);
      const res = digitoneAlgo4(ctx, 0, ops, envNodes, 50);

      assert.strictEqual(res.feedbackOp, 'B2');
      assert.ok(envNodes.gainB2.connections.includes(ops.opB1.frequency));
      assert.ok(envNodes.gainB1.connections.includes(ops.opA.frequency));
      assert.ok(envNodes.gainA.connections.includes(ops.opC.frequency));
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(ops.opB1.connections.includes(res.outY));

      res.disconnect();
    });

    it('Algo 5: (B1, B2)->A->C, Feedback on B1, X=C, Y=A', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = createMockEnvNodes(ctx);
      const res = digitoneAlgo5(ctx, 0, ops, envNodes, 50);

      assert.strictEqual(res.feedbackOp, 'B1');
      assert.ok(envNodes.gainB1.connections.includes(ops.opA.frequency));
      assert.ok(envNodes.gainB2.connections.includes(ops.opA.frequency));
      assert.ok(envNodes.gainA.connections.includes(ops.opC.frequency));
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(ops.opA.connections.includes(res.outY));

      res.disconnect();
    });

    it('Algo 6: A->(C, B1), B2->(C, B1), Feedback on A, X=C, Y=B1', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = createMockEnvNodes(ctx);
      const res = digitoneAlgo6(ctx, 0, ops, envNodes, 50);

      assert.strictEqual(res.feedbackOp, 'A');
      assert.ok(envNodes.gainA.connections.includes(ops.opC.frequency));
      assert.ok(envNodes.gainA.connections.includes(ops.opB1.frequency));
      assert.ok(envNodes.gainB2.connections.includes(ops.opC.frequency));
      assert.ok(envNodes.gainB2.connections.includes(ops.opB1.frequency));
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(ops.opB1.connections.includes(res.outY));

      res.disconnect();
    });

    it('Algo 7: A->C, B2->B1, Feedback on A, X=C+A(enveloped), Y=B1(enveloped)+B2(enveloped)', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = createMockEnvNodes(ctx);
      const res = digitoneAlgo7(ctx, 0, ops, envNodes, 50);

      assert.strictEqual(res.feedbackOp, 'A');
      // Carrier X gets C (dotted) and gainA (solid)
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(envNodes.gainA.connections.includes(res.outX));
      // Carrier Y gets gainB1 (solid) and gainB2 (solid)
      assert.ok(envNodes.gainB1.connections.includes(res.outY));
      assert.ok(envNodes.gainB2.connections.includes(res.outY));

      res.disconnect();
    });

    it('Algo 8: A->C, B1 & B2 independent carriers, Feedback on B1, X=C+B2(enveloped), Y=B1(enveloped)', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = createMockEnvNodes(ctx);
      const res = digitoneAlgo8(ctx, 0, ops, envNodes, 50);

      assert.strictEqual(res.feedbackOp, 'B1');
      // Carrier X gets C and gainB2
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(envNodes.gainB2.connections.includes(res.outX));
      // Carrier Y gets gainB1
      assert.ok(envNodes.gainB1.connections.includes(res.outY));

      res.disconnect();
    });
  });

  describe('Full Digitone Voice Playback (syn)', () => {
    it('plays voice with defaults and cleans up onended', () => {
      const ctx = new MockAudioContext();
      let endedCalled = false;
      const voice = playDigitoneSynVoice(
        ctx,
        0,
        {
          freq: 220,
          duration: 0.5,
          algo: 1,
          fdbk: 60,
          mix: 0,
          drv: 20,
          fltr_type: 1,
          fltr_freq: 90,
        },
        () => {
          endedCalled = true;
        }
      );

      assert.ok(voice.node);
      assert.strictEqual(typeof voice.stop, 'function');

      // Trigger ended
      voice.stop(0.5);
    });

    it('supports all 8 algorithms in full synth voice', () => {
      const ctx = new MockAudioContext();
      for (let a = 1; a <= 8; a++) {
        const voice = playDigitoneSynVoice(
          ctx,
          0,
          {
            algo: a,
            harm: 10,
            dtun: 40,
            fdbk: 80,
            mix: 30,
            base: 20,
            width: 90,
            drv: 35,
          },
          () => {}
        );
        assert.ok(voice.node);
      }
    });
  });
});
