# My voice on Higgs Realtime

Clone your voice with Boson AI, then chat with Higgs Realtime and hear it reply in your voice.

## Setup

1. Create an API key at [boson.ai/workspace/api-key](https://www.boson.ai/workspace/api-key) and claim the free trial credit at [boson.ai/workspace/billing](https://www.boson.ai/workspace/billing/overview). Without credit you get a 429 error or close code 4429.
2. Go to the project folder:

   ```bash
   cd ~/projects/boson-ai-hackathon
   ```

3. Install the packages ([uv](https://docs.astral.sh/uv/), Python 3.13+):

   ```bash
   uv sync
   ```

4. Create `.env` with your key:

   ```
   BOSON_AI_API_KEY=bai-xxxx
   ```

## Run

**First run: record and clone your voice**

```bash
uv run my_voice_realtime.py
```

Press Enter, speak naturally for 10 seconds (no background noise or music), then type exactly what you said. The script saves `my_voice.wav` and prints a voice ID. Copy that ID.

To clone from an existing recording instead (wav, mp3 or flac, 5–30 s of clean speech):

```bash
uv run my_voice_realtime.py me.wav
```

**Later runs: reuse the voice**

```bash
uv run my_voice_realtime.py voice_<your id>
```

You don't need to record again. The same audio always gives the same ID.

**Optional: set an emotion or style**

```bash
uv run my_voice_realtime.py voice_<your id> --style "excited and cheerful"
```

The style is added to the model's instructions, so it is a hint, not exact control. It is set once per run; restart to try another.

**Chat**

Type a message at `You:`. The reply plays in your voice and its text prints. Press Enter on an empty line to quit.

## Dev

```bash
uv run ruff check . && uv run ruff format . && uv run pyrefly check && uv run pytest
```

## Troubleshooting

| If you see | It means |
| - | - |
| Close code 3000 | The key in `.env` is wrong or missing |
| 429 / close code 4429 | No credit (claim the trial), or a temporary rate limit (the script retries) |
| No sound, but text prints | Check your Mac's sound output device |
| The mic records silence | Allow your terminal in System Settings → Privacy & Security → Microphone |

## Docs

- [Higgs Realtime quickstart](https://docs.boson.ai/models/higgs-realtime/quickstart)
- [Realtime audio and voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices)
- [Custom voices](https://docs.boson.ai/models/higgs-tts/voices#custom-voices)
