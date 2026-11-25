from manim import *

from common import *


def task_row(label: str, tag: str, color: str, w: float = 3.7):
    bg = RoundedRectangle(width=w, height=0.62, corner_radius=0.14, stroke_width=0).set_fill(PANEL, 1)
    box = RoundedRectangle(width=0.26, height=0.26, corner_radius=0.06, stroke_color=color, stroke_width=2.4)
    t = T(label, 16, TEXT, weight="MEDIUM")
    tg = T(tag, 13, color, weight="SEMIBOLD")
    VGroup(box, t).arrange(RIGHT, buff=0.18).move_to(bg).align_to(bg, LEFT).shift(RIGHT * 0.18)
    tg.move_to(bg).align_to(bg, RIGHT).shift(LEFT * 0.18)
    return VGroup(bg, box, t, tg)


class MyDay(PitchScene):
    SID = "s05"
    PUSH = 0.07

    def construct(self):
        ph = phone(4.3, 6.6).move_to(DOWN * 0.3)
        title = T("My Day", 30, TEXT, weight="BOLD").move_to(ph[1].get_top() + DOWN * 0.75).align_to(ph[1], LEFT).shift(RIGHT * 0.3)
        sub = T("Tuesday · 6 things", 15, MUTED).next_to(title, DOWN, buff=0.06, aligned_edge=LEFT)

        items = [("Call back Ben", "Overdue", CORAL), ("Quote #142", "Overdue", CORAL), ("Follow up Ana", "Today", BRAND),
                 ("Supplier order", "Today", BRAND), ("Approve leave", "Today", BRAND), ("Team training", "Thu", MUTED)]
        rows = VGroup(*[task_row(*it) for it in items]).arrange(DOWN, buff=0.14)
        rows.next_to(sub, DOWN, buff=0.3).align_to(sub, LEFT)

        self.cue("followups", lead=0.2)
        self.sfx("swish", -7)
        self.play(FadeIn(ph, shift=UP * 0.6), run_time=0.3)
        # Notifications fly in from both sides and slot into the list.
        anims = []
        for i, r in enumerate(rows):
            side = LEFT if i % 2 == 0 else RIGHT
            start = r.copy().scale(1.25).move_to(side * 5.5 + UP * (1.5 - i * 0.55))
            anims.append(Succession(FadeIn(start, run_time=0.05), ReplacementTransform(start, r, run_time=0.45,
                                                                                       rate_func=rate_functions.ease_out_cubic)))
        self.sfx_seq("swish", 6, 0.2, -13)
        self.sfx_seq("pop", 6, 0.2, -9, 0.4)
        self.play(LaggedStart(*anims, lag_ratio=0.18), run_time=1.6)
        bell = icon("bell", CORAL, 0.35).next_to(ph[0], RIGHT, buff=0.4).shift(UP * 2.2)
        self.sfx("ping", -3, max(0.0, self.sync.words[[w for w, _ in self.sync.words].index("overdue")][1] - 0.2 - self.now))
        self.play_cue("overdue", FadeIn(bell, scale=1.4), Wiggle(bell, rotation_angle=0.12 * TAU), run_time=0.5, lead=0.2)

        self.cue("my", lead=0.25)
        self.sfx("pop", -6)
        self.play(FadeIn(title, shift=DOWN * 0.15), FadeIn(sub), FadeOut(bell), run_time=0.3)

        # Nothing slips: tasks tick off one after another.
        self.cue("nothing", lead=0.3)
        ticks = []
        for r in rows[:5]:
            ck = icon("check", MINT, 0.16).move_to(r[1])
            strike = Line(r[2].get_left(), r[2].get_right(), stroke_color=MUTED, stroke_width=2)
            ticks.append(AnimationGroup(r[1].animate.set_fill(MINT, 0.15).set_stroke(MINT), Create(ck), Create(strike),
                                        r[2].animate.set_opacity(0.5)))
        self.sfx_seq("tick", 5, 0.235, -4)
        self.play(LaggedStart(*ticks, lag_ratio=0.3), run_time=1.3)
        done = pill("All caught up", MINT, 22).next_to(ph[0], RIGHT, buff=0.45)
        self.sfx("chime", -3)
        self.play(FadeIn(done, scale=1.3), run_time=0.25, rate_func=rate_functions.ease_out_back)
        self.outro()
