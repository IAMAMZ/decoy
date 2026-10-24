// Runs on the browser's audio thread. Turns mic audio into 24 kHz 16-bit mono PCM
// (what Higgs Realtime expects) and posts it in 100 ms chunks with a loudness level.
const TARGET_RATE = 24000;
const CHUNK = TARGET_RATE / 10;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // 1 when the context already runs at 24 kHz
    this.pos = 0;
    this.out = new Int16Array(CHUNK);
    this.n = 0;
    this.energy = 0;
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    let i = this.pos;
    for (; i < input.length; i += this.ratio) {
      // Average the source samples that fall in this output sample (simple anti-aliasing).
      const from = Math.floor(i);
      const to = Math.min(input.length, Math.max(from + 1, Math.floor(i + this.ratio)));
      let s = 0;
      for (let j = from; j < to; j++) s += input[j];
      s /= to - from;
      s = Math.max(-1, Math.min(1, s));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.energy += s * s;
      if (this.n === CHUNK) {
        const level = Math.sqrt(this.energy / CHUNK);
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(CHUNK);
        this.n = 0;
        this.energy = 0;
      }
    }
    this.pos = i - input.length;
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
