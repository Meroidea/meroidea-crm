from manim import *

from common import *


def board(title: str, stages: list[str], field: str, color: str):
    head = T(title, 30, TEXT, weight="BOLD")
    cols = VGroup()
    for s in stages:
        box = card(2.75, 2.3, color=EDGE)
        lab = T(s, 21, color, weight="SEMIBOLD").next_to(box.get_top(), DOWN, buff=0.22)
        cols.add(VGroup(box, lab))
    cols.arrange(RIGHT, buff=0.25)
    head.next_to(cols, UP, buff=0.35).align_to(cols, LEFT)
    c = card(2.35, 1.0, color=SKY2).set_fill(interpolate_color(ManimColor(PANEL), ManimColor(SKY2), 0.1), 1)
    f = pill(field, GOLD, 16, text_color=TEXT)
    nm = T("Record #1042", 17, TEXT, weight="MEDIUM")
    VGroup(nm, f).arrange(DOWN, buff=0.1, aligned_edge=LEFT).move_to(c)
    rec = VGroup(c, nm, f).next_to(cols[1][1], DOWN, buff=0.25)
    return VGroup(head, cols, rec)


class Moat(PitchScene):
    SID = "s08"

    def construct(self):
        k = kicker("08 · THE MOAT")
        self.add(k)

        headline = VGroup(T("Configuration", 44, GLOW, weight="BOLD"), T("over", 44, MUTED, weight="MEDIUM"),
                          T("customisation", 44, TEXT, weight="BOLD")).arrange(RIGHT, buff=0.3).to_edge(UP, buff=1.0)
        self.play_cue("configuration", FadeIn(headline[0], shift=UP * 0.2), run_time=0.5, lead=0.2)
        self.play_cue("customisation", FadeIn(headline[1:], shift=UP * 0.2), run_time=0.5, lead=0.4)

        a = board("Cases · migration agency", ["Enquiry", "Consultation", "Applied", "Enrolled"], "Visa subclass: 500", SKY)
        b = board("Bookings · restaurant catering", ["Enquiry", "Tasting", "Quote sent", "Booked"], "Guest count: 40", GOLD)
        for x in (a, b):
            x.move_to(DOWN * 0.55)
        self.play_cue("migration", FadeIn(a, shift=UP * 0.2), run_time=0.7, lead=0.35)
        self.cue("restaurants", lead=0.25)
        self.play(Transform(a[0], b[0]), run_time=0.8)

        # Labels, stages, fields: each morphs on its word.
        self.play_cue("labels", Indicate(a[0], color=GOLD, scale_factor=1.05), run_time=0.45, lead=0.2)
        self.play_cue("stages", *[Transform(ca[1], cb[1]) for ca, cb in zip(a[1], b[1])], run_time=0.6, lead=0.2)
        self.play_cue("fields", Transform(a[2], b[2]), run_time=0.5, lead=0.2)

        quote = pill("Developer quote", CORAL, 22).next_to(a, DOWN, buff=0.3)
        strike = Line(quote.get_left() + LEFT * 0.1, quote.get_right() + RIGHT * 0.1, color=CORAL, stroke_width=4)
        self.play_cue("developer", FadeIn(quote), run_time=0.35, lead=0.3)
        self.play(Create(strike), run_time=0.35)

        # Underneath: the engineering, counted from the repository.
        self.cue("underneath", lead=0.3)
        self.play(FadeOut(VGroup(a, quote, strike, headline), shift=UP * 0.3), run_time=0.5)
        under = T("Underneath", 26, MUTED, weight="SEMIBOLD").to_edge(UP, buff=1.0)
        self.play(FadeIn(under), run_time=0.3)
        stats = [(112, "tables", SKY), (196, "row-level security policies", MINT), (85, "permissions", GLOW), (113, "test files", GOLD)]
        trackers = [ValueTracker(0) for _ in stats]
        blocks = VGroup()
        for (n, lab, col), tr in zip(stats, trackers):
            num = always_redraw(lambda tr=tr, col=col: T(f"{int(round(tr.get_value()))}", 76, col, weight="BOLD", font=MONO))
            l = T(lab, 20, TEXT)
            blocks.add(VGroup(num, l))
        slots = [LEFT * 4.8, LEFT * 1.6, RIGHT * 1.6, RIGHT * 4.8]
        for blk, pos in zip(blocks, slots):
            blk[0].add_updater(lambda m, pos=pos: m.move_to(pos + UP * 0.45))
            blk[1].move_to(pos + DOWN * 0.45)
        cue_words = ["one", "one", "eightyfive", "one"]
        for (n, _, _), tr, blk, word in zip(stats, trackers, blocks, cue_words):
            self.cue(word, lead=0.2)
            self.add(blk[0])
            self.play(FadeIn(blk[1], shift=UP * 0.1), tr.animate.set_value(n), run_time=1.0, rate_func=rate_functions.ease_out_cubic)
        for blk in blocks:
            blk[0].clear_updaters()
        src = T("counted from the repository, November 2026", 16, MUTED).next_to(VGroup(*blocks), DOWN, buff=0.45)
        self.add(src)

        self.cue("australianhosted", lead=0.3)
        tags = VGroup(pill("Sydney · ap-southeast-2", MINT, 22), pill("Audited CSV export", SKY, 22), pill("Erase on request", GLOW, 22))
        tags.arrange(RIGHT, buff=0.3).to_edge(DOWN, buff=0.85)
        self.play(FadeIn(tags[0], shift=UP * 0.15), run_time=0.4)
        self.play_cue("exportable", LaggedStart(*[FadeIn(t, shift=UP * 0.15) for t in tags[1:]], lag_ratio=0.3), run_time=0.6, lead=0.2)
        self.outro()
