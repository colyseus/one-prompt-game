/** Little synthesized blips. The context starts on the first key press (autoplay rules). */
export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;

  unlock() {
    if (this.ctx) { return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);

    const length = this.ctx.sampleRate * 0.4;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) { data[i] = Math.random() * 2 - 1; }
  }

  swing() { this.whoosh(0.12, 1800, 5200, 0.5); }
  hit() { this.tone("square", 520, 180, 0.09, 0.35); this.tone("sine", 900, 600, 0.06, 0.2); }
  squish() { this.tone("sine", 300, 60, 0.25, 0.5); this.whoosh(0.15, 600, 200, 0.25); }
  hurt() { this.tone("sawtooth", 220, 70, 0.3, 0.35); }
  key() { [660, 880, 1320].forEach((f, i) => this.tone("triangle", f, f, 0.12, 0.35, i * 0.08)); }
  open() { [523, 659, 784, 1046].forEach((f, i) => this.tone("sine", f, f, 0.25, 0.3, i * 0.1)); }
  descend() { this.whoosh(0.6, 3000, 300, 0.4); this.tone("sine", 700, 200, 0.6, 0.3); }
  gameOver() { [392, 330, 262, 196].forEach((f, i) => this.tone("triangle", f, f * 0.98, 0.35, 0.35, i * 0.22)); }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0) {
    if (!this.ctx || !this.master) { return; }
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private whoosh(duration: number, from: number, to: number, volume: number) {
    if (!this.ctx || !this.master || !this.noise) { return; }
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }
}
