"""YouTube thumbnails (1280x720 final). Rendered large with Manim, then downscaled for crisp edges.

    ../.venv-video/bin/manim -s -r 2560,1440 --media_dir build/media thumbnail.py ThumbA ThumbB
"""

from manim import *

from common import *
from scene_02_solution import core_mark


def heavy(text: str, size: float, color: str, stroke: str = "#FFFFFF", sw: float = 10):
    """Big thumbnail type: Inter Black with a white keyline so it reads on any background."""
    t = Text(text, font="Inter", weight=HEAVY, font_size=size, color=ink(color))
    back = t.copy().set_stroke(stroke, width=sw).set_fill(opacity=0)
    return VGroup(back, t)


def chat(text, color, w=3.2):
    t = T(text, 22, TEXT, weight="MEDIUM")
    box = RoundedRectangle(width=max(w, t.width + 0.5), height=0.62, corner_radius=0.28, stroke_width=0)
    box.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(color), 0.45), 1)
    return VGroup(box, t.move_to(box))


class ThumbBase(Scene):
    def setup(self):
        self.camera.background_color = BG
        bg = ImageMobject(str(background_plate(2560, 1440))).set(height=config.frame_height)
        self.add(bg)


class ThumbA(ThumbBase):
    """Before → after: chaos on the left, one calm workspace on the right."""

    def construct(self):
        rng = np.random.default_rng(3)
        # Left panel: warm chaos.
        left = Polygon([-7.2, 4.1, 0], [0.6, 4.1, 0], [-0.6, -4.1, 0], [-7.2, -4.1, 0], stroke_width=0)
        left.set_fill(interpolate_color(ManimColor(BG), ManimColor(CORAL), 0.16), 1)
        self.add(left)
        msgs = [("Where's my order?", SKY2), ("Table for 6?", INFO), ("Can I swap shifts?", CORAL), ("Invoice please", SKY),
                ("Quote for 40?", SKY2), ("Are you open?", INFO)]
        chats = VGroup()
        for i, (m, c) in enumerate(msgs):
            b = chat(m, c, 2.6).rotate(rng.uniform(-0.18, 0.18))
            b.move_to([rng.uniform(-6.0, -2.6), -2.9 + i * 0.62, 0])
            chats.add(b)
        sheet = shadow_card(3.0, 1.9, radius=0.12).rotate(0.12).move_to([-3.5, -1.35, 0])
        refs = VGroup(*[T("#REF!", 22, CORAL, weight="BOLD", font=MONO) for _ in range(3)]).arrange(DOWN, buff=0.12)
        refs.move_to(sheet[1]).rotate(0.12)
        inv = shadow_card(2.4, 2.8, radius=0.12).rotate(-0.16).move_to([-5.3, -0.5, 0])
        stamp = VGroup(RoundedRectangle(width=2.3, height=0.72, corner_radius=0.08, stroke_color=CORAL, stroke_width=9),
                       Text("NOT SENT", font="Inter", weight=HEAVY, font_size=34, color=ink(CORAL))).rotate(0.28).move_to(inv[1])
        notes = VGroup(*[Square(0.75, stroke_width=0).set_fill(GOLD if k % 2 else "#FFE7A6", 1).rotate(rng.uniform(-0.5, 0.5))
                         .move_to(p) for k, p in enumerate([[-6.6, 0.9, 0], [-1.8, -3.4, 0], [-1.4, 0.1, 0], [-6.5, -3.5, 0]])])
        badge = badge_count(40).scale(2.0).move_to([-1.6, 1.15, 0])
        self.add(notes, inv, stamp, sheet, refs, chats, badge)

        # Right panel: the calm workspace.
        win = laptop(6.0, 4.3).move_to([3.7, -1.0, 0])
        mark = wordmark(0.3).move_to(win[1]).align_to(win[1], LEFT).shift(RIGHT * 0.75)
        specs = [("inbox", "Inbox", CORAL), ("sales", "Sales", BRAND), ("roster", "Rosters", SKY),
                 ("payroll", "Payroll", BRAND), ("invoice", "Invoices", INFO), ("books", "Books", SKY)]
        tiles = VGroup(*[tile(k, l, c, w=1.7, h=1.55) for k, l, c in specs]).arrange_in_grid(2, 3, buff=0.22)
        tiles.move_to(win[0][1]).shift(DOWN * 0.2)
        self.add(win, mark, tiles)
        ok = VGroup(Circle(radius=0.42, stroke_width=0).set_fill(MINT, 1), icon("check", "#FFFFFF", 0.5))
        ok[1].move_to(ok[0])
        ok.move_to(win[0][1].get_corner(UR) + LEFT * 0.05 + UP * 0.05)
        self.add(ok)

        # Arrow across the split.
        arrow = Arrow([-1.0, -0.9, 0], [0.55, -0.9, 0], buff=0, stroke_width=22, color=BRAND,
                      max_tip_length_to_length_ratio=0.5, max_stroke_width_to_length_ratio=20)
        self.add(arrow)

        # Headline.
        h1 = heavy("STOP THE", 112, TEXT)
        h2 = heavy("CHAOS", 150, BRAND)
        h2[1].set_color_by_gradient(BRAND, INFO)
        head = VGroup(h1, h2).arrange(RIGHT, buff=0.3, aligned_edge=DOWN)
        head.scale_to_fit_width(13.2).to_edge(UP, buff=0.32)
        self.add(head)


class ThumbB(ThumbBase):
    """Everything in one: logo at the centre, modules orbiting it."""

    def construct(self):
        wv, _ = waves(height=4.6, opacity=0.16, stroke=4)
        wv.move_to(DOWN * 0.8)
        self.add(wv)
        core = core_mark(1.05).move_to(LEFT * 3.9 + DOWN * 0.35)
        core.remove(core[3])  # no small wordmark; the headline carries the name
        self.add(core)
        specs = [("inbox", "Inbox", CORAL), ("sales", "Sales", BRAND), ("roster", "Rosters", SKY), ("payroll", "Payroll", BRAND),
                 ("invoice", "Invoices", INFO), ("books", "Books", SKY), ("customers", "Customers", INFO), ("staff", "Staff", SKY)]
        centre = core[1].get_center()
        orbit = DashedVMobject(Ellipse(width=5.6, height=5.0, stroke_color=BRAND, stroke_width=3), num_dashes=60).move_to(centre)
        orbit.set_stroke(opacity=0.35)
        self.add(orbit)
        for i, (k, l, c) in enumerate(specs):
            a = PI / 2 + i * TAU / len(specs)
            chip = shadow_card(1.08, 1.08, radius=0.26, depth=0.05)
            ic = icon(k, ink(c), 0.33).move_to(chip[1])
            g = VGroup(chip, ic).move_to(centre + np.array([2.8 * np.cos(a), 2.5 * np.sin(a), 0]))
            self.add(g)
        h1 = heavy("ALL-IN-ONE", 128, BRAND)
        h1[1].set_color_by_gradient(BRAND, INFO)
        h2 = heavy("business app", 74, TEXT, sw=8)
        h3 = T("Customers · Rosters · Payroll · Invoices · Books", 30, MUTED, weight="SEMIBOLD")
        right = VGroup(h1, h2, h3).arrange(DOWN, aligned_edge=LEFT, buff=0.25)
        right.scale_to_fit_width(6.3)
        right.move_to(RIGHT * 3.45 + DOWN * 0.15)
        brand = wordmark(0.42).next_to(right, UP, buff=0.5).align_to(right, LEFT)
        self.add(right, brand)
