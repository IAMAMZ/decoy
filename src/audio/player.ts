// Plays Decoy's streamed reply (base64 PCM16, 24 kHz) gaplessly, and can stop instantly
// when the scammer interrupts.
export class Player {
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(
    private ctx: AudioContext,
    private onSpeaking: (speaking: boolean) => void,
  ) {}

  play(b64: string) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
    const buf = this.ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime + 0.03, this.next);
    src.start(at);
    this.next = at + buf.duration;
    this.sources.add(src);
    this.onSpeaking(true);
    src.onended = () => {
      this.sources.delete(src);
      if (this.sources.size === 0) this.onSpeaking(false);
    };
  }

  stop() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.next = 0;
    this.onSpeaking(false);
  }
}
