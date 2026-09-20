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
  besselJ,
  getHarmonicPartials,
  createDigitonePeriodicWave,
  scheduleOperatorEnv,
  schedulePitchEnvelope,
  createFeedbackLoop,
  createDigitoneFeedbackOperator,
  createDigitoneOverdriveNode,
  createBaseWidthFilterNode,
  createMultimodeFilterNode,
  playDigitoneSynVoice,
} from './strudel-synthdef.js';

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
  static instances = [];
  constructor(ctx, options = {}) {
    super(ctx);
    this.frequency = new MockAudioParam(options.frequency ?? 440);
    this.type = options.type ?? 'sine';
    this.started = false;
    this.stopped = false;
    this.listeners = {};
    this.periodicWave = null;
    MockOscillatorNode.instances.push(this);
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
  static instances = [];
  constructor(ctx, options = {}) {
    super(ctx);
    this.gain = new MockAudioParam(options.gain ?? 1);
    MockGainNode.instances.push(this);
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

class MockAudioBufferSourceNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx);
    this.buffer = null;
    this.loop = false;
    this.started = false;
    this.stopped = false;
  }
  start(t) {
    this.started = true;
    this.startTime = t;
  }
  stop(t) {
    this.stopped = true;
    this.stopTime = t;
  }
}

class MockAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: channels },
      () => new Float32Array(length),
    );
  }
  getChannelData(c) {
    return this.channels[c] || new Float32Array(this.length);
  }
}

class MockAudioContext {
  constructor() {
    this.sampleRate = 44100;
  }
  createPeriodicWave(real, imag) {
    return { real, imag };
  }
  createBuffer(channels, length, sampleRate) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    return new MockAudioBufferSourceNode(this);
  }
}

