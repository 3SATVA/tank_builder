const SOUND_KEY = "tank-builder-sound";
const VOICES = 7;

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let enabled = readStored();
let voices = 0;

function readStored(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
  if (on) unlockAudio();
}

function audio(): AudioContext | null {
  const Ctx = window.AudioContext;
  if (!Ctx) return null;
  if (!ctx) ctx = new Ctx();
  return ctx;
}

export function unlockAudio(): void {
  const current = audio();
  if (current?.state === "suspended") void current.resume();
}

function noiseBuffer(current: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === current.sampleRate) return noise;
  const length = Math.floor(current.sampleRate * 0.4);
  const buffer = current.createBuffer(1, length, current.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

function takeVoice(priority: boolean): boolean {
  if (!enabled) return false;
  if (voices >= VOICES && !priority) return false;
  voices += 1;
  return true;
}

function release(when: number): void {
  const current = audio();
  if (!current) {
    voices = Math.max(0, voices - 1);
    return;
  }
  const wait = Math.max(0, (when - current.currentTime) * 1000 + 30);
  window.setTimeout(() => {
    voices = Math.max(0, voices - 1);
  }, wait);
}

function tone(freq: number, duration: number, type: OscillatorType, volume: number, priority = false): void {
  const current = audio();
  if (!current || current.state !== "running" || !takeVoice(priority)) return;
  const start = current.currentTime;
  const osc = current.createOscillator();
  const gain = current.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(36, freq * 0.62), start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain);
  gain.connect(current.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  release(start + duration + 0.02);
}

function sweep(from: number, to: number, duration: number, type: OscillatorType, volume: number): void {
  const current = audio();
  if (!current || current.state !== "running" || !takeVoice(false)) return;
  const start = current.currentTime;
  const osc = current.createOscillator();
  const gain = current.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(36, to), start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain);
  gain.connect(current.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  release(start + duration + 0.02);
}

function crunch(duration: number, volume: number, freq: number): void {
  const current = audio();
  if (!current || current.state !== "running" || !takeVoice(false)) return;
  const start = current.currentTime;
  const src = current.createBufferSource();
  src.buffer = noiseBuffer(current);
  const filter = current.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(freq, start);
  filter.frequency.exponentialRampToValueAtTime(80, start + duration);
  const gain = current.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(current.destination);
  src.start(start);
  src.stop(start + duration);
  release(start + duration);
}

export function sfxLight(): void {
  tone(640, 0.045, "square", 0.03);
}

export function sfxMedium(): void {
  tone(220, 0.09, "square", 0.04);
  crunch(0.08, 0.05, 900);
}

export function sfxHeavy(): void {
  tone(78, 0.22, "sine", 0.07);
  crunch(0.2, 0.08, 420);
}

export function sfxHarpoon(): void {
  sweep(880, 180, 0.12, "square", 0.035);
}

export function sfxMissile(): void {
  sweep(240, 720, 0.18, "sawtooth", 0.03);
}

export function sfxExplosion(): void {
  tone(62, 0.28, "sine", 0.07);
  crunch(0.26, 0.09, 500);
}

export function sfxMine(): void {
  tone(110, 0.16, "triangle", 0.05);
  crunch(0.14, 0.06, 360);
}

export function sfxBreak(): void {
  crunch(0.11, 0.07, 1400);
  tone(180, 0.06, "square", 0.03);
}

export function sfxShield(): void {
  tone(980, 0.07, "sine", 0.03);
}

export function sfxWin(): void {
  tone(523, 0.1, "square", 0.04, true);
  window.setTimeout(() => tone(659, 0.1, "square", 0.04, true), 110);
  window.setTimeout(() => tone(784, 0.18, "square", 0.045, true), 220);
}

export function sfxLose(): void {
  tone(330, 0.14, "sawtooth", 0.04, true);
  window.setTimeout(() => tone(196, 0.28, "triangle", 0.05, true), 140);
}

export function sfxShot(): void {
  sfxLight();
}

export function sfxHit(): void {
  tone(160, 0.04, "triangle", 0.028);
}

export function sfxBoom(): void {
  sfxExplosion();
}

export function sfxTap(): void {
  tone(680, 0.03, "square", 0.02);
}
