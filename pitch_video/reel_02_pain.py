from manim import *

from reel_common import *


def pain_card(title: str, color: str, body, w: float = 6.2, h: float = 2.05):
    sc = shadow_card(w, h, color=color, radius=0.26, stroke_width=3)
    t = T(title, 30, color, weight="BOLD")
    t.next_to(sc[1].get_corner(UL), DR, buff=0.32)
    body.next_to(t, DOWN, buff=0.25, aligned_edge=LEFT)
    return VGroup(sc, t, body)


class Pain(ReelScene):
    SID = "r02"

    def construct(self):
        # 1. Messages get missed.
        bubble = RoundedRectangle(width=4.0, height=0.62, corner_radius=0.28, stroke_width=0).set_fill(ACCENT_BG, 1)
        bt = T("Are you open on Sunday?", 22, TEXT).move_to(bubble)
        status = T("Unread · 3 days", 20, CORAL, weight="SEMIBOLD")
        body1 = VGroup(VGroup(bubble, bt), status).arrange(RIGHT, buff=0.25)
        c1 = pain_card("Messages missed", CORAL, body1).move_to(UP * 4.35 + LEFT * 0.15)

        # 2. Rosters blow the budget.
        track = RoundedRectangle(width=4.6, height=0.32, corner_radius=0.16, stroke_width=0).set_fill(MUTED_BG, 1)
        fill = RoundedRectangle(width=0.01, height=0.32, corner_radius=0.16, stroke_width=0).set_fill(SKY, 1)
        fill.align_to(track, LEFT)
        limit = DashedLine(UP * 0.32, DOWN * 0.32, stroke_color=TEXT, stroke_width=3).move_to(track.get_left() + RIGHT * 3.6)
        over = T("+$1,240 over", 22, CORAL, weight="BOLD")
        bar = VGroup(track, fill, limit)
        body2 = VGroup(bar, over).arrange(RIGHT, buff=0.25)
        c2 = pain_card("Roster over budget", CORAL, body2).move_to(UP * 1.95 + LEFT * 0.15)

        # 3. Invoices go unpaid.
        doc = VGroup(*[Line(LEFT * 1.0, RIGHT * (1.0 - 0.4 * (i % 2)), stroke_color=EDGE, stroke_width=6) for i in range(3)])
        doc.arrange(DOWN, buff=0.18, aligned_edge=LEFT)
        amt = T("INV-0142 · $792", 22, TEXT, weight="SEMIBOLD")
        body3 = VGroup(doc, amt).arrange(RIGHT, buff=0.4)
        c3 = pain_card("Invoice unpaid", CORAL, body3).move_to(DOWN * 0.45 + LEFT * 0.15)
        stamp = VGroup(RoundedRectangle(width=2.5, height=0.72, corner_radius=0.08, stroke_color=CORAL, stroke_width=7),
                       Text("OVERDUE", font="Inter", weight=HEAVY, font_size=34, color=ink(CORAL))).rotate(0.2)
        stamp.move_to(c3[0][1].get_right() + LEFT * 1.5 + UP * 0.1)

        self.cue("messages", lead=0.15)
        self.sfx("swish", -6)
        self.play(FadeIn(c1, shift=LEFT * 2), run_time=0.3, rate_func=rate_functions.ease_out_back)
        self.sfx("ping", -6)
        self.play(Indicate(status, color=ink(CORAL)), run_time=0.35)

        self.cue("rosters", lead=0.15)
        self.sfx("swish", -6)
        self.play(FadeIn(c2, shift=RIGHT * 2), run_time=0.3, rate_func=rate_functions.ease_out_back)
        self.sfx("riser", -14)
        self.play(fill.animate.stretch_to_fit_width(4.6, about_edge=LEFT).set_fill(CORAL, 1), run_time=0.6,
                  rate_func=rate_functions.ease_in_quad)
        self.sfx("impact", -7)
        self.play(FadeIn(over, scale=1.4), run_time=0.15)

        self.cue("invoices", lead=0.15)
        self.sfx("swish", -6)
        self.play(FadeIn(c3, shift=LEFT * 2), run_time=0.3, rate_func=rate_functions.ease_out_back)
        self.sfx("stamp", 0, 0.15)
        self.play(FadeIn(stamp, scale=2.4), run_time=0.2, rate_func=rate_functions.ease_in_quad)
        self.shake(0.06, 4, 0.25, gain=-5)
        # Build tension into the reveal.
        self.sfx("riser", -6, max(0.0, self.end - self.now - 1.3))
        self.play(*[c.animate.set_color(CORAL).scale(0.96) for c in (c1[1], c2[1], c3[1])], run_time=0.3)
        self.outro()
