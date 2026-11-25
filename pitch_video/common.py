"""Shared look and audio-sync machinery for every scene."""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from manim import (
    DOWN,
    LEFT,
    RIGHT,
    UP,
    UL,
    FadeOut,
    Circle,
    Dot,
    Group,
    Line,
    MovingCameraScene,
    RoundedRectangle,
    Text,
    VGroup,
    config,
    smooth,
    interpolate_color,
    ManimColor,
)

ROOT = Path(__file__).parent

# ---- Palette (product palette, lifted for a dark ground) ------------------------------------
BG = "#0F1419"
PANEL = "#18202A"
EDGE = "#2A3441"
GLOW = "#8B8AF0"
BRAND = "#4B49AC"
SKY = "#98BDFF"
SKY2 = "#7DA0FA"
CORAL = "#F3797E"
GOLD = "#F5C46B"
MINT = "#6EE7B7"
TEXT = "#E6EAF2"
MUTED = "#8A94A6"

FONT = "Inter"
MONO = "JetBrains Mono"

config.background_color = BG


def T(s: str, size: float = 32, color: str = TEXT, weight: str = "NORMAL", font: str = FONT, **kw):
    """Pango text. Size is in points at the default frame; weight is a Pango weight name."""
    return Text(s, font=font, font_size=size, color=color, weight=weight, **kw)


def mono(s: str, size: float = 24, color: str = TEXT, **kw):
    return Text(s, font=MONO, font_size=size, color=color, **kw)


def glow_dot(color: str = GLOW, radius: float = 0.08, layers: int = 5, spread: float = 3.2):
    """A dot with a soft halo built from translucent rings (cheap bloom)."""
    halo = VGroup(
        *[
            Circle(radius=radius * (1 + spread * i / layers), stroke_width=0)
            .set_fill(color, opacity=0.16 * (1 - i / layers) ** 2)
            for i in range(layers, 0, -1)
        ]
    )
    core = Dot(radius=radius, color=color)
    return VGroup(halo, core)


def pill(label: str, color: str = SKY, size: float = 22, pad_x: float = 0.28, pad_y: float = 0.14,
         fill_opacity: float = 0.14, text_color: str | None = None):
    txt = T(label, size, text_color or color, weight="MEDIUM")
    box = RoundedRectangle(
        width=txt.width + 2 * pad_x, height=txt.height + 2 * pad_y,
        corner_radius=min(0.18, (txt.height + 2 * pad_y) / 2),
        stroke_color=color, stroke_width=1.6,
    ).set_fill(color, opacity=fill_opacity)
    txt.move_to(box)
    return VGroup(box, txt)


def card(width: float, height: float, color: str = EDGE, fill: str = PANEL, radius: float = 0.16,
         stroke_width: float = 1.6):
    return RoundedRectangle(width=width, height=height, corner_radius=radius,
                            stroke_color=color, stroke_width=stroke_width).set_fill(fill, opacity=1)


def node(label: str, color: str = SKY, size: float = 24, width: float | None = None):
    """A labelled rounded card used for tools, gates, modules."""
    txt = T(label, size, TEXT, weight="MEDIUM")
    w = width or txt.width + 0.6
    box = card(w, txt.height + 0.42, color=color)
    box.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(color), 0.12), opacity=1)
    accent = Line(box.get_corner(UL) + RIGHT * 0.14, box.get_corner(UL) + RIGHT * (w - 0.14),
                  stroke_color=color, stroke_width=3)
    txt.move_to(box)
    return VGroup(box, accent, txt)


def kicker(label: str, color: str = GLOW):
    """Section label in the top-left corner, e.g. '01 · THE PROBLEM'."""
    k = T(label, 20, color, weight="SEMIBOLD")
    k.to_corner(UL, buff=0.55)
    return k


def footnote(label: str):
    f = T(label, 15, MUTED)
    f.to_corner(DOWN + RIGHT, buff=0.35)
    return f


def counter_text(value: float, fmt: str, size: float, color: str, weight: str = "BOLD"):
    return T(fmt.format(value), size, color, weight=weight, font=MONO)


# ---- Audio sync --------------------------------------------------------------------------------

def _norm(word: str) -> str:
    return re.sub(r"[^a-z0-9]", "", word.lower())


class Sync:
    """Word timings for one scene's voiceover (from tts.py)."""

    def __init__(self, sid: str):
        meta = json.loads((ROOT / "build" / "audio" / f"{sid}.json").read_text())
        self.duration: float = meta["duration"]
        self.words: list[tuple[str, float]] = [(w, t) for w, t in meta["words"]]
        self.cursor = 0

    def t(self, word: str) -> float:
        """Start time of the next occurrence of `word` at or after the cursor (prefix match)."""
        key = _norm(word)
        for i in range(self.cursor, len(self.words)):
            if self.words[i][0].startswith(key):
                self.cursor = i + 1
                return self.words[i][1]
        raise KeyError(f"cue word '{word}' not found after position {self.cursor}")


class PitchScene(MovingCameraScene):
    SID = ""
    TAIL = 0.6  # seconds of picture after the last word

    def setup(self):
        super().setup()
        self.camera.background_color = BG
        self.sync = Sync(self.SID)

    @property
    def now(self) -> float:
        return self.renderer.time

    @property
    def end(self) -> float:
        return self.sync.duration + self.TAIL

    def wait_until(self, t: float):
        dt = t - self.now
        if dt > 1 / 60:
            self.wait(dt)

    def cue(self, word: str, lead: float = 0.15) -> float:
        """Wait until just before `word` is spoken. Returns that word's time."""
        t = self.sync.t(word)
        self.wait_until(t - lead)
        return t

    def play_cue(self, word: str, *anims, run_time: float = 1.0, lead: float = 0.15, **kw):
        self.cue(word, lead)
        self.play(*anims, run_time=run_time, **kw)

    def outro(self, fade: float = 0.55):
        """Fade everything out so the scene ends exactly at voice length + tail."""
        self.wait_until(self.end - fade)
        mobs = [m for m in self.mobjects]
        if mobs:
            self.play(*[FadeOut(m) for m in mobs], run_time=fade, rate_func=smooth)
        self.wait_until(self.end)


def ring_points(n: int, radius: float, phase: float = 0.0):
    return [np.array([radius * np.cos(phase + 2 * np.pi * i / n), radius * np.sin(phase + 2 * np.pi * i / n), 0])
            for i in range(n)]


__all__ = [name for name in dir() if not name.startswith("_")] + ["Group", "UP", "DOWN", "LEFT", "RIGHT"]
