from manim import *

from reel_common import *


def numbered(n: int, text: str):
    c = Circle(radius=0.42, stroke_width=0).set_fill(BRAND, 1)
    num = Text(str(n), font="Inter", weight=HEAVY, font_size=40, color="#FFFFFF").move_to(c)
    t = heavy(text, 52, TEXT, sw=8)
    return VGroup(VGroup(c, num), t).arrange(RIGHT, buff=0.3)


class Different(ReelScene):
    SID = "r05"

    def construct(self):
        q1 = heavy("WHAT MAKES IT", 70, TEXT)
        q2 = heavy("DIFFERENT?", 104, BRAND)
        q2[1].set_color_by_gradient(BRAND, INFO)
        q = VGroup(q1, q2).arrange(DOWN, buff=0.08).move_to(VIS_CENTER + UP * 0.6)
        self.cue("so", lead=0.05)
        self.sfx("impact", -5)
        self.play(FadeIn(q, scale=1.4), run_time=0.3, rate_func=rate_functions.ease_out_back)
        self.play(q.animate.scale(0.55).move_to(UP * 5.05), run_time=0.35, rate_func=smooth)

        # 1. Built for Australia.
        h1 = numbered(1, "Built for Australia").move_to(UP * 3.55)
        p = pin(BRAND, 1.6).move_to(UP * 1.75 + LEFT * 1.9)
        syd = T("Sydney-hosted", 22, MUTED, weight="SEMIBOLD").next_to(p, DOWN, buff=0.2)
        chips = VGroup(pill("Award rates", BRAND, 26), pill("GST", INFO, 26), pill("Tax tables", SKY, 26))
        chips.arrange(DOWN, buff=0.25, aligned_edge=LEFT).move_to(UP * 1.6 + RIGHT * 1.1)
        self.cue("built", lead=0.25)
        self.sfx("swish", -6)
        self.play(FadeIn(h1, shift=RIGHT * 1.0), run_time=0.3)
        self.sfx("pop", -4)
        self.play(FadeIn(p, shift=DOWN * 0.8), FadeIn(syd), run_time=0.3, rate_func=rate_functions.ease_out_bounce)
        for word, c in zip(["award", "gst", "tax"], chips):
            self.cue(word, lead=0.15)
            self.sfx("pop", -5)
            self.play(FadeIn(c, shift=LEFT * 0.4, scale=1.2), run_time=0.2, rate_func=rate_functions.ease_out_back)
        g1 = VGroup(h1, p, syd, chips)

        # 2. Shapes itself to your business.
        self.cue("shapes", lead=0.3)
        self.sfx("whoosh", -8)
        h2 = numbered(2, "Fits your business").move_to(UP * 3.55)
        self.play(FadeOut(g1, shift=LEFT * 2), FadeIn(h2, shift=LEFT * 1.0), run_time=0.3)
        boards = [("Bookings", ["Enquiry", "Tasting", "Booked"], GOLD), ("Cases", ["Enquiry", "Applied", "Granted"], SKY),
                  ("Orders", ["New", "Packed", "Shipped"], CORAL)]

        def board(title, stages, col):
            cols = VGroup(*[VGroup(RoundedRectangle(width=1.95, height=1.7, corner_radius=0.14, stroke_width=0).set_fill(MUTED_BG, 1),
                                   T(s_, 19, ink(col), weight="BOLD")) for s_ in stages])
            for c in cols:
                c[1].next_to(c[0].get_top(), DOWN, buff=0.15)
            cols.arrange(RIGHT, buff=0.15)
            t = T(title, 30, TEXT, weight="BOLD").next_to(cols, UP, buff=0.2).align_to(cols, LEFT)
            return VGroup(t, cols).move_to(UP * 1.55)

        b = board(*boards[0])
        self.sfx("pop", -6)
        self.play(FadeIn(b, shift=UP * 0.3), run_time=0.25)
        for nb, word in ((board(*boards[1]), "your"), (board(*boards[2]), "words")):
            self.cue(word, lead=0.25)
            self.sfx("swish", -7)
            self.play(Transform(b, nb), run_time=0.3)
        nodev = pill("No developers", CORAL, 26).move_to(UP * 0.0)
        code = T("</>", 26, CORAL, weight="BOLD", font=MONO).next_to(nodev, LEFT, buff=0.25)
        strike = Line(VGroup(code, nodev).get_left() + LEFT * 0.1, VGroup(code, nodev).get_right() + RIGHT * 0.1, color=CORAL,
                      stroke_width=6)
        self.cue("developers", lead=0.3)
        self.sfx("pop", -5)
        self.play(FadeIn(VGroup(code, nodev), scale=1.2), run_time=0.2)
        self.sfx("stamp", -4)
        self.play(Create(strike), run_time=0.2)
        g2 = VGroup(h2, b, code, nodev, strike)

        # 3. AI drafts, a person approves.
        self.cue("ai", lead=0.6)
        self.sfx("whoosh", -8)
        h3 = numbered(3, "AI with a human OK").move_to(UP * 3.55)
        if h3.width > 7.4:
            h3.scale_to_fit_width(7.4)
        self.play(FadeOut(g2, shift=LEFT * 2), FadeIn(h3, shift=LEFT * 1.0), run_time=0.3)
        draft = shadow_card(6.6, 2.4, color=INFO, radius=0.24, stroke_width=2.5).move_to(UP * 1.45)
        star = Star(n=4, outer_radius=0.2, inner_radius=0.07, stroke_width=0).set_fill(INFO, 1)
        dl = T("MeroAI draft", 18, INFO, weight="BOLD")
        d1 = T("Invoice · Acme Pty Ltd", 24, TEXT, weight="BOLD")
        d2 = T("40 × catering box · $792 incl. GST", 18, MUTED)
        txt = VGroup(VGroup(star, dl).arrange(RIGHT, buff=0.12), d1, d2).arrange(DOWN, aligned_edge=LEFT, buff=0.1)
        txt.move_to(draft[1]).align_to(draft[1], LEFT).shift(RIGHT * 0.35 + UP * 0.25)
        btn = pill("Approve", BRAND, 22, fill_opacity=1, text_color="#FFFFFF").move_to(draft[1]).align_to(draft[1], RIGHT)
        btn.shift(LEFT * 0.35 + DOWN * 0.7)
        self.cue("drafts", lead=0.3)
        self.sfx("sparkle", -4)
        self.play(FadeIn(VGroup(draft, txt), shift=UP * 0.4), run_time=0.3)
        self.play(FadeIn(btn, scale=1.2), run_time=0.2)
        self.cue("approves", lead=0.2)
        cursor = Polygon([0, 0, 0], [0, -0.42, 0], [0.11, -0.31, 0], [0.24, -0.5, 0], [0.32, -0.45, 0], [0.19, -0.27, 0],
                         [0.33, -0.27, 0], stroke_color="#FFFFFF", stroke_width=2).set_fill(TEXT, 1).scale(1.3)
        cursor.move_to(btn.get_center() + DOWN * 1.2 + RIGHT * 0.8, aligned_edge=UL)
        self.add(cursor)
        self.play(cursor.animate.move_to(btn.get_center() + DOWN * 0.05, aligned_edge=UL), run_time=0.25)
        self.sfx("click", -1)
        ring = RoundedRectangle(width=btn.width, height=btn.height, corner_radius=0.2, stroke_color=BRAND, stroke_width=5).move_to(btn)
        done = pill("✓ Approved", MINT, 22, fill_opacity=0.3).move_to(btn)
        self.play(ring.animate.scale(1.7).set_stroke(opacity=0), ReplacementTransform(btn, done), run_time=0.3)
        self.sfx("chime", -3)
        self.play(draft[1].animate.set_stroke(MINT, width=3), FadeOut(cursor), run_time=0.25)
        self.outro()
