from manim import *

from reel_common import *
from scene_02_solution import core_mark


class Reveal(ReelScene):
    SID = "r03"

    def construct(self):
        rng = np.random.default_rng(6)
        shards = VGroup()
        for i in range(18):
            m = RoundedRectangle(width=rng.uniform(0.5, 1.4), height=rng.uniform(0.3, 0.9), corner_radius=0.12, stroke_width=0)
            m.set_fill(interpolate_color(ManimColor(PANEL), ManimColor([CORAL, SKY2, INFO, GOLD][i % 4]), 0.5), 1)
            m.move_to([rng.uniform(-3.6, 3.6), rng.uniform(-3, 6), 0]).rotate(rng.uniform(-0.6, 0.6))
            shards.add(m)
        self.add(shards)
        core = core_mark(1.35).move_to(VIS_CENTER + UP * 0.5)
        self.cue("meet", lead=0.05)
        self.sfx("whoosh", -5)
        self.play(*[m.animate.move_to(core[1].get_center()).scale(0.05).rotate(rng.uniform(2, 5)) for m in shards],
                  run_time=0.45, rate_func=rate_functions.ease_in_cubic)
        self.remove(shards)
        self.sfx("impact", 0)
        self.sfx("sparkle", -5)
        self.play(FadeIn(core, scale=0.4), run_time=0.35, rate_func=rate_functions.ease_out_back)
        rings = VGroup(*[Circle(radius=1.0, stroke_color=c, stroke_width=6).move_to(core[1]) for c in (BRAND, INFO, SKY2)])
        self.play(LaggedStart(*[r.animate.scale(4.5).set_stroke(opacity=0) for r in rings], lag_ratio=0.12), run_time=0.55)
        self.remove(rings)

        line1 = heavy("ONE WORKSPACE", 78, BRAND)
        line1[1].set_color_by_gradient(BRAND, INFO)
        line2 = heavy("for your entire business", 46, TEXT, sw=8)
        tag = VGroup(line1, line2).arrange(DOWN, buff=0.15).next_to(core, DOWN, buff=0.5)
        if tag.width > 7.2:
            tag.scale_to_fit_width(7.2)
        self.cue("one", lead=0.2)
        self.sfx("swish", -7)
        self.play(FadeIn(line1, shift=UP * 0.3, scale=1.1), run_time=0.3, rate_func=rate_functions.ease_out_back)
        self.play(FadeIn(line2, shift=UP * 0.2), run_time=0.3)
        self.outro()
