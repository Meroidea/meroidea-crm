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

import sfx
from script import SCENES

ROOT = Path(__file__).parent
BUILD = ROOT / "build"
MEDIA = BUILD / "media"
QUALITY_DIR = {"h": "1080p60", "l": "480p15", "m": "720p30", "k": "2160p60"}
OUT = ROOT / "meroidea_investor_pitch.mp4"
MANIM = Path(sys.executable).with_name("manim")
TTS_PYTHON = ROOT.parent / ".venv-tts" / "bin" / "python"  # Kokoro needs Python 3.12


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
    """Am–F–C–G at 100 bpm: detuned pad, plucked eighth-note arpeggio, soft kick, convolution reverb."""
    rng = np.random.default_rng(1)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    hz = lambda midi: 440.0 * 2 ** ((midi - 69) / 12)  # noqa: E731
    chords = [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]]  # Am F C G
    bar = 60 / 100 * 8  # two bars of 4/4 at 100 bpm per chord (4.8 s)
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
    # Drive: 100 bpm plucked arpeggio over the chord tones, plus a soft four-on-the-floor kick.
    bpm = 100
    eighth = 60 / bpm / 2
    pl_l, pl_r = np.zeros(n), np.zeros(n)
    arp_order = [0, 2, 3, 1, 2, 3, 1, 2]
    for k in range(int(seconds / eighth)):
        t0 = k * eighth
        chord = chords[int(t0 // bar) % 4]
        note = chord[1:][arp_order[k % 8] % 3] + 12 + (12 if (k // 8) % 2 else 0)  # up an octave: mid-range
        i0 = int(t0 * sr)
        m = min(n - i0, int(0.5 * sr))
        if m <= 0:
            break
        tt = np.arange(m) / sr
        f = hz(note)
        tone = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt) + 0.12 * np.sin(2 * np.pi * 3 * f * tt))
        env = np.exp(-tt * 7.5) * (1 - np.exp(-tt * 400))
        amp = 0.22 if k % 2 == 0 else 0.15
        pan = 0.35 if k % 2 == 0 else 0.65
        pl_l[i0:i0 + m] += tone * env * amp * (1 - pan) * 2
        pl_r[i0:i0 + m] += tone * env * amp * pan * 2
    kick = np.zeros(n)
    for k in range(int(seconds / (60 / bpm))):
        i0 = int(k * 60 / bpm * sr)
        m = min(n - i0, int(0.3 * sr))
        tt = np.arange(m) / sr
        f_sweep = 48 + 70 * np.exp(-tt * 30)
        kick[i0:i0 + m] += np.sin(2 * np.pi * np.cumsum(f_sweep) / sr) * np.exp(-tt * 14) * 0.7
    # Intro swell: the drive fades in over the first 4 s.
    swell = np.clip(t / 4.0, 0, 1)
    # Off-beat hi-hats: high-frequency presence so the groove carries on laptop and phone speakers.
    hats = np.zeros(n)
    hp = butter(4, 7000, "high", fs=sr, output="sos")
    for k in range(int(seconds / eighth)):
        if k % 2 == 1:
            i0 = int(k * eighth * sr)
            m = min(n - i0, int(0.06 * sr))
            if m > 0:
                hats[i0:i0 + m] += rng.standard_normal(m) * np.exp(-np.arange(m) / sr * 70) * 0.35
    hats = sosfilt(hp, hats)
    sos = butter(4, 5000, "low", fs=sr, output="sos")
    sos_pl = butter(2, 8000, "low", fs=sr, output="sos")
    kick *= 0.55  # less sub: small speakers can't play it and it only muddies the voice
    left = sosfilt(sos, left * lfo) * 0.8 + (sosfilt(sos_pl, pl_l) * 1.4 + kick + hats) * swell
    right = sosfilt(sos, right * lfo) * 0.8 + (sosfilt(sos_pl, pl_r) * 1.4 + kick + hats * 0.9) * swell
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
        inputs += ["-i", str(BUILD / "audio" / f"{s['id']}.wav")]
        ms = int(round(offsets[i] * 1000))
        filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{i}]")
    mix_in = "".join(f"[v{i}]" for i in range(len(SCENES)))
    filters.append(f"{mix_in}amix=inputs={len(SCENES)}:normalize=0,apad=whole_dur={total:.3f}[voice]")
    voice = BUILD / "voice.wav"
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filters), "-map", "[voice]",
         "-t", f"{total:.3f}", str(voice)])

    # 3. Sound effects: each scene's logged events, shifted onto the film timeline.
    lib = BUILD / "sfx_lib"
    sfx.make_library(lib)
    events = []
    for i, s in enumerate(SCENES):
        f = BUILD / "sfx" / f"{s['id']}.json"
        if f.exists():
            events += [(offsets[i] + t, name, gain) for t, name, gain in json.loads(f.read_text())]
    sfx_wav = BUILD / "sfx.wav"
    placed = sfx.render_track(events, total, lib, sfx_wav)
    print(f"  {placed} sound effects placed")

    # 4. Mix. The pad sits ~20 dB below the voice (relative to the voice's own level), is ducked a
    #    further few dB while anyone speaks, and fades at both ends. Loudness is then set with one
    #    static gain (measured, not a dynamic AGC) so quiet passages are never pumped up.
    fade_out = max(total - 3.0, 0)
    voice_lufs = measure_lufs(voice)
    music_lufs = measure_lufs(bgm)
    music_gain = (voice_lufs - 11.0) - music_lufs   # ~11 LU under the voice: clearly audible, never competing
    master_gain = -16.0 - voice_lufs
    print(f"  voice {voice_lufs:.1f} LUFS · music {music_lufs:.1f} LUFS → music gain {music_gain:+.1f} dB, "
          f"master {master_gain:+.1f} dB")
    graph = (
        # Voice "post": high-pass, gentle compression, presence lift and a faint small-room ambience,
        # the treatment a recorded voiceover gets; a bone-dry TTS read sounds synthetic.
        "[1:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=80,"
        "acompressor=threshold=-22dB:ratio=2.5:attack=8:release=120:makeup=2,"
        "equalizer=f=3200:t=q:w=1.2:g=2.5,equalizer=f=250:t=q:w=1.0:g=-1.5,"
        "aecho=0.9:0.6:28|47:0.07|0.04,asplit=2[vo][key];"
        f"[2:a]aresample=48000,aformat=channel_layouts=stereo,volume={music_gain:.2f}dB,atrim=0:{total:.3f},"
        f"afade=t=in:st=0:d=2,afade=t=out:st={fade_out:.3f}:d=3[mus];"
        "[mus][key]sidechaincompress=threshold=0.05:ratio=3:attack=60:release=450:makeup=1[duck];"
        "[3:a]aresample=48000,aformat=channel_layouts=stereo,volume=-9dB[fx];"
        f"[vo][duck][fx]amix=inputs=3:normalize=0,volume={master_gain:.2f}dB,alimiter=limit=0.89:level=false[a]"
    )
    # Pass 1: mix the audio. Pass 2: measure it and master to exactly -16 LUFS (static gain + limiter).
    mix = BUILD / "mix.wav"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(picture), "-i", str(voice), "-stream_loop", "-1", "-i", str(bgm),
         "-i", str(sfx_wav), "-filter_complex", graph, "-map", "[a]", "-ar", "48000", "-t", f"{total:.3f}", str(mix)])
    trim = -16.0 - measure_lufs(mix)
    print(f"  master trim {trim:+.1f} dB")
    run(["ffmpeg", "-v", "error", "-y", "-i", str(picture), "-i", str(mix),
         "-filter_complex", f"[1:a]volume={trim:.2f}dB,alimiter=limit=0.89:level=false[a]",
         "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
         "-t", f"{total:.3f}", str(OUT)])
    print(f"  wrote {OUT.relative_to(ROOT.parent)}  ({OUT.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quality", default="h", choices=list(QUALITY_DIR), help="manim quality flag (h = 1080p60)")
    ap.add_argument("--jobs", type=int, default=4, help="scenes rendered in parallel")
    ap.add_argument("--skip-render", action="store_true")
    args = ap.parse_args()

    print("1/3 voiceover (Kokoro)")
    if not TTS_PYTHON.exists():
        raise SystemExit("missing .venv-tts: see README (Kokoro needs Python 3.12)")
    run([str(TTS_PYTHON), "tts.py"], cwd=ROOT)
    if not args.skip_render:
        print(f"2/3 render ({QUALITY_DIR[args.quality]})")
        render_all(args.quality, args.jobs)
    print("3/3 music + assembly")
    assemble(args.quality)


if __name__ == "__main__":
    main()
