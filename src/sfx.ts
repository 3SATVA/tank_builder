let ctx: AudioContext | null = null;

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

function tone(freq: number, duration: number, type: OscillatorType, volume: number): void {
  const current = audio();
  if (!current || current.state !== "running") return;
  const start = current.currentTime;
  const osc = current.createOscillator();
  const gain = current.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.65), start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain);
  gain.connect(current.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function sfxShot(): void {
  tone(240, 0.06, "square", 0.035);
}

export function sfxHit(): void {
  tone(140, 0.05, "triangle", 0.04);
}

export function sfxBoom(): void {
  tone(90, 0.2, "sawtooth", 0.045);
}

export function sfxTap(): void {
  tone(520, 0.04, "square", 0.02);
}
