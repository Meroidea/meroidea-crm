"""Voice first: synthesise one WAV per scene with Kokoro (open-weight neural TTS, runs locally)
and record its exact length and per-word timings.

Run with the TTS environment (Python 3.12):  ../.venv-tts/bin/python tts.py
Writes build/audio/<id>.wav and build/audio/<id>.json:
    {"duration": seconds, "words": [[normalised_word, start_seconds], ...]}

Naturalness: each sentence is synthesised on its own and joined with human-length pauses
(longer after a question or a short hook line), instead of one breathless take.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

from script import SCENES, SPEED, VOICE

ROOT = Path(__file__).parent
AUDIO = ROOT / "build" / "audio"
SR = 24000
LEAD_IN = 0.12


def norm(word: str) -> str:
    return re.sub(r"[^a-z0-9]", "", word.lower())


def pause_after(sentence: str) -> float:
    s = sentence.strip()
    words = len(s.split())
    if s.endswith("?"):
        return 0.42
    if words <= 3:          # punchy hook lines ("Monday.", "One login.") get room to land
        return 0.3
    return 0.22


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.?!])\s+(?=[A-Z])", text.strip())
    return [p for p in parts if p]


def synth_scene(pipe, scene: dict) -> None:
    wav = AUDIO / f"{scene['id']}.wav"
    meta = AUDIO / f"{scene['id']}.json"
    digest = hashlib.sha1(f"kokoro-v3|{VOICE}|{SPEED}|{scene['text']}".encode()).hexdigest()
    if wav.exists() and meta.exists() and json.loads(meta.read_text()).get("hash") == digest:
        print(f"  {scene['id']}: cached")
        return
    chunks = [np.zeros(int(LEAD_IN * SR), dtype=np.float32)]
    words: list[list] = []
    offset = LEAD_IN
    for sentence in split_sentences(scene["text"]):
        for result in pipe(sentence, voice=VOICE, speed=SPEED):
            audio = result.audio.numpy().astype(np.float32)
            # Kokoro pads each chunk with silence; keep only the speech plus a 40 ms margin.
            loud = np.flatnonzero(np.abs(audio) > 0.02 * (np.max(np.abs(audio)) or 1))
            head = max(0, loud[0] - int(0.04 * SR)) if len(loud) else 0
            tail = min(len(audio), loud[-1] + int(0.06 * SR)) if len(loud) else len(audio)
            audio = audio[head:tail]
            shift = head / SR
            for tok in result.tokens or []:
                if tok.start_ts is not None and norm(tok.text):
                    words.append([norm(tok.text), round(offset + max(0.0, tok.start_ts - shift), 3)])
            chunks.append(audio)
            offset += len(audio) / SR
        gap = pause_after(sentence)
        chunks.append(np.zeros(int(gap * SR), dtype=np.float32))
        offset += gap
    audio = np.concatenate(chunks)
    # Trim the final pause to 0.1 s so scenes do not end on dead air.
    end = len(audio) - int((pause_after(split_sentences(scene["text"])[-1]) - 0.1) * SR)
    audio = audio[:end]
    peak = float(np.max(np.abs(audio))) or 1.0
    sf.write(wav, audio / peak * 0.89, SR, subtype="PCM_16")
    duration = len(audio) / SR
    meta.write_text(json.dumps({"hash": digest, "duration": duration, "words": words}))
    print(f"  {scene['id']}: {duration:6.2f}s  {len(words)} words")


def main() -> None:
    from kokoro import KPipeline

    AUDIO.mkdir(parents=True, exist_ok=True)
    pipe = KPipeline(lang_code="a" if VOICE[0] == "a" else "b")
    for scene in SCENES:
        synth_scene(pipe, scene)


if __name__ == "__main__":
    sys.exit(main())
