"""Procedural sound design: every effect is synthesised here (no third-party samples, no licences).

    make_library(dir)  -> writes <name>.wav for each effect (48 kHz stereo)
    render_track(events, total, lib_dir, out) -> one SFX stem placed on the film timeline

Scenes log events with PitchScene.sfx(name, gain=dB); build.py collects them per scene.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, sosfiltfilt

SR = 48000
rng = np.random.default_rng(7)


def _t(d):
    return np.arange(int(d * SR)) / SR


def _env(n, a=0.005, r=0.2, shape=4.0):
    t = np.arange(n) / SR
    att = np.clip(t / max(a, 1e-4), 0, 1)
    rel = np.exp(-t * shape / max(r, 1e-4))
    return att * rel


def _bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def _hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def _lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)


def _stereo(m, width=0.0):
    if width <= 0:
        return np.stack([m, m], 1)
    d = int(width * SR)
    r = np.concatenate([np.zeros(d), m])[: len(m)]
    return np.stack([m, r], 1)


def whoosh(d=0.55, lo=250, hi=4200, up=True):
    """Filtered-noise sweep: transitions, things flying past."""
    n = int(d * SR)
    noise = rng.standard_normal(n)
    t = np.linspace(0, 1, n)
    out = np.zeros(n)
    blocks = 24
    for b in range(blocks):
        s0, s1 = b * n // blocks, (b + 1) * n // blocks
        frac = b / (blocks - 1)
        fc = lo * (hi / lo) ** (frac if up else 1 - frac)
        seg = _bp(noise, max(60, fc * 0.6), min(SR / 2 - 100, fc * 1.6))[s0:s1]
        out[s0:s1] = seg
    env = np.sin(np.pi * t) ** 1.6
    return _stereo(out * env, 0.012)


def pop(f0=880, f1=520, d=0.09):
    """UI pop: a short pitched blip with a soft click."""
    t = _t(d)
    f = f1 + (f0 - f1) * np.exp(-t * 40)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(len(t), 0.002, d, 5)
    click = _hp(rng.standard_normal(len(t)), 3000) * _env(len(t), 0.0005, 0.01, 6) * 0.25
    return _stereo(tone + click)


def click(d=0.035):
    t = _t(d)
    x = _bp(rng.standard_normal(len(t)), 1800, 7000) * _env(len(t), 0.0003, 0.012, 6)
    x += np.sin(2 * np.pi * 2400 * t) * _env(len(t), 0.0003, 0.008, 6) * 0.4
    return _stereo(x)


def impact(d=0.9):
    """Cinematic hit: sub drop + noise burst + short tail."""
    t = _t(d)
    f = 38 + 70 * np.exp(-t * 18)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(len(t), 0.002, 0.7, 4)
    burst = _lp(rng.standard_normal(len(t)), 2500) * _env(len(t), 0.001, 0.12, 6) * 0.6
    body = _bp(rng.standard_normal(len(t)), 120, 600) * _env(len(t), 0.002, 0.35, 5) * 0.5
    return _stereo(sub + burst + body, 0.004)


def riser(d=1.4):
    """Tension build into a reveal."""
    t = _t(d)
    f = 180 * (1 + 3 * (t / d) ** 2)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.35 + np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR) * 0.2
    noise = whoosh(d, 200, 6000)[:, 0] * 0.8
    env = (t / d) ** 2.2
    return _stereo((tone + noise[: len(t)]) * env, 0.008)


def chime(notes=(1318.5, 1975.5), d=0.9):
    """Success: two bell partials, slightly staggered."""
    t = _t(d)
    x = np.zeros(len(t))
    for i, f in enumerate(notes):
        lag = int(i * 0.07 * SR)
        b = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.76 * t)) * _env(len(t), 0.002, 0.6, 4)
        x[lag:] += b[: len(t) - lag] * (0.6 if i else 0.8)
    return _stereo(x, 0.006)


def ping(d=0.5):
    """Notification: rising two-note ping."""
    return chime((1046.5, 1568.0), d)


def sparkle(d=0.7):
    t = _t(d)
    x = np.zeros(len(t))
    for k in range(9):
        f = rng.uniform(2500, 6000)
        s = int(rng.uniform(0, 0.35) * SR)
        g = np.sin(2 * np.pi * f * t[: len(t) - s]) * _env(len(t) - s, 0.001, 0.18, 6) * rng.uniform(0.2, 0.45)
        x[s:] += g
    return _stereo(x, 0.01)


def coin(d=0.6):
    return chime((1975.5, 2637.0), d)


def typing(d=1.6, rate=14):
    n = int(d * SR)
    x = np.zeros(n)
    t0 = 0.0
    while t0 < d - 0.05:
        k = click(0.03)[:, 0] * rng.uniform(0.35, 0.7)
        i = int(t0 * SR)
        x[i:i + len(k)] += k[: n - i]
        t0 += 1 / rate * rng.uniform(0.7, 1.3)
    return _stereo(x, 0.003)


def tick(d=0.05):
    return pop(1800, 1400, d)


def stamp(d=0.5):
    """Rubber stamp: a dull thump with a papery slap."""
    t = _t(d)
    thump = np.sin(2 * np.pi * np.cumsum(90 + 60 * np.exp(-t * 30)) / SR) * _env(len(t), 0.001, 0.18, 6)
    slap = _bp(rng.standard_normal(len(t)), 600, 5000) * _env(len(t), 0.0005, 0.06, 6) * 0.7
    return _stereo(thump + slap)


def swish(d=0.28):
    return whoosh(d, 800, 6000)


LIBRARY = {
    "whoosh": whoosh, "swish": swish, "pop": pop, "click": click, "impact": impact, "riser": riser,
    "chime": chime, "ping": ping, "sparkle": sparkle, "coin": coin, "typing": typing, "tick": tick,
    "stamp": stamp,
}


def make_library(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name, fn in LIBRARY.items():
        x = fn()
        x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
        wavfile.write(out / f"{name}.wav", SR, (x * 32767).astype(np.int16))


def render_track(events: list[tuple[float, str, float]], total: float, lib: Path, out: Path) -> int:
    """events: (time_seconds, name, gain_db). Returns the number of events placed."""
    buf = np.zeros((int((total + 2) * SR), 2))
    cache: dict[str, np.ndarray] = {}
    for t, name, gain in events:
        if name not in cache:
            sr, data = wavfile.read(lib / f"{name}.wav")
            cache[name] = data.astype(np.float64) / 32767
        x = cache[name] * 10 ** (gain / 20)
        i = int(max(0.0, t) * SR)
        j = min(len(buf), i + len(x))
        buf[i:j] += x[: j - i]
    buf = buf[: int(total * SR)]
    peak = np.max(np.abs(buf)) or 1
    if peak > 0.98:
        buf *= 0.98 / peak
    wavfile.write(out, SR, (buf * 32767).astype(np.int16))
    return len(events)
