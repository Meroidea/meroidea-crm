from manim import *

from common import *


class Architecture(PitchScene):
    SID = "s03"

    def construct(self):
        k = kicker("03 · ISOLATION BY CONSTRUCTION")
        self.add(k)

        # ---- Part 1: row-level security ---------------------------------------------------------
        headline = T("The database enforces isolation.", 38, TEXT, weight="SEMIBOLD").to_edge(UP, buff=1.05)
        self.play_cue("isolation", FadeIn(headline, shift=DOWN * 0.2), run_time=0.9, lead=0.05)

        cols = ["tenant_id", "record", "amount"]
        rows = [("A", "Opportunity", "$12,000"), ("B", "Opportunity", "$8,500"), ("A", "Contact", "—"),
                ("B", "Invoice", "$1,100"), ("A", "Roster shift", "$264")]
        widths = [1.7, 2.4, 1.6]
        tcolor = {"A": SKY, "B": GOLD}

        def cell(txt, w, color=TEXT, fill=PANEL, size=20, bold=False):
            box = Rectangle(width=w, height=0.5, stroke_color=EDGE, stroke_width=1).set_fill(fill, opacity=1)
            t = mono(txt, size, color, weight="BOLD" if bold else "NORMAL").move_to(box)
            return VGroup(box, t)

        header = VGroup(*[cell(c, w, MUTED, MUTED_BG, 18) for c, w in zip(cols, widths)]).arrange(RIGHT, buff=0)
        body = VGroup()
        for tid, rec, amt in rows:
            r = VGroup(cell(tid, widths[0], tcolor[tid], bold=True), cell(rec, widths[1]), cell(amt, widths[2]))
            r.arrange(RIGHT, buff=0)
            r.tid = tid
            body.add(r)
        table = VGroup(header, *body).arrange(DOWN, buff=0).move_to(RIGHT * 2.2 + DOWN * 0.55)
        self.play_cue("table", FadeIn(header), LaggedStart(*[FadeIn(r, shift=UP * 0.1) for r in body], lag_ratio=0.1),
                      run_time=1.0, lead=0.3)
        self.play_cue("tenant", Indicate(header[0], color=MINT, scale_factor=1.08), run_time=0.8)

        shield = VGroup(
            RoundedRectangle(width=0.32, height=3.4, corner_radius=0.16, stroke_color=MINT, stroke_width=3)
            .set_fill(MINT, opacity=0.18),
        )
        shield.next_to(table, LEFT, buff=0.55)
        rls = T("row-level security", 18, MINT, weight="MEDIUM").rotate(PI / 2).next_to(shield, LEFT, buff=0.12)
        self.play_cue("rowlevel", GrowFromEdge(shield, DOWN), FadeIn(rls), run_time=0.8)

        session = node("Business B session", GOLD, 20).move_to(LEFT * 5.3 + DOWN * 0.55)
        self.play_cue("postgres", FadeIn(session, shift=RIGHT * 0.2), run_time=0.5, lead=0.3)

        # B's query sees only B's rows; anything of A's is refused at the shield.
        self.cue("refuses", lead=0.4)
        a_rows = [r for r in body if r.tid == "A"]
        b_rows = [r for r in body if r.tid == "B"]
        probe = glow_dot(CORAL, 0.09).move_to(session.get_right())
        self.play(probe.animate.move_to(shield.get_left() + LEFT * 0.05), run_time=0.5, rate_func=rate_functions.ease_in_quad)
        cross = T("✕ refused", 22, CORAL, weight="BOLD").next_to(shield, UP, buff=0.15)
        self.play(probe.animate.move_to(session.get_right() + RIGHT * 0.3).set_color(CORAL), FadeIn(cross),
                  *[r.animate.set_opacity(0.18) for r in a_rows],
                  *[r[0][0].animate.set_stroke(GOLD, width=2) for r in b_rows], run_time=0.7)
        self.play(FadeOut(probe), run_time=0.3)

        # ---- Part 2: eight gates ----------------------------------------------------------------
        self.cue("every", lead=0.3)
        part1 = VGroup(headline, table, shield, rls, session, cross)
        self.play(FadeOut(part1, shift=UP * 0.3), run_time=0.6)
        head2 = T("Every change passes the same eight gates.", 36, TEXT, weight="SEMIBOLD").to_edge(UP, buff=1.05)
        labels = ["Authenticate", "Resolve tenant", "Permission + scope", "Validate (Zod)",
                  "Business rules", "Commit (tx)", "Audit", "Revalidate"]
        gates = VGroup()
        for i, lab in enumerate(labels):
            n = node(lab, SKY2, 20, width=2.95)
            num = T(f"{i + 1}", 16, MUTED, font=MONO).next_to(n, UP, buff=0.08).align_to(n, LEFT)
            gates.add(VGroup(n, num))
        row1 = VGroup(*gates[:4]).arrange(RIGHT, buff=0.36)
        row2 = VGroup(*gates[4:]).arrange(RIGHT, buff=0.36)
        VGroup(row1, row2).arrange(DOWN, buff=0.85).move_to(DOWN * 0.35)
        rails = VGroup()
        for a, b in zip(gates[:-1], gates[1:]):
            if a in row1 and b in row2:
                p1, p2 = a[0].get_bottom(), b[0].get_top()
                path = VMobject(stroke_color=EDGE, stroke_width=2.5)
                path.set_points_as_corners([p1, p1 + DOWN * 0.38, p2 + UP * 0.38 + (p1 - p2) * [0, 0, 0], p2])
                path.set_points_as_corners([p1, [p1[0], (p1[1] + p2[1]) / 2, 0], [p2[0], (p1[1] + p2[1]) / 2, 0], p2])
                rails.add(path)
            else:
                rails.add(Line(a[0].get_right(), b[0].get_left(), stroke_color=EDGE, stroke_width=2.5))
        self.play(FadeIn(head2, shift=DOWN * 0.2), LaggedStart(*[FadeIn(g, shift=UP * 0.15) for g in gates], lag_ratio=0.06),
                  Create(rails), run_time=1.2)

        packet = glow_dot(GLOW, 0.1).move_to(gates[0][0].get_left() + LEFT * 0.5)
        self.add(packet)
        cues = ["authenticate", "resolve", "check", "validate", "apply", "commit", "audit", "refresh"]
        log = None
        for i, (g, word) in enumerate(zip(gates, cues)):
            self.cue(word, lead=0.25)
            box = g[0][0]
            anims = [packet.animate.move_to(box.get_center()),
                     box.animate.set_stroke(MINT, width=2.6).set_fill(interpolate_color(ManimColor(PANEL), ManimColor(MINT), 0.18), opacity=1),
                     g[0][1].animate.set_stroke(MINT)]
            if word == "audit":
                log = mono("audit_logs ← opportunity.stage_changed · who · when · diff", 17, GOLD)
                log.next_to(VGroup(row1, row2), DOWN, buff=0.45)
                anims.append(FadeIn(log, shift=DOWN * 0.15))
            self.play(*anims, run_time=0.38 if word != "audit" else 0.6, rate_func=smooth)

        self.cue("nothing", lead=0.2)
        tag = pill("authedAction() · the only path to a write", MINT, 24)
        tag.next_to(log, DOWN, buff=0.3)
        self.play(FadeOut(packet), FadeIn(tag, shift=UP * 0.15),
                  *[Indicate(g[0][0], color=MINT, scale_factor=1.03) for g in gates], run_time=0.9)
        self.outro()
