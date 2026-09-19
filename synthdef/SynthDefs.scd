
// effects


// synth defs

(
////////////////////////////////////////////

SynthDef(\sbd2, {
    |out = 0, pan = 0, amp = 1, gate = 1, len = 0.2, sust = 0.1|
    var body, bodyFreq, bodyAmp;
    var pop, popFreq, popAmp;
    var click, clickAmp;
    var snd;

    // body starts midrange, quickly drops down to low freqs, and trails off
    bodyFreq = EnvGen.ar(Env([261, 150, 50], [0.02, 0.1], curve: \exp));
    bodyAmp = EnvGen.ar(Env.linen(0.005, sust, len), gate, doneAction: 2);
    body = SinOsc.ar(bodyFreq) * bodyAmp;
	body = (body*1.4).tanh;
    // pop sweeps over the midrange
    popFreq = XLine.kr(750, 261, 0.01);
    popAmp = EnvGen.ar(Env.linen(0.001, 0.02, 0.001)) * 0.15;
    pop = SinOsc.ar(popFreq) * popAmp;
    // click is spectrally rich, covering the high-freq range
    // you can use Formant, FM, noise, whatever
    clickAmp = EnvGen.ar(Env.perc(0.001, 0.001)) * 0.4;
    click = LPF.ar(Formant.ar(910, 8760, 2110), 10000) * clickAmp;

    snd = body + pop + click;
	snd = snd.tanh;

    OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\sbd, {
    |out = 0, pan = 0, amp = 0.3, len = 0.5, sust = 0.5, freq = 42|
    var body, bodyFreq, bodyAmp;
    var pop, popFreq, popAmp;
    var click, clickAmp;
    var snd;
	// var ring = SinOsc.ar(40);
    // body starts midrange, quickly drops down to low freqs, and trails off
	bodyFreq = EnvGen.ar(Env([freq * 6,freq * 3,freq], [0.01, 0.08], \exp));
	bodyAmp = EnvGen.ar(Env([0, 1, 0.75, 0], [0.001, len / 4, len / 2], 2), doneAction: 2);
    body = SinOsc.ar(bodyFreq) * bodyAmp;
    // pop sweeps over the midrange
    popFreq = XLine.kr(750, 250, 0.01);
    popAmp = EnvGen.ar(Env.linen(0.001, 0.02, 0.001)) * 0.3;
    pop = SinOsc.ar(popFreq) * popAmp;
    // click is spectrally rich, covering the high-freq range
    // you can use Formant, FM, noise, whatever
    clickAmp = EnvGen.ar(Env.perc(0.001, 0.0005)) * 0.4;
	click = SinOsc.ar(freq * 4, mul: XLine.kr(80, 0.1, 0.02) * freq * 4);
	click = SinOsc.ar(freq + click) * clickAmp;

	snd = (body + pop + click);
	snd = snd * XLine.kr(2, 1, 0.05);
	snd = snd * 1.2;
	snd = snd.tanh;

    OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan)
	);
}).add;

