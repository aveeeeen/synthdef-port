# 要求

音声合成ソフトであるSupercolliderで定義したSynthdefをStrudel(javascriptのライブコーディングライブラリ)にポート(移植)を行う。

以下がStrudelで定義されたカスタムシンセの例である。
シンセのエンベロープやAudioNodeのクリーンアップ処理は例のコードに従うこと。

また、ホワイトノイズのようなOscillatorNodeだけでは生成できない音は、`whiteNoiseNode`のような補助関数を利用すること。
作成した補助関数をシンセ定義(`registerSound`)で利用する方法は`'ssn'`のシンセ定義の実装を参照すること。

```javascript
const whiteNoiseNode = (ctx) => {
  const audioCtx = ctx;
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);
  const gain = 0.4;

  for (let channel = 0; channel < noiseBuffer.numberOfChannels; channel++) {
    const channelData = noiseBuffer.getChannelData(channel);
    for (let i = 0; i < bufferSize; i++) {
      channelData[i] = Math.random() * 2 - 1;
    }
  }

  const source = audioCtx.createBufferSource();
  const gainNode = new GainNode(audioCtx, {
    gain: gain,
  });
  source.buffer = noiseBuffer;
  source.loop = true; // Loops seamlessly
  source.connect(gainNode);

  return {
    noise: source,
    node: gainNode,
    disconnect: () => {
      source.disconnect();
      gNode.disconnect();
    },
  };
};

registerSound(
  "skik",
  (time, value, onended) => {
    let { freq, prate, attack, decay, duration, sustain, release } = value;
    const ctx = getAudioContext();

    const pitchRate = prate ?? 4;
    const defaultFreq = freq ?? 40;
    const defaultAttack = attack ?? 0.001;
    const defaultLen = decay ?? 1;
    const defaultSustain = sustain ?? 0.3;
    const defaultRelease = release ?? 0.9;
    const initBpFreq = 8000;

    const maxGain = 0.4;
    const index = 128 * 12;

    const clipDur = duration - 0.01;

    const o = new OscillatorNode(ctx, {
      type: "sine",
      frequency: Number(defaultFreq),
    });
    const a = new GainNode(ctx, {
      value: maxGain,
    });

    const m = new OscillatorNode(ctx, {
      type: "sawtooth",
      frequency: Number(defaultFreq * 2),
    });
    const ma = new GainNode(ctx, {
      value: index,
    });

    const highpass = new BiquadFilterNode(ctx, {
      type: "highpass",
      Q: 2,
      frequency: 30,
      value: maxGain,
    });

    m.connect(ma);
    ma.connect(o.frequency);
    o.connect(a);
    highpass.connect(a);

    const pEnv = {
      a: 0.001,
      d: 0.04,
    };

    const mpEnv = {
      a: 0.001,
      d: 0.002,
    };

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

    o.addEventListener("ended", () => {
      m.disconnect();
      ma.disconnect();
      o.disconnect();
      a.disconnect();
      highpass.disconnect();
      onended();
    });

    return {
      node: a,
      stop: (time) => {
        o.stop(time);
        m.stop(time);
      },
    };
  },
  {
    type: "synth",
  },
);

registerSound(
  "ssn",
  (time, value, onended) => {
    let { freq, prate, attack, decay, duration, sustain, release } = value;
    const ctx = getAudioContext();

    const pitchRate = prate ?? 4;
    const defaultFreq = freq ?? 120;
    const defaultAttack = attack ?? 0.001;
    const defaultLen = decay ?? 0.5;
    const defaultSustain = sustain ?? 0;
    const defaultRelease = release ?? 0.9;
    const initBpFreq = 8000;

    const maxGain = 0.6;
    const index = 128 * 8;

    const clipDur = duration - 0.01;

    const o = new OscillatorNode(ctx, {
      type: "sine",
      frequency: Number(defaultFreq),
    });

    const { noise, node, disconnect } = whiteNoiseNode(ctx);

    const a = new GainNode(ctx, {
      value: maxGain,
    });

    const m = new OscillatorNode(ctx, {
      type: "sine",
      frequency: Number(defaultFreq),
    });

    const ma = new GainNode(ctx, {
      value: index,
    });

    const highpass = new BiquadFilterNode(ctx, {
      type: "highpass",
      Q: 4,
      frequency: 120,
      value: maxGain,
    });

    m.connect(ma);
    ma.connect(o.frequency);
    o.connect(a);
    node.connect(a);
    highpass.connect(a);

    const pEnv = {
      a: 0.001,
      d: 0.01,
    };

    const mpEnv = {
      a: 0.001,
      d: 0.09,
    };

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

    o.addEventListener("ended", () => {
      m.disconnect();
      ma.disconnect();
      disconnect();
      o.disconnect();
      a.disconnect();
      highpass.disconnect();
      onended();
    });

    return {
      node: a,
      stop: (time) => {
        o.stop(time);
        n.stop(time);
        m.stop(time);
      },
    };
  },
  {
    type: "synth",
  },
);
```

#　ゴール

- `./synthdef/SynthDefs.scd`にある`synthDef`関数で定義されているシンセ定義を`./strudel-out/strudel-synthdef.js`に移植すること。
- `registerSound`のシンセの名前は、`synthDef`関数の第一引数に代入されている値でバックスラッシュをトリムしたものを用いること。
  - e.g. `synthDef(\sbd, ...)` -> `registerSound('sbd', ...)`
