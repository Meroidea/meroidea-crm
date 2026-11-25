from manim import *

from common import *


def bubble(text: str, color: str = SKY2, w: float = 2.6):
    t = T(text, 16, TEXT)
    box = RoundedRectangle(width=max(w, t.width + 0.4), height=0.5, corner_radius=0.22, stroke_width=0)
    box.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(color), 0.35), 1)
    t.move_to(box)
    return VGroup(box, t)


class Problem(PitchScene):
    SID = "s01"
    PUSH = 0.08

    def construct(self):
        rng = np.random.default_rng(2)

        # MONDAY slams in.
        mon = T("MONDAY", 120, TEXT, weight="BOLD")
        self.cue("monday", lead=0.12)
        self.sfx("swish", -8)
        self.play(FadeIn(mon, scale=1.6), run_time=0.35, rate_func=rate_functions.ease_out_back)
        self.shake(0.07, 5, 0.3)

        # Clock: 9:00 with spinning hands, then the heading parks top-left.
        face = Circle(radius=0.75, stroke_color=TEXT, stroke_width=5).set_fill(PANEL, 1)
        hour = Line(ORIGIN, UP * 0.38, stroke_color=TEXT, stroke_width=6)
        minute = Line(ORIGIN, UP * 0.6, stroke_color=CORAL, stroke_width=4)
        clock = VGroup(face, hour, minute)
        nine = T("9:00 am", 72, TEXT, weight="BOLD", font=MONO)
        self.cue("nine", lead=0.15)
        group = VGroup(clock, nine).arrange(RIGHT, buff=0.5)
        self.play(mon.animate.scale(0.45).next_to(group, UP, buff=0.35), FadeIn(group, shift=UP * 0.2), run_time=0.4)
        self.sfx("swish", -9)
        self.sfx("tick", -6, 0.65)
        self.play(Rotate(minute, -TAU * 2, about_point=face.get_center()),
                  Rotate(hour, -PI / 2 * 1.0, about_point=face.get_center()), run_time=0.7, rate_func=smooth)
        header = VGroup(mon, clock, nine)
        self.play(header.animate.scale(0.42).to_corner(UL, buff=0.5), run_time=0.4)

        # Phone with missed calls.
        ph = phone(2.5, 4.7).move_to(LEFT * 4.6 + DOWN * 0.45)
        calls = VGroup(*[VGroup(icon("staff", CORAL, 0.18), T(f"Missed · {n}", 15, TEXT)).arrange(RIGHT, buff=0.15)
                         for n in ("Ben", "Unknown", "Supplier")]).arrange(DOWN, aligned_edge=LEFT, buff=0.28)
        calls.move_to(ph[1]).shift(UP * 0.9)
        b3 = badge_count(3).move_to(ph[0].get_corner(UR) + LEFT * 0.08 + DOWN * 0.08)
        self.cue("three", lead=0.2)
        self.sfx("swish", -8)
        self.play(FadeIn(ph, shift=RIGHT * 0.6), run_time=0.3)
        self.sfx_seq("pop", 3, 0.14, -7)
        self.play(LaggedStart(*[FadeIn(c, shift=DOWN * 0.15) for c in calls], lag_ratio=0.25),
                  GrowFromCenter(b3), run_time=0.55)
        ring = Circle(radius=0.3, stroke_color=CORAL, stroke_width=4).move_to(b3)
        self.sfx("ping", -5)
        self.play(ring.animate.scale(3).set_stroke(opacity=0), run_time=0.35)
        self.remove(ring)

        # An avalanche of messages, counter rolling to 40.
        self.cue("forty", lead=0.2)
        n_msgs = ValueTracker(0)
        counter = always_redraw(lambda: badge_count(int(n_msgs.get_value())).scale(1.25).move_to(RIGHT * 6.0 + UP * 2.6))
        self.add(counter)
        texts = ["Are you open today?", "Table for 6 at 7?", "Where's my order?", "Can I swap shifts?",
                 "Invoice please", "Quote for Friday?", "Running late", "Is parking free?", "Need a refund",
                 "Still hiring?", "Price for 40?", "Thanks!"]
        bubbles = VGroup()
        anims = []
        for i in range(12):
            bb = bubble(texts[i], [SKY2, INFO, SKY, CORAL][i % 4], w=2.3)
            target = np.array([rng.uniform(2.6, 5.4), -2.6 + 0.42 * i + rng.uniform(-0.05, 0.05), 0])
            bb.move_to(target + UP * 5).rotate(rng.uniform(-0.12, 0.12))
            bubbles.add(bb)
            anims.append(bb.animate.move_to(target))
        self.sfx_seq("pop", 12, 0.105, -12)
        self.sfx("ping", -7, 1.2)
        self.play(LaggedStart(*anims, lag_ratio=0.12, rate_func=rate_functions.ease_out_bounce),
                  n_msgs.animate.set_value(40), run_time=1.5)

        # A roster that doesn't add up.
        self.cue("roster", lead=0.25)
        sheet = shadow_card(3.9, 2.2).move_to(LEFT * 0.4 + DOWN * 1.6)
        cells = VGroup(*[Rectangle(width=0.58, height=0.32, stroke_color=EDGE, stroke_width=1).set_fill(PANEL, 1)
                         for _ in range(24)]).arrange_in_grid(4, 6, buff=0)
        cells.move_to(sheet[1]).shift(DOWN * 0.12)
        stitle = T("roster_FINAL_v7.xlsx", 15, MUTED, font=MONO).next_to(cells, UP, buff=0.12).align_to(cells, LEFT)
        self.sfx("swish", -9)
        self.play(FadeIn(VGroup(sheet, cells, stitle), shift=UP * 0.4), run_time=0.35)
        bad = [cells[i] for i in (3, 8, 14, 21)]
        errs = VGroup(*[T("#REF!", 12, CORAL, font=MONO, weight="BOLD").move_to(c) for c in bad])
        self.sfx_seq("tick", 4, 0.06, -6)
        self.play(*[c.animate.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(CORAL), 0.35), 1) for c in bad],
                  FadeIn(errs, scale=1.4), run_time=0.35)

        # An invoice nobody sent: stamp slam.
        self.cue("invoice", lead=0.2)
        inv = shadow_card(2.3, 2.7).move_to(RIGHT * 0.3 + UP * 1.35).rotate(0.05)
        lines = VGroup(*[Line(LEFT * 0.7, RIGHT * (0.7 - 0.25 * (i % 2)), stroke_color=EDGE, stroke_width=5)
                         for i in range(5)]).arrange(DOWN, buff=0.24, aligned_edge=LEFT).move_to(inv[1]).rotate(0.05)
        ititle = T("INVOICE", 18, TEXT, weight="BOLD").move_to(inv[1].get_top() + DOWN * 0.3).rotate(0.05)
        self.sfx("swish", -9)
        self.play(FadeIn(VGroup(inv, lines, ititle), shift=DOWN * 0.4), run_time=0.3)
        stamp = VGroup(RoundedRectangle(width=2.0, height=0.6, corner_radius=0.08, stroke_color=CORAL, stroke_width=5),
                       T("NOT SENT", 26, CORAL, weight="BOLD")).rotate(-0.25).move_to(inv[1])
        self.cue("nobody", lead=0.0)
        self.sfx("stamp", -1, 0.16)
        self.play(FadeIn(stamp, scale=2.4), run_time=0.22, rate_func=rate_functions.ease_in_quad)
        self.shake(0.06, 4, 0.25)

        # Sound familiar? Everything jitters; the camera leans in.
        self.cue("sound", lead=0.2)
        clutter = VGroup(ph, calls, b3, bubbles, sheet, cells, stitle, errs, inv, lines, ititle, stamp)
        q = T("Sound familiar?", 64, TEXT, weight="BOLD")
        qbg = BackgroundRectangle(q, color=BG, fill_opacity=0.92, buff=0.35)
        veil = Rectangle(width=30, height=20, stroke_width=0).set_fill(BG, 0.72)
        self.sfx("whoosh", -9)
        self.play(FadeIn(veil), FadeOut(counter), self.zoom.animate.set_value(0.9),
                  FadeIn(qbg), FadeIn(q, scale=1.3), run_time=0.45)

        # Spreadsheets · sticky notes · memory.
        self.cue("most", lead=0.2)
        self.play(FadeOut(q, shift=UP * 0.3), FadeOut(qbg), self.zoom.animate.set_value(1.0), run_time=0.35)
        words = [("spreadsheets", SKY), ("sticky notes", GOLD), ("memory", CORAL)]
        shown = VGroup()
        for i, (w, col) in enumerate(words):
            self.cue(w.split()[0], lead=0.12)
            t = T(w, 64, col, weight="BOLD")
            t.move_to(UP * (1.45 - 1.45 * i))
            bgp = BackgroundRectangle(t, color=BG, fill_opacity=0.9, buff=0.2)
            self.sfx("impact", -9)
            self.play(FadeIn(bgp), FadeIn(t, scale=1.5), run_time=0.25, rate_func=rate_functions.ease_out_back)
            shown.add(bgp, t)
            if w == "sticky notes":
                notes = VGroup()
                for j in range(7):
                    nte = Square(0.55, stroke_width=0).set_fill(GOLD if j % 2 else "#FFE7A6", 1).rotate(rng.uniform(-0.5, 0.5))
                    nte.move_to([rng.uniform(-6.2, 6.2), 4.6, 0])
                    notes.add(nte)
                self.sfx_seq("swish", 3, 0.25, -12)
                self.play(LaggedStart(*[n.animate(rate_func=rate_functions.ease_in_quad).shift(DOWN * rng.uniform(5.5, 9)).rotate(rng.uniform(-1, 1))
                                        for n in notes], lag_ratio=0.06), run_time=0.9)
        self.outro()
