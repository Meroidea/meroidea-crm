"""One command from script to finished film.

    python build.py                 # voice → render 1080p60 → music → assemble
    python build.py --quality l     # quick 480p15 preview of the whole film
    python build.py --skip-render   # re-mix audio/assembly only

Output: pitch_video/meroidea_investor_pitch.mp4
Background music: drop your own track at assets/bgm.mp3, otherwise an ambient pad is generated.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

import tts
from script import SCENES

ROOT = Path(__file__).parent
BUILD = ROOT / "build"
MEDIA = BUILD / "media"
QUALITY_DIR = {"h": "1080p60", "l": "480p15", "m": "720p30", "k": "2160p60"}
OUT = ROOT / "meroidea_investor_pitch.mp4"
MANIM = Path(sys.executable).with_name("manim")


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kw)


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def measure_lufs(path: Path) -> float:
    err = subprocess.run(["ffmpeg", "-v", "info", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                         check=True, capture_output=True, text=True).stderr
    lines = [ln for ln in err.splitlines() if ln.strip().startswith("I:")]
    return float(lines[-1].split()[1])


def scene_video(scene: dict, quality: str) -> Path:
    return MEDIA / "videos" / scene["module"] / QUALITY_DIR[quality] / f"{scene['cls']}.mp4"


# ---- Render -----------------------------------------------------------------------------------

def render_one(scene: dict, quality: str) -> str:
    log = BUILD / "logs" / f"{scene['id']}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "w") as fh:
        proc = subprocess.run([str(MANIM), f"-q{quality}", "--media_dir", str(MEDIA), "--disable_caching",
                               f"{scene['module']}.py", scene["cls"]], cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT)
    if proc.returncode:
        raise RuntimeError(f"render failed for {scene['id']}: see {log}")
    return f"{scene['id']} → {scene_video(scene, quality).relative_to(ROOT)}"


def render_all(quality: str, jobs: int) -> None:
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for line in pool.map(lambda s: render_one(s, quality), SCENES):
            print("  rendered", line)


# ---- Procedural ambient pad -----------------------------------------------------------------------

def make_pad(seconds: float, path: Path, sr: int = 44100) -> None:
    """A slow Am–F–C–G pad with detuned partials, a soft heartbeat pulse and a convolution reverb."""
    rng = np.random.default_rng(1)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    hz = lambda midi: 440.0 * 2 ** ((midi - 69) / 12)  # noqa: E731
    chords = [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]]  # Am F C G
    bar = 8.0  # seconds per chord
    left, right = np.zeros(n), np.zeros(n)
    for ci in range(int(np.ceil(seconds / bar)) + 1):
        chord = chords[ci % 4]
        start = ci * bar - 2.0  # 2 s overlap for crossfades
        s0, s1 = max(0, int(start * sr)), min(n, int((start + bar + 4.0) * sr))
        if s0 >= n:
            break
        seg = t[s0:s1] - start
        env = np.sin(np.pi * np.clip(seg / (bar + 4.0), 0, 1)) ** 2
        for note in chord:
            f = hz(note)
            for det, amp in ((-0.11, 0.5), (0.0, 1.0), (0.13, 0.5)):
                ph = rng.uniform(0, 2 * np.pi)
                tone = np.sin(2 * np.pi * (f + det) * seg + ph) + 0.18 * np.sin(2 * np.pi * 2 * (f + det) * seg + ph)
                w = amp * env * (0.6 if note < 50 else 0.32)
                pan = 0.5 + 0.35 * det / 0.13 if det else 0.5
                left[s0:s1] += tone * w * (1 - pan) * 2
                right[s0:s1] += tone * w * pan * 2
    lfo = 0.82 + 0.18 * np.sin(2 * np.pi * 0.07 * t)
    # Heartbeat: a soft sub thump on the root, ~66 bpm, quietly under the pad.
    beat = np.zeros(n)
    period = 60 / 66
    for k in range(int(seconds / period)):
        i0 = int(k * period * sr)
        m = min(n - i0, int(0.45 * sr))
        tt = np.arange(m) / sr
        beat[i0:i0 + m] += np.sin(2 * np.pi * 55 * tt) * np.exp(-tt * 9) * (0.55 if k % 2 == 0 else 0.3)
    sos = butter(4, 1800, "low", fs=sr, output="sos")
    left, right = sosfilt(sos, left * lfo) + beat, sosfilt(sos, right * lfo) + beat
    ir_len = int(3.2 * sr)
    ir_t = np.arange(ir_len) / sr
    for ch_i, ch in enumerate((left, right)):
        ir = rng.standard_normal(ir_len) * np.exp(-ir_t * 2.2)
        wet = fftconvolve(ch, ir)[:n]
        mix = 0.65 * ch + 0.35 * wet / (np.max(np.abs(wet)) + 1e-9) * np.max(np.abs(ch))
        if ch_i == 0:
            left = mix
        else:
            right = mix
    stereo = np.stack([left, right], axis=1)
    fade = int(3 * sr)
    stereo[:fade] *= np.linspace(0, 1, fade)[:, None]
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    stereo /= np.max(np.abs(stereo)) + 1e-9
    wavfile.write(path, sr, (stereo * 0.9 * 32767).astype(np.int16))


# ---- Assembly -----------------------------------------------------------------------------------

def assemble(quality: str) -> None:
    videos = [scene_video(s, quality) for s in SCENES]
    missing = [str(v) for v in videos if not v.exists()]
    if missing:
        raise SystemExit("missing renders: " + ", ".join(missing))
    durations = [probe_duration(v) for v in videos]
    offsets = np.concatenate([[0.0], np.cumsum(durations)[:-1]])
    total = float(sum(durations))
    print(f"  film length {total:.2f}s ({int(total // 60)}:{total % 60:05.2f})")

    bgm = ROOT / "assets" / "bgm.mp3"
    if not bgm.exists():
        bgm = BUILD / "bgm.wav"
        print("  no assets/bgm.mp3, generating ambient pad")
        make_pad(total + 1.0, bgm)

    # 1. Picture: concatenate the scene renders.
    listing = BUILD / "concat.txt"
    listing.write_text("".join(f"file '{v.resolve()}'\n" for v in videos))
    picture = BUILD / "picture.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(picture)])

    # 2. Voice: each scene's clip placed at the start of its scene.
    inputs, filters = [], []
    for i, s in enumerate(SCENES):
        inputs += ["-i", str(BUILD / "audio" / f"{s['id']}.mp3")]
        ms = int(round((offsets[i] + 0.05) * 1000))
        filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{i}]")
    mix_in = "".join(f"[v{i}]" for i in range(len(SCENES)))
    filters.append(f"{mix_in}amix=inputs={len(SCENES)}:normalize=0,apad=whole_dur={total:.3f}[voice]")
    voice = BUILD / "voice.wav"
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filters), "-map", "[voice]",
         "-t", f"{total:.3f}", str(voice)])

    # 3. Mix. The pad sits ~20 dB below the voice (relative to the voice's own level), is ducked a
    #    further few dB while anyone speaks, and fades at both ends. Loudness is then set with one
    #    static gain (measured, not a dynamic AGC) so quiet passages are never pumped up.
    fade_out = max(total - 3.0, 0)
    voice_lufs = measure_lufs(voice)
    music_lufs = measure_lufs(bgm)
    music_gain = (voice_lufs - 20.0) - music_lufs
    master_gain = -16.0 - voice_lufs
    print(f"  voice {voice_lufs:.1f} LUFS · music {music_lufs:.1f} LUFS → music gain {music_gain:+.1f} dB, "
          f"master {master_gain:+.1f} dB")
    graph = (
        "[1:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[vo][key];"
        f"[2:a]aresample=48000,aformat=channel_layouts=stereo,volume={music_gain:.2f}dB,atrim=0:{total:.3f},"
        f"afade=t=in:st=0:d=2,afade=t=out:st={fade_out:.3f}:d=3[mus];"
        "[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600:makeup=1[duck];"
        f"[vo][duck]amix=inputs=2:normalize=0,volume={master_gain:.2f}dB,alimiter=limit=0.89:level=false[a]"
    )
    run(["ffmpeg", "-v", "error", "-y", "-i", str(picture), "-i", str(voice), "-stream_loop", "-1", "-i", str(bgm),
         "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
         "-t", f"{total:.3f}", str(OUT)])
    print(f"  wrote {OUT.relative_to(ROOT.parent)}  ({OUT.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quality", default="h", choices=list(QUALITY_DIR), help="manim quality flag (h = 1080p60)")
    ap.add_argument("--jobs", type=int, default=4, help="scenes rendered in parallel")
    ap.add_argument("--skip-render", action="store_true")
    args = ap.parse_args()

    print("1/3 voiceover")
    asyncio.run(tts.main())
    if not args.skip_render:
        print(f"2/3 render ({QUALITY_DIR[args.quality]})")
        render_all(args.quality, args.jobs)
    print("3/3 music + assembly")
    assemble(args.quality)


if __name__ == "__main__":
    main()
