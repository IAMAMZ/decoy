// Splits an always-on mic into turns by loudness, for the headset side, which has no key to hold.
// It follows the room's noise floor, so steady hiss or fan noise never counts as talking.
export class Vad {
  on: number; // lowest level that starts a turn; settable live
  voiced = 0; // loud chunks in the current turn, to drop coughs and clicks
  private floor = 0;
  private quiet = 0;
  private active = false;
  private hangChunks: number;

  constructor(on: number, hangChunks = 7) {
    this.on = on;
    this.hangChunks = hangChunks;
  }

  /** Feed one 100 ms chunk's level. */
  push(level: number): 'start' | 'speech' | 'end' | null {
    const start = Math.max(this.on, this.floor * 4);
    if (!this.active) {
      if (level < start) {
        // Falls fast, rises slowly: a word doesn't lift the floor, a fan switching on does.
        this.floor += (level - this.floor) * (level < this.floor ? 0.3 : 0.05);
        return null;
      }
      this.active = true;
      this.quiet = 0;
      this.voiced = 1;
      return 'start';
    }
    if (level >= start * 0.6) {
      this.quiet = 0;
      this.voiced++;
    } else if (++this.quiet >= this.hangChunks) {
      this.active = false;
      return 'end';
    }
    return 'speech';
  }

  reset() {
    this.active = false;
  }
}
