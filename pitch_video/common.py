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
    UR,
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
    ORIGIN,
    rate_functions,
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
    TAIL = 0.35  # seconds of picture after the last word
    PUSH = 0.06  # slow camera push-in across the scene (fraction of frame)
    AMBIENT = True

    def setup(self):
        super().setup()
        self.camera.background_color = BG
        self.sync = Sync(self.SID)
        from manim import ImageMobject
        # Plate is 1.3x the frame (same 20 px dot pitch) so pans and pushes never show its edge.
        self.bg = ImageMobject(str(background_plate(2496, 1404))).set(height=config.frame_height * 1.3)
        self.bg.z_index = -100
        self.add(self.bg)
        # Constant life: drifting brand particles and a slow push-in, so no frame is ever still.
        if self.AMBIENT:
            self.particles = ambient_particles()
            self.add(self.particles)
        # Camera rig: zoom and focus trackers layered on the slow push. Scenes animate
        # self.zoom / self.focus (punch-ins, pans, shakes) instead of the frame itself.
        from manim import ValueTracker
        frame = self.camera.frame
        w0 = frame.width
        total = self.sync.duration + self.TAIL
        push = self.PUSH
        self.zoom = ValueTracker(1.0)
        self.focus = Dot(radius=0.001, fill_opacity=0, stroke_width=0)
        self.add(self.zoom, self.focus)
        frame.add_updater(lambda m: m.set(width=w0 * self.zoom.get_value()
                                          * (1 - push * min(1.0, self.renderer.time / max(total, 1))))
                          .move_to(self.focus.get_center()))

    def shake(self, amp: float = 0.08, n: int = 6, run_time: float = 0.45):
        """A short camera shake (impact)."""
        from manim import Succession
        rng = np.random.default_rng(int(self.renderer.time * 1000) % 2**31)
        c = self.focus.get_center()
        steps = [self.focus.animate(run_time=run_time / (n + 1)).move_to(c + np.array([*rng.uniform(-amp, amp, 2), 0]))
                 for _ in range(n)]
        steps.append(self.focus.animate(run_time=run_time / (n + 1)).move_to(c))
        self.play(Succession(*steps))

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

    def outro(self, fade: float = 0.4, whip: bool = True):
        """Whip everything off to the left so the scene ends exactly at voice length + tail;
        the next scene's content arrives from the right, which reads as one camera move."""
        self.wait_until(self.end - fade)
        keep = {id(self.bg), id(getattr(self, "particles", None)), id(self.zoom), id(self.focus)}
        mobs = [m for m in self.mobjects if id(m) not in keep]
        if mobs:
            shift = LEFT * 3.5 if whip else ORIGIN
            self.play(*[FadeOut(m, shift=shift) for m in mobs], run_time=fade, rate_func=rate_functions.ease_in_cubic)
        self.wait_until(self.end)


# ---- Cinematic helpers ------------------------------------------------------------------------

def ambient_particles(n: int = 46, seed: int = 21):
    """Soft brand-coloured motes drifting upward and sideways, wrapping at the frame edge."""
    rng = np.random.default_rng(seed)
    cols = [BRAND, INFO, SKY, SKY2]
    g = VGroup()
    W, H = config.frame_width + 1, config.frame_height + 1
    for i in range(n):
        r = rng.uniform(0.025, 0.07)
        d = Dot(radius=r, color=cols[i % 4], fill_opacity=rng.uniform(0.12, 0.35))
        d.move_to([rng.uniform(-W / 2, W / 2), rng.uniform(-H / 2, H / 2), 0])
        d.vel = np.array([rng.uniform(-0.12, 0.12), rng.uniform(0.08, 0.3), 0])
        d.phase = rng.uniform(0, 6.28)
        g.add(d)

    def drift(group, dt):
        for d in group:
            d.phase += dt
            d.shift((d.vel + np.array([0.06 * np.sin(d.phase * 0.7), 0, 0])) * dt)
            x, y, _ = d.get_center()
            if y > H / 2:
                d.move_to([x, -H / 2, 0])
            if x > W / 2:
                d.move_to([-W / 2, y, 0])
            if x < -W / 2:
                d.move_to([W / 2, y, 0])

    g.add_updater(drift)
    g.z_index = -50
    return g