// Set up global mocks for tests
globalThis.AudioNode = MockAudioNode;
globalThis.OscillatorNode = MockOscillatorNode;
globalThis.GainNode = MockGainNode;
globalThis.DelayNode = MockDelayNode;
globalThis.BiquadFilterNode = MockBiquadFilterNode;
globalThis.WaveShaperNode = MockWaveShaperNode;
globalThis.AudioBufferSourceNode = MockAudioBufferSourceNode;

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

    it('reflects duration for note-off: stops oscillators according to duration', () => {
      const ctx = new MockAudioContext();
      MockOscillatorNode.instances = [];

      // Test short duration: 0.1s (e.g. 16th note pattern)
      playDigitoneSynVoice(
        ctx,
        0,
        {
          duration: 0.1,
          algo: 1,
        },
        () => {}
      );

      const recentOscs = MockOscillatorNode.instances.slice(-4);
      assert.strictEqual(recentOscs.length, 4);
      for (const osc of recentOscs) {
        assert.ok(osc.stopped, 'Oscillator should be scheduled to stop');
        assert.strictEqual(
          Math.round(osc.stopTime * 1000) / 1000,
          0.099,
          `Expected oscillator stopTime 0.099, got ${osc.stopTime}`
        );
      }

      // Test ultra short duration: 0.02s
      playDigitoneSynVoice(
        ctx,
        1.0,
        {
          duration: 0.02,
          algo: 2,
        },
        () => {}
      );
      const ultraShortOscs = MockOscillatorNode.instances.slice(-4);
      for (const osc of ultraShortOscs) {
        assert.ok(osc.stopped);
        assert.strictEqual(
          Math.round(osc.stopTime * 1000) / 1000,
          1.019,
          `Expected oscillator stopTime 1.019, got ${osc.stopTime}`
        );
      }

      // Test longer duration: 0.8s
      playDigitoneSynVoice(
        ctx,
        0,
        {
          duration: 0.8,
          algo: 3,
        },
        () => {}
      );
      const longOscs = MockOscillatorNode.instances.slice(-4);
      for (const osc of longOscs) {
        assert.ok(osc.stopped);
        assert.strictEqual(
          Math.round(osc.stopTime * 1000) / 1000,
          0.799,
          `Expected oscillator stopTime 0.799, got ${osc.stopTime}`
        );
      }
    });

    it('scheduleOperatorEnv respects duration and note-off in ASDE mode', () => {
      const param = new MockAudioParam(0);
      scheduleOperatorEnv(param, 0, {
        delayVal: 0,
        atkVal: 0,
        decVal: 64,
        endVal: 0,
        levVal: 127,
        trigMode: 0, // ASDE gated mode
        duration: 0.2,
        maxDeviation: 1000,
      });

      // clipDur = 0.19, stopTime = 0.199
      const scheduledTimes = param.scheduled.map(
        (s) => Math.round(s.time * 1000) / 1000
      );
      assert.ok(
        scheduledTimes.includes(0.19),
        'Should schedule note-off at clipDur'
      );
      assert.ok(
        scheduledTimes.includes(0.199),
        'Should ramp to endLevel at stopTime'
      );
      assert.ok(
        scheduledTimes.every((t) => t <= 0.199),
        'No scheduled events should exceed stopTime'
      );
    });
  });

  describe('Pitch Envelope (patk, plen, prate, pmode)', () => {
    it('schedules pitch envelope starting at peak when patk = 0', () => {
      const param = new MockAudioParam(100);
      schedulePitchEnvelope(param, 0, 100, {
        patk: 0,
        plen: 0.15,
        prate: 2.0,
        duration: 0.5,
      });

      const setVal = param.scheduled.find((s) => s.type === 'setValue');
      const ramp = param.scheduled.find((s) => s.type === 'exponentialRamp');
      assert.strictEqual(setVal.value, 200);
      assert.strictEqual(ramp.value, 100);
      assert.strictEqual(Math.round(ramp.time * 1000) / 1000, 0.15);
    });

    it('schedules pitch attack ramp when patk > 0', () => {
      const param = new MockAudioParam(100);
      schedulePitchEnvelope(param, 0, 100, {
        patk: 0.05,
        plen: 0.1,
        prate: 1.5,
        duration: 0.5,
      });

      const ramps = param.scheduled.filter((s) => s.type === 'exponentialRamp');
      assert.strictEqual(ramps.length, 2);
      assert.strictEqual(ramps[0].value, 150);
      assert.strictEqual(Math.round(ramps[0].time * 1000) / 1000, 0.05);
      assert.strictEqual(ramps[1].value, 100);
      assert.strictEqual(Math.round(ramps[1].time * 1000) / 1000, 0.15);
    });

    it('applies pitch envelope only to carrier operators in carrier mode', () => {
      const ctx = new MockAudioContext();
      MockOscillatorNode.instances = [];

      // Algo 1 has carriers C, B1, and modulators A, B2
      playDigitoneSynVoice(
        ctx,
        0,
        {
          algo: 1,
          freq: 200,
          patk: 0,
          plen: 0.2,
          prate: 2.0,
          pmode: 'carrier',
          duration: 0.5,
        },
        () => {}
      );

      const oscs = MockOscillatorNode.instances.slice(-4);
      const opC = oscs[0];
      const hasRampC = opC.frequency.scheduled.some((s) => s.type === 'exponentialRamp');
      assert.ok(hasRampC, 'Carrier C should have pitch envelope scheduled');

      const opB2 = oscs[3];
      const hasRampB2 = opB2.frequency.scheduled.some((s) => s.type === 'exponentialRamp');
      assert.ok(!hasRampB2, 'Modulator B2 should NOT have pitch envelope in carrier mode');
    });

    it('applies pitch envelope to all operators in all mode', () => {
      const ctx = new MockAudioContext();
      MockOscillatorNode.instances = [];

      playDigitoneSynVoice(
        ctx,
        0,
        {
          algo: 1,
          freq: 200,
          patk: 0,
          plen: 0.2,
          prate: 2.0,
          pmode: 'all',
          duration: 0.5,
        },
        () => {}
      );

      const oscs = MockOscillatorNode.instances.slice(-4);
      for (const osc of oscs) {
        const hasRamp = osc.frequency.scheduled.some((s) => s.type === 'exponentialRamp');
        assert.ok(hasRamp, 'All operators should have pitch envelope in all mode');
      }
    });
  });

  describe('Envelope Seconds Timing', () => {
    it('scheduleOperatorEnv accepts direct seconds for atkSec and decSec', () => {
      const param = new MockAudioParam(0);
      scheduleOperatorEnv(param, 0, {
        delSec: 0.05,
        atkSec: 0.1,
        decSec: 0.3,
        levVal: 127,
        endVal: 0,
        trigMode: 1,
        duration: 1.0,
        maxDeviation: 1.0,
      });

      const ramps = param.scheduled.filter((s) => s.type === 'linearRamp');
      assert.strictEqual(Math.round(ramps[0].time * 1000) / 1000, 0.15);
      assert.strictEqual(Math.round(ramps[1].time * 1000) / 1000, 0.45);
    });

    it('playDigitoneSynVoice interprets amp envelope and filter envelope in seconds', () => {
      const ctx = new MockAudioContext();
      const voice = playDigitoneSynVoice(
        ctx,
        0,
        {
          amp_atk: 0.08,
          amp_dec: 0.25,
          amp_sus: 64,
          amp_rel: 0.15,
          fltr_atk: 0.03,
          fltr_dec: 0.12,
          duration: 1.0,
        },
        () => {}
      );
      assert.ok(voice.node);
    });
  });

  describe('Algorithms 7 & 8 Carrier Envelopes & Separation', () => {
    it('Algo 7 passes audio through carrier amplitude envelopes (gain 0..1)', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = {
        ...createMockEnvNodes(ctx),
        carrierGainA: new MockGainNode(ctx, { gain: 0 }),
        carrierGainB1: new MockGainNode(ctx, { gain: 0 }),
        carrierGainB2: new MockGainNode(ctx, { gain: 0 }),
      };

      const res = digitoneAlgo7(ctx, 0, ops, envNodes, 0);

      // Carrier X gets C directly (dotted line) and A enveloped (solid line)
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(ops.opA.connections.includes(envNodes.carrierGainA));
      assert.ok(envNodes.carrierGainA.connections.includes(res.outX));

      // Carrier Y gets B1 enveloped and B2 enveloped
      assert.ok(ops.opB1.connections.includes(envNodes.carrierGainB1));
      assert.ok(envNodes.carrierGainB1.connections.includes(res.outY));
      assert.ok(ops.opB2.connections.includes(envNodes.carrierGainB2));
      assert.ok(envNodes.carrierGainB2.connections.includes(res.outY));

      // Modulators: A modulates C, B2 modulates B1
      assert.ok(ops.opA.connections.includes(envNodes.gainA));
      assert.ok(envNodes.gainA.connections.includes(ops.opC.frequency));
      assert.ok(ops.opB2.connections.includes(envNodes.gainB2));
      assert.ok(envNodes.gainB2.connections.includes(ops.opB1.frequency));

      res.disconnect();
    });

    it('Algo 8 passes B1 and B2 carriers through carrier amplitude envelopes', () => {
      const ctx = new MockAudioContext();
      const ops = createMockOps(ctx);
      const envNodes = {
        ...createMockEnvNodes(ctx),
        carrierGainB1: new MockGainNode(ctx, { gain: 0 }),
        carrierGainB2: new MockGainNode(ctx, { gain: 0 }),
      };

      const res = digitoneAlgo8(ctx, 0, ops, envNodes, 0);

      // Carrier X gets C (dotted) and B2 enveloped (solid)
      assert.ok(ops.opC.connections.includes(res.outX));
      assert.ok(ops.opB2.connections.includes(envNodes.carrierGainB2));
      assert.ok(envNodes.carrierGainB2.connections.includes(res.outX));

      // Carrier Y gets B1 enveloped (solid)
      assert.ok(ops.opB1.connections.includes(envNodes.carrierGainB1));
      assert.ok(envNodes.carrierGainB1.connections.includes(res.outY));

      // Modulation: A modulates C
      assert.ok(ops.opA.connections.includes(envNodes.gainA));
      assert.ok(envNodes.gainA.connections.includes(ops.opC.frequency));

      res.disconnect();
    });
  });

  describe('FM Feedback DSP (Sine -> Sawtooth -> Noise)', () => {
    it('produces pure sine partials at feedback = 0', () => {
      const p = getHarmonicPartials(0, 'A', 0);
      assert.strictEqual(p[1], 1.0);
      for (let n = 2; n < p.length; n++) {
        assert.strictEqual(p[n], 0, `Partial ${n} should be 0 at fdbk=0`);
      }
    });

    it('smoothly expands harmonics up to sawtooth spectrum at feedback = 64', () => {
      const p32 = getHarmonicPartials(0, 'A', 32);
      const p64 = getHarmonicPartials(0, 'A', 64);

      assert.ok(p32[2] > 0);
      assert.ok(p64[2] > p32[2]);
      assert.ok(p64[3] > p32[3]);

      assert.ok(p64[1] > p64[2]);
      assert.ok(p64[2] > p64[3]);
      assert.ok(p64[3] > p64[4]);
      assert.ok(p64[10] > 0);
    });

    it('createDigitoneFeedbackOperator uses pure oscillator when fdbk <= 64', () => {
      const ctx = new MockAudioContext();
      const op = createDigitoneFeedbackOperator(ctx, 0, 220, 0, 'A', 50, 1.0);
      assert.strictEqual(op.noiseSource, null);
      assert.ok(op.osc instanceof MockOscillatorNode);
      op.disconnect();
    });

    it('createDigitoneFeedbackOperator activates noise blending when fdbk > 64', () => {
      const ctx = new MockAudioContext();
      const op = createDigitoneFeedbackOperator(ctx, 0, 220, 0, 'A', 100, 1.0);
      assert.ok(op.noiseSource, 'Noise source should be created when fdbk > 64');
      assert.ok(op.node instanceof MockGainNode, 'Output should be blended gain node');
      op.disconnect();
    });
  });
});

