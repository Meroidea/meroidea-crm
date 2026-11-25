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

# ---- Palette: the Meroidea website's own tokens (src/app/globals.css, docs/design-system.md) ----
BG = "#F5F7FF"          # --background
DOT = "#CFD4E6"         # --dot (website dotted grid)
PANEL = "#FFFFFF"       # --card
MUTED_BG = "#EEF1FA"    # --muted
ACCENT_BG = "#E8F1FF"   # --accent (#98BDFF 22% on white)
EDGE = "#E3E7F2"        # --border
GLOW = "#4B49AC"        # --primary
BRAND = "#4B49AC"
INFO = "#7978E9"        # --info
SKY = "#7DA0FA"         # --chart-3
SKY2 = "#98BDFF"        # --chart-2
CORAL = "#F3797E"       # --destructive / --chart-5
GOLD = "#F2C36B"        # --warning-border
MINT = "#3159C9"        # --positive-text (the palette's "good" shade)
TEXT = "#1F2937"        # --foreground
MUTED = "#5B6474"       # --muted-foreground
WARN_BG = "#FFF6E0"     # --warning

# Fills that fail AA as text get their documented readable shade when used for words.
_INK = {CORAL: "#C2383F", SKY: "#3159C9", SKY2: "#3159C9", GOLD: "#6B4200", INFO: BRAND,
        "#0866FF": "#0866FF", "#FF0069": "#C2003F", "#25D366": "#147A3B"}

FONT = "Inter"
MONO = "JetBrains Mono"

config.background_color = BG


def ink(color) -> str:
    hexv = ManimColor(color).to_hex().upper()
    return _INK.get(hexv, hexv)


def T(s: str, size: float = 32, color: str = TEXT, weight: str = "NORMAL", font: str = FONT, **kw):
    """Pango text in the site's font. Light brand colours are swapped for their readable text shade."""
    return Text(s, font=font, font_size=size, color=ink(color), weight=weight, **kw)


def mono(s: str, size: float = 24, color: str = TEXT, **kw):
    return Text(s, font=MONO, font_size=size, color=ink(color), **kw)


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
    if ManimColor(color).to_hex().upper() == GOLD and fill_opacity >= 0.1:
        fill_opacity = 1.0
        color_fill = WARN_BG
    else:
        color_fill = color
    box = RoundedRectangle(
        width=txt.width + 2 * pad_x, height=txt.height + 2 * pad_y,
        corner_radius=min(0.18, (txt.height + 2 * pad_y) / 2),
        stroke_color=color, stroke_width=1.6,
    ).set_fill(color_fill, opacity=fill_opacity)
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


# ---- Website background: dotted grid with a radial fade (src/components/layout/dot-background.tsx) ----

def background_plate(width: int = 1920, height: int = 1080) -> Path:
    """Render the site's dot grid once: 1 px #CFD4E6 dots every 20 px, masked by
    radial-gradient(ellipse at center, transparent 20%, black) of the page colour."""
    path = ROOT / "build" / f"bg_{width}x{height}.png"
    if path.exists():
        return path
    from PIL import Image

    ss = 2  # supersample for clean dots
    W, H = width * ss, height * ss
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    pitch, r = 20 * ss, 1.0 * ss
    dx = (xx % pitch) - pitch / 2 + 0.5
    dy = (yy % pitch) - pitch / 2 + 0.5
    dot = np.clip(r + 0.5 - np.sqrt(dx ** 2 + dy ** 2), 0, 1)
    # CSS "ellipse at center" defaults to farthest-corner: the corner sits at radius 1.
    nx, ny = (xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)
    rad = np.sqrt(nx ** 2 + ny ** 2) / np.sqrt(2)
    cover = np.clip((rad - 0.2) / 0.8, 0, 1)
    vis = dot * (1 - cover)
    bg = np.array([0xF5, 0xF7, 0xFF], np.float32)
    dc = np.array([0xCF, 0xD4, 0xE6], np.float32)
    img = bg[None, None, :] * (1 - vis[..., None]) + dc[None, None, :] * vis[..., None]
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img.astype(np.uint8)).resize((width, height), Image.LANCZOS).save(path)
    return path