def shadow_card(width: float, height: float, color: str = EDGE, fill: str = PANEL, radius: float = 0.18,
                stroke_width: float = 1.4, depth: float = 0.07):
    """A white card with a soft drop shadow (like the site's cards). Index 0 shadow, 1 card."""
    shadow = VGroup(*[RoundedRectangle(width=width + 0.06 * i, height=height + 0.06 * i, corner_radius=radius + 0.03 * i,
                                       stroke_width=0).set_fill("#1F2937", opacity=0.022)
                      for i in range(5)])
    shadow.shift(DOWN * depth)
    c = card(width, height, color=color, fill=fill, radius=radius, stroke_width=stroke_width)
    return VGroup(shadow, c)


def ripple(point, color: str = BRAND, radius: float = 1.2):
    """An expanding ring that fades: the 'click' accent."""
    from manim import Circle as _C, AnimationGroup, GrowFromCenter
    ring = _C(radius=radius, stroke_color=color, stroke_width=4).move_to(point)
    return ring


def phone(width: float = 2.6, height: float = 5.2):
    """A minimal phone frame; index 0 body, 1 screen, 2 notch."""
    body = RoundedRectangle(width=width, height=height, corner_radius=0.38, stroke_color="#1F2937", stroke_width=3)
    body.set_fill("#FFFFFF", 1)
    screen = RoundedRectangle(width=width - 0.22, height=height - 0.22, corner_radius=0.3, stroke_width=0).set_fill(BG, 1)
    notch = RoundedRectangle(width=width * 0.32, height=0.14, corner_radius=0.07, stroke_width=0).set_fill("#1F2937", 1)
    notch.move_to(body.get_top() + DOWN * 0.22)
    return VGroup(body, screen, notch)


def laptop(width: float = 9.0, height: float = 5.4):
    """A browser-window frame like the site's product shots; index 0 window, 1 top bar, 2 dots."""
    win = shadow_card(width, height, radius=0.2)
    bar = RoundedRectangle(width=width, height=0.42, corner_radius=0.2, stroke_width=0).set_fill(MUTED_BG, 1)
    bar.align_to(win[1], UP)
    dots = VGroup(*[Dot(radius=0.055, color=c) for c in (CORAL, GOLD, SKY)]).arrange(RIGHT, buff=0.12)
    dots.move_to(bar).align_to(bar, LEFT).shift(RIGHT * 0.25)
    return VGroup(win, bar, dots)


