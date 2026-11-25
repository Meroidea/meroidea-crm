from manim import *

from common import *
from scene_02_solution import core_mark

TRADING = 2_729_648


class Close(PitchScene):
    SID = "s10"
    TAIL = 2.6  # hold the end card
    PUSH = 0.03

    def construct(self):
        rng = np.random.default_rng(9)
        cols, rows = 64, 22
        n = cols * rows
        per_dot = TRADING / n
        dots = VGroup(*[Dot(radius=0.045, color="#B9C0D8", fill_opacity=1) for _ in range(n)])
        dots.arrange_in_grid(rows=rows, cols=cols, buff=0.115).move_to(DOWN * 0.42)
        count = ValueTracker(0)
        big = always_redraw(lambda: T(f"{int(count.get_value()):,}", 60, TEXT, weight="BOLD", font=MONO).to_edge(UP, buff=0.7))
        cap = T("businesses in Australia", 24, MUTED).next_to(big, DOWN, buff=0.1)
        src = footnote(f"ABS, Counts of Australian Businesses, 30 June 2025 · 1 dot ≈ {per_dot:,.0f} businesses")

        self.cue("australia", lead=0.1)
        self.add(big, src)
        self.play(LaggedStart(*[FadeIn(d, scale=0.2) for d in dots], lag_ratio=0.0008), count.animate.set_value(TRADING),
                  FadeIn(cap), run_time=1.8, rate_func=smooth)

        # Buried in the pile: the field turns coral and collapses into a heap.
        self.cue("buried", lead=0.3)
        heap = [np.array([rng.normal(0, 1.6), -3.0 + abs(rng.normal(0, 0.5)) + rng.uniform(0, 0.9), 0]) for _ in range(n)]
        self.play(*[d.animate.move_to(p).set_color(CORAL) for d, p in zip(dots, heap)], run_time=0.8,
                  rate_func=rate_functions.ease_in_quad)
        self.shake(0.06, 4, 0.25)

        # Meroidea: the heap streams up into the logo.
        self.cue("meroidea", lead=0.3)
        core = core_mark(0.8).move_to(UP * 1.95)
        self.play(FadeOut(VGroup(big, cap, src)),
                  *[d.animate.move_to(core[1].get_center() + rng.normal(0, 0.15, 3) * [1, 1, 0]).set_color(BRAND).set_opacity(0)
                    for d in dots], run_time=0.8, rate_func=rate_functions.ease_in_cubic)
        self.remove(dots)
        self.play(FadeIn(core, scale=0.5), run_time=0.35, rate_func=rate_functions.ease_out_back)
        burst = VGroup(*[Circle(radius=0.8, stroke_color=c, stroke_width=4).move_to(core[1]) for c in (BRAND, INFO, SKY2)])
        self.play(LaggedStart(*[r.animate.scale(4).set_stroke(opacity=0) for r in burst], lag_ratio=0.12), run_time=0.6)
        self.remove(burst)

        # The website's hero line, gradient + hand-drawn underline, over its waves.
        self.cue("workspace", lead=0.4)
        l1 = T("One workspace to", 44, TEXT, weight="SEMIBOLD")
        l2 = T("run your business", 44, BRAND, weight="SEMIBOLD")
        l2.set_color_by_gradient(BRAND, INFO, BRAND)
        tagline = VGroup(l1, l2).arrange(DOWN, buff=0.12).next_to(core, DOWN, buff=0.3)
        w = l2.width
        under = CubicBezier(l2.get_corner(DL) + DOWN * 0.1, l2.get_corner(DL) + RIGHT * w * 0.3 + DOWN * 0.03,
                            l2.get_corner(DL) + RIGHT * w * 0.7 + DOWN * 0.13, l2.get_corner(DR) + DOWN * 0.04,
                            stroke_color=SKY2, stroke_width=6)
        wv, wclock = waves(height=3.8)
        wv.move_to(tagline.get_center())
        self.add(wclock)
        self.bring_to_back(wv)
        self.bring_to_back(self.bg)
        self.play(FadeIn(wv), FadeIn(l1, shift=UP * 0.2), run_time=0.35)
        self.play(FadeIn(l2, shift=UP * 0.2), run_time=0.35)
        self.play(Create(under), run_time=0.45)

        chips = VGroup(pill("Built in Sydney", BRAND, 22), pill("Ready to scale", INFO, 22)).arrange(RIGHT, buff=0.3)
        chips.next_to(tagline, DOWN, buff=0.45)
        self.play_cue("sydney", FadeIn(chips[0], shift=UP * 0.2, scale=0.9), run_time=0.3, lead=0.3)
        self.play_cue("scale", FadeIn(chips[1], shift=UP * 0.2, scale=0.9), run_time=0.3, lead=0.3)
        url = T("crm.meroidea.com", 26, BRAND, weight="SEMIBOLD", font=MONO).next_to(chips, DOWN, buff=0.4)
        self.play(FadeIn(url, shift=UP * 0.15), run_time=0.4)
        self.outro(fade=0.9, whip=False)
