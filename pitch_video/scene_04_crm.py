from manim import *

from common import *


def avatar(initials: str, color: str, r: float = 0.36):
    c = Circle(radius=r, stroke_color=color, stroke_width=2.4).set_fill(interpolate_color(ManimColor(PANEL), ManimColor(color), 0.25), opacity=1)
    return VGroup(c, T(initials, 20, TEXT, weight="SEMIBOLD").move_to(c))


class Crm(PitchScene):
    SID = "s04"

    def construct(self):
        k = kicker("04 · CRM & SALES PIPELINE", SKY)
        self.add(k)
        rng = np.random.default_rng(5)

        # ---- Capture ----------------------------------------------------------------------------
        sources = VGroup(*[pill(s, c, 22) for s, c in
                           [("Web forms", SKY), ("Imports", GLOW), ("Referrals", MINT), ("Social", CORAL)]])
        sources.arrange(DOWN, aligned_edge=LEFT, buff=0.42).move_to(LEFT * 5.3)
        queue = card(4.8, 3.3, color=SKY2)
        queue_t = T("Lead queue", 22, TEXT, weight="SEMIBOLD").next_to(queue.get_top(), DOWN, buff=0.22)
        queue_g = VGroup(queue, queue_t).move_to(LEFT * 0.9)
        self.cue("sales", lead=0.1)
        self.play(FadeIn(queue_g), run_time=0.6)
        for word, s in zip(["web", "imports", "referrals", "social"], sources):
            self.play_cue(word, FadeIn(s, shift=RIGHT * 0.3), run_time=0.4, lead=0.2)

        def flow(n=8, rt=1.2):
            dots, anims = VGroup(), []
            for i in range(n):
                s = sources[i % 4]
                d = glow_dot(s[0].get_stroke_color(), 0.06, 3).move_to(s.get_right())
                target = queue.get_center() + np.array([rng.uniform(-1.8, 1.8), rng.uniform(-1.1, 0.6), 0])
                dots.add(d)
                anims.append(d.animate.move_to(target))
            self.play(LaggedStart(*anims, lag_ratio=0.12), run_time=rt)
            return dots

        dots = flow()

        # ---- Duplicates ------------------------------------------------------------------------
        self.cue("duplicates", lead=0.35)
        rows = VGroup(
            pill("ana.lopez@example.com · new row", MUTED, 16, fill_opacity=0.08, text_color=TEXT),
            pill("ana.lopez@example.com · owner: Sam", GOLD, 16, text_color=TEXT),
        ).arrange(DOWN, buff=0.18, aligned_edge=LEFT)
        rows.next_to(queue_t, DOWN, buff=0.3)
        warn = T("⚠ strong match · same email or phone", 17, GOLD, weight="MEDIUM").next_to(rows, DOWN, buff=0.2)
        self.play(FadeOut(dots), FadeIn(rows, shift=UP * 0.1), run_time=0.6)
        self.play(FadeIn(warn), Indicate(rows[1], color=GOLD, scale_factor=1.04), run_time=0.7)
        chips = VGroup(pill("skip", MUTED, 20), pill("merge", MINT, 20), pill("create", SKY, 20)).arrange(RIGHT, buff=0.2)
        chips.next_to(warn, DOWN, buff=0.22)
        for word, c in zip(["skip", "merge", "create"], chips):
            self.play_cue(word, FadeIn(c, scale=0.8), run_time=0.3, lead=0.12)
        self.play(Indicate(chips[1], color=MINT), run_time=0.5)

        # ---- Routing ---------------------------------------------------------------------------
        self.cue("routing", lead=0.3)
        reps = VGroup(avatar("SK", SKY), avatar("JM", MINT), avatar("PR", GOLD)).arrange(DOWN, buff=0.7).move_to(RIGHT * 3.4)
        loads = [3, 1, 2]
        bars = VGroup()
        for rep, n in zip(reps, loads):
            b = Rectangle(width=0.32 * n, height=0.26, stroke_width=0).set_fill(rep[0].get_stroke_color(), opacity=0.7)
            b.next_to(rep, RIGHT, buff=0.25).align_to(rep.get_right() + RIGHT * 0.25, LEFT)
            bars.add(b)
        rlabel = T("Routing rules", 22, TEXT, weight="SEMIBOLD").next_to(reps, UP, buff=0.35).shift(RIGHT * 0.5)
        self.play(FadeIn(reps, shift=LEFT * 0.2), FadeIn(rlabel), FadeOut(VGroup(rows, warn, chips)), run_time=0.7)

        mode = T("round robin", 20, SKY, weight="MEDIUM").next_to(reps, DOWN, buff=0.35).shift(RIGHT * 0.5)
        self.cue("round", lead=0.25)
        self.play(FadeIn(mode), run_time=0.3)
        rr = []
        for i in range(3):
            d = glow_dot(SKY, 0.07, 3).move_to(queue.get_right())
            rr.append(Succession(FadeIn(d, run_time=0.1), d.animate(run_time=0.5).move_to(reps[i][0].get_left()),
                                 FadeOut(d, run_time=0.1)))
        self.play(LaggedStart(*rr, lag_ratio=0.3), run_time=1.3)

        self.cue("leastloaded", lead=0.3)
        mode2 = T("least loaded", 20, MINT, weight="MEDIUM").move_to(mode)
        self.play(ReplacementTransform(mode, mode2), LaggedStart(*[GrowFromEdge(b, LEFT) for b in bars], lag_ratio=0.1), run_time=0.6)
        d = glow_dot(MINT, 0.08, 3).move_to(queue.get_right())
        self.play(d.animate.move_to(reps[1][0].get_left()), run_time=0.55)
        self.play(FadeOut(d), bars[1].animate.stretch_to_fit_width(0.64, about_edge=LEFT), run_time=0.35)

        # ---- Board + weighted forecast -----------------------------------------------------------
        self.cue("board", lead=0.4)
        self.play(*[FadeOut(m) for m in [sources, queue_g, reps, bars, rlabel, mode2]], run_time=0.5)

        stages = [("New", 10, [12000, 6000]), ("Qualified", 30, [18000, 9000]), ("Proposal", 60, [24000]), ("Negotiation", 90, [15000])]
        colw, gap = 3.0, 0.25
        columns = VGroup()
        cards = []
        badges = VGroup()
        for name, p, amounts in stages:
            col = card(colw, 3.5, color=EDGE)
            head = T(name, 20, TEXT, weight="SEMIBOLD").next_to(col.get_top(), DOWN, buff=0.2).align_to(col, LEFT).shift(RIGHT * 0.22)
            badge = pill(f"{p}%", GOLD, 16).next_to(col.get_top(), DOWN, buff=0.16).align_to(col, RIGHT).shift(LEFT * 0.18)
            badges.add(badge)
            group = VGroup(col, head)
            stage_cards = []
            for j, amt in enumerate(amounts):
                cbox = card(colw - 0.4, 0.78, color=SKY2).set_fill(interpolate_color(ManimColor(PANEL), ManimColor(SKY2), 0.1), opacity=1)
                ctext = T(f"${amt:,.0f}", 22, TEXT, weight="MEDIUM", font=MONO).move_to(cbox)
                c = VGroup(cbox, ctext)
                c.amount, c.p = amt, p
                stage_cards.append(c)
            cards.append(stage_cards)
            columns.add(VGroup(group, *stage_cards))
        for colgroup in columns:
            stack = VGroup(*colgroup[1:])
            if len(stack):
                stack.arrange(DOWN, buff=0.48)
        columns.arrange(RIGHT, buff=gap).move_to(UP * 0.35)
        for colgroup in columns:
            stack = VGroup(*colgroup[1:])
            if len(stack):
                stack.next_to(colgroup[0][1], DOWN, buff=0.3).align_to(colgroup[0][0], LEFT).shift(RIGHT * 0.2)
        for b, colgroup in zip(badges, columns):
            b.next_to(colgroup[0][0].get_top(), DOWN, buff=0.16).align_to(colgroup[0][0], RIGHT).shift(LEFT * 0.18)

        self.play(LaggedStart(*[FadeIn(c, shift=UP * 0.2) for c in columns], lag_ratio=0.1), run_time=0.9)
        self.play_cue("probability", LaggedStart(*[FadeIn(b, scale=0.7) for b in badges], lag_ratio=0.12), run_time=0.7, lead=0.3)

        formula = T("weighted forecast  =  Σ  value × stage probability", 26, GOLD, weight="MEDIUM")
        formula.to_edge(DOWN, buff=1.1)
        self.play_cue("weighted", Write(formula), run_time=1.2, lead=0.2)

        self.cue("each", lead=0.2)
        total = ValueTracker(0)
        counter = always_redraw(lambda: T(f"${total.get_value():,.0f}", 40, GOLD, weight="BOLD", font=MONO)
                                .next_to(formula, DOWN, buff=0.22))
        self.add(counter)
        flat = [c for cs in cards for c in cs]
        products = []
        for c in flat:
            prod = T(f"× {c.p / 100:.1f} = ${c.amount * c.p / 100:,.0f}", 18, GOLD, font=MONO)
            prod.next_to(c, DOWN, buff=0.06)
            products.append(prod)
        self.play(LaggedStart(*[FadeIn(p, shift=UP * 0.1) for p in products], lag_ratio=0.1), run_time=1.4)
        weighted = sum(c.amount * c.p / 100 for c in flat)
        self.cue("summed", lead=0.35)
        self.play(*[p.animate.move_to(counter.get_center()).set_opacity(0) for p in products],
                  total.animate.set_value(weighted), run_time=1.0, rate_func=smooth)
        self.remove(*products)

        # ---- MeroAI next best action --------------------------------------------------------------
        self.cue("meroai", lead=0.3)
        board = VGroup(columns, badges)
        self.play(board.animate.set_opacity(0.25), FadeOut(formula), FadeOut(counter), run_time=0.4)
        ai_box = card(9.6, 2.2, color=GLOW, stroke_width=2.4)
        ai_box.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(GLOW), 0.1), opacity=1)
        ai_head = T("MeroAI · next best action", 20, GLOW, weight="SEMIBOLD")
        ai_line = T("Call Ana about the quote", 30, TEXT, weight="SEMIBOLD")
        ai_why = T("$24,000 in Proposal · no activity for 9 days", 20, MUTED)
        btn = pill("Approve", MINT, 22)
        txt = VGroup(ai_head, ai_line, ai_why).arrange(DOWN, aligned_edge=LEFT, buff=0.16)
        txt.move_to(ai_box).align_to(ai_box, LEFT).shift(RIGHT * 0.45)
        btn.move_to(ai_box).align_to(ai_box, RIGHT).shift(LEFT * 0.45)
        ai = VGroup(ai_box, ai_head, ai_line, ai_why, btn).move_to(DOWN * 0.2)
        self.play(FadeIn(ai, shift=UP * 0.2), run_time=0.6)
        self.cue("approves", lead=0.15)
        done = pill("✓ Approved by Sam", MINT, 22, fill_opacity=0.35).move_to(btn).align_to(ai_box, RIGHT).shift(LEFT * 0.45)
        self.play(ReplacementTransform(btn, done), ai_box.animate.set_stroke(MINT), run_time=0.5)
        note = T("Every AI tool prepares a preview. A person makes the change.", 20, MUTED).next_to(ai, DOWN, buff=0.35)
        self.play(FadeIn(note), run_time=0.5)
        self.outro()