def icon(kind: str, color: str = BRAND, s: float = 0.5):
    """Simple line icons in the spirit of Lucide (the site's icon set), built from shapes."""
    from manim import Arc, Line as L, Polygon, Rectangle as R
    sw = 3.2
    g = VGroup()
    if kind == "customers":
        g.add(Circle(radius=0.16 * s / 0.5, stroke_color=color, stroke_width=sw).shift(LEFT * 0.12 * s / 0.5 + UP * 0.1 * s / 0.5),
              Arc(radius=0.26 * s / 0.5, start_angle=0.15, angle=2.84, stroke_color=color, stroke_width=sw).shift(LEFT * 0.12 * s / 0.5 + DOWN * 0.3 * s / 0.5),
              Circle(radius=0.12 * s / 0.5, stroke_color=color, stroke_width=sw).shift(RIGHT * 0.22 * s / 0.5 + UP * 0.14 * s / 0.5))
    elif kind == "sales":
        for i, h in enumerate([0.3, 0.55, 0.8]):
            g.add(R(width=0.16 * s / 0.5, height=h * s / 0.5, stroke_color=color, stroke_width=sw)
                  .move_to(RIGHT * (i - 1) * 0.26 * s / 0.5, aligned_edge=DOWN).shift(DOWN * 0.4 * s / 0.5))
    elif kind == "staff":
        g.add(Circle(radius=0.17 * s / 0.5, stroke_color=color, stroke_width=sw).shift(UP * 0.15 * s / 0.5),
              Arc(radius=0.3 * s / 0.5, start_angle=0.2, angle=2.74, stroke_color=color, stroke_width=sw).shift(DOWN * 0.38 * s / 0.5))
    elif kind == "roster":
        box = R(width=0.8 * s / 0.5, height=0.7 * s / 0.5, stroke_color=color, stroke_width=sw)
        g.add(box, L(box.get_left() + UP * 0.15 * s / 0.5, box.get_right() + UP * 0.15 * s / 0.5, stroke_color=color, stroke_width=sw))
        for i in range(3):
            g.add(Dot(radius=0.04 * s / 0.5, color=color).move_to(box.get_center() + RIGHT * (i - 1) * 0.22 * s / 0.5 + DOWN * 0.12 * s / 0.5))
    elif kind == "payroll":
        g.add(Text("$", font=FONT, font_size=44 * s / 0.5, color=color, weight="BOLD"))
    elif kind == "invoice":
        doc = R(width=0.6 * s / 0.5, height=0.8 * s / 0.5, stroke_color=color, stroke_width=sw)
        g.add(doc, *[L(LEFT * 0.17 * s / 0.5, RIGHT * 0.17 * s / 0.5, stroke_color=color, stroke_width=sw - 0.8)
                     .shift(UP * (0.18 - 0.17 * i) * s / 0.5) for i in range(3)])
    elif kind == "books":
        g.add(Polygon(LEFT * 0.42, LEFT * 0.42 + UP * 0.5, ORIGIN + UP * 0.38, ORIGIN, stroke_color=color, stroke_width=sw).scale(s / 0.5),
              Polygon(RIGHT * 0.42, RIGHT * 0.42 + UP * 0.5, ORIGIN + UP * 0.38, ORIGIN, stroke_color=color, stroke_width=sw).scale(s / 0.5))
        g.shift(DOWN * 0.15 * s / 0.5)
    elif kind == "inbox":
        env = R(width=0.86 * s / 0.5, height=0.6 * s / 0.5, stroke_color=color, stroke_width=sw)
        g.add(env, L(env.get_corner(UL), env.get_center() + DOWN * 0.05 * s / 0.5, stroke_color=color, stroke_width=sw),
              L(env.get_corner(UR), env.get_center() + DOWN * 0.05 * s / 0.5, stroke_color=color, stroke_width=sw))
    elif kind == "bell":
        g.add(Arc(radius=0.28 * s / 0.5, start_angle=0, angle=3.1416, stroke_color=color, stroke_width=sw).shift(UP * 0.05 * s / 0.5),
              L(LEFT * 0.34 * s / 0.5 + DOWN * 0.2 * s / 0.5, RIGHT * 0.34 * s / 0.5 + DOWN * 0.2 * s / 0.5, stroke_color=color, stroke_width=sw),
              L(LEFT * 0.28 * s / 0.5 + UP * 0.05 * s / 0.5, LEFT * 0.3 * s / 0.5 + DOWN * 0.2 * s / 0.5, stroke_color=color, stroke_width=sw),
              L(RIGHT * 0.28 * s / 0.5 + UP * 0.05 * s / 0.5, RIGHT * 0.3 * s / 0.5 + DOWN * 0.2 * s / 0.5, stroke_color=color, stroke_width=sw),
              Dot(radius=0.06 * s / 0.5, color=color).shift(DOWN * 0.32 * s / 0.5))
    elif kind == "check":
        from manim import VMobject
        m = VMobject(stroke_color=color, stroke_width=sw + 1)
        m.set_points_as_corners([LEFT * 0.3 + UP * 0.02, LEFT * 0.08 + DOWN * 0.22, RIGHT * 0.32 + UP * 0.26])
        g.add(m.scale(s / 0.5))
    elif kind == "clock":
        c = Circle(radius=0.36 * s / 0.5, stroke_color=color, stroke_width=sw)
        g.add(c, L(ORIGIN, UP * 0.22 * s / 0.5, stroke_color=color, stroke_width=sw),
              L(ORIGIN, RIGHT * 0.16 * s / 0.5, stroke_color=color, stroke_width=sw))
    return g


def tile(kind: str, label: str, color: str = BRAND, w: float = 1.9, h: float = 1.55):
    """App-launcher tile: shadow card, tinted icon chip, label."""
    sc = shadow_card(w, h, radius=0.2)
    chip = RoundedRectangle(width=0.78, height=0.78, corner_radius=0.2, stroke_width=0)
    chip.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(color), 0.14), 1)
    ic = icon(kind, ink(color), 0.3).move_to(chip)
    lab = T(label, 19, TEXT, weight="SEMIBOLD")
    VGroup(VGroup(chip, ic), lab).arrange(DOWN, buff=0.18).move_to(sc[1])
    return VGroup(sc, VGroup(chip, ic), lab)


def badge_count(n: int, color: str = CORAL):
    c = Circle(radius=0.26, stroke_width=0).set_fill(color, 1)
    t = Text(str(n), font=FONT, font_size=22, color="#FFFFFF", weight="BOLD").move_to(c)
    return VGroup(c, t)


def ring_points(n: int, radius: float, phase: float = 0.0):
    return [np.array([radius * np.cos(phase + 2 * np.pi * i / n), radius * np.sin(phase + 2 * np.pi * i / n), 0])
            for i in range(n)]


__all__ = [name for name in dir() if not name.startswith("_")] + ["Group", "UP", "DOWN", "LEFT", "RIGHT"]
