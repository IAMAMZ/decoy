// Higgs Realtime from the browser (docs.boson.ai/models/higgs-realtime).
// Auth: mint a short-lived client secret, then pass it as a WebSocket subprotocol,
// because browsers can't set an Authorization header on a WebSocket.
//
// Demo-laptop only: VITE_BOSON_API_KEY ends up in the page. Never deploy this build publicly;
// move secret minting to a server first.

export type RealtimeHandlers = {
  onCommitted: (itemId: string) => void;
  onInputTranscript: (itemId: string, text: string) => void;
  onAudio: (b64: string) => void;
  onAiTranscript: (text: string) => void;
  onResponseDone: () => void;
  onError: (message: string) => void;
  onClose: () => void;
};

const API = 'https://api.boson.ai/v1';

export class Realtime {
  private ws: WebSocket | null = null;
  private waiting: ((type: string, ev: any) => void) | null = null;
  private labels = 0;

  constructor(private h: RealtimeHandlers) {}

  async connect(instructions: string): Promise<void> {
    const key = import.meta.env.VITE_BOSON_API_KEY as string | undefined;
    if (!key) throw new Error('Set VITE_BOSON_API_KEY in frontend/.env.local');

    const r = await fetch(`${API}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { seconds: 600 } }),
    });
    if (!r.ok) throw new Error(`Boson client secret failed (${r.status}): ${await r.text()}`);
    const { value } = await r.json();

    const ws = new WebSocket('wss://api.boson.ai/v1/realtime', ['realtime', `bai-client-secret.${value}`]);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not reach Higgs Realtime'));
    });
    ws.onmessage = (m) => this.handle(JSON.parse(m.data));
    ws.onclose = (e) => {
      if (e.code === 4429) this.h.onError('Boson says out of credit (4429)');
      this.h.onClose();
    };

    const voice = (import.meta.env.VITE_MARGARET_VOICE as string | undefined) || 'default';
    this.send({
      type: 'session.update',
      session: {
        model: 'higgs-realtime',
        instructions,
        output_modalities: ['audio'],
        audio: {
          // Push-to-talk decides when a turn ends, so server turn detection is off.
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: null,
            transcription: { model: 'higgs-stt-3.1', language: 'en' },
            noise_reduction: { type: 'near_field' },
          },
          output: { format: { type: 'audio/pcm', rate: 24000 }, voice },
        },
      },
    });
    await this.waitFor('session.created', 15000);
  }

  setInstructions(instructions: string) {
    this.send({ type: 'session.update', session: { model: 'higgs-realtime', instructions } });
  }

  /** Text marker before a turn's audio so the model knows who is speaking. Returns its item id. */
  label(text: string): string {
    const id = `label_${++this.labels}_${Date.now().toString(36)}`;
    this.send({
      type: 'conversation.item.create',
      item: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    });
    return id;
  }

  deleteItem(id: string) {
    this.send({ type: 'conversation.item.delete', item_id: id });
  }

  append(pcm: ArrayBuffer) {
    const bytes = new Uint8Array(pcm);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    this.send({ type: 'input_audio_buffer.append', audio: btoa(bin) });
  }

  clear() {
    this.send({ type: 'input_audio_buffer.clear' });
  }

  commit() {
    this.send({ type: 'input_audio_buffer.commit' });
  }

  respond() {
    this.send({ type: 'response.create' });
  }

  cancel() {
    this.send({ type: 'response.cancel' });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  private send(ev: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }

  private waitFor(type: string, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`No ${type} from Higgs Realtime`)), ms);
      this.waiting = (got, ev) => {
        if (got === 'error') {
          clearTimeout(t);
          reject(new Error(ev.error?.message ?? 'Realtime error'));
        } else if (got === type) {
          clearTimeout(t);
          this.waiting = null;
          resolve();
        }
      };
    });
  }

  private handle(ev: any) {
    this.waiting?.(ev.type, ev);
    switch (ev.type) {
      case 'input_audio_buffer.committed':
        return this.h.onCommitted(ev.item_id);
      case 'conversation.item.input_audio_transcription.completed':
        return this.h.onInputTranscript(ev.item_id, ev.transcript ?? '');
      case 'response.output_audio.delta':
        return this.h.onAudio(ev.delta);
      case 'response.output_audio_transcript.done':
        return this.h.onAiTranscript(ev.transcript ?? '');
      case 'response.done':
        return this.h.onResponseDone();
      case 'error':
        // Cancelling when nothing is playing is harmless; don't surface it.
        if (!/no active response|cancel/i.test(ev.error?.message ?? '')) this.h.onError(ev.error?.message ?? 'Realtime error');
        return;
    }
  }
}
