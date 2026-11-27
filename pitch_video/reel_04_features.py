from manim import *

from reel_common import *

CH = ["#0866FF", "#FF0069", "#25D366", "#111111", "#7DA0FA", "#7978E9"]


def screen_title(text, screen):
    return T(text, 30, TEXT, weight="BOLD").move_to(screen.get_top() + DOWN * 0.75).align_to(screen, LEFT).shift(RIGHT * 0.35)


class Features(ReelScene):
    SID = "r04"

    def construct(self):
        ph = phone(4.5, 7.5).move_to(VIS_CENTER + DOWN * 0.15)
        scr = ph[1]
        self.sfx("swish", -6)
        self.play(FadeIn(ph, shift=UP * 1.2), run_time=0.35, rate_func=rate_functions.ease_out_back)

        def swap(old, new):
            anims = [FadeIn(new, shift=LEFT * 1.2)]
            if old is not None:
                anims.append(FadeOut(old, shift=LEFT * 1.2))
            self.sfx("swish", -9)
            self.play(*anims, run_time=0.3, rate_func=rate_functions.ease_in_out_cubic)

        # 1. Inbox.
        inbox = VGroup(screen_title("Inbox", scr))
        names = [("Ana", "Table for four?"), ("Ben", "Is my order ready?"), ("Chloe", "Quote for 40"), ("Dev", "Do you deliver?"),
                 ("Ella", "Open Sunday?"), ("Finn", "Thanks!")]
        rows = VGroup()
        for i, (n, m) in enumerate(names):
            bg = RoundedRectangle(width=3.9, height=0.72, corner_radius=0.14, stroke_width=0).set_fill(PANEL, 1)
            dot = Circle(radius=0.11, stroke_width=0).set_fill(CH[i], 1)
            tx = VGroup(T(n, 19, TEXT, weight="BOLD"), T(m, 15, MUTED)).arrange(DOWN, aligned_edge=LEFT, buff=0.04)
            VGroup(dot, tx).arrange(RIGHT, buff=0.2).move_to(bg).align_to(bg, LEFT).shift(RIGHT * 0.2)
            rows.add(VGroup(bg, dot, tx))
        rows.arrange(DOWN, buff=0.12).next_to(inbox[0], DOWN, buff=0.3).align_to(inbox[0], LEFT).shift(LEFT * 0.1)
        self.cue("every", lead=0.2)
        swap(None, inbox)
        self.sfx_seq("pop", 6, 0.08, -10)
        self.play(LaggedStart(*[FadeIn(r, shift=DOWN * 0.3) for r in rows], lag_ratio=0.12), run_time=0.7)
        inbox.add(rows)

        # 2. Rosters in one click, award-costed.
        roster = VGroup(screen_title("Roster", scr))
        cells = VGroup(*[RoundedRectangle(width=0.47, height=0.42, corner_radius=0.07, stroke_width=0).set_fill(MUTED_BG, 1)
                         for _ in range(42)]).arrange_in_grid(6, 7, buff=0.07)
        cells.next_to(roster[0], DOWN, buff=0.35).align_to(roster[0], LEFT)
        btn = pill("Instant build", BRAND, 18, fill_opacity=1, text_color="#FFFFFF").next_to(cells, DOWN, buff=0.35)
        award = pill("Award costed ✓", MINT, 18).next_to(btn, DOWN, buff=0.22)
        roster.add(cells, btn)
        self.cue("rosters", lead=0.2)
        swap(inbox, roster)
        self.cue("click", lead=0.2)
        self.sfx("click", -1)
        self.play(btn.animate.scale(0.9), run_time=0.08)
        self.play(btn.animate.scale(1 / 0.9), run_time=0.08)
        pattern = [i for i in range(42) if (i * 7 + i // 7) % 3 != 0]
        cols = [BRAND, INFO, SKY, SKY2]
        self.sfx("sparkle", -7)
        self.play(LaggedStart(*[cells[i].animate.set_fill(cols[(i // 7) % 4], 1) for i in sorted(pattern, key=lambda i: i % 7 + i // 7)],
                              lag_ratio=0.03), run_time=0.7)
        self.cue("award", lead=0.3)
        self.sfx("coin", -6)
        self.play(FadeIn(award, scale=1.3), run_time=0.25, rate_func=rate_functions.ease_out_back)
        roster.add(award)

        # 3. Timesheets → payslips.
        pay = VGroup(screen_title("Pay run", scr))
        ts = shadow_card(3.8, 1.25, radius=0.2)
        tst = VGroup(icon("check", MINT, 0.25), VGroup(T("Timesheet", 19, TEXT, weight="BOLD"), T("38 h · approved", 15, MUTED))
                     .arrange(DOWN, aligned_edge=LEFT, buff=0.04)).arrange(RIGHT, buff=0.25).move_to(ts[1])
        slip = shadow_card(3.8, 1.25, color=BRAND, radius=0.2)
        slt = VGroup(icon("payroll", BRAND, 0.3), VGroup(T("Payslip", 19, TEXT, weight="BOLD"), T("tax · super · YTD", 15, MUTED))
                     .arrange(DOWN, aligned_edge=LEFT, buff=0.04)).arrange(RIGHT, buff=0.25).move_to(slip[1])
        tsg, slg = VGroup(ts, tst), VGroup(slip, slt)
        VGroup(tsg, slg).arrange(DOWN, buff=1.0).next_to(pay[0], DOWN, buff=0.45).align_to(pay[0], LEFT)
        arr = Arrow(tsg.get_bottom(), slg.get_top(), buff=0.1, color=BRAND, stroke_width=6, max_tip_length_to_length_ratio=0.35)
        self.cue("timesheets", lead=0.2)
        swap(roster, pay)
        self.sfx("pop", -6)
        self.play(FadeIn(tsg, shift=DOWN * 0.3), run_time=0.25)
        self.cue("payslips", lead=0.35)
        self.sfx("swish", -9)
        self.play(GrowArrow(arr), run_time=0.25)
        self.sfx("chime", -5)
        self.play(FadeIn(slg, shift=DOWN * 0.3, scale=0.9), run_time=0.3, rate_func=rate_functions.ease_out_back)
        pay.add(tsg, arr, slg)

        # 4. Invoices into the books.
        books = VGroup(screen_title("Books", scr))
        inv = pill("INV-0142 · Paid $792", MINT, 18).next_to(books[0], DOWN, buff=0.35).align_to(books[0], LEFT)
        chart = shadow_card(3.8, 2.7, radius=0.2).next_to(inv, DOWN, buff=0.35).align_to(inv, LEFT)
        ctitle = T("Profit & loss", 17, MUTED, weight="SEMIBOLD").next_to(chart[1].get_corner(UL), DR, buff=0.2)
        bars = VGroup(*[Rectangle(width=0.42, height=h, stroke_width=0).set_fill(BRAND if i % 2 else SKY2, 1)
                        for i, h in enumerate([0.6, 0.9, 0.8, 1.3, 1.6])]).arrange(RIGHT, buff=0.15, aligned_edge=DOWN)
        bars.move_to(chart[1]).align_to(chart[1], DOWN).shift(UP * 0.3)
        gst = pill("GST ✓", BRAND, 16).next_to(chart, DOWN, buff=0.25).align_to(chart, LEFT)
        self.cue("invoices", lead=0.2)
        swap(pay, books)
        self.sfx("coin", -4)
        self.play(FadeIn(inv, scale=1.2), run_time=0.25)
        self.sfx("swish", -10)
        self.play(FadeIn(chart), FadeIn(ctitle), LaggedStart(*[GrowFromEdge(b, DOWN) for b in bars], lag_ratio=0.12), run_time=0.6)
        self.sfx("tick", -5)
        self.play(FadeIn(gst, scale=1.3), run_time=0.2)
        self.outro()
