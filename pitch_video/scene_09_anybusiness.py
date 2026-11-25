from manim import *

from common import *

THEMES = [
    ("Restaurant", "Bookings", ["Enquiry", "Tasting", "Quote sent", "Booked"], "Guests: 40", GOLD),
    ("Migration agency", "Cases", ["Enquiry", "Consult", "Applied", "Visa granted"], "Visa: 500", SKY),
    ("Retail shop", "Orders", ["New", "Packed", "Shipped", "Delivered"], "SKU: TS-104", CORAL),
]


def board(theme):
    biz, obj, stages, field, col = theme
    title = T(obj, 30, TEXT, weight="BOLD")
    cols = VGroup()
    for s_ in stages:
        c = RoundedRectangle(width=2.3, height=2.5, corner_radius=0.14, stroke_width=0).set_fill(MUTED_BG, 1)
        h = T(s_, 17, ink(col), weight="SEMIBOLD").next_to(c.get_top(), DOWN, buff=0.18)
        cols.add(VGroup(c, h))
    cols.arrange(RIGHT, buff=0.18)
    title.next_to(cols, UP, buff=0.3).align_to(cols, LEFT)
    rec = shadow_card(2.0, 0.95, radius=0.14, depth=0.04)
    f = pill(field, col, 14, text_color=TEXT)
    nm = T("Record #1042", 15, TEXT, weight="SEMIBOLD")
    VGroup(nm, f).arrange(DOWN, buff=0.08, aligned_edge=LEFT).move_to(rec[1])
    recg = VGroup(rec, nm, f).next_to(cols[1][1], DOWN, buff=0.22)
    return VGroup(title, cols, recg)


class AnyBusiness(PitchScene):
    SID = "s09"

    def construct(self):
        kinds = [("staff", "Restaurant", GOLD, "restaurant"), ("customers", "Migration agency", SKY, "migration"),
                 ("invoice", "Retail shop", CORAL, "retail")]
        cards = VGroup()
        for k, lab, col, word in kinds:
            sc = shadow_card(3.5, 2.3, color=col, radius=0.22, stroke_width=2)
            chip = Circle(radius=0.45, stroke_width=0).set_fill(interpolate_color(ManimColor(PANEL), ManimColor(col), 0.25), 1)
            ic = icon(k, ink(col), 0.35).move_to(chip)
            t = T(lab, 22, TEXT, weight="BOLD")
            VGroup(VGroup(chip, ic), t).arrange(DOWN, buff=0.25).move_to(sc[1])
            cards.add(VGroup(sc, chip, ic, t))
        cards.arrange(RIGHT, buff=0.5).move_to(UP * 0.2)
        for c, (_, _, _, word) in zip(cards, kinds):
            self.cue(word, lead=0.15)
            self.sfx("pop", -4)
            self.play(FadeIn(c, shift=UP * 0.6, scale=0.85), run_time=0.3, rate_func=rate_functions.ease_out_back)

        # One board reshapes itself for each business.
        self.cue("meroidea", lead=0.25)
        b = board(THEMES[0]).scale(1.25).move_to(DOWN * 0.55)
        biz_lab = pill(THEMES[0][0], THEMES[0][4], 18).next_to(b, UP, buff=0.25).align_to(b, RIGHT)
        self.sfx("swish", -8)
        self.play(cards.animate.scale(0.38).arrange(RIGHT, buff=0.3).to_edge(UP, buff=0.45), run_time=0.4)
        self.sfx("whoosh", -9)
        self.play(FadeIn(b, shift=UP * 0.3), FadeIn(biz_lab), Circumscribe(cards[0], color=ink(GOLD), buff=0.06), run_time=0.4)

        for i, word in ((1, "stages"), (2, "fields")):
            self.cue(word, lead=0.25)
            nb = board(THEMES[i]).scale(1.25).move_to(b)
            nl = pill(THEMES[i][0], THEMES[i][4], 18).move_to(biz_lab).align_to(biz_lab, RIGHT)
            self.sfx("swish", -6)
            self.play(Transform(b, nb), Transform(biz_lab, nl), Circumscribe(cards[i], color=ink(THEMES[i][4]), buff=0.06),
                      run_time=0.45, rate_func=smooth)
        self.cue("words", lead=0.2)
        self.sfx("tick", -5)
        self.play(Indicate(b[0], color=BRAND, scale_factor=1.12), run_time=0.35)

        # Switch on what you need; grow into the rest.
        self.cue("switch", lead=0.3)
        self.play(FadeOut(VGroup(b, biz_lab), shift=LEFT * 0.6), FadeOut(cards, shift=UP * 0.3), run_time=0.3)
        feats = ["Customers", "Inbox", "Tasks", "Rosters", "Timesheets", "Payroll", "Invoices", "Books",
                 "Inventory", "Hiring", "Helpdesk", "Training"]
        toggles = VGroup()
        for f in feats:
            track = RoundedRectangle(width=0.7, height=0.38, corner_radius=0.19, stroke_width=0).set_fill("#D5DBEA", 1)
            knob = Circle(radius=0.15, stroke_width=0).set_fill("#FFFFFF", 1).move_to(track.get_left() + RIGHT * 0.19)
            lab = T(f, 18, TEXT, weight="MEDIUM")
            row = VGroup(VGroup(track, knob), lab).arrange(RIGHT, buff=0.22)
            bgc = shadow_card(2.8, 0.75, radius=0.16, depth=0.04)
            row.move_to(bgc[1]).align_to(bgc[1], LEFT).shift(RIGHT * 0.22)
            toggles.add(VGroup(bgc, row))
        toggles.arrange_in_grid(3, 4, buff=(0.24, 0.28)).move_to(DOWN * 0.1)
        self.sfx("whoosh", -10)
        self.play(LaggedStart(*[FadeIn(t, scale=0.8) for t in toggles], lag_ratio=0.03), run_time=0.45)

        def flip(t):
            track, knob = t[1][0]
            return AnimationGroup(track.animate.set_fill(BRAND, 1), knob.animate.shift(RIGHT * 0.32))

        today = [0, 1, 2, 6]
        self.sfx_seq("click", 4, 0.14, -4)
        self.play(LaggedStart(*[flip(toggles[i]) for i in today], lag_ratio=0.2), run_time=0.7)
        self.cue("grow", lead=0.2)
        rest = [i for i in range(12) if i not in today]
        self.sfx_seq("click", 8, 0.095, -6)
        self.sfx("chime", -6, 0.9)
        self.play(LaggedStart(*[flip(toggles[i]) for i in rest], lag_ratio=0.1), self.zoom.animate.set_value(0.97), run_time=1.0)
        self.outro()
