from manim import *

from reel_common import *
from scene_02_solution import core_mark


class Close(ReelScene):
    SID = "r06"
    TAIL = 2.6  # hold the end card

    def construct(self):
        sh = shield(BRAND, 1.55).move_to(VIS_CENTER + UP * 1.3)
        lock_body = RoundedRectangle(width=0.9, height=0.7, corner_radius=0.12, stroke_width=0).set_fill(BRAND, 1)
        lock_arc = Arc(radius=0.3, start_angle=0, angle=PI, stroke_color=BRAND, stroke_width=10)
        lock_arc.next_to(lock_body, UP, buff=-0.02)
        lock = VGroup(lock_arc, lock_body).move_to(sh).shift(DOWN * 0.05)
        p = pin(CORAL, 0.8).next_to(sh, RIGHT, buff=0.35).shift(UP * 0.6)
        syd = T("Sydney", 22, TEXT, weight="BOLD").next_to(p, DOWN, buff=0.12)
        self.cue("data", lead=0.2)
        self.sfx("swish", -6)
        self.play(DrawBorderThenFill(sh), run_time=0.45)
        self.sfx("pop", -5)
        self.play(FadeIn(p, shift=DOWN * 0.6), FadeIn(syd), run_time=0.3, rate_func=rate_functions.ease_out_bounce)
        self.cue("sealed", lead=0.2)
        lock_arc.shift(UP * 0.25)
        self.play(FadeIn(lock, scale=0.6), run_time=0.2)
        self.sfx("click", 0)
        self.sfx("impact", -10)
        self.play(lock_arc.animate.shift(DOWN * 0.25), sh.animate.set_fill(BRAND, 0.22), run_time=0.15)

        # Every change recorded.
        self.cue("every", lead=0.2)
        log = VGroup(*[VGroup(Dot(radius=0.07, color=c), T(t, 19, TEXT), T(tm, 16, MUTED, font=MONO)).arrange(RIGHT, buff=0.2)
                       for c, t, tm in ((BRAND, "Sam moved a deal", "09:41"), (INFO, "Priya sent INV-0142", "09:43"),
                                        (SKY, "Jo approved a timesheet", "09:47"))]).arrange(DOWN, aligned_edge=LEFT, buff=0.18)
        log.next_to(sh, DOWN, buff=0.45)
        self.sfx_seq("tick", 3, 0.15, -6)
        self.play(LaggedStart(*[FadeIn(r, shift=DOWN * 0.3) for r in log], lag_ratio=0.25), run_time=0.6)

        # We set it up with you.
        self.cue("we", lead=0.25)
        self.sfx("whoosh", -8)
        g = VGroup(sh, lock, p, syd, log)
        self.play(g.animate.scale(0.6).set_opacity(0).shift(UP * 2), run_time=0.35)
        self.remove(g)
        card = shadow_card(6.4, 2.0, color=BRAND, radius=0.26, stroke_width=2.5).move_to(VIS_CENTER + UP * 0.4)
        cal = icon("roster", BRAND, 0.55)
        ct = VGroup(T("Set up with you", 32, TEXT, weight="BOLD"), T("Your stages, fields and team, ready on day one", 17, MUTED))
        ct.arrange(DOWN, aligned_edge=LEFT, buff=0.08)
        VGroup(cal, ct).arrange(RIGHT, buff=0.35).move_to(card[1])
        self.sfx("pop", -4)
        self.play(FadeIn(VGroup(card, cal, ct), scale=0.85), run_time=0.3, rate_func=rate_functions.ease_out_back)

        # End card.
        self.cue("meroidea", lead=0.3)
        self.captions_on = False
        self.play(FadeOut(VGroup(card, cal, ct), shift=UP * 1.5), run_time=0.25)
        core = core_mark(1.25).move_to(UP * 3.4)
        self.sfx("impact", 0)
        self.sfx("sparkle", -4)
        self.play(FadeIn(core, scale=0.4), run_time=0.3, rate_func=rate_functions.ease_out_back)
        rings = VGroup(*[Circle(radius=1.0, stroke_color=c, stroke_width=6).move_to(core[1]) for c in (BRAND, INFO, SKY2)])
        self.play(LaggedStart(*[r.animate.scale(4).set_stroke(opacity=0) for r in rings], lag_ratio=0.12), run_time=0.5)
        self.remove(rings)
        l1 = heavy("One workspace to", 58, TEXT, sw=8)
        l2 = heavy("run your business", 66, BRAND)
        l2[1].set_color_by_gradient(BRAND, INFO, BRAND)
        tag = VGroup(l1, l2).arrange(DOWN, buff=0.12).next_to(core, DOWN, buff=0.45)
        if tag.width > 7.3:
            tag.scale_to_fit_width(7.3)
        w = l2.width
        under = CubicBezier(l2.get_corner(DL) + DOWN * 0.12, l2.get_corner(DL) + RIGHT * w * 0.3 + DOWN * 0.04,
                            l2.get_corner(DL) + RIGHT * w * 0.7 + DOWN * 0.16, l2.get_corner(DR) + DOWN * 0.05,
                            stroke_color=SKY2, stroke_width=8)
        wv, wclock = waves(width=9, height=3.6)
        wv.move_to(tag)
        self.add(wclock)
        self.bring_to_back(wv)
        self.bring_to_back(self.bg)
        self.cue("one", lead=0.25)
        self.sfx("swish", -8)
        self.play(FadeIn(wv), FadeIn(l1, shift=UP * 0.3), run_time=0.3)
        self.play(FadeIn(l2, shift=UP * 0.3), run_time=0.3)
        self.sfx("swish", -11)
        self.play(Create(under), run_time=0.4)
        chips = VGroup(pill("Built in Sydney", BRAND, 24), pill("For any business", INFO, 24)).arrange(RIGHT, buff=0.25)
        url = T("crm.meroidea.com", 34, BRAND, weight="BOLD", font=MONO)
        VGroup(chips, url).arrange(DOWN, buff=0.4).next_to(tag, DOWN, buff=0.55)
        self.sfx("pop", -5)
        self.play(FadeIn(chips, shift=UP * 0.2), run_time=0.3)
        self.sfx("chime", -4)
        self.play(FadeIn(url, scale=1.2), run_time=0.35, rate_func=rate_functions.ease_out_back)
        self.outro(fade=0.8, whip=False)
