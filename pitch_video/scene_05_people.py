from manim import *

from common import *


class People(PitchScene):
    SID = "s05"

    def construct(self):
        k = kicker("05 · PEOPLE & PERMISSIONS", MINT)
        self.add(k)

        l1 = T("People are where most CRMs stop.", 40, MUTED, weight="SEMIBOLD")
        l2 = T("Meroidea keeps going.", 40, TEXT, weight="SEMIBOLD")
        VGroup(l1, l2).arrange(DOWN, buff=0.3)
        self.play_cue("people", FadeIn(l1, shift=UP * 0.2), run_time=0.8, lead=0.05)
        self.play_cue("meroidea", FadeIn(l2, shift=UP * 0.2), run_time=0.7, lead=0.2)

        # ---- Scopes: own ⊂ team ⊂ all ----------------------------------------------------------
        badges = VGroup(pill("Admin", GLOW, 24), pill("Manager", SKY, 24), pill("Staff", MINT, 24))
        badges.arrange(DOWN, buff=0.55, aligned_edge=LEFT).move_to(RIGHT * 3.6 + UP * 0.2)
        self.cue("admins", lead=0.5)
        self.play(FadeOut(VGroup(l1, l2), shift=UP * 0.3), FadeIn(badges[0], shift=LEFT * 0.2), run_time=0.45)
        for word, b in zip(["managers", "staff"], badges[1:]):
            self.play_cue(word, FadeIn(b, shift=LEFT * 0.2), run_time=0.35, lead=0.2)

        centre = LEFT * 2.3 + DOWN * 0.1
        circles = [
            (1.0, MINT, "own"),
            (1.9, SKY, "team"),
            (2.85, GLOW, "all"),
        ]
        rings = VGroup()
        labels = VGroup()
        for r, col, lab in circles:
            c = Circle(radius=r, stroke_color=col, stroke_width=3).set_fill(col, opacity=0.08).move_to(centre)
            t = T(lab, 24, col, weight="SEMIBOLD", font=MONO).move_to(centre + UP * (r - 0.36))
            rings.add(c)
            labels.add(t)
        me = glow_dot(MINT, 0.09).move_to(centre + DOWN * 0.15)
        arrows = VGroup()
        for word, ring, lab, badge in zip(["own", "teams", "everything"], rings, labels, reversed(badges)):
            self.cue(word, lead=0.3)
            a = Arrow(badge.get_left(), ring.point_at_angle(PI / 9), buff=0.12, stroke_width=2.5,
                      color=badge[0].get_stroke_color(), max_tip_length_to_length_ratio=0.08)
            arrows.add(a)
            anims = [GrowFromCenter(ring), FadeIn(lab), GrowArrow(a)]
            if word == "own":
                anims.append(FadeIn(me))
            self.play(*anims, run_time=0.55)
        scope = VGroup(rings, labels, me, arrows, badges)

        # ---- Rosters costed live -----------------------------------------------------------------
        self.cue("rosters", lead=0.35)
        self.play(FadeOut(scope, shift=LEFT * 0.4), run_time=0.5)
        days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        staff = ["Ana", "Ben", "Chloe"]
        cw, ch = 1.25, 0.58
        grid = VGroup()
        head = VGroup(*[T(d, 18, MUTED, weight="MEDIUM") for d in days])
        for i, d in enumerate(head):
            d.move_to(RIGHT * (i * (cw + 0.08)))
        grid_cells = {}
        rows = VGroup()
        for r, name in enumerate(staff):
            row = VGroup()
            for c in range(7):
                box = RoundedRectangle(width=cw, height=ch, corner_radius=0.08, stroke_color=EDGE, stroke_width=1.2)
                box.set_fill(PANEL, opacity=1).move_to(RIGHT * (c * (cw + 0.08)) + DOWN * ((r + 1) * (ch + 0.1)))
                row.add(box)
                grid_cells[(r, c)] = box
            rows.add(row)
        names = VGroup(*[T(n, 18, TEXT).next_to(rows[i][0], LEFT, buff=0.25) for i, n in enumerate(staff)])
        roster = VGroup(head, rows, names).move_to(UP * 0.9)
        shifts = [(0, 0), (0, 1), (0, 4), (0, 5), (1, 1), (1, 2), (1, 3), (1, 6), (2, 0), (2, 3), (2, 4), (2, 5), (2, 6)]
        holiday = (1, 3)
        fills = []
        for (r, c) in shifts:
            box = grid_cells[(r, c)]
            label = "PH" if (r, c) == holiday else "9–5" if c < 5 else "10–4"
            t = T(label, 16, TEXT, font=MONO).move_to(box)
            fills.append((box, t, (r, c)))
        cost = ValueTracker(0)
        cost_t = always_redraw(lambda: VGroup(
            T("wage cost, live", 20, MUTED),
            T(f"${cost.get_value():,.0f}", 34, GOLD, weight="BOLD", font=MONO)).arrange(RIGHT, buff=0.3)
            .next_to(roster, DOWN, buff=0.4))
        self.play(FadeIn(head), FadeIn(rows), FadeIn(names), run_time=0.6)
        self.add(cost_t)
        self.play(LaggedStart(*[AnimationGroup(b.animate.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(SKY2), 0.3), opacity=1),
                                               FadeIn(t)) for b, t, _ in fills], lag_ratio=0.08),
                  cost.animate.set_value(3120), run_time=1.6)
        award = pill("Restaurant Industry Award · clause-referenced rules", SKY, 18).next_to(roster, UP, buff=0.3)
        self.play_cue("award", FadeIn(award, shift=DOWN * 0.15), run_time=0.5, lead=0.25)
        weekend = [(b, t) for b, t, rc in fills if rc[1] >= 5]
        self.play_cue("weekend", *[b.animate.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(GOLD), 0.45), opacity=1).set_stroke(GOLD)
                                   for b, _ in weekend], cost.animate.set_value(3842), run_time=0.7, lead=0.2)
        ph_box = grid_cells[holiday]
        self.play_cue("publicholiday", ph_box.animate.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(CORAL), 0.5), opacity=1).set_stroke(CORAL),
                      cost.animate.set_value(4286), run_time=0.7, lead=0.2)

        # ---- Timesheets → payslips, and the sign-off rule ---------------------------------------------
        self.cue("approved", lead=0.3)
        roster.add(VGroup(*[t for _, t, _ in fills]))
        self.play(VGroup(roster, award).animate.scale(0.6).to_edge(UP, buff=0.9), FadeOut(cost_t), run_time=0.6)
        ts = node("Timesheet ✓ approved", MINT, 22)
        ps = node("Payslip · tax · super", GOLD, 22)
        VGroup(ts, ps).arrange(RIGHT, buff=2.0).move_to(DOWN * 0.6)
        ar = Arrow(ts.get_right(), ps.get_left(), buff=0.15, color=TEXT, stroke_width=3)
        self.play(FadeIn(ts, shift=RIGHT * 0.2), run_time=0.4)
        self.play_cue("payslips", GrowArrow(ar), FadeIn(ps, shift=RIGHT * 0.2), run_time=0.6, lead=0.4)

        self.cue("nobody", lead=0.3)
        own = pill("Approve my own hours", CORAL, 20).next_to(ts, DOWN, buff=0.45)
        strike = Line(own.get_left() + LEFT * 0.12, own.get_right() + RIGHT * 0.12, color=CORAL, stroke_width=4)
        self.play(FadeIn(own, shift=UP * 0.1), run_time=0.45)
        self.play(Create(strike), run_time=0.35)
        rule = T("Nobody signs off their own pay.", 30, TEXT, weight="SEMIBOLD").to_edge(DOWN, buff=0.55)
        self.play(FadeIn(rule, shift=UP * 0.15), run_time=0.5)
        self.outro()
