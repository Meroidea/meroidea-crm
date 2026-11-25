from manim import *

from common import *


class Money(PitchScene):
    SID = "s07"

    def construct(self):
        # A prompt that types itself.
        prompt = shadow_card(8.6, 0.95, color=INFO, radius=0.3)
        sparkle = Star(n=4, outer_radius=0.17, inner_radius=0.06, stroke_width=0).set_fill(INFO, 1)
        text = T("Invoice Acme for 40 catering boxes", 24, TEXT, weight="MEDIUM")
        caret = Rectangle(width=0.03, height=0.36, stroke_width=0).set_fill(BRAND, 1)
        prompt_g = VGroup(prompt, sparkle, text).move_to(UP * 2.5)
        sparkle.move_to(prompt[1]).align_to(prompt[1], LEFT).shift(RIGHT * 0.35)
        text.next_to(sparkle, RIGHT, buff=0.25)
        self.cue("type", lead=0.15)
        self.sfx("swish", -8)
        self.sfx("sparkle", -9)
        self.play(FadeIn(prompt, shift=DOWN * 0.3), FadeIn(sparkle, scale=0.5), run_time=0.3)
        self.sfx("typing", -7)
        self.play(AddTextLetterByLetter(text, time_per_char=0.045), run_time=1.6, rate_func=linear)
        caret.next_to(text, RIGHT, buff=0.05)
        self.add(caret)

        # The invoice drafts itself, line by line.
        self.cue("drafts", lead=0.4)
        inv = shadow_card(5.4, 4.0, radius=0.2).move_to(LEFT * 2.5 + DOWN * 1.0)
        head = VGroup(T("INVOICE", 22, TEXT, weight="BOLD"), T("INV-0142 · Acme Pty Ltd", 14, MUTED)).arrange(DOWN, aligned_edge=LEFT, buff=0.05)
        head.move_to(inv[1].get_corner(UL) + RIGHT * 1.6 + DOWN * 0.5).align_to(inv[1], LEFT).shift(RIGHT * 0.35)
        rows = [("40 × Catering box", "$720.00"), ("GST 10%", "$72.00")]
        lines = VGroup()
        for a, b in rows:
            l = VGroup(T(a, 16, TEXT), T(b, 16, TEXT, font=MONO))
            l[1].move_to(inv[1]).align_to(inv[1], RIGHT).shift(LEFT * 0.35)
            l[0].align_to(inv[1], LEFT).shift(RIGHT * 0.35)
            lines.add(l)
        rule = Line(LEFT * 2.35, RIGHT * 2.35, stroke_color=EDGE, stroke_width=2)
        total = VGroup(T("Total", 18, TEXT, weight="BOLD"), T("$792.00", 20, BRAND, weight="BOLD", font=MONO))
        for i, l in enumerate(lines):
            for m in l:
                m.set_y(inv[1].get_center()[1] + 0.35 - i * 0.5)
        rule.move_to(inv[1]).set_y(inv[1].get_center()[1] - 0.45)
        total[0].align_to(inv[1], LEFT).shift(RIGHT * 0.35).set_y(rule.get_y() - 0.42)
        total[1].align_to(inv[1], RIGHT).shift(LEFT * 0.35).set_y(rule.get_y() - 0.42)
        self.remove(caret)
        self.sfx("whoosh", -9)
        self.play(FadeIn(inv, scale=0.85), FadeIn(head, shift=DOWN * 0.2), run_time=0.45)
        self.sfx_seq("pop", 3, 0.22, -9)
        self.play(LaggedStart(*[FadeIn(l, shift=RIGHT * 0.3) for l in lines], Create(rule), FadeIn(total, shift=UP * 0.2),
                              lag_ratio=0.25), run_time=0.8)
        docg = VGroup(inv, head, lines, rule, total)

        # Overdue: stamp, then a reminder flies out.
        self.cue("overdue", lead=0.1)
        stamp = VGroup(RoundedRectangle(width=2.2, height=0.62, corner_radius=0.08, stroke_color=CORAL, stroke_width=5),
                       T("OVERDUE", 26, CORAL, weight="BOLD")).rotate(0.2).move_to(inv[1].get_center() + RIGHT * 1.2 + UP * 1.1)
        self.sfx("stamp", 0, 0.15)
        self.play(FadeIn(stamp, scale=2.5), run_time=0.2, rate_func=rate_functions.ease_in_quad)
        self.shake(0.05, 4, 0.22)
        self.cue("reminder", lead=0.3)
        mail = shadow_card(3.6, 1.2, color=SKY, radius=0.18).move_to(inv[1].get_center())
        mt = VGroup(icon("inbox", ink(SKY), 0.2), VGroup(T("Friendly reminder", 15, TEXT, weight="BOLD"),
                                                           T("INV-0142 · $792.00 due", 13, MUTED)).arrange(DOWN, aligned_edge=LEFT, buff=0.04))
        mt.arrange(RIGHT, buff=0.2).move_to(mail[1])
        mailg = VGroup(mail, mt)
        self.play(FadeIn(mailg, scale=0.6), run_time=0.2)
        self.sfx("whoosh", -6)
        self.play(mailg.animate.move_to(RIGHT * 3.8 + DOWN * 0.2).rotate(-0.06), run_time=0.5, rate_func=rate_functions.ease_out_cubic)
        trail = Line(inv[1].get_right(), mailg.get_left(), stroke_color=SKY, stroke_width=3).set_opacity(0.5)
        self.play(Create(trail), run_time=0.2)

        # Payment comes back; PAID replaces OVERDUE; money flows into the books.
        self.cue("payment", lead=0.25)
        paid_chip = pill("Payment received · $792.00", MINT, 16).move_to(mailg)
        self.play(FadeOut(trail), ReplacementTransform(mailg, paid_chip), run_time=0.3)
        self.sfx("swish", -9)
        self.sfx("coin", -3, 0.35)
        self.play(paid_chip.animate.move_to(inv[1].get_center() + DOWN * 0.1).scale(0.7).set_opacity(0),
                  run_time=0.4, rate_func=rate_functions.ease_in_cubic)
        paid = VGroup(RoundedRectangle(width=1.6, height=0.62, corner_radius=0.08, stroke_color=BRAND, stroke_width=5),
                      T("PAID", 26, BRAND, weight="BOLD")).rotate(0.2).move_to(stamp)
        self.sfx("stamp", -3)
        self.play(ReplacementTransform(stamp, paid), run_time=0.25)

        self.cue("books", lead=0.3)
        self.sfx("whoosh", -9)
        self.play(VGroup(docg, paid).animate.scale(0.55).move_to(LEFT * 4.4 + UP * 0.2), FadeOut(prompt_g, shift=UP * 0.4), run_time=0.45)
        coins = VGroup(*[Dot(radius=0.09, color=c) for c in (BRAND, INFO, SKY, BRAND, INFO, SKY)])
        books = VGroup(icon("books", BRAND, 0.5))
        bchip = Circle(radius=0.75, stroke_width=0).set_fill(ACCENT_BG, 1)
        books = VGroup(bchip, icon("books", BRAND, 0.55).move_to(bchip), T("Your books", 18, TEXT, weight="BOLD")
                       .next_to(bchip, RIGHT, buff=0.25)).move_to(RIGHT * 1.4 + UP * 1.55)
        self.sfx("pop", -6)
        self.play(FadeIn(books, scale=0.6), run_time=0.25)
        for c in coins:
            c.move_to(docg.get_right())
        self.sfx_seq("coin", 3, 0.2, -12)
        self.play(LaggedStart(*[c.animate(rate_func=rate_functions.ease_in_out_sine).move_to(bchip.get_center()).set_opacity(0)
                                for c in coins], lag_ratio=0.12), run_time=0.7)

        # Three live reports.
        reports = VGroup()
        # GST
        g1 = shadow_card(2.25, 2.15, radius=0.18)
        g1t = T("GST", 17, MUTED, weight="SEMIBOLD")
        g1v = T("$72.00", 26, TEXT, weight="BOLD", font=MONO)
        VGroup(g1t, g1v).arrange(DOWN, buff=0.15).move_to(g1[1])
        reports.add(VGroup(g1, g1t, g1v))
        # Profit and loss bars
        g2 = shadow_card(2.25, 2.15, radius=0.18)
        g2t = T("Profit & loss", 17, MUTED, weight="SEMIBOLD").move_to(g2[1].get_top() + DOWN * 0.32)
        bars = VGroup(*[Rectangle(width=0.32, height=h, stroke_width=0).set_fill(BRAND if i % 2 else SKY2, 1)
                        for i, h in enumerate([0.5, 0.8, 0.65, 1.1, 1.3])]).arrange(RIGHT, buff=0.1, aligned_edge=DOWN)
        bars.move_to(g2[1]).align_to(g2[1], DOWN).shift(UP * 0.3)
        reports.add(VGroup(g2, g2t, bars))
        # Balance sheet
        g3 = shadow_card(2.25, 2.15, radius=0.18)
        g3t = T("Balance sheet", 17, MUTED, weight="SEMIBOLD").move_to(g3[1].get_top() + DOWN * 0.32)
        beam = Line(LEFT * 0.75, RIGHT * 0.75, stroke_color=TEXT, stroke_width=4)
        fulc = Triangle(stroke_width=0).set_fill(TEXT, 1).scale(0.15)
        pans = VGroup(Square(0.34, stroke_width=0).set_fill(BRAND, 1).next_to(beam.get_left(), UP, buff=0),
                      Square(0.34, stroke_width=0).set_fill(SKY2, 1).next_to(beam.get_right(), UP, buff=0))
        bal = VGroup(beam, pans)
        fulc.next_to(beam, DOWN, buff=0)
        scale_g = VGroup(bal, fulc).move_to(g3[1]).shift(DOWN * 0.2)
        reports.add(VGroup(g3, g3t, scale_g))
        reports.arrange(RIGHT, buff=0.28).move_to(RIGHT * 1.4 + DOWN * 1.15)
        links = VGroup(*[Line(bchip.get_right(), r.get_left(), stroke_color=BRAND, stroke_width=2, stroke_opacity=0.35) for r in reports])
        for word, r in zip(["gst", "profit", "balance"], reports):
            self.cue(word, lead=0.2)
            if word == "profit":
                self.sfx("pop", -6)
                self.sfx("swish", -12)
                self.play(FadeIn(r[0]), FadeIn(r[1]), LaggedStart(*[GrowFromEdge(b, DOWN) for b in r[2]], lag_ratio=0.12), run_time=0.45)
            elif word == "balance":
                bal.rotate(0.18, about_point=fulc.get_top())
                self.sfx("pop", -6)
                self.play(FadeIn(r), run_time=0.2)
                self.play(Rotate(bal, -0.18, about_point=fulc.get_top()), run_time=0.4, rate_func=rate_functions.ease_out_back)
            else:
                self.sfx("pop", -6)
                self.play(FadeIn(r, shift=UP * 0.3), run_time=0.3, rate_func=rate_functions.ease_out_back)
        uptodate = VGroup(Dot(radius=0.07, color=MINT), T("always up to date", 18, MINT, weight="SEMIBOLD")).arrange(RIGHT, buff=0.12)
        uptodate.next_to(reports, DOWN, buff=0.35)
        self.play_cue("always", FadeIn(uptodate, shift=UP * 0.15), run_time=0.3, lead=0.2)
        self.sfx("chime", -4)
        self.play(Flash(uptodate[0], color=MINT, line_length=0.15, flash_radius=0.2), run_time=0.35)
        self.outro()
