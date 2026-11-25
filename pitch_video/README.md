# Meroidea investor pitch video

A 2-minute, 1080p60 feature-led pitch in the 3Blue1Brown style, built with Manim Community Edition and styled exactly like the Meroidea website (light `#F5F7FF` ground, dot grid, Inter, `#4B49AC`, the logo tile). The voiceover is
synthesised by edge-tts and an ambient pad is generated in code.

| File | What it is |
|---|---|
| `SYSTEM_AUDIT.md` | What the codebase actually contains, counted from the repo, plus a *brief vs. reality* table |
| `STORYBOARD.md` | Visual language, script and shot list |
| `script.py` | The narration: the single source for both voice and animation cues |
| `tts.py` | Voice first: one MP3 per scene, with exact duration and **per-word timestamps** |
| `common.py` | Palette, components and `PitchScene`, which syncs animation cues to spoken words |
| `scene_01_problem.py` … `scene_09_vision.py` | One Manim scene per beat |
| `build.py` | Voice → render → music → ffmpeg assembly in one command |

## Build

```bash
# Video environment (Python 3.13): Manim + mixing. Linux also needs libpango1.0-dev and ffmpeg.
python3 -m venv .venv-video
.venv-video/bin/pip install manim mutagen numpy scipy pillow

# Voice environment (Python 3.12, which Kokoro needs): CPU-only torch + Kokoro-82M.
uv venv -p python3.12 .venv-tts
uv pip install -p .venv-tts/bin/python torch --index-url https://download.pytorch.org/whl/cpu
uv pip install -p .venv-tts/bin/python "kokoro>=0.9" soundfile \
  https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

cd pitch_video
../.venv-video/bin/python build.py                 # voice → 1080p60 render → music + SFX → master
../.venv-video/bin/python build.py --quality l     # fast 480p preview
../.venv-video/bin/python build.py --skip-render   # re-mix audio only
```

## Audio

- **Voice:** Kokoro-82M (open-weight neural TTS, Apache-2.0, runs locally), voice `af_heart`. Each sentence is
  synthesised separately and joined with natural pauses. Change `VOICE` in `script.py` (for example `am_michael`
  for a male narrator). For a fully human read, record it and replace `build/audio/<id>.wav`; the cue sheet
  will need re-timing.
- **Voice post:** high-pass, gentle compression, presence EQ and a faint room ambience.
- **Music:** generated Am–F–C–G at 100 bpm (pad, arpeggio, kick, hi-hats), about 11 LU under the voice, ducked
  under speech. Drop a track at `assets/bgm.mp3` to use your own.
- **Sound design (`sfx.py`):** whooshes, pops, clicks, impacts, a riser, chimes, pings, typing, sparkles,
  stamps and coins, all synthesised. Scenes log each cue with `self.sfx(name, gain)` at the exact animation frame.
- **Master:** two-pass, a static gain to −16 LUFS plus a limiter (about −1 dBTP).

## How the sync works

edge-tts returns a timestamp for every spoken word. A scene calls `self.cue("weighted")` to wait until that word
is about to be spoken, or `self.play_cue(word, *anims)` to wait and then play. Each scene ends exactly 0.6 s after
its last word. Assembly measures every rendered scene and places its voice clip at that scene's start, so
changing a line in `script.py` re-times the animation automatically.

## Music

Put any track at `assets/bgm.mp3` to use it. Otherwise `build.py` generates an Am–F–C–G ambient pad with a soft
66 bpm pulse and reverb. The pad is set about 20 dB below the voice (measured in LUFS), ducked under speech by
sidechain compression, and faded at both ends. The master is a static gain to −16 LUFS plus a limiter, with no AGC.

## Honesty rules

Engineering figures (112 tables, 196 RLS policies, 85 permissions, 113 test files) were counted from the repo in
November 2026. Re-count them before reusing the video later. The market figures are ABS (30 June 2025). Dashboard numbers are
illustrative synthetic data and are labelled so on screen.
