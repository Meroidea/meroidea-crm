# Meroidea investor pitch video

A 3 min 23 s, 1080p60 explainer in the 3Blue1Brown style, built with Manim Community Edition. The voiceover is
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
python3 -m venv .venv-video
.venv-video/bin/pip install manim edge-tts mutagen numpy scipy   # Linux also needs libpango1.0-dev and ffmpeg
cd pitch_video
../.venv-video/bin/python build.py                 # 1080p60 → meroidea_investor_pitch.mp4
../.venv-video/bin/python build.py --quality l     # fast 480p preview
../.venv-video/bin/python build.py --skip-render   # re-mix audio only
```

Behind a TLS-inspecting proxy, set `SSL_CERT_FILE` to its CA bundle. `tts.py` then uses it for edge-tts.

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
