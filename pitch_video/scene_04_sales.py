from manim import *

from common import *


def deal(name: str, amt: str, color: str = SKY, w: float = 2.45):
    sc = shadow_card(w, 0.92, radius=0.14, depth=0.05)
    bar = RoundedRectangle(width=0.08, height=0.6, corner_radius=0.04, stroke_width=0).set_fill(color, 1)
    nm = T(name, 16, TEXT, weight="SEMIBOLD")
    am = T(amt, 15, MUTED, font=MONO)
    body = VGroup(nm, am).arrange(DOWN, aligned_edge=LEFT, buff=0.06)
    VGroup(bar, body).arrange(RIGHT, buff=0.18).move_to(sc[1]).align_to(sc[1], LEFT).shift(RIGHT * 0.15)
    return VGroup(sc, bar, body)


class Sales(PitchScene):
    SID = "s04"

    def construct(self):
        win = laptop(12.4, 6.6).move_to(DOWN * 0.3)
        title = T("Pipeline", 22, TEXT, weight="BOLD").move_to(win[1]).align_to(win[1], LEFT).shift(RIGHT * 1.0)
        stages = ["New", "Quoted", "Negotiating", "Won"]
        cols = VGroup()
        for s_ in stages:
            c = RoundedRectangle(width=2.75, height=4.6, corner_radius=0.16, stroke_width=0).set_fill(MUTED_BG, 1)
            h = T(s_, 18, MUTED, weight="SEMIBOLD").next_to(c.get_top(), DOWN, buff=0.18).align_to(c, LEFT).shift(RIGHT * 0.2)
            cols.add(VGroup(c, h))
        cols.arrange(RIGHT, buff=0.22).move_to(win[0][1]).shift(DOWN * 0.55 + LEFT * 0.0)
        # Forecast KPI in the window header.
        fc_val = ValueTracker(31200)
        fc = always_redraw(lambda: VGroup(T("Forecast", 15, MUTED), T(f"${fc_val.get_value():,.0f}", 24, BRAND, weight="BOLD", font=MONO))
                           .arrange(RIGHT, buff=0.2).next_to(cols, UP, buff=0.22).align_to(cols, RIGHT))
        data = [[("Ben Ng", "$4,800"), ("Dev Patel", "$2,200")], [("Ana Lopez", "$9,600"), ("Acme Pty", "$6,000")],
                [("Chloe Wu", "$12,000"), ("Kiran S.", "$3,400")], [("Lee Café", "$7,500")]]
        colors = [SKY, INFO, BRAND, MINT]
        cards = []
        for ci, col in enumerate(cols):
            stack = []
            for j, (n, a) in enumerate(data[ci]):
                d = deal(n, a, colors[ci]).next_to(col[1], DOWN, buff=0.22 + j * 1.05).align_to(col[0], LEFT).shift(RIGHT * 0.15)
                stack.append(d)
            cards.append(stack)

        self.cue("pipeline", lead=0.2)
        self.play(FadeIn(win, scale=0.92), FadeIn(title), LaggedStart(*[FadeIn(c, shift=UP * 0.3) for c in cols], lag_ratio=0.08),
                  run_time=0.5)
        self.add(fc)
        flat = [c for s_ in cards for c in s_]
        self.play(LaggedStart(*[FadeIn(c, shift=DOWN * 0.4) for c in flat], lag_ratio=0.08,
                              rate_func=rate_functions.ease_out_back), run_time=1.0)

        # Stuck: one deal pulses with an age tag.
        stuck = cards[1][0]
        self.cue("stuck", lead=0.3)
        age = pill("12 days", CORAL, 14).next_to(stuck[0][1].get_corner(UR), DL, buff=0.08).shift(UP * 0.28)
        self.play(stuck[0][1].animate.set_stroke(CORAL, width=3), FadeIn(age, scale=1.4), run_time=0.3)
        self.play(Wiggle(stuck, scale_value=1.05, rotation_angle=0.03 * TAU), run_time=0.5)

        # Drag a deal forward: lift, arc across, drop, ripple; forecast counts up.
        self.cue("drag", lead=0.2)
        self.play(self.zoom.animate.set_value(0.88), self.focus.animate.move_to(LEFT * 0.4 + DOWN * 0.2), run_time=0.35)
        cursor = Polygon([0, 0, 0], [0, -0.42, 0], [0.11, -0.31, 0], [0.24, -0.5, 0], [0.32, -0.45, 0], [0.19, -0.27, 0], [0.33, -0.27, 0],
                         stroke_color="#FFFFFF", stroke_width=2).set_fill(TEXT, 1).scale(0.9)
        cursor.move_to(stuck.get_center() + RIGHT * 0.5 + DOWN * 0.1, aligned_edge=UL)
        self.play(FadeIn(cursor, shift=UP * 0.2), run_time=0.15)
        self.play(stuck.animate.scale(1.08).shift(UP * 0.12), FadeOut(age), cursor.animate.shift(UP * 0.12), run_time=0.15)
        target = cols[2][1].get_bottom() + DOWN * (0.22 + 2 * 1.05 + 0.46)
        target = np.array([cols[2][0].get_left()[0] + 0.15 + stuck.width / 2 / 1.08, target[1], 0])
        path = ArcBetweenPoints(stuck.get_center(), target, angle=-0.6)
        self.play(MoveAlongPath(stuck, path), cursor.animate.move_to(target + RIGHT * 0.5 + DOWN * 0.1, aligned_edge=UL),
                  run_time=0.55, rate_func=rate_functions.ease_in_out_cubic)
        self.play(stuck.animate.scale(1 / 1.08), stuck[0][1].animate.set_stroke(EDGE, width=1.4), FadeOut(cursor),
                  cards[1][1].animate.shift(UP * 1.05), run_time=0.2)
        ring = RoundedRectangle(width=stuck.width, height=stuck.height, corner_radius=0.14, stroke_color=BRAND,
                                stroke_width=4).move_to(stuck)
        self.cue("forecast", lead=0.3)
        self.play(ring.animate.scale(1.4).set_stroke(opacity=0), fc_val.animate.set_value(34080),
                  self.zoom.animate.set_value(0.95), self.focus.animate.move_to(ORIGIN), run_time=0.8)
        up = VGroup(Triangle(stroke_width=0).set_fill(MINT, 1).scale(0.1), T("+$2,880", 16, MINT, weight="BOLD")).arrange(RIGHT, buff=0.1)
        up.next_to(fc, DOWN, buff=0.08).align_to(fc, RIGHT)
        self.play(FadeIn(up, shift=UP * 0.2), run_time=0.25)

        # Who to call next, and why.
        self.cue("meroidea", lead=0.3)
        veil = Rectangle(width=30, height=20, stroke_width=0).set_fill(BG, 0.55)
        ai = shadow_card(6.6, 1.9, color=INFO, radius=0.22).move_to(RIGHT * 2.4 + DOWN * 1.4)
        sparkle = VGroup(*[Star(n=4, outer_radius=r, inner_radius=r * 0.35, stroke_width=0).set_fill(INFO, 1).shift(off)
                           for r, off in ((0.16, ORIGIN), (0.08, RIGHT * 0.2 + UP * 0.17))])
        h1 = T("Call Ana Lopez today", 26, TEXT, weight="BOLD")
        h2 = T("$9,600 quote · no reply in 9 days", 17, MUTED)
        hl = T("MeroAI · next best action", 15, INFO, weight="SEMIBOLD")
        txt = VGroup(hl, h1, h2).arrange(DOWN, aligned_edge=LEFT, buff=0.08)
        VGroup(sparkle, txt).arrange(RIGHT, buff=0.3, aligned_edge=UP).move_to(ai[1])
        self.play(FadeIn(veil), FadeIn(VGroup(ai, sparkle, txt), shift=LEFT * 1.0), run_time=0.4,
                  rate_func=rate_functions.ease_out_back)
        self.play(Rotate(sparkle, PI / 2), run_time=0.5)
        self.play_cue("why", Indicate(h2, color=BRAND, scale_factor=1.06), run_time=0.4, lead=0.2)
        self.outro()
