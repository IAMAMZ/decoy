"""Generate the takeover warning clip with Higgs Avatar (face + Higgs TTS voice), once, before the demo.

Run from the repo root:   python scripts/make_avatar_clip.py [face image]
Writes public/avatar/takeover.mp4, which the app plays on Margaret's phone at takeover.

The line must match TAKEOVER_LINE in src/agent/avatar.ts: the clip speaks it, the phone shows it as text.
Reads the Boson key from VITE_BOSON_API_KEY in .env.local (or BOSON_API_KEY in the environment).
"""

import base64
import json
import os
import pathlib
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "avatar" / "takeover.mp4"
API = "https://api.boson.ai/v1"

LINE = "Margaret, this call is a scam. Your money is safe. You can hang up now; I'll handle it from here."
FACE = "https://docs.boson.ai/public/avatar/sample.jpg"  # Boson's sample face; pass your own image to replace it
VOICE = "eleanor"  # calm, clear preset voice
SIZE = "640x640"


def api_key() -> str:
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("VITE_BOSON_API_KEY="):
                return line.split("=", 1)[1].strip()
    return os.environ["BOSON_API_KEY"]


def request(method: str, path: str, body: dict | None = None) -> bytes:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def face(arg: str | None) -> str:
    """A URL as is; a local file as base64."""
    if not arg:
        return FACE
    if arg.startswith(("http://", "https://")):
        return arg
    return base64.b64encode(pathlib.Path(arg).read_bytes()).decode()


KEY = api_key()
t0 = time.time()
video = json.loads(
    request(
        "POST",
        "/videos",
        {
            "model": "higgs-avatar",
            "ref_image": face(sys.argv[1] if len(sys.argv) > 1 else None),
            "input_tts": {"model": "higgs-tts-3", "input": LINE, "voice": VOICE},
            "size": SIZE,
        },
    )
)
print("job", video["id"], video.get("status"))
while video.get("status") not in ("completed", "failed"):
    time.sleep(3)
    video = json.loads(request("GET", f"/videos/{video['id']}"))
    print(f"  {video.get('status')} {video.get('progress', '')}")
if video["status"] == "failed":
    sys.exit(f"Avatar job failed: {video.get('error')}")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_bytes(request("GET", f"/videos/{video['id']}/content"))
print(f"Saved {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB) in {time.time() - t0:.0f}s")