SynthDef(\shh, {
	|out, pan, gate = 1, freq = 5000, ringfreq = 700, modrate = 1, amp = 1, index = 3, len = 0.1|
	var snd, mod;
	mod = LFPulse.ar(freq * modrate) * (freq * modrate * index);
	snd = LFPulse.ar(freq + mod);
	snd = snd * LFPulse.ar(ringfreq);
	snd = RHPF.ar (snd, 6000, 0.3);
	snd = snd * EnvGen.ar(Env.perc(0.001, len,curve: -8),gate: gate, doneAction: 2);
	snd = snd * XLine.kr(1.3, 1, 0.02);
	snd = snd * 1;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\soh, {
	|out, pan, gate = 1, freq = 5000, ringfreq = 700, modrate = 1, amp = 1, index = 3, len = 1|
	var snd, mod;
	mod = LFPulse.ar(freq * modrate) * (freq * modrate * index);
	snd = LFPulse.ar(freq + mod);
	snd = snd * LFPulse.ar(ringfreq);
	snd = RHPF.ar (snd, 6000, 0.3);
	snd = snd * EnvGen.ar(Env.perc(0.001, len,curve: -8), gate: gate, doneAction: 2);
	snd = snd * XLine.kr(1.3, 1, 0.02);
	snd = snd * 1;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\mchbd, {
    arg clr = 0, shp = 0.5, sweep = 1, contour = 0.2,

    // Additional parameters
    freq = 50, amp = 1, gate = 1, len = 0.4, plen = 0.1, out = 0, pan;

    var sig, env, pitchEnv, colorMod, shapeMod, feedback, freqMod, mod;

    // Main amplitude envelope
    env = env = EnvGen.ar(Env([0,1,0.5,0], [0.001, len/4, len], -4), gate: gate, doneAction: 2);

    // Pitch envelope for sweep parameter
    pitchEnv = EnvGen.kr(
        Env([1, 0.2, 0], [0.03, plen], [-4, -2]),
        gate
    );

    // Apply sweep to frequency modulation
    freqMod = freq * (1 + (pitchEnv * sweep * 6));

    // Contour modulates color and shape over time
	contour = contour.linlin(0, 1, 1, 0);
	colorMod = clr * (1 + (contour * env * 2));
    shapeMod = shp * (1 + (contour * env * 2));

    /*// Start with sine wave
    sig = SinOsc.ar(freqMod);*/

	mod = SinOsc.ar(freqMod) * freq * 32 * Env([0, 1, 0], [0.001, 0.001], -4).kr(0);

    // SHAPE: Triangle/sawtooth modulation with feedback
    // FM-style feedback synthesis
	// feedback = LocalIn.ar(1);
	sig = SinOscFB.ar(freqMod + (mod * sweep), shapeMod.linlin(0, 1, 0, 0.9));

    // COLOR: Sine to square wave morphing using wave shaping
    // Soft square-like modulation by adding harmonics
    sig = sig + (sig.pow(3) * colorMod * 0.3);
    sig = sig + (sig.pow(5) * colorMod * 0.5);

    // Additional harmonic content for square-like character
    sig = sig + (SinOsc.ar(freqMod * 3) * colorMod * 0.3);
    sig = sig + (SinOsc.ar(freqMod * 5) * colorMod * 0.2);

    // Triangle wave component
    sig = sig + (LFTri.ar(freqMod) * shapeMod * 0.9);

    // Add noise at high shape values
	sig = sig + (BPF.ar(PinkNoise.ar(), 8000, 0.5) * shapeMod.floor.pow(2) * 0.4);
    // Feedback delay and filtering
	// feedback = DelayN.ar(sig, 0.01, 0.001);
    // feedback = LPF.ar(feedback, freqMod * 4);
	/*LocalOut.ar(feedback);*/

    // Soft saturation and filtering
    sig = sig * env;
	sig = sig.tanh;
	sig = sig * -4.dbamp;

    // Final amplitude and envelope

    // Stereo output
    OffsetOut.ar(out,
		DirtPan.ar(sig, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\mchtone, {
    arg clr = 1, shp = 0.5, sweep = 1, contour = 0.2,

    // Additional parameters
    freq = 50, amp = 1, gate = 1, len = 0.4, plen = 0.1, out = 0, pan;

    var sig, env, pitchEnv, colorMod, shapeMod, feedback, freqMod, mod;

    // Main amplitude envelope
    env = env = EnvGen.ar(Env([0,1,0.5,0], [0.001, len/4, len], -4), gate: gate, doneAction: 2);

    // Apply sweep to frequency modulation
    freqMod = freq * clr;

    // Contour modulates color and shape over time
	contour = contour.linlin(0, 1, 1, 0);
    shapeMod = shp * (1 + (contour * env));

    /*// Start with sine wave
    sig = SinOsc.ar(freqMod);*/

	mod = SinOsc.ar(freqMod) * freq * shp.linlin(0, 1, 0, 16);

    // SHAPE: Triangle/sawtooth modulation with feedback
    // FM-style feedback synthesis
	feedback = LocalIn.ar(1);
	sig = SinOsc.ar(freq + mod + (feedback * freq * sweep));

    // Add noise at high shape values
	// sig = sig + (BPF.ar(PinkNoise.ar(), 8000, 0.5) * shapeMod.floor.pow(2) * 0.4);
    // Feedback delay and filtering
	feedback = DelayN.ar(sig, 0.01, 0.00001);
	feedback = RHPF.ar(feedback, 20, 0.1);
	LocalOut.ar(sig);

    // Soft saturation and filtering
    sig = sig * env;
	sig = sig.tanh;
	sig = sig * -4.dbamp;

    // Final amplitude and envelope

    // Stereo output
    OffsetOut.ar(out,
		DirtPan.ar(sig, ~dirt.numChannels, pan, amp)
	);
}).add;



SynthDef(\skik, {
	|out, pan, gate = 1, freq = 50, modrate = 1, plen = 0.12, prate = 6, index = 32, len = 0.4, amp = 1|
	var snd, mod, penv, env, modenv;
	modenv = EnvGen.ar(Env.perc(0.001, 0.0001));
	env = EnvGen.ar(Env([0,1,0.75,0], [0.001, len/4, len/2]), gate: gate, doneAction: 2);
	penv = EnvGen.ar(Env.perc(0.001, plen, prate));
	mod = SinOsc.ar(freq * modrate * penv.linexp(0,prate,1,prate) ) * (freq * modrate * index) * modenv.linexp(0, 1, 0.005, 1);
	snd = SinOsc.ar(freq * penv.linexp(0,prate,1,prate) + mod);
	snd = snd; //*\\\ LFPulse.ar(ringfreq);
	snd = snd * 2;
	snd = snd * EnvGen.ar(Env.perc(0.001, 0.1)).linexp(0, 1, 1, 3);
	// snd = RHPF.ar(snd, 40, 0.7);
	snd = snd * env * 1.2;
	snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\skik2, {
	|out, pan, gate = 1, freq = 50, modrate = 1, plen = 0.01, prate = 8, index = 42, len = 0.4, amp = 1|
	var snd, mod, penv, env, modenv, click, cenv, cmod, cindex, cmodrate, bmod;
	cmodrate = 2;
	cindex = 32;
	modenv = EnvGen.ar(Env.perc(0.001, 0.1));
	env = EnvGen.ar(Env([0,1,0,0], [0.001, len/8, len]), gate: gate, doneAction: 2);
	cenv = EnvGen.ar (Env.perc(0.0001, 0.01));
	penv = EnvGen.ar(Env.perc(0.001, plen, prate));
	mod = SinOsc.ar(freq * modrate * penv.linexp(0,prate,1,prate)) * (freq * modrate * index) * env * 0.4;
	cmod = SinOsc.ar(freq * cmodrate * penv.linexp(0,prate,1,prate)) * (freq * cmodrate * cindex) * env * 0.02;
	bmod = SinOsc.ar(freq * 2 * penv.linexp(0,prate,1,prate)) * (freq * 2 * 42) * cenv;
	click = SinOsc.ar(freq * bmod);
	snd = (SinOsc.ar(freq * penv.linexp(0,prate,1,prate) + cmod) * cmod * 2) + mod * 0.04;
	// snd = DiodeRingMod.ar(snd, cmod * env);
	snd = snd + click;
	snd = DriveNoise.ar(snd, 0.1, 0.8);
	snd = RHPF.ar(snd, 50, 0.7);
	// snd = snd * EnvGen.ar(Env.perc(0.001, 0.1)).linexp(0, 1, 1, 3);
	snd = snd * env * 0.6;
	snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\sak, {
	|out, pan, gate = 1, amp = 1, freq = 50, plen = 0.12, prate = 6, len 1.4, index = 32, modrate = 1|
	var snd, mod, env, penv;
	var modenv = EnvGen.ar(Env.perc(0.001, 0.001));
	env = EnvGen.ar(Env.perc(0.001, len), gate: gate, doneAction: 2);
	penv = EnvGen.ar(Env([freq, prate * freq, prate * freq / 2 , prate * freq / 4, freq , 20], [0.001, plen / 16, plen / 8 , plen / 2 , plen], \exp));
	mod = LFSaw.ar(penv * modrate) * modrate * index * modenv.linlin(0, 1 , 0.7, 4);
	snd = SinOsc.ar(penv + mod);
	// snd = LPF.ar(snd, XLine.kr(15000, 500, len / 2));
	snd = RHPF.ar(snd, 50, 0.3);
	snd = snd * 2;
	snd = DriveNoise.ar(snd, 0.2, 0.8);
	snd = snd * env;
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\sak2, {
	|out, pan, amp = 1, plen = 0.1, freq = 40|
	var len = 2;

	var snd, env;
	snd = SinOsc.ar( Hasher.kr((1 .. 18).normalize).linlin(0, 1, 20, 100) * EnvGen.kr(Env([1, 12, 4, 2], [0.01, plen / 4, plen])));
	snd.sum;
	snd = snd * EnvGen.ar(Env.perc(0.001, len), doneAction: 2);
	// snd = PitchShift.ar(snd, 0.001, 0.5, 0.01);
	snd = snd * 2;
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\ssn, {
	|out, pan, amp = 1, gate = 1, prate = 6, plen = 0.12, len = 0.3|
	var snd, penv, env, noise;
	var freq = 160;
	env = EnvGen.ar(Env.perc(0.0001,len, curve: -6), gate: gate, doneAction: 2);
	penv = EnvGen.ar(Env([1, prate, prate / 3, 1] , [0.001, plen / 16, plen / 8]));
	snd = SinOsc.ar(freq * penv);
	snd.tanh;
	snd = snd * env;
	noise = WhiteNoise.ar();
	noise = BPF.ar(noise, XLine.kr(12000, 6000, len), 1) * EnvGen.ar(Env.perc(0.001, len)) * -4.dbamp;
	snd = snd + noise;
	snd = snd * 1.6;
	snd = snd * EnvGen.ar(Env.perc(0.0001, 0.2)).linexp(0, 1, 1, 1.2);
	snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\scp, {
	| out, pan, gate = 1, amp = 1.5, atk = 0.0001, len = 0.3, curveRate = 6, q = 0.7|
	var freq = 800;
	var env = Env([0, 1, 0], [atk, len], -6).kr(0);
	var env2 = Env([0, 0, 1, 0], [0.02, atk, len], -6).kr(2, gate);
	var distenv2 = EnvGen.kr(Env([0, 0, 0.8, 0], [0.01, 0.0001, 0.05]));
	var snd = LFNoise0.ar(12000) * env;

	snd = RLPF.ar(snd, XLine.kr(12000, 4000, len), q.linlin(0, 1, 1, 0.01));
	snd = snd + BPF.ar(snd, XLine.kr(8000, freq, len), 0.1);
	snd = RHPF.ar(snd, freq, 0.3);
	snd = snd * 1.2;
	snd = snd.tanh;
	snd = (snd * env) + (snd * env2);
	snd = (snd * EnvGen.ar(Env.perc(0.0001, 0.05)).linexp(0, 1, 1, 1.3)) + (snd * distenv2.linexp(0, 1, 1, 1.4));
	snd = snd / 1.5;
	snd.tanh;
	// snd = PitchShift.ar(snd, 0.001, 1.1, 0.05);
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\sperc, {
	|out, pan, amp = 1, gate = 1, freq = 160, modrate = 0.4, plen = 0.1, index = 5, len = 0.8|
	var snd, mod, penv, env, modenv;
	modenv = EnvGen.ar(Env.perc(0.01, len * 0.4));
	env = EnvGen.ar(Env.perc(0.001,len, curve: -6), gate: gate, doneAction: 2);
	penv = EnvGen.ar(Env.perc(0.001, plen, 4, -8));
	mod = SinOsc.ar(freq * modrate) * (freq * modrate * index) * modenv.linexp(0, 1, 0.1, 1);
	snd = SinOsc.ar(freq * penv.linexp(0,4,1,4) + mod);
	snd = snd * env;
	snd = HPF.ar(snd, 80) * 1;
	snd = snd * EnvGen.ar(Env.perc(0.001, 0.001)).linexp(0, 1, 1, 2);
	snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\stom, {
	|out, pan, amp = 1, gate = 1, freq = 88, modrate = 2, plen = 0.05, index = 8, len = 0.3|
	var snd, mod, penv, env, modenv;
	modenv = EnvGen.ar(Env.perc(0.001, 0.01));
	env = EnvGen.ar(Env.perc(0.001,len, curve: -4), gate: gate, doneAction: 2);
	penv = EnvGen.ar(Env.perc(0.001, plen, 4, -8));
	mod = SinOsc.ar(freq * modrate) * (freq * modrate * index) * modenv.linexp(0, 1, 0.01, 1);
	snd = SinOsc.ar(freq * penv.linexp(0,4,1,4) + mod);
	snd = snd * env;
	snd = snd * 1;
	snd = snd * EnvGen.ar(Env.perc(0.0001, 0.1)).linexp(0, 1, 1, 1.1);
	snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\snoise, {
	|out, pan, gate = 1, amp = 1, len = 1|
	var snd, env;
	env = EnvGen.ar(Env([0, 1, 0], [0.001, len]), gate: gate, doneAction: 2);
	snd = ClipNoise.ar() * env;
	snd = HPF.ar(snd, 7000);
	snd = snd * 0.5
	;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\ssub, {| out, pan, gate = 1, freq = 40, modrate = 0.5, index = 1.25, amp = 1, atk = 0.0001, len = 0.3, sust = 0.9|
	var env, mod, snd;
	env = EnvGen.kr(Env.adsr(0.001, len, sust, 0.1), gate: gate, doneAction: 2);
	snd = SinOsc.ar([1, 2, 3] * freq, mul: [0.3, 0.01, 0.05]);
	snd = snd.sum;
	snd = snd * env;
	snd = (snd * 3);
	snd = RLPF.ar(snd, 200);
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\s808, {| out, pan, gate = 1, freq = 40, amp = 1, atk = 0.0001, len = 1, plen = 0.2|
	var env, mod, snd;
	var penv = EnvGen.kr(Env([1,1.5,1], [0.01, plen], -6));
	env = EnvGen.kr(Env([0,1,0], [0.001, len], -4), gate: gate, doneAction: 2);
	snd = SinOsc.ar([1, 2, 3] * freq * penv, mul: [0.3, 0.08, 0.14]);
	snd = snd.sum;
	snd = snd * env;
	snd = (snd * 1.6);
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\dist808, {| out, pan, gate = 1, freq = 40, amp = 1, atk = 0.0001, len = 1, plen = 0.05|
	var env, mod, snd;
	var penv = EnvGen.kr(Env([1,1.5,1], [0.01, plen], -6));
	env = EnvGen.kr(Env([0,1,0], [0.001, len], -4), gate: gate, doneAction: 2);
	snd = SinOsc.ar([1, 2, 3] * freq * penv, mul: [0.3, 0.08, 0.14]);
	snd = snd.sum;
	snd = snd * env;
	snd = CrossoverDistortion.ar(snd, 0.2, 1.0);
	snd = snd * 2;
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

//////////////////////

SynthDef(\randhit, {
	|out, pan, amp = 1, len = 1, freq = 40|
	var snd, env;
	snd = SinOsc.ar(LFNoise0.kr((1 .. 18)).range(1, 5).linlin(1, 5, 20, 12000) * EnvGen.kr(Env([4, 20, 2], [0.01, len])));
	snd.sum;
	snd = PitchShift.ar(snd, 0.001, 0.5, 0.01);
	snd = snd * 4;
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\boom, {
	|out, pan, amp = 1, len = 1, plen = 0.2, freq = 40|
	var snd, env;
	snd = SinOsc.ar(Hasher.kr((1 .. 18).normalize).linlin(0, 1, 20, 12000) * EnvGen.kr(Env([4, 10, 3, 2], [0.01, plen / 4, plen])));
	snd.sum;
	snd = PitchShift.ar(snd, 0.001, 0.5, 0.01);
	snd = snd * 4;
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\beam, {
	|out, pan, amp = 1, len = 1, freq = 40|
	var snd, env;
	snd = SinOsc.ar(LFNoise0.kr((1 .. 18).normalize).linlin(0, 1, 20, 12000) * EnvGen.kr(Env([2.4, 2.5], [len])));
	snd.sum;
	snd = PitchShift.ar(snd, 0.001, 0.5, 0.01);
	snd = snd * 4;
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\knife, {
	|out, pan, amp = 1, len = 1, freq = 88|
	var snd, env;
	snd = SinOsc.ar( (1 .. 19).normalize.pow(XLine.kr(4, 4.8, 0.1)).tan.linlin(0, 1, 20, 8000) * (freq / 4).midiratio );
	snd.sum;
	// snd = BPF.ar(snd, XLine.ar(6000, 100, len) * [1, 1.5], 0.6).sum;
	snd = PitchShift.ar(snd, 0.001, 1, 0.01);
	// snd = Splay.ar(snd);
	snd = CombC.ar(snd, 0.1, 1 / XLine.kr(80, 120, len), 0.1);
	snd = RLPF.ar(snd, XLine.kr(12000, 1000, len / 2), 0.5);
	snd = snd * 3;
	snd = snd * Env.linen(0.01, 0.1, len).ar(Done.freeSelf);
	snd = snd.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\perc2, {| out, pan, freq = 60, plen = 0.01, prate = 2, amp = 1, atk = 0.05, len = 2|
	var pEnv = Line.kr(freq * prate ,freq, plen);
	var click_pEnv = Line.kr(1000 ,freq, plen);
	var env = EnvGen.kr(Env.perc(atk, len), doneAction: 2);
	var clickEnv = EnvGen.kr(Env.perc(0.001, 0.005, 0.5));
	var freqmod = pEnv;
	var controlOsc = SinOsc.kr(freq/2, 0.0, amp) * env;
	var click = SinOsc.ar(click_pEnv, 0, 0.5) * clickEnv;
	var mainOsc = SinOsc.ar(freqmod, 0.0, controlOsc) + click;
	var outnode = Clip.ar(mainOsc, -1, 1);
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\sinpad, {| out, pan, freq = 60, plen = 0.01, prate = 2, amp = 1, atk = 0.01, len = 2, sust = 1|
	var pEnv = Line.kr(freq * prate ,freq, plen);
	var env = EnvGen.kr(Env.adsr(atk, len, sust, 0.1, curve: -6), doneAction: 2);
	var amplfoL = SinOsc.kr(1.2, mul: 0.3);
	var amplfoR = SinOsc.kr(0.8, mul: 0.3);
	var oscamp = 0.5;
	var mainOsc = [
		((SinOsc.ar(pEnv, 0.0, mul: oscamp) * env) + (SinOsc.ar(pEnv * 0.75, 0.2, mul: oscamp * 0.8) * env)) * (0.2 + amplfoL),
		((SinOsc.ar(pEnv, 1, mul: oscamp) * env) + (SinOsc.ar(pEnv * 0.5, 0.7, mul: oscamp) * env)) * (0.2 + amplfoR)
	];
	var outnode = mainOsc;
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmmod, { arg out, pan, amp = 1, gate = 1, freq = 40, len = 0.5, index = 12, modrate = 1, atk = 0.001;
	var snd, env;
	env = EnvGen.ar(Env([0,1,0], [atk, len], -4), gate, doneAction: 2);
	snd = SinOsc.ar(
		freq * (SinOsc.ar(freq * LFSaw.kr(100).linlin(-1, 1, 0.01, 10) * 2) * index);
    );
	snd = snd * env;
	snd = snd * amp;
	snd = RHPF.ar(snd, 60, 1.1);
    OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmkik, {| out, pan, freq = 42, modrate = 1, index = 0.7, patk = 0.001, plen = 0.07, prate = 16, amp = 1, atk = 0.001, len = 0.4, curveRate = 2, contour = 0.8|
	var env = EnvGen.kr(Env.perc(atk, len, curve: (-1.0 * curveRate)), doneAction: 2);
	var modEnv = EnvGen.kr(Env.perc(atk, len)) * contour;
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));

	var clickAmp = EnvGen.ar(Env.perc(0.001, 0.0005)) * 0.1;
	var click, car;

	var mod = SinOsc.ar(
		freq * modrate * (1 + pEnv),
		mul: freq * modrate * index) * modEnv;

	car = SinOsc.ar(
		(freq + mod) * (1 + pEnv) ,
		0,
		amp
	) * env;

	click = SinOsc.ar(freq * 4, mul: XLine.kr(80, 0.1, 0.02) * freq * 4);
	click = SinOsc.ar(freq + click) * clickAmp;
	car = car + click;
	car = (RHPF.ar(car, 40, 0.2) * 3).tanh;

	OffsetOut.ar(out,
		DirtPan.ar(car, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmkik2, {| out, pan, freq = 42, modrate = 1, index = 15, patk = 0.001, plen = 0.12, prate = 6, amp = 1, atk = 0.001, len = 3, curveRate = 4, contour = 0.2|
	var cr = -1.0 * curveRate;
	var env = EnvGen.kr(Env.perc(atk, len, curve: cr), doneAction: 2);
	var modEnv = EnvGen.kr(Env.perc(atk, len)) * contour;
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));
	var mod = LFSaw.ar(
		freq * modrate * (1 + pEnv),
		mul: freq * modrate * index) * (modEnv);

	var car = SinOsc.ar(
		(freq + mod) * (1 + pEnv) ,
		0,
		amp
	) * env;


	var output = RHPF.ar(car * 4, 30, 0.2);
	output = output * XLine.kr(2, 1, 0.2);
	output.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(output, ~dirt.numChannels, pan, env)
	);
}).add;

SynthDef(\fmsn, {| out, pan, freq = 40, modrate = 3, index = 0.5, patk = 0.01, plen = 0.15, prate = 8, amp = 1, atk = 0.01, len = 0.7, noiseamp = 0.5, curveRate = 4|
	var env = EnvGen.kr(Env.perc(atk, len, curve: (-1.0 * curveRate)), doneAction: 2);
	var modEnv = EnvGen.kr(Env.perc(atk, len, index));
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));

	var mod = Pulse.ar(
		freq * modrate * (1 + pEnv),
		0.5,
		freq * modrate * (1 + modEnv)
	);

	var car = SinOsc.ar(
		(freq + mod) * (1 + pEnv) ,
		0,
		amp
	) * env;

	var noise = WhiteNoise.ar(noiseamp) * env;

	var outnode = RHPF.ar(car + noise, 100, 0.5);
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmsn2, {| out, pan, freq = 100, modrate = 3, index = 12, patk = 0.02, plen = 0.2, prate = 8, amp = 1, atk = 0.01, len = 1, curveRate = 8, contour = 0.7|
	var env = EnvGen.kr(Env.perc(atk, len, curve: (-1.0 * curveRate)), doneAction: 2);
	var modEnv = EnvGen.kr(Env.perc(atk, len, 1 * contour));
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate, curve: -10));
	var mod = LFSaw.ar(
		freq * modrate * (1 + pEnv),
		mul: freq * modrate * index) * (modEnv);

	var car = LFPulse.ar(
		(freq + mod) * (1 + pEnv) ,
		mul: amp) * env;

	var lpf = RLPF.ar(car, XLine.kr(8000, freq * 16, (len * 0.5)), 0.9);
	var hpf = RHPF.ar(lpf, XLine.kr(20, 200, 0.01), 0.2);
	var output = SoftClipAmp.ar(hpf, 12);
	OffsetOut.ar(out,
		DirtPan.ar(output, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmfilter, {| out, pan, freq = 40, modrate = 1, index = 1, patk = 0.001, plen = 0.002, prate = 4, amp = 1, atk = 0.001, len = 1, curveRate = 4, cutoff = 8000, q = 0.1|
	var env = EnvGen.kr(Env.perc(atk, len, curve: (-1.0 * curveRate)), doneAction: 2);
	var modEnv = EnvGen.kr(Env.perc(atk, len, index));
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));
	var mod = SinOsc.ar(
		freq * modrate * (1 + pEnv),
		0,
		freq * modrate * (index));

	var car = SinOsc.ar(
		(freq + mod) * (1 + pEnv) ,
		0,
		amp) * env;

	var outnode = RLPF.ar(car , XLine.kr(cutoff, 20, len), ( 0.01 + 1 - q ));
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmbass, {
	arg pan, out, amp = 1, gate = 1, freq = 110, len = 1, index = 1, modrate = 1.5;
	var car, mod, mod2, env, indexctrl;
	indexctrl = Env([0, 1, 0], [0.01, len], -4).kr(0).linexp(0, 1, 1, index * 16);
	env = Env([0, 1, 0], [0.001, len], -4).kr(2, gate);
	mod2 = SinOsc.ar(freq * modrate * 4) * indexctrl * 1.3;
	mod = SinOsc.ar(freq * modrate) * indexctrl * 0.9;
	car = SinOsc.ar(freq + mod + mod2) ;
	car = Splay.ar(car * env);
	OffsetOut.ar(out,
		DirtPan.ar(car, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmpad, {| out, pan, freq = 40, modrate = 0.5, index = 1, patk = 0.001, plen = 0.0001, prate = 4, amp = 1, atk = 0.01, len = 4, sust = 1, detune = 0.1, curveRate = 4, cutoff = 2000, q = 0.1|
	var env = EnvGen.kr(Env.adsr(atk, len, sust) , doneAction: 2);
	var modEnv = EnvGen.kr(Env.perc(atk, len, index));
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));
	var mod = SinOsc.ar(
		freq * modrate * (1 + pEnv),
		0,
		freq * modrate * (index) );

	var carL = SinOsc.ar(
		(freq + mod) * (1 + pEnv) + (0.1 * detune),
		0,
		amp) * env;

	var carR = SinOsc.ar(
		(freq + mod) * (1 + pEnv) - (0.1 * detune),
		0,
		amp) * env;

	var outnode = RLPF.ar([carL, carR] , XLine.kr(cutoff, 500, len), ( 0.001 + 1 - q ));
	outnode = outnode * 0.5;
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmsaw, {| out, pan, gate = 1, freq = 40, modrate = 1, index = 1, patk = 0.001, plen = 0.01, prate = 4, amp = 1, atk = 0.01, len = 1, sust = 0, curveRate = 4, cutoff = 8000, detune = 0, q = 0.1|
	var env = EnvGen.kr(Env.adsr(atk, len, sust, curve: (-1.0 * curveRate)), gate: gate, doneAction: 2);
	var modEnv = EnvGen.kr(Env.adsr(atk, len, sust * index));
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));
	var mod = LFSaw.ar(
		freq * modrate * (1 + pEnv),
		mul: freq * modrate) * modEnv;

	var carL = SinOsc.ar(
		freq + mod * (1 + pEnv) + (1 * detune),
		mul: amp) * env;

	var carR = SinOsc.ar(
		freq + mod * (1 + pEnv) - (1 * detune),
		mul: amp) * env;

	var outnode = RLPF.ar([carL, carR] , XLine.kr(cutoff, 20, len), ( 0.01 + 1 - q ));
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmperc, {| out, pan, freq = 40, modrate = 2, index = 0.5, patk = 0.0001, plen = 0.05, prate = 4, amp = 1, atk = 0.0001, len = 2, curveRate = 4|
	var env = EnvGen.kr(Env.perc(atk, len, curve: (-1.0 * curveRate)), doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));
	var mod = SinOsc.ar(
		freq * modrate * (2 + pEnv),
		0,
		freq * modrate * (index));

	var car = SinOsc.ar(
		(freq + mod) * (1 + pEnv) ,
		0,
		amp) * env;
	OffsetOut.ar(out,
		DirtPan.ar(car, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmkey, {| out, pan, freq = 40, modrate = 1, index = 2, patk = 0.0001, plen = 0.001, prate = 4, amp = 1, atk = 0.0001, len = 4, curveRate = 4, q = 0.1|
	var env = EnvGen.kr(Env.perc(atk, len, curve: (-1.0 * curveRate)), doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));
	var mod = SinOsc.ar(
		freq * modrate * (2 + pEnv),
		mul: freq * modrate * (index));
	var snd = SinOsc.ar(
		(freq + mod) * (1 + pEnv) ,
		mul: amp) * env;
	snd = [FreqShift.ar(snd, 0), FreqShift.ar(snd, 2)];
	snd = RLPF.ar(snd, XLine.kr(12000, 1000, len), ( 0.01 + 1 - q ));
	snd = snd + LFNoise1.ar(15000, 0.003);
	snd = snd * 0.8;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;


SynthDef(\fmcp, {| out, pan, freq = 600, modrate = 4, index = 24, patk = 0.001, plen = 0.1, prate = 8, amp = 1.5, atk = 0.0001, len = 0.4, curveRate = 4, q = 0.5|
	var env = EnvGen.kr(Env.perc(atk, len, curve: (-1.0 * curveRate)), doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(patk, plen, prate));
	var fr = 1000;
	var mod = LFSaw.ar(
		fr * modrate * (1 + pEnv),
		mul: fr * modrate * (index));
	var snd = SinOsc.ar(
		(fr + mod) * (1 + pEnv) ,
		mul: amp) * env;

	snd = RLPF.ar(snd, XLine.kr(10000, 6000, 0.5), ( 0.01 + 1 - q ));

	// snd = PitchShift.ar(snd, 0.01, 1, 0.2) * 4 ;
	snd = RHPF.ar(snd, freq, 0.3) * XLine.kr(1, 0.001, 1);
	snd = (snd*3).tanh;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmhat, {| out, pan, freq = 4000, modrate = 4.1, index = 24.1, patk = 0.001, plen = 0.05, prate = 0, amp = 1, atk = 0.0001, len = 2, sust = 0, curveRate = 4, q = 0.5|
	var env = EnvGen.kr(Env.adsr(atk, len, sust), doneAction: 2);
	var fr = 2000;
	var mod = LFSaw.ar(
		fr * modrate,
		mul: fr * modrate * (index));
	var snd = SinOsc.ar(
		(fr + mod),
		mul: 0.7) * env;

	snd = RHPF.ar(snd, freq, 0.3);
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\fmhh, {| out, pan, freq = 5000, modrate = 4.1, index = 24.1, patk = 0.001, plen = 0.05, prate = 0, amp = 0.9, atk = 0.0001, len = 0.1, sust = 0, curveRate = 4, q = 0.5|
	var env = EnvGen.kr(Env.adsr(atk, len, sust), doneAction: 2);
	var fr = 4000;
	var mod = LFSaw.ar(
		fr * modrate,
		mul: fr * modrate * (index));
	var snd = SinOsc.ar(
		(fr + mod),
		mul: 0.7) * env;

	snd = RHPF.ar(snd, freq, 0.3);
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\swub, {|out, pan, gate = 1, amp = 1, freq = 80, index = 32, modrate = 0.5, len = 1, sust = 1, cutoff = 9000, q = 0.2|
	var snd;
	var env = EnvGen.ar(Env([0,1,0], [0.01, len], 2), gate: gate, doneAction: 2);
	var n = 5;
	var partials = Array.fill(n, {|i| 2 * i});
	snd = Mix.fill(n, {|i|
		SinOsc.ar((partials[i] * freq * modrate) + (0.1 * Rand(0.1 , 20))) * SinOsc.ar(freq / 2);
	});
	snd = snd * 8;
	snd = [LPF.ar(snd, SinOsc.ar(1.3).linlin(-1,1,200, 5000), 0.4), LPF.ar(snd, SinOsc.ar(0.8).linlin(-1,1, 200, 5000), 0.4)];
	snd = snd.tanh;
	snd = RLPF.ar(
		snd,
		EnvGen.ar(Env.perc(0.001, len, 1, 2)).linlin(0, 1, 100, 12000),
		( 0.01 + 1 - q )
	);
	snd = snd * 0.6;
	snd = snd * env;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

(
SynthDef(\swub2, {|out, pan, gate = 1, amp = 1, freq = 80, index = 32, modrate = 5, len = 0.7, cutoff = 7000, q = 0.1|
	var snd;
	var env = EnvGen.ar(Env([0,1,0], [0.001, len], -2), gate: gate, doneAction: 2);
	var modEnv = EnvGen.ar(Env([0,1,0], [0.001, len], -4));
	var array = [0.5, 1.5, 2.5, 3.5, 4.5];
	snd = SinOsc.ar(array * freq + SinOsc.ar(freq * modrate, mul: freq * modEnv.linexp(0, 1, 1, index) ));
	snd.sum;
	/*snd = [LPF.ar(snd, SinOsc.ar(12).linexp(-1,1,20, 20000), 0.3), LPF.ar(snd, SinOsc.ar(5).linexp(-1,1, 500, 20000), 0.3)];*/
	snd = CombN.ar(snd, 0.1, 0.1, 0.2, 0.5) + snd;
	snd = SoftClipAmp.ar(snd);
	snd = CrossoverDistortion.ar(snd, 0.1, 0.5);
	snd = RLPF.ar(
		snd,
		100 + EnvGen.ar(Env([0, cutoff, 0], [0.02, len], -2)),
		( 0.01 + 1 - q )
	);
	snd = snd * env;
	// snd = snd * 0.6;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\sbass, { |out, pan, amp = 1, gate = 1, freq = 32, len = 1, spd = 2.5, index = 3, modrate = 8 |
	var fenv, env, snd;
	// fenv = EnvGen.ar(Env([1, 4, 1], [0.001, 0.8], -4));
	env = EnvGen.ar(Env([0,1,0], [0.0001, len], -4), gate: gate, doneAction: 2);
	snd = SinOsc.ar(freq + SinOsc.ar(freq * modrate, 2pi).linlin(-1, 1, -1 * freq * index, freq * index), (2pi));
	snd = snd + SinOsc.ar(freq + SinOsc.ar(freq * modrate, (2pi * spd * (LFTri.kr(0.4).linlin(-1,1,1,64) / 64))).linlin(-1, 1, -1 * freq * index, freq * index), (2pi * 3 * (LFTri.kr(0.3).linlin(-1,1,1, 64) / 64)) );
	snd = snd / 2;
	// snd = snd.fold2(1.2);
	snd = snd.round(0.01);
	snd = CrossoverDistortion.ar(snd, 0.8, 1.0);
	snd = snd * 2;
	snd.tanh;
	snd = snd * env;
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\modsaw, {| out, pan, freq = 440, atk = 0.01, len = 2, amp = 0.9, prate = 2 , plen = 0.001 , q = 0.1, cutoff = 6000, cutoffspd = 0|
	var env = EnvGen.kr(Env.perc(atk, len), doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(0.001, plen, prate));
	var saw = Saw.ar(
		(freq) * (pEnv + 1)
		,SinOsc.kr(freq:SinOsc.kr(freq:SinOsc.kr(freq,0.75), phase: 0.25), phase: 0.5) * 1.3
	) * env;
	var outnode = RLPF.ar(saw , XLine.kr(cutoff, 20, len), ( 0.01 + 1 - q ));
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\detsaw, {| out, pan, gate = 1, freq = 440, atk = 0.01, len = 2, sust = 0, amp = 0.9, prate = 0 , plen = 0.001 , q = 0.1, detune = 0.01, cutoff = 6000, cutoffspd = 2|
	var env = EnvGen.kr(Env.adsr(atk, len, sust), gate: gate , doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(0.001, plen, prate));
	var sawL = LFSaw.ar(
		(freq) * (pEnv + 1) + (1 * detune)
	) * env;

	var sawR = LFSaw.ar(
		(freq) * (pEnv + 1) - (1 * detune)
	) * env;

	var outnode = RLPF.ar([sawL,sawR] , XLine.kr(cutoff, 200, cutoffspd), ( 0.01 + 1 - q ));
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\sawpad, {| out, pan, gate = 1, freq = 440, atk = 0.01, len = 2, sust = 1, amp = 1, prate = 0 , plen = 0.001 , q = 0.1, detune = 0.02, lpfstart = 10000, lpfend = 500, cutoffspd = 0|
	var env = EnvGen.kr(Env.adsr(atk, len, sust), gate: gate , doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(0.01, plen, prate));
	var n = 8;
	var array = Array.fill(n, {arg i;
		var scale;
		if (i % 2 == 0)
		{
			scale = 1;
		}
		{
			scale = -1;
		};
		i + 1 * scale
	});
	var saw = LFSaw.ar(freq + (array * 1 * detune), Rand(0,1));
	saw = Splay.ar(saw) / n;
	saw = saw * env;
	saw = saw * 1.2;
	saw = RLPF.ar(saw , XLine.kr(lpfstart, lpfend, len), ( 0.01 + 1 - q ));
	OffsetOut.ar(out,
		DirtPan.ar(saw, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\chirp, {| out, pan, gate = 1, freq = 40, atk = 0.001, len = 0.5, amp = 0.9, prate = 300 , plen = 0.1 , q = 0.5, cutoff = 12000, cutoffspd = 0|
	var env = EnvGen.kr(Env.perc(atk, len, curve: -7), gate: gate, doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(0.01, plen, prate, -7));
	var osc2 = SinOsc.ar(freq * (1 + pEnv) ) * env;
	var outnode = RLPF.ar(osc2 , XLine.kr(cutoff, 20, len), ( 0.01 + 1 - q ));
	outnode = HPF.ar(outnode, 30) * 1.2;
	outnode.tanh;
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\chirp2, {| out, pan, freq = 40, atk = 0.01, len = 1, amp = 0.9, prate = 256 , plen = 0.1 , q = 1, cutoff = 12000, cutoffspd = 0|
	var env = EnvGen.kr(Env.perc(atk, len), doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(0.01, plen, prate));
	var osc2 = WhiteNoise.ar * env;
	var outnode = RLPF.ar(osc2 , XLine.kr(cutoff, 20, len), ( 0.01 + 1 - q ), 0.3);
	OffsetOut.ar(out,
		DirtPan.ar(outnode, ~dirt.numChannels, pan, amp)
	);
}).add;



SynthDef(\mplk, {| out, pan, freq = 440, atk = 0.01, len = 4, amp = 1, prate = 8 , plen = 0.01, stereorate = 3, q = 0.8 |
	var snd;
	var basefreqs = [469, 938, 1199, 1406, 1984, 2334, 2454, 2814, 2922, 3388, 3859];
	var ratio = basefreqs.size.collect({|i|
		(basefreqs[i] / basefreqs[0]);
	});
	var env = EnvGen.kr(Env.perc(atk, len), doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(0.001, plen, prate));
	snd = Klang.ar(`[ratio, Array.fill(basefreqs.size, {|i| (1 / basefreqs.size) ** 0.8}), nil], freq);
	snd = snd / basefreqs.size * env;
	snd = snd + SinOsc.ar(freq * (1 + pEnv), mul: 0.2);
	snd = snd * 4.dbamp;
	snd = [FreqShift.ar(snd, stereorate), FreqShift.ar(snd, 2)];
	snd = RLPF.ar(snd, XLine.kr(12000, 1000, len), ( 0.01 + 1 - q ));
	snd = snd + LFNoise1.ar(15000, 0.003);
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\mplk2, {| out, pan, gate = 1, freq = 440, atk = 0.01, len = 4, amp = 0.9, prate = 8 , plen = 0.01, stereorate = 2.2, q = 0.5 |
	var snd;
	/*var basefreqs = [469, 938, 1199, 1406, 1984, 2334, 2454, 2814, 2922, 3388, 3859];
	var ratio = basefreqs.size.collect({|i|
		(basefreqs[i] / basefreqs[0]);
	});*/
	var ratio = [ 1.0, 2.0, 2.5565031982942, 2.997867803838, 4.2302771855011, 4.9765458422175, 5.2324093816631, 6.0, 6.2302771855011, 7.2238805970149, 8.228144989339 ];
	var env = EnvGen.kr(Env.perc(atk, len), gate: gate, doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(0.001, plen, prate));
	snd = SinOsc.ar(
		freq: ratio * freq,
		mul: (1 .. ratio.size).linexp(1, ratio.size, 1, 0.001)
	);
	snd = snd.sum(); // or snd = Mix.ar(snd);

	snd = snd / ratio.size * env;
	snd = snd + SinOsc.ar(freq * (1 + pEnv), mul: 0.1);
	// snd = snd * freq.linexp(100, 10000, 0.9, 0.4);
	snd = snd * 8.dbamp;
	snd = [FreqShift.ar(snd, stereorate), FreqShift.ar(snd, 2)];
	snd = RLPF.ar(snd, XLine.kr(12000, 1000, len), ( 0.01 + 1 - q ));
	snd = snd + LFNoise1.ar(15000, 0.003);
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\mkey, {| out, pan, gate = 1, freq = 440, atk = 0.01, len = 4, amp = 0.9, prate = 8 , plen = 0.005, stereorate = 5, q = 0.5, cutoff 10000 |
	var snd;
	var basefreqs = [312, 623, 935, 1247, 1557, 1870, 2183, 2496, 2805, 3118, 3432, 4054, 4356, 4727];
	var ratio = basefreqs.size.collect({|i|
		(basefreqs[i] / basefreqs[0]);
	});
	var env = EnvGen.kr(Env.perc(atk, len), gate: gate, doneAction: 2);
	var pEnv = EnvGen.kr(Env.perc(0.001, plen, prate));
	snd = Klang.ar(`[ratio, Array.fill(basefreqs.size, {|i| (1 / basefreqs.size) ** 0.7}), nil], freq);
	snd = snd / basefreqs.size * env;
	snd = snd + SinOsc.ar(freq * (1 + pEnv), mul: 0.2);
	snd = snd * 4.dbamp;
	snd = [FreqShift.ar(snd, stereorate), FreqShift.ar(snd, 0)];
	snd = PitchShift.ar(snd, 0.001, 1.25, 0.1) + PitchShift.ar(snd, 0.001, 0.75, 0.1);
	snd = RLPF.ar(snd, XLine.kr(cutoff, 4000, 0.9), ( 0.01 + 1 - q ));
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\ep, {| out, pan, freq = 440, atk = 0.01, len = 2, sust = 0.7, amp = 0.9, prate = 8 , plen = 0.01, stereorate = 2, q = 0 |
	var snd;
	// [261.5, 522.8, 784.2, 1046, 1307, 1568, 1803, 2091, 2353, 2614]; freq
	// [1.2, 1.0, 0.6, 0.1, 0.001, 0.0001, 0.0001, 0.0001, 0.01, 0.005] mul
	var basefreqs = [261.5, 522.8, 784.2, 1046, 1307, 1568, 1803, 2091, 2353, 2614];
	var ratio = basefreqs.size.collect({|i|
		(basefreqs[i] / basefreqs[0]);
	});
	var basefreqs_ = [401.4, 664.1, 923.7, 1185, 1901];
	var ratio_ = basefreqs_.size.collect({|i|
		(basefreqs_[i] / basefreqs_[0]);
	});
	var harm = Klang.ar(`[ratio_, Array.fill(basefreqs_.size, {|i| (1 / basefreqs_.size) ** 2}), nil], freq);
	var env = EnvGen.kr(Env.adsr(decayTime: len, sustainLevel: sust), doneAction: 2);
	var harmenv = EnvGen.kr(Env.perc(releaseTime: 0.1));
	var pEnv = EnvGen.kr(Env.perc(0.001, plen, prate));

	snd = Klang.ar(`[ratio, [1.0, 0.9, 0.6, 0.1, 0.001, 0.0001, 0.0001, 0.0001, 0.01, 0.005], nil], freq, 1);
	snd = snd / basefreqs.size * env * freq.linexp(100, 10000, 1, 0.01);
	harm = harm / basefreqs_.size;
	harm = harm * harmenv;
	snd = snd + harm;
	snd = snd * 8.dbamp;
	snd = [FreqShift.ar(snd, stereorate), FreqShift.ar(snd, 1)];
	// snd = PitchShift.ar(snd, 0.01);
	snd = RLPF.ar(snd, XLine.kr(10000, 1000, 1), ( 0.01 + 1 - q ));
	snd = snd + LFNoise1.ar(15000, 0.003);
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

SynthDef(\ep2, {| out, pan, gate = 1, freq = 440, atk = 0.01, len = 2, sust = 0.7, amp = 0.9, prate = 8 , plen = 0.01, stereorate = 2, q = 0 |
	var snd;
	// [261.5, 522.8, 784.2, 1046, 1307, 1568, 1803, 2091, 2353, 2614]; freq
	// [1.2, 1.0, 0.6, 0.1, 0.001, 0.0001, 0.0001, 0.0001, 0.01, 0.005] mul
	var basefreqs = [261.5, 522.8, 784.2, 1046, 1307, 1568, 1803, 2091, 2353, 2614];
	var ratio = basefreqs.size.collect({|i|
		(basefreqs[i] / basefreqs[0]);
	});
	var basefreqs_ = [401.4, 664.1, 923.7, 1185, 1901];
	var ratio_ = basefreqs_.size.collect({|i|
		(basefreqs_[i] / basefreqs_[0]);
	});
	var harm = Klang.ar(`[ratio_, Array.fill(basefreqs_.size, {|i| (1 / basefreqs_.size) ** 2}), nil], freq);
	var env = EnvGen.kr(Env.adsr(decayTime: len, sustainLevel: sust), gate: gate, doneAction: 2);
	var harmenv = EnvGen.kr(Env.perc(releaseTime: 0.1));
	var pEnv = EnvGen.kr(Env.perc(0.001, plen, prate));

	snd = Klang.ar(`[ratio, (ratio.size .. 1).linexp(1, ratio.size, 0.0001, 1), nil], freq, 1);
	snd = snd / basefreqs.size * env * freq.linexp(100, 10000, 1, 0.01);
	harm = harm / basefreqs_.size;
	harm = harm * harmenv;
	snd = snd + harm;
	snd = snd * 8.dbamp;
	snd = [FreqShift.ar(snd, stereorate), FreqShift.ar(snd, 1)];
	// snd = PitchShift.ar(snd, 0.01);
	snd = RLPF.ar(snd, XLine.kr(10000, 1000, 1), ( 0.01 + 1 - q ));
	snd = snd + LFNoise1.ar(15000, 0.003);
	OffsetOut.ar(out,
		DirtPan.ar(snd, ~dirt.numChannels, pan, amp)
	);
}).add;

)



)

a = Synth(\swub);

a.set(\gate, 0);



