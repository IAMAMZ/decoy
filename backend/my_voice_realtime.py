"""Clone your voice and hear Higgs Realtime answer in it.

Usage:
  python my_voice_realtime.py            # record 10 s from your mic
  python my_voice_realtime.py me.wav     # or use an existing clip (wav/mp3/flac)
  python my_voice_realtime.py voice_...  # or reuse a voice ID you already created
  add --style "whispering, sleepy" to any of these to set the emotion/delivery
"""
import argparse
import asyncio
import base64
import io
import json
import os
import sys
import wave

import requests
import sounddevice as sd
import websockets
from dotenv import load_dotenv

API = "https://api.boson.ai/v1"
load_dotenv()
KEY = os.environ["BOSON_AI_API_KEY"]
RATE = 24000


def record(seconds=10):
    input(f"Press Enter, then read something naturally for {seconds} s...")
    pcm = sd.rec(seconds * RATE, samplerate=RATE, channels=1, dtype="int16")
    sd.wait()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    open("my_voice.wav", "wb").write(buf.getvalue())  # keep it so you can re-run with the file
    return buf.getvalue()


def create_voice(audio: bytes, transcript: str) -> str:
    r = requests.post(
        f"{API}/audio/voices",
        headers={"Authorization": f"Bearer {KEY}"},
        json={"ref_audio": base64.b64encode(audio).decode(), "ref_text": transcript},
    )
    r.raise_for_status()
    body = r.json()
    return body.get("voice") or body["voice_id"]  # API reference and guide disagree on the field name


async def open_session(voice: str, style: str | None, attempts=5):
    """Connect and wait for the session ack; retry when the voice check is rate-limited."""
    for attempt in range(attempts):
        print("Connecting to Realtime...")
        ws = await websockets.connect(
            "wss://api.boson.ai/v1/realtime",
            additional_headers={"Authorization": f"Bearer {KEY}"},
        )
        await ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "model": "higgs-realtime",
                "instructions": "a scam person is calling you this is their scam call, your job is just to troll them and waste their time be funny but belivable"
                + (f" Speak with this emotion and style: {style}." if style else ""),
                "audio": {"output": {"voice": voice}},
            },
        }))
        print("Connected, waiting for the server to accept the voice...")
        while True:
            try:
                event = json.loads(await asyncio.wait_for(ws.recv(), 30))
            except TimeoutError:
                sys.exit("No reply from the server in 30 s after session.update.")
            except websockets.ConnectionClosed as e:
                sys.exit(f"Server closed the connection: code {e.code} {e.reason}")
            print("  server:", event["type"])
            if event["type"] in ("session.created", "session.updated"):  # first update is acked with .created
                return ws
            if event["type"] == "error":
                await ws.close()
                if "429" not in event["error"]["message"]:
                    sys.exit(f"Session error: {event['error']['message']}")
                wait = 2 ** attempt * 5
                print(f"Voice check rate-limited (429), retrying in {wait} s...")
                await asyncio.sleep(wait)
                break
    sys.exit("Still getting 429. Check credit at boson.ai/workspace/billing, or try again later.")


async def chat(voice: str, style: str | None):
    speaker = sd.RawOutputStream(samplerate=RATE, channels=1, dtype="int16")
    speaker.start()
    ws = await open_session(voice, style)
    print("Session ready with your voice.")
    async with ws:
        # input() in a thread so the event loop keeps answering keepalive pings while you type
        while (text := (await asyncio.to_thread(input, "\nYou (empty to quit): ")).strip()):
            await ws.send(json.dumps({
                "type": "conversation.item.create",
                "item": {"type": "message", "role": "user",
                         "content": [{"type": "input_text", "text": text}]},
            }))
            await ws.send(json.dumps({"type": "response.create"}))
            async for msg in ws:
                event = json.loads(msg)
                if event["type"] == "error":
                    print("Error:", event["error"]["message"])
                elif event["type"] == "response.output_audio.delta":
                    speaker.write(base64.b64decode(event["delta"]))
                elif event["type"] == "response.output_audio_transcript.done":
                    print("Assistant:", event["transcript"])
                elif event["type"] == "response.done":
                    break
    speaker.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clone your voice and chat with Higgs Realtime in it.")
    parser.add_argument("source", nargs="?", help="audio file or voice_... ID; omit to record from the mic")
    parser.add_argument("--style", help='emotion/delivery, e.g. "excited and cheerful" or "whispering"')
    args = parser.parse_args()
    arg = args.source
    if arg and arg.startswith("voice_"):  # reuse an existing voice, no re-recording
        voice = arg
    else:
        audio = open(arg, "rb").read() if arg else record()
        transcript = input("Type exactly what you said in the clip: ")
        voice = create_voice(audio, transcript)
        print("Voice ID:", voice)
    asyncio.run(chat(voice, args.style))