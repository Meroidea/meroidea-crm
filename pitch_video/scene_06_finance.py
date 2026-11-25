from manim import *

from common import *


class Finance(PitchScene):
    SID = "s06"

    def construct(self):
        k = kicker("06 · WORK, MONEY & INSIGHT", GOLD)
        self.add(k)

        # ---- My Day ----------------------------------------------------------------------------
        title = T("My Day", 36, TEXT, weight="SEMIBOLD").to_edge(UP, buff=1.0)
        self.play_cue("work", FadeIn(title, shift=DOWN * 0.2), run_time=0.6, lead=0.05)
        cols_spec = [("Overdue", CORAL, ["Call back Ben", "Send quote #142"]),
                     ("Due today", SKY, ["Roster review", "Follow up Ana", "Approve leave"]),
                     ("Upcoming", MUTED, ["Supplier order", "Team training"])]
        cols = VGroup()
        for name, col, tasks in cols_spec:
            box = card(3.6, 3.3, color=col, stroke_width=2)
            head = T(name, 22, col, weight="SEMIBOLD").next_to(box.get_top(), DOWN, buff=0.22)
            chips = VGroup(*[pill(t, col, 18, text_color=TEXT, fill_opacity=0.1) for t in tasks]).arrange(DOWN, buff=0.18)
            chips.next_to(head, DOWN, buff=0.3)
            cols.add(VGroup(box, head, chips))
        cols.arrange(RIGHT, buff=0.4).move_to(DOWN * 0.35)
        for word, c in zip(["overdue", "due", "upcoming"], cols):
            self.play_cue(word, FadeIn(c[0]), FadeIn(c[1]), LaggedStart(*[FadeIn(ch, shift=UP * 0.1) for ch in c[2]], lag_ratio=0.15),
                          run_time=0.5, lead=0.2)

        # ---- Documents --------------------------------------------------------------------------
        self.cue("documents", lead=0.3)
        self.play(FadeOut(VGroup(cols, title), shift=LEFT * 0.4), run_time=0.45)
        docs = VGroup()
        for i, v in enumerate(["v1", "v2", "v3"]):
            d = card(2.1, 2.7, color=SKY2 if i == 2 else EDGE, stroke_width=2)
            lines = VGroup(*[Line(LEFT * 0.7, RIGHT * (0.7 - 0.3 * (j % 2)), stroke_color=MUTED, stroke_width=2) for j in range(5)])
            lines.arrange(DOWN, buff=0.22, aligned_edge=LEFT).move_to(d).shift(UP * 0.2)
            tag = T(v, 18, SKY if i == 2 else MUTED, font=MONO).next_to(d.get_bottom(), UP, buff=0.18)
            docs.add(VGroup(d, lines, tag).shift(RIGHT * 0.45 * i + DOWN * 0.25 * i))
        docs.move_to(LEFT * 2.6 + DOWN * 0.2)
        lockline = T("private bucket · audited downloads", 20, MUTED).next_to(docs, DOWN, buff=0.35)
        edit = pill("Edit in browser · Word · Excel · PowerPoint · PDF", SKY, 20).move_to(RIGHT * 3.0 + UP * 0.4)
        ver = pill("Version history", GLOW, 20).next_to(edit, DOWN, buff=0.3)
        self.play(LaggedStart(*[FadeIn(d, shift=UP * 0.2) for d in docs], lag_ratio=0.2), FadeIn(lockline), run_time=0.8)
        self.play_cue("versions", FadeIn(ver, shift=LEFT * 0.2), run_time=0.4, lead=0.2)
        self.play_cue("inbrowser", FadeIn(edit, shift=LEFT * 0.2), run_time=0.4, lead=0.2)

        # ---- Double-entry ledger ----------------------------------------------------------------
        self.cue("money", lead=0.3)
        self.play(FadeOut(VGroup(docs, lockline, edit, ver), shift=LEFT * 0.4), run_time=0.45)
        heading = T("Double-entry ledger · written only by database functions", 26, TEXT, weight="SEMIBOLD").to_edge(UP, buff=1.0)
        fulcrum = Triangle(color=MUTED, stroke_width=2).set_fill(PANEL, 1).scale(0.35).move_to(DOWN * 0.9)
        beam = VGroup(Line(LEFT * 4.2, RIGHT * 4.2, stroke_color=TEXT, stroke_width=4))
        beam.next_to(fulcrum, UP, buff=0)
        dr_t = T("DEBIT", 22, SKY, weight="BOLD").move_to(LEFT * 3.4 + UP * 1.6)
        cr_t = T("CREDIT", 22, GOLD, weight="BOLD").move_to(RIGHT * 3.4 + UP * 1.6)
        self.play(FadeIn(heading, shift=DOWN * 0.15), FadeIn(fulcrum), Create(beam), FadeIn(dr_t), FadeIn(cr_t), run_time=0.7)

        def entry(label, amt, col):
            return pill(f"{label}  {amt}", col, 20, text_color=TEXT)

        dr = entry("Bank", "1,100.00", SKY).move_to(LEFT * 3.4 + UP * 0.9)
        pivot = fulcrum.get_top()
        left_side = VGroup(beam, dr)
        self.play(FadeIn(dr, shift=DOWN * 0.3), run_time=0.4)
        self.play(Rotate(left_side, angle=0.09, about_point=pivot), run_time=0.5)
        cr1 = entry("Sales", "1,000.00", GOLD).move_to(RIGHT * 3.4 + UP * 0.95)
        cr2 = entry("GST", "100.00", GOLD).next_to(cr1, DOWN, buff=0.15)
        self.play_cue("balances", FadeIn(cr1, shift=DOWN * 0.3), FadeIn(cr2, shift=DOWN * 0.3), run_time=0.4, lead=0.6)
        self.play(Rotate(left_side, angle=-0.09, about_point=pivot), run_time=0.5, rate_func=smooth)
        ok = T("✓ balanced to the cent", 26, MINT, weight="SEMIBOLD").next_to(fulcrum, DOWN, buff=0.4)
        self.play(FadeIn(ok, shift=UP * 0.1), run_time=0.4)

        # ---- Executive dashboard ------------------------------------------------------------------
        self.cue("dashboard", lead=0.4)
        self.play(*[FadeOut(m) for m in [heading, fulcrum, left_side, cr1, cr2, dr_t, cr_t, ok]], run_time=0.45)

        kpis = [("Open pipeline", "$84,000", SKY, "open"), ("Weighted forecast", "$37,800", GOLD, "weighted"),
                ("Won this month", "$21,500", MINT, None), ("Win rate (90 days)", "42%", GLOW, "win")]
        tiles = VGroup()
        for name, val, col, _ in kpis:
            box = card(3.05, 1.35, color=col, stroke_width=2)
            nm = T(name, 17, MUTED).next_to(box.get_corner(UL), DR, buff=0.2)
            v = T(val, 32, TEXT, weight="BOLD", font=MONO).next_to(nm, DOWN, aligned_edge=LEFT, buff=0.12)
            tiles.add(VGroup(box, nm, v))
        tiles.arrange(RIGHT, buff=0.25).to_edge(UP, buff=1.05)
        self.play(LaggedStart(*[FadeIn(t, shift=UP * 0.15) for t in tiles[:1]], lag_ratio=0.1), run_time=0.4)
        self.play_cue("weighted", FadeIn(tiles[1], shift=UP * 0.15), FadeIn(tiles[2], shift=UP * 0.15), run_time=0.4, lead=0.2)

        # Win-rate ring.
        ring_bg = Circle(radius=0.32, stroke_color=EDGE, stroke_width=7)
        ring_bg.move_to(tiles[3][0].get_right() + LEFT * 0.55)
        sweep = ValueTracker(0.001)
        ring = always_redraw(lambda: Arc(radius=0.32, start_angle=PI / 2, angle=-TAU * sweep.get_value(), stroke_color=GLOW,
                                         stroke_width=7, arc_center=ring_bg.get_center()))
        self.play_cue("win", FadeIn(tiles[3], shift=UP * 0.15), FadeIn(ring_bg), run_time=0.35, lead=0.2)
        self.add(ring)
        self.play(sweep.animate.set_value(0.42), run_time=0.8)

        # Revenue vs forecast bars (illustrative).
        months = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]
        won = [14, 17, 15, 19, 22, 21.5]
        fc = [15, 16, 18, 20, 21, 24]
        ax = Axes(x_range=[0, 6.5, 1], y_range=[0, 26, 5], x_length=6.6, y_length=3.4,
                  axis_config={"color": EDGE, "stroke_width": 2, "include_ticks": False}, tips=False)
        ax.move_to(LEFT * 3.0 + DOWN * 1.6)
        bars = VGroup()
        fbars = VGroup()
        mlabels = VGroup()
        for i, (m, w, f) in enumerate(zip(months, won, fc)):
            x = i + 0.75
            b = Rectangle(width=0.36, height=ax.y_axis.unit_size * w, stroke_width=0).set_fill(SKY2, 0.85)
            b.move_to(ax.c2p(x - 0.2, 0), aligned_edge=DOWN)
            fb = Rectangle(width=0.36, height=ax.y_axis.unit_size * f, stroke_color=GOLD, stroke_width=2).set_fill(GOLD, 0.12)
            fb.move_to(ax.c2p(x + 0.2, 0), aligned_edge=DOWN)
            bars.add(b)
            fbars.add(fb)
            mlabels.add(T(m, 15, MUTED).next_to(ax.c2p(x, 0), DOWN, buff=0.12))
        legend = VGroup(
            VGroup(Square(0.18, stroke_width=0).set_fill(SKY2, 0.85), T("won", 15, MUTED)).arrange(RIGHT, buff=0.1),
            VGroup(Square(0.18, stroke_color=GOLD, stroke_width=2).set_fill(GOLD, 0.12), T("forecast", 15, MUTED)).arrange(RIGHT, buff=0.1),
        ).arrange(RIGHT, buff=0.35).next_to(ax, UP, buff=0.12).align_to(ax, LEFT)
        self.play(Create(ax), FadeIn(mlabels), FadeIn(legend),
                  LaggedStart(*[GrowFromEdge(b, DOWN) for b in bars], lag_ratio=0.08),
                  LaggedStart(*[GrowFromEdge(b, DOWN) for b in fbars], lag_ratio=0.08), run_time=1.0)

        # Live audit trail.
        panel = card(5.9, 3.5, color=EDGE).move_to(RIGHT * 3.55 + DOWN * 1.55)
        ptitle = T("Audit trail · live", 18, MINT, weight="SEMIBOLD").next_to(panel.get_corner(UL), DR, buff=0.2)
        entries = [
            "09:41  Sam      opportunity.stage → Proposal",
            "09:43  Priya    invoice.sent  #INV-0142",
            "09:47  Ana      timesheet.approved  Ben",
            "09:52  Jordan   contact.merged",
            "09:55  Sam      export.csv  reports/funnel",
        ]
        lines = VGroup(*[mono(e, 14, TEXT) for e in entries]).arrange(DOWN, aligned_edge=LEFT, buff=0.2)
        lines.next_to(ptitle, DOWN, aligned_edge=LEFT, buff=0.25)
        self.play_cue("audit", FadeIn(panel), FadeIn(ptitle), run_time=0.4, lead=0.3)
        self.play(LaggedStart(*[FadeIn(l, shift=UP * 0.15) for l in lines], lag_ratio=0.25), run_time=1.4)
        self.add(footnote("Dashboard figures: illustrative, synthetic data"))
        self.outro()
