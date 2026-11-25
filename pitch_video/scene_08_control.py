from manim import *

from common import *


def person(initials: str, color: str, r: float = 0.3):
    c = Circle(radius=r, stroke_color="#FFFFFF", stroke_width=3).set_fill(color, 1)
    return VGroup(c, T(initials, 15 * r / 0.3, "#FFFFFF", weight="BOLD").move_to(c))


class Control(PitchScene):
    SID = "s08"

    def construct(self):
        rng = np.random.default_rng(12)
        head = T("Everyone sees exactly what they should.", 44, TEXT, weight="BOLD").to_edge(UP, buff=0.55)
        self.cue("everyone", lead=0.1)
        self.sfx("swish", -7)
        self.play(FadeIn(head, shift=UP * 0.3), run_time=0.4)

        centre = LEFT * 2.6 + DOWN * 0.55
        # A field of records (dots); each ring lights the records inside it.
        recs = VGroup()
        for _ in range(110):
            ang, rad = rng.uniform(0, TAU), np.sqrt(rng.uniform(0, 1)) * 2.75
            recs.add(Dot(radius=0.06, color="#C9CFE3").move_to(centre + rad * np.array([np.cos(ang), np.sin(ang), 0])))
        self.sfx("sparkle", -10)
        self.play(LaggedStart(*[FadeIn(d, scale=0.3) for d in recs], lag_ratio=0.005), run_time=0.5)

        levels = [("Staff", "own work", 0.95, SKY, "staff"), ("Managers", "their team", 1.85, INFO, "managers"),
                  ("Owners", "everything", 2.85, BRAND, "owners")]
        rings = VGroup()
        tags = VGroup()
        for i, (who, what, r, col, word) in enumerate(levels):
            self.cue(word, lead=0.15)
            ring = Circle(radius=r, stroke_color=col, stroke_width=4).set_fill(col, 0.06).move_to(centre)
            inside = [d for d in recs if np.linalg.norm(d.get_center() - centre) <= r]
            av = person(who[0], col, 0.28).move_to(centre + r * np.array([np.cos(0.6), np.sin(0.6), 0]))
            tag = VGroup(T(who, 22, col, weight="BOLD"), T(what, 18, MUTED)).arrange(DOWN, aligned_edge=LEFT, buff=0.04)
            tag.move_to(RIGHT * 2.6 + UP * (1.3 - 1.1 * i)).align_to(RIGHT * 1.7, LEFT)
            dot = person(who[0], col, 0.24).next_to(tag, LEFT, buff=0.25)
            self.sfx("pop", -4)
            self.sfx("swish", -11)
            self.play(GrowFromCenter(ring), FadeIn(av, scale=0.4), *[d.animate.set_color(col) for d in inside],
                      FadeIn(VGroup(dot, tag), shift=LEFT * 0.3), run_time=0.45, rate_func=rate_functions.ease_out_back)
            rings.add(ring, av)
            tags.add(dot, tag)

        # Every change recorded: an activity feed streams in.
        self.cue("recorded", lead=0.3)
        self.sfx("whoosh", -9)
        self.play(FadeOut(tags, shift=RIGHT * 0.3), FadeOut(head, shift=UP * 0.3),
                  VGroup(rings, recs).animate.scale(0.75).move_to(LEFT * 3.6 + DOWN * 0.1), run_time=0.4)
        feed = shadow_card(6.6, 5.6).move_to(RIGHT * 2.75 + DOWN * 0.1)
        ft = T("Activity", 22, TEXT, weight="BOLD").next_to(feed[1].get_corner(UL), DR, buff=0.3)
        live = VGroup(Dot(radius=0.06, color=CORAL), T("live", 14, CORAL, weight="SEMIBOLD")).arrange(RIGHT, buff=0.08)
        live.next_to(feed[1].get_corner(UR), DL, buff=0.32)
        self.sfx("swish", -9)
        self.play(FadeIn(feed, shift=LEFT * 0.4), FadeIn(ft), FadeIn(live), run_time=0.3)
        entries = [("SK", "Sam moved Ana's deal to Quoted", "09:41", BRAND), ("PR", "Priya sent invoice INV-0142", "09:43", INFO),
                   ("JM", "Jordan approved Ben's timesheet", "09:47", SKY), ("AL", "Ana published next week's roster", "09:52", MINT),
                   ("SK", "Sam replied to a WhatsApp message", "09:55", BRAND)]
        rows = VGroup()
        for ini, txt, tm, col in entries:
            r = VGroup(person(ini, col, 0.22), T(txt, 15, TEXT), T(tm, 13, MUTED, font=MONO)).arrange(RIGHT, buff=0.2)
            rows.add(r)
        rows.arrange(DOWN, aligned_edge=LEFT, buff=0.32).next_to(ft, DOWN, buff=0.35).align_to(ft, LEFT)
        for r in rows:
            r[2].align_to(feed[1], RIGHT).shift(LEFT * 0.3)
        self.sfx_seq("tick", 5, 0.33, -7)
        self.play(LaggedStart(*[FadeIn(r, shift=DOWN * 0.35) for r in rows], lag_ratio=0.3), run_time=1.7)
        self.sfx("ping", -7)
        self.play(Flash(live[0], color=CORAL, line_length=0.12, flash_radius=0.16), run_time=0.3)
        self.play_cue("who", Indicate(rows[2], color=BRAND, scale_factor=1.04), run_time=0.4, lead=0.25)
        self.outro()
