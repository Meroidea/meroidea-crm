"""Voiceover first: synthesise one MP3 per scene and record its exact length and word timings.

Writes build/audio/<id>.mp3 and build/audio/<id>.json:
    {"duration": seconds, "words": [[normalised_word, start_seconds], ...]}
Scenes read the JSON so each animation cue lands on the word that motivates it.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import ssl
import sys
from pathlib import Path

import edge_tts
import edge_tts.communicate as communicate
from mutagen.mp3 import MP3

from script import RATE, SCENES, VOICE

ROOT = Path(__file__).parent
AUDIO = ROOT / "build" / "audio"

# edge-tts pins certifi's CA store. Behind a TLS-inspecting proxy, honour SSL_CERT_FILE instead.
if os.environ.get("SSL_CERT_FILE"):
    communicate._SSL_CTX = ssl.create_default_context(cafile=os.environ["SSL_CERT_FILE"])


def norm(word: str) -> str:
    return re.sub(r"[^a-z0-9]", "", word.lower())


async def synth(scene: dict) -> None:
    mp3 = AUDIO / f"{scene['id']}.mp3"
    meta = AUDIO / f"{scene['id']}.json"
    digest = hashlib.sha1(f"{VOICE}|{RATE}|{scene['text']}".encode()).hexdigest()
    if mp3.exists() and meta.exists() and json.loads(meta.read_text()).get("hash") == digest:
        print(f"  {scene['id']}: cached")
        return
    words: list[list] = []
    for attempt in range(4):
        try:
            words = []
            com = edge_tts.Communicate(scene["text"], VOICE, rate=RATE, boundary="WordBoundary")
            with open(mp3, "wb") as fh:
                async for chunk in com.stream():
                    if chunk["type"] == "audio":
                        fh.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        words.append([norm(chunk["text"]), chunk["offset"] / 1e7])
            break
        except Exception as exc:  # network hiccup: back off and retry
            print(f"  {scene['id']}: attempt {attempt + 1} failed: {exc}", file=sys.stderr)
            await asyncio.sleep(2**attempt)
    else:
        raise SystemExit(f"TTS failed for {scene['id']}")
    duration = MP3(mp3).info.length
    meta.write_text(json.dumps({"hash": digest, "duration": duration, "words": words}))
    print(f"  {scene['id']}: {duration:6.2f}s  {len(words)} words")


async def main() -> None:
    AUDIO.mkdir(parents=True, exist_ok=True)
    for scene in SCENES:
        await synth(scene)


if __name__ == "__main__":
    asyncio.run(main())
