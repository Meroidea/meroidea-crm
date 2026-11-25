from manim import *

from common import *
from scene_02_solution import core_mark

TRADING = 2_729_648
EMPLOYING = 994_178


class Vision(PitchScene):
    SID = "s09"
    TAIL = 2.4  # hold the end card

    def construct(self):
        k = kicker("09 · THE OPPORTUNITY", GOLD)
        self.add(k)
        rng = np.random.default_rng(9)

        cols, rows = 64, 22
        n = cols * rows  # 1,408 dots
        per_dot = TRADING / n
        dots = VGroup(*[Dot(radius=0.045, color=MUTED, fill_opacity=0.55) for _ in range(n)])
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
        emp = VGroup(T(f"{EMPLOYING:,}", 30, MINT, weight="BOLD", font=MONO), T("employ staff", 22, MINT)).arrange(RIGHT, buff=0.2)
        emp.next_to(dots, DOWN, buff=0.22)
        self.play_cue("nearly", lit.animate.set_color(MINT).set_opacity(0.95), FadeIn(emp, shift=UP * 0.1), run_time=1.0, lead=0.2)

        # Still on the tangle: the field shivers coral.
        self.cue("tangle", lead=0.45)
        self.play(*[d.animate.shift(rng.normal(0, 0.05, 3) * [1, 1, 0]) for d in dots[::3]],
                  dots.animate.set_color(CORAL), run_time=0.6, rate_func=there_and_back)

        # Everything converges into the one platform.
        self.cue("meroidea", lead=0.3)
        core = core_mark(1.0).move_to(UP * 1.75)
        self.play(FadeOut(VGroup(big, cap, emp, src)),
                  *[d.animate.move_to(core[1].get_center() + rng.normal(0, 0.25, 3) * [1, 1, 0]).set_opacity(0) for d in dots],
                  run_time=1.3, rate_func=rate_functions.ease_in_cubic)
        self.remove(dots)
        self.play(FadeIn(core, scale=0.7), run_time=0.7)
        tagline = T("One platform for the whole business.", 32, TEXT, weight="MEDIUM").next_to(core, DOWN, buff=0.35)
        self.play(FadeIn(tagline, shift=UP * 0.15), run_time=0.5)

        chips = VGroup(pill("Built in Sydney", MINT, 22), pill("Ready to scale", SKY, 22)).arrange(RIGHT, buff=0.3)
        chips.next_to(tagline, DOWN, buff=0.4)
        self.play_cue("sydney", FadeIn(chips[0], shift=UP * 0.15), run_time=0.4, lead=0.3)
        self.play_cue("scale", FadeIn(chips[1], shift=UP * 0.15), run_time=0.4, lead=0.3)
        cta = T("Let's build it together.", 36, GOLD, weight="BOLD")
        url = T("crm.meroidea.com", 24, MUTED, font=MONO)
        VGroup(cta, url).arrange(DOWN, buff=0.18).next_to(chips, DOWN, buff=0.45)
        self.play_cue("lets", FadeIn(cta, shift=UP * 0.15), run_time=0.6, lead=0.15)
        self.play(FadeIn(url), run_time=0.5)
        self.outro(fade=0.8)