def waves(lines: int = 32, width: float = 14.6, height: float = 3.2, opacity: float = 0.085,
          stroke: float = 3, seed: int = 4):
    """The hero's flowing lines (src/components/motion/wavy-background.tsx): chart palette, each line
    with its own amplitude, frequency and alpha, overall opacity 0.085. Returns (group, clock)."""
    from manim import ValueTracker, VMobject, always_redraw
    rng = np.random.default_rng(seed)
    palette = [BRAND, SKY2, SKY, INFO, INFO]
    pers = [dict(off=rng.uniform(0, 100), freq=rng.uniform(0.18, 0.42), amp=0.55 + rng.random() * 0.95,
                 speed=rng.uniform(0.15, 0.35) * rng.choice([-1, 1]), alpha=0.45 + rng.random() * 0.55,
                 w=stroke * (0.7 + 0.6 * rng.random())) for _ in range(lines)]
    clock = ValueTracker(0)
    xs = np.linspace(-width / 2, width / 2, 90)
    spread = height * 0.82 / lines
    amp0 = min(height * 0.12 * 3.2, 0.9)

    def build():
        t = clock.get_value()
        g = VGroup()
        for i, p in enumerate(pers):
            base = (i - (lines - 1) / 2) * spread
            edge = 0.4 + 0.6 * (1 - (np.abs(xs) / (width / 2)) ** 2)
            y = base + amp0 * p["amp"] * (np.sin(xs * p["freq"] * 2.1 + p["off"] + t * p["speed"])
                                          + 0.45 * np.sin(xs * p["freq"] * 4.8 + p["off"] * 1.7 + t * p["speed"] * 1.6)) * 0.5
            m = VMobject(stroke_color=palette[i % len(palette)], stroke_width=p["w"],
                         stroke_opacity=opacity * p["alpha"])
            m.set_points_smoothly([np.array([x, yv, 0]) for x, yv in zip(xs, y)])
            g.add(m)
        return g

    group = always_redraw(build)
    clock.add_updater(lambda m, dt: m.increment_value(dt))
    return group, clock


def logo_mark(size: float = 1.0):
    """public icon.svg: rounded tile #4B49AC→#7978E9, a white M, and a #98BDFF dot (64-unit grid)."""
    from manim import VMobject
    from manim.constants import CapStyleType, LineJointType
    u = size / 64
    tile = RoundedRectangle(width=size, height=size, corner_radius=15 * u, stroke_width=0)
    tile.set_fill(color=[BRAND, INFO], opacity=1)
    tile.set_sheen_direction(DOWN + RIGHT)
    def p(x, y):
        return np.array([(x - 32) * u, (32 - y) * u, 0])
    m = VMobject(stroke_color="#FFFFFF", stroke_width=6.5 * u * 100, joint_type=LineJointType.ROUND,
                 cap_style=CapStyleType.ROUND)
    m.set_points_as_corners([p(17, 47), p(17, 23), p(32, 38), p(47, 23), p(47, 47)])
    dot = Circle(radius=5 * u, stroke_width=0).set_fill(SKY2, 1).move_to(p(49, 13.5))
    return VGroup(tile, m, dot)


def wordmark(size: float = 1.0):
    """Header lockup: logo tile + 'Meroidea' in Inter semibold."""
    mark = logo_mark(size)
    word = T("Meroidea", 64 * size, TEXT, weight="SEMIBOLD")
    word.next_to(mark, RIGHT, buff=0.3 * size)
    return VGroup(mark, word)


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
        from manim import ImageMobject
        self.bg = ImageMobject(str(background_plate())).set(height=config.frame_height)
        self.bg.z_index = -100
        self.add(self.bg)

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
        mobs = [m for m in self.mobjects if m is not self.bg]
        if mobs:
            self.play(*[FadeOut(m) for m in mobs], run_time=fade, rate_func=smooth)
        self.wait_until(self.end)


def ring_points(n: int, radius: float, phase: float = 0.0):
    return [np.array([radius * np.cos(phase + 2 * np.pi * i / n), radius * np.sin(phase + 2 * np.pi * i / n), 0])
            for i in range(n)]


__all__ = [name for name in dir() if not name.startswith("_")] + ["Group", "UP", "DOWN", "LEFT", "RIGHT"]
