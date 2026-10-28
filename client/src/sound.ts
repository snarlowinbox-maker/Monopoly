/**
 * Tiny procedural sound engine using Web Audio API — no external files needed.
 * All sounds are synthesized so the bundle stays lean.
 */
let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.12, when = 0) {
  const c = ensureCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = 0;
  g.gain.setValueAtTime(0, c.currentTime + when);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + when + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + when);
  o.stop(c.currentTime + when + dur + 0.02);
}

function noise(dur: number, gain = 0.08) {
  const c = ensureCtx();
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(g).connect(c.destination);
  src.start();
}

export const sfx = {
  dice()  { noise(0.18, 0.15); tone(220, 0.1, 'triangle', 0.08, 0.02); },
  cash()  { tone(880, 0.08, 'square', 0.1); tone(1320, 0.1, 'square', 0.08, 0.06); },
  build() { tone(120, 0.15, 'sawtooth', 0.1); tone(80, 0.2, 'sine', 0.08, 0.05); },
  card()  { noise(0.12, 0.05); tone(660, 0.08, 'sine', 0.06, 0.05); },
  jail()  { tone(220, 0.2, 'sawtooth', 0.1); tone(160, 0.3, 'sawtooth', 0.1, 0.15); },
  buy()   { tone(660, 0.1, 'sine', 0.1); tone(990, 0.12, 'sine', 0.1, 0.08); },
  move()  { tone(440, 0.04, 'sine', 0.03); },
  turn()  { tone(523, 0.09, 'sine', 0.08); tone(784, 0.11, 'sine', 0.08, 0.07); },
  win()   { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'sine', 0.12, i * 0.14)); },
};