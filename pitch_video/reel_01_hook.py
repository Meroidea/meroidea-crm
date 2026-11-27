from manim import *

from reel_common import *

APPS = [("inbox", CORAL), ("roster", SKY), ("sales", BRAND), ("payroll", INFO), ("invoice", SKY2),
        ("customers", CORAL), ("books", BRAND), ("clock", SKY), ("staff", INFO)]


def app_icon(kind, color, s=1.25):
    sq = RoundedRectangle(width=s, height=s, corner_radius=s * 0.24, stroke_width=0)
    sq.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(color), 0.3), 1)
    ic = icon(kind, ink(color), 0.45).move_to(sq)
    shadow = sq.copy().set_fill("#1F2937", 0.07).shift(DOWN * 0.07)
    return VGroup(shadow, sq, ic)


class Hook(ReelScene):
    SID = "r01"

    def construct(self):
        rng = np.random.default_rng(4)
        icons = VGroup(*[app_icon(k, c) for k, c in APPS]).arrange_in_grid(3, 3, buff=0.48).move_to(UP * 0.5)
        badges = VGroup(*[badge_count(int(n)).scale(0.95).move_to(ic[1].get_corner(UR) + LEFT * 0.08 + DOWN * 0.08)
                          for ic, n in zip(icons, rng.integers(2, 48, 9))])
        self.sfx_seq("pop", 9, 0.05, -9)
        self.play(LaggedStart(*[FadeIn(i, scale=0.4) for i in icons], lag_ratio=0.06,
                              rate_func=rate_functions.ease_out_back), run_time=0.6)
        self.sfx_seq("tick", 9, 0.04, -10)
        self.play(LaggedStart(*[GrowFromCenter(b) for b in badges], lag_ratio=0.05), run_time=0.45)

        title = heavy("TOO MANY", 80, TEXT)
        title2 = heavy("APPS?", 108, CORAL)
        head = VGroup(title, title2).arrange(DOWN, buff=0.05).move_to(UP * TITLE_Y)
        self.cue("too", lead=0.1)
        self.sfx("impact", -4)
        self.play(FadeIn(head, scale=1.5), run_time=0.25, rate_func=rate_functions.ease_out_back)
        self.shake(0.07, 5, 0.3, gain=-8)

        # None of them talk to each other: wires tangle, links break.
        self.cue("none", lead=0.2)
        wires = VGroup()
        for _ in range(14):
            a, b = rng.choice(9, 2, replace=False)
            p, q = icons[a][1].get_center(), icons[b][1].get_center()
            wires.add(CubicBezier(p, p + [rng.uniform(-2, 2), rng.uniform(-2, 2), 0], q + [rng.uniform(-2, 2), rng.uniform(-2, 2), 0], q,
                                  stroke_color=CORAL, stroke_width=4, stroke_opacity=0.75))
        wires.z_index = -1
        self.sfx("whoosh", -9)
        self.play(LaggedStart(*[Create(w) for w in wires], lag_ratio=0.04), run_time=0.6)
        crosses = VGroup(*[VGroup(Line(UL * 0.18, DR * 0.18, stroke_width=7, color=CORAL), Line(UR * 0.18, DL * 0.18, stroke_width=7, color=CORAL))
                           .move_to(w.point_from_proportion(0.5)) for w in wires[:6]])
        self.sfx_seq("tick", 6, 0.06, -5)
        self.play(LaggedStart(*[GrowFromCenter(c) for c in crosses], lag_ratio=0.1), *[Wiggle(i, scale_value=1.05) for i in icons],
                  run_time=0.7)
        self.outro()
