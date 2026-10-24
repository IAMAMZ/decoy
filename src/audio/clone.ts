// Instant voice clone of the real customer from their own push-to-talk turns
// (docs.boson.ai/api-reference/audio/create-a-voice), so Decoy's takeover sounds like them.

const API = '/api/boson'; // proxy that adds the key, see realtime.ts
const RATE = 24000; // matches the mic worklet

/** Registers the turns' PCM16 audio plus its transcript as a Boson voice. Returns the `voice_<id>`. */
export async function createVoice(pcm: ArrayBuffer[], text: string): Promise<string> {
  const body = JSON.stringify({ ref_audio: `data:audio/wav;base64,${toBase64(wav(pcm))}`, ref_text: text });
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${API}/audio/voices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    // The voices API rate-limits bursts; a short wait clears it.
    if (r.status === 429 && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`Voice clone failed (${r.status}): ${await r.text()}`);
    const j = await r.json();
    return j.voice_id ?? j.voice; // the live API returns voice_id; the docs say voice
  }
}

export const pcmSeconds = (pcm: ArrayBuffer[]) => pcm.reduce((n, b) => n + b.byteLength, 0) / 2 / RATE;

function wav(chunks: ArrayBuffer[]): Uint8Array {
  const size = chunks.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(44 + size);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + size, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, size, true);
  let o = 44;
  for (const b of chunks) {
    out.set(new Uint8Array(b), o);
    o += b.byteLength;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
