from manim import *

from common import *
from scene_02_solution import core_mark

TRADING = 2_729_648
EMPLOYING = 994_178


class Vision(PitchScene):
    SID = "s09"
    TAIL = 2.4  # hold the end card

    def construct(self):
        k = kicker("09 · THE OPPORTUNITY")
        self.add(k)
        rng = np.random.default_rng(9)

        cols, rows = 64, 22
        n = cols * rows  # 1,408 dots
        per_dot = TRADING / n
        dots = VGroup(*[Dot(radius=0.045, color="#B9C0D8", fill_opacity=1) for _ in range(n)])
        dots.arrange_in_grid(rows=rows, cols=cols, buff=0.115).move_to(DOWN * 0.42)

        count = ValueTracker(0)
        big = always_redraw(lambda: T(f"{int(count.get_value()):,}", 54, TEXT, weight="BOLD", font=MONO)
                            .to_edge(UP, buff=0.95))
        cap = T("actively trading businesses in Australia", 24, MUTED).next_to(big, DOWN, buff=0.12)
        src = footnote(f"ABS, Counts of Australian Businesses, 30 June 2025 · 1 dot ≈ {per_dot:,.0f} businesses")

        self.cue("australia", lead=0.1)
        self.add(big, src)
        self.play(LaggedStart(*[FadeIn(d) for d in dots], lag_ratio=0.0015), count.animate.set_value(TRADING),
                  FadeIn(cap), run_time=2.4, rate_func=smooth)

        lit_n = round(EMPLOYING / per_dot)
        idx = rng.permutation(n)[:lit_n]
        lit = VGroup(*[dots[i] for i in idx])
        emp = VGroup(T(f"{EMPLOYING:,}", 30, BRAND, weight="BOLD", font=MONO), T("employ staff", 22, BRAND)).arrange(RIGHT, buff=0.2)
        emp.next_to(dots, DOWN, buff=0.22)
        self.play_cue("nearly", lit.animate.set_color(BRAND).set_opacity(1), FadeIn(emp, shift=UP * 0.1), run_time=1.0, lead=0.2)

        # Still on the tangle: the field shivers coral.
        self.cue("tangle", lead=0.45)
        self.play(*[d.animate.shift(rng.normal(0, 0.05, 3) * [1, 1, 0]) for d in dots[::3]],
                  dots.animate.set_color(CORAL), run_time=0.6, rate_func=there_and_back)

        # Everything converges into the one platform.
        self.cue("meroidea", lead=0.3)
        core = core_mark(0.8).move_to(UP * 1.95)
        self.play(FadeOut(VGroup(big, cap, emp, src)),
                  *[d.animate.move_to(core[1].get_center() + rng.normal(0, 0.25, 3) * [1, 1, 0]).set_opacity(0) for d in dots],
                  run_time=1.3, rate_func=rate_functions.ease_in_cubic)
        self.remove(dots)
        self.play(FadeIn(core, scale=0.7), run_time=0.7)
        # The website's own hero line: "One workspace to / run your business", gradient + underline.
        l1 = T("One workspace to", 40, TEXT, weight="SEMIBOLD")
        l2 = T("run your business", 40, BRAND, weight="SEMIBOLD")
        l2.set_color_by_gradient(BRAND, INFO, BRAND)
        tagline = VGroup(l1, l2).arrange(DOWN, buff=0.12).next_to(core, DOWN, buff=0.3)
        w = l2.width
        under = CubicBezier(l2.get_corner(DL) + DOWN * 0.1, l2.get_corner(DL) + RIGHT * w * 0.3 + DOWN * 0.03,
                            l2.get_corner(DL) + RIGHT * w * 0.7 + DOWN * 0.13, l2.get_corner(DR) + DOWN * 0.04,
                            stroke_color=SKY2, stroke_width=5)
        wv, wclock = waves(height=3.6)
        wv.move_to(tagline.get_center())
        self.add(wclock)
        self.bring_to_back(wv)
        self.bring_to_back(self.bg)
        self.play(FadeIn(wv), FadeIn(tagline, shift=UP * 0.15), run_time=0.6)
        self.play(Create(under), run_time=0.5)

        chips = VGroup(pill("Built in Sydney", MINT, 22), pill("Ready to scale", SKY, 22)).arrange(RIGHT, buff=0.3)
        chips.next_to(tagline, DOWN, buff=0.4)
        self.play_cue("sydney", FadeIn(chips[0], shift=UP * 0.15), run_time=0.4, lead=0.3)
        self.play_cue("scale", FadeIn(chips[1], shift=UP * 0.15), run_time=0.4, lead=0.3)
        cta = T("Let's build it together.", 34, BRAND, weight="BOLD")
        url = T("crm.meroidea.com", 24, MUTED, font=MONO)
        VGroup(cta, url).arrange(DOWN, buff=0.15).next_to(chips, DOWN, buff=0.35)
        self.play_cue("lets", FadeIn(cta, shift=UP * 0.15), run_time=0.6, lead=0.15)
        self.play(FadeIn(url), run_time=0.5)
        self.outro(fade=0.8)
