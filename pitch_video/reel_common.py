"""Vertical (9:16) framework: frame geometry, platform safe zones and burned-in captions.

Frame is 8 x 14.22 units at 1080 x 1920 px: the same 135 px per unit as the 16:9 film, so every
shared component keeps its size.

Safe zones (TikTok / Reels / Facebook Reels overlays): keep key content out of the top ~10%
(y > 5.6), the bottom ~25% (y < -3.55) and the right-hand action column (x > 2.9, lower half).
"""

from __future__ import annotations

import re

from manim import (
    DOWN, LEFT, RIGHT, UP, HEAVY, ORIGIN, RoundedRectangle, Text, VGroup, config, Polygon, Circle, Line,
)

config.frame_width = 8.0
config.frame_height = 8.0 * 1920 / 1080

from common import *  # noqa: E402,F401
from common import BG, BRAND, INFO, TEXT, PitchScene, ink  # noqa: E402

CAPTION_Y = -2.85     # above the bottom overlay
CAPTION_X = -0.2      # nudged left of the action column
VIS_CENTER = UP * 1.85  # middle of the visual zone (y -1.9 .. 5.6)
TITLE_Y = 4.6


def heavy(text: str, size: float, color: str = TEXT, stroke: str = "#FFFFFF", sw: float = 10):
    """Big display type: Inter Heavy with a white keyline."""
    t = Text(text, font="Inter", weight=HEAVY, font_size=size, color=ink(color))
    back = t.copy().set_stroke(stroke, width=sw).set_fill(opacity=0)
    return VGroup(back, t)


def pin(color: str = BRAND, s: float = 1.0):
    """A map pin."""
    head = Circle(radius=0.32 * s, stroke_width=0).set_fill(color, 1)
    tip = Polygon(LEFT * 0.27 * s, RIGHT * 0.27 * s, DOWN * 0.62 * s, stroke_width=0).set_fill(color, 1)
    tip.next_to(head, DOWN, buff=-0.2 * s)
    hole = Circle(radius=0.12 * s, stroke_width=0).set_fill("#FFFFFF", 1).move_to(head)
    return VGroup(tip, head, hole)


def shield(color: str = BRAND, s: float = 1.0):
    from manim import VMobject
    import numpy as np
    pts = [np.array(p) * s for p in [(-1, 0.9, 0), (0, 1.25, 0), (1, 0.9, 0), (0.95, -0.1, 0), (0.6, -0.8, 0), (0, -1.3, 0),
                                       (-0.6, -0.8, 0), (-0.95, -0.1, 0), (-1, 0.9, 0)]]
    m = VMobject(stroke_color=color, stroke_width=8).set_fill(color, 0.12)
    m.set_points_smoothly(pts)
    return m


class ReelScene(PitchScene):
    """PitchScene plus a burned-in, word-highlighted caption track."""

    CAPTIONS = True
    PUSH = 0.05

    def setup(self):
        super().setup()
        self.captions_on = self.CAPTIONS
        if self.CAPTIONS:
            self._build_captions()

    def _build_captions(self):
        from script_reel import SCENES
        text = next(s["text"] for s in SCENES if s["id"] == self.SID)
        written = text.split()
        times = [t for _, t in self.sync.words]
        if len(written) != len(times):  # fall back to the recognised tokens
            written = [r.strip() for r in self.sync.raw]
        # Phrases: up to 3 words, breaking after punctuation.
        phrases, cur = [], []
        for w, t in zip(written, times):
            cur.append((w, t))
            if len(cur) == 3 or re.search(r"[.,?!:;]$", w):
                phrases.append(cur)
                cur = []
        if cur:
            phrases.append(cur)
        self._phrases = []
        for i, ph in enumerate(phrases):
            start = ph[0][1] - 0.05
            end = phrases[i + 1][0][1] - 0.05 if i + 1 < len(phrases) else self.sync.duration + 0.3
            words = VGroup()
            for w, _ in ph:
                clean = w.strip(",.")
                dark = Text(clean, font="Inter", weight=HEAVY, font_size=60, color=TEXT)
                light = Text(clean, font="Inter", weight=HEAVY, font_size=60, color="#FFFFFF")
                keyline = dark.copy().set_stroke("#FFFFFF", width=12).set_fill(opacity=0)
                pill_ = RoundedRectangle(width=dark.width + 0.34, height=dark.height + 0.3, corner_radius=0.16,
                                         stroke_width=0).set_fill(BRAND, 1)
                g = VGroup(pill_, keyline, dark, light)
                for m in (pill_, light, keyline, dark):
                    m.move_to(dark)
                words.add(g)
            words.arrange(RIGHT, buff=0.24)
            if words.width > 7.0:
                words.scale_to_fit_width(7.0)
            words.move_to([CAPTION_X, CAPTION_Y, 0])
            self._phrases.append({"start": start, "end": end, "words": words, "times": [t for _, t in ph]})
        from manim import always_redraw

        def build():
            t = self.now
            current = None
            if self.captions_on:
                for ph in self._phrases:
                    if ph["start"] <= t < ph["end"]:
                        current = ph
                        break
            if current is None:
                return VGroup()
            out = VGroup()
            g = current["words"]
            for k, wg in enumerate(g):
                active = current["times"][k] - 0.03 <= t and (k + 1 == len(g) or t < current["times"][k + 1] - 0.03)
                spoken = t >= current["times"][k] - 0.03
                if active:
                    out.add(wg[0].copy(), wg[3].copy())
                else:
                    kl, dk = wg[1].copy(), wg[2].copy()
                    if not spoken:
                        dk.set_opacity(0.35)
                    out.add(kl, dk)
            age = t - current["start"]
            out.scale(1 + 0.18 * max(0.0, 1 - age / 0.12), about_point=g.get_center())
            return out

        self.caption_box = always_redraw(build)
        self.caption_box.z_index = 200
        self.add(self.caption_box)

    def outro(self, fade: float = 0.35, whip: bool = True):
        keep = {id(self.bg), id(getattr(self, "particles", None)), id(self.zoom), id(self.focus),
                id(getattr(self, "caption_box", None))}
        self.wait_until(self.end - fade)
        mobs = [m for m in self.mobjects if id(m) not in keep]
        if mobs:
            if whip:
                self.sfx("whoosh", -7)
            from manim import FadeOut, rate_functions
            shift = UP * 3.0 if whip else ORIGIN
            self.play(*[FadeOut(m, shift=shift) for m in mobs], run_time=fade, rate_func=rate_functions.ease_in_cubic)
        self.wait_until(self.end)
