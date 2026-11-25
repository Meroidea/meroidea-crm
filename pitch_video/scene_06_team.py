from manim import *

from common import *


class Team(PitchScene):
    SID = "s06"

    def construct(self):
        win = laptop(12.0, 6.4).move_to(DOWN * 0.25)
        title = T("Roster · next week", 20, TEXT, weight="BOLD").move_to(win[1]).align_to(win[1], LEFT).shift(RIGHT * 1.0)
        days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        staff = ["Ana", "Ben", "Chloe", "Dev", "Ella"]
        cw, chh = 1.25, 0.62
        grid = VGroup()
        cells = {}
        for r in range(5):
            for c in range(7):
                b = RoundedRectangle(width=cw, height=chh, corner_radius=0.1, stroke_color=EDGE, stroke_width=1.2).set_fill(BG, 1)
                b.move_to(RIGHT * c * (cw + 0.1) + DOWN * r * (chh + 0.12))
                cells[(r, c)] = b
                grid.add(b)
        heads = VGroup(*[T(d, 15, MUTED, weight="SEMIBOLD").next_to(cells[(0, i)], UP, buff=0.42) for i, d in enumerate(days)])
        names = VGroup(*[T(n, 16, TEXT, weight="MEDIUM").next_to(cells[(i, 0)], LEFT, buff=0.25) for i, n in enumerate(staff)])
        table = VGroup(grid, heads, names).move_to(win[0][1]).shift(DOWN * 0.3 + RIGHT * 0.2)
        # Trading hours band: open 7 days, longer at the weekend.
        hours = VGroup(*[RoundedRectangle(width=cw, height=0.12, corner_radius=0.05, stroke_width=0)
                         .set_fill(SKY2, 0.9 if i >= 4 else 0.5).next_to(cells[(0, i)], UP, buff=0.16) for i in range(7)])
        btn = pill("Instant build", BRAND, 18, fill_opacity=1, text_color="#FFFFFF")
        btn.move_to(win[1]).align_to(win[1], RIGHT).shift(LEFT * 0.4)

        self.cue("next", lead=0.15)
        self.sfx("swish", -7)
        self.play(FadeIn(win, scale=0.94), FadeIn(title), FadeIn(table, shift=UP * 0.2), FadeIn(btn), run_time=0.45)

        # One click: cursor taps the button, shifts fill in a diagonal wave.
        cursor = Polygon([0, 0, 0], [0, -0.42, 0], [0.11, -0.31, 0], [0.24, -0.5, 0], [0.32, -0.45, 0], [0.19, -0.27, 0],
                         [0.33, -0.27, 0], stroke_color="#FFFFFF", stroke_width=2).set_fill(TEXT, 1)
        cursor.move_to(DOWN * 2 + RIGHT * 1, aligned_edge=UL)
        self.cue("one", lead=0.4)
        self.play(cursor.animate.move_to(btn.get_center() + DOWN * 0.05, aligned_edge=UL), run_time=0.35,
                  rate_func=rate_functions.ease_out_cubic)
        self.cue("click", lead=0.1)
        ring = RoundedRectangle(width=btn.width, height=btn.height, corner_radius=0.2, stroke_color=BRAND, stroke_width=4).move_to(btn)
        self.sfx("click", -1)
        self.play(btn.animate.scale(0.9), ring.animate.scale(1.6).set_stroke(opacity=0), run_time=0.15)
        self.play(btn.animate.scale(1 / 0.9), FadeOut(cursor), run_time=0.1)
        pattern = {(0, 0), (0, 1), (0, 4), (0, 5), (1, 1), (1, 2), (1, 3), (1, 6), (2, 0), (2, 2), (2, 4), (2, 5),
                   (3, 3), (3, 4), (3, 5), (3, 6), (4, 0), (4, 1), (4, 5), (4, 6)}
        fills = []
        labels = VGroup()
        for (r, c) in sorted(pattern, key=lambda rc: rc[0] + rc[1]):
            b = cells[(r, c)]
            col = [SKY, INFO, BRAND, SKY2, INFO][r]
            lab = T("10–6" if c >= 5 else "9–5", 14, "#FFFFFF" if col != SKY2 else TEXT, weight="SEMIBOLD", font=MONO).move_to(b)
            labels.add(lab)
            fills.append(AnimationGroup(b.animate.set_fill(col, 0.95).set_stroke(col), FadeIn(lab, scale=0.5)))
        self.sfx("sparkle", -7)
        self.sfx_seq("tick", 10, 0.1, -14)
        self.play(LaggedStart(*fills, lag_ratio=0.05), run_time=1.1)

        self.cue("trading", lead=0.25)
        hlab = T("trading hours", 13, ink(SKY), weight="SEMIBOLD").next_to(hours, LEFT, buff=0.2)
        self.sfx("swish", -11)
        self.play(LaggedStart(*[GrowFromEdge(h, LEFT) for h in hours], lag_ratio=0.06), FadeIn(hlab), run_time=0.5)

        self.cue("award", lead=0.4)
        cost = ValueTracker(0)
        cost_t = always_redraw(lambda: VGroup(T("Wage cost", 15, MUTED), T(f"${cost.get_value():,.0f}", 22, BRAND, weight="BOLD", font=MONO))
                               .arrange(RIGHT, buff=0.15).next_to(btn, LEFT, buff=0.4))
        chk = VGroup(icon("check", MINT, 0.18), T("award checked", 14, MINT, weight="SEMIBOLD")).arrange(RIGHT, buff=0.06)
        self.add(cost_t)
        self.sfx("coin", -7, 0.5)
        self.play(cost.animate.set_value(6480), run_time=0.7)
        chk.next_to(cost_t, DOWN, buff=0.06).align_to(cost_t, RIGHT)
        self.sfx("tick", -5)
        self.play(FadeIn(chk, scale=1.3), run_time=0.2)

        # Staff get shifts on their phones.
        self.cue("phones", lead=0.45)
        roster = VGroup(win, title, table, hours, hlab, btn, labels, cost_t, chk)
        cost_t.clear_updaters()
        self.sfx("whoosh", -9)
        self.play(roster.animate.scale(0.5).move_to(LEFT * 3.6 + UP * 1.5), run_time=0.45)
        phones = VGroup()
        for name, shift_ in (("Ana", "Mon 9–5 · Sat 10–6"), ("Ben", "Tue 9–5 · Wed 9–5")):
            p = phone(1.9, 3.5)
            note = shadow_card(1.65, 0.95, radius=0.14, depth=0.03)
            t1 = T("Shifts published", 12, TEXT, weight="BOLD")
            t2 = T(shift_, 10, MUTED)
            VGroup(t1, t2).arrange(DOWN, aligned_edge=LEFT, buff=0.05).move_to(note[1])
            note_g = VGroup(note, t1, t2).move_to(p[1].get_top() + DOWN * 0.85)
            phones.add(VGroup(p, note_g, T(name, 16, TEXT, weight="SEMIBOLD").next_to(p, DOWN, buff=0.12)))
        phones.arrange(RIGHT, buff=0.5).move_to(RIGHT * 3.6 + UP * 1.0)
        self.play(LaggedStart(*[FadeIn(VGroup(p[0], p[2]), shift=UP * 0.4) for p in phones], lag_ratio=0.2), run_time=0.4)
        self.sfx("ping", -4)
        self.sfx("ping", -6, 0.1)
        self.play(LaggedStart(*[FadeIn(p[1], shift=DOWN * 0.3, scale=0.9) for p in phones], lag_ratio=0.2), run_time=0.35)

        # Clock-in → timesheet ✓ → payslip, as a conveyor.
        self.cue("clockins", lead=0.3)
        stations = VGroup()
        for kind, lab, col in (("clock", "Clock-in", SKY), ("check", "Timesheet approved", MINT), ("payroll", "Payslip", BRAND)):
            sc = shadow_card(3.25, 1.15, radius=0.18)
            chip = Circle(radius=0.3, stroke_width=0).set_fill(interpolate_color(ManimColor(PANEL), ManimColor(col), 0.16), 1)
            ic = icon(kind, ink(col), 0.24).move_to(chip)
            tx = T(lab, 15, TEXT, weight="SEMIBOLD")
            VGroup(VGroup(chip, ic), tx).arrange(RIGHT, buff=0.18).move_to(sc[1])
            stations.add(VGroup(sc, chip, ic, tx))
        stations.arrange(RIGHT, buff=0.9).move_to(DOWN * 2.3)
        belts = VGroup(*[Arrow(stations[i].get_right(), stations[i + 1].get_left(), buff=0.1, color=MUTED, stroke_width=3,
                               max_tip_length_to_length_ratio=0.2) for i in range(2)])
        self.sfx("pop", -6)
        self.play(FadeIn(stations[0], shift=UP * 0.3), run_time=0.25)
        self.sfx("pop", -6, max(0.0, self.sync.words[[w for w, _ in self.sync.words].index("approved")][1] - 0.3 - self.now))
        self.play_cue("approved", GrowArrow(belts[0]), FadeIn(stations[1], shift=UP * 0.3), run_time=0.35, lead=0.3)
        tok = Dot(radius=0.09, color=MINT).move_to(belts[0].get_start())
        self.sfx("swish", -12)
        self.play(MoveAlongPath(tok, belts[0]), run_time=0.3)
        self.remove(tok)
        self.play_cue("payslips", GrowArrow(belts[1]), FadeIn(stations[2], shift=UP * 0.3), run_time=0.35, lead=0.35)
        tok2 = Dot(radius=0.09, color=BRAND).move_to(belts[1].get_start())
        self.sfx("swish", -12)
        self.sfx("chime", -4, 0.3)
        self.play(MoveAlongPath(tok2, belts[1]), Indicate(stations[2], color=BRAND, scale_factor=1.06), run_time=0.4)
        self.remove(tok2)
        self.outro()
