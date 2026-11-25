from manim import *

from common import *

# The website's --channel-* tokens.
CH = [("Facebook", "#0866FF", "facebook"), ("Instagram", "#FF0069", "instagram"), ("WhatsApp", "#25D366", "whatsapp"),
      ("Email", "#7DA0FA", "email"), ("Website chat", "#7978E9", "website")]


def orb(label: str, color: str):
    c = Circle(radius=0.34, stroke_width=0).set_fill(color, 1)
    halo = Circle(radius=0.55, stroke_width=0).set_fill(color, 0.15)
    t = T(label, 18, TEXT, weight="SEMIBOLD").next_to(c, DOWN, buff=0.16)
    return VGroup(halo, c, t)


class Inbox(PitchScene):
    SID = "s03"

    def construct(self):
        head = T("Never miss a customer again.", 50, TEXT, weight="BOLD").to_edge(UP, buff=0.55)
        self.cue("never", lead=0.1)
        self.play(FadeIn(head, shift=UP * 0.3, scale=1.1), run_time=0.4, rate_func=rate_functions.ease_out_back)

        positions = [LEFT * 5.3 + UP * 1.3, LEFT * 3.4 + UP * 1.9, LEFT * 5.6 + DOWN * 0.4, LEFT * 3.6 + DOWN * 0.1,
                     LEFT * 4.6 + DOWN * 2.1]
        orbs = VGroup()
        for (label, col, word), pos in zip(CH, positions):
            o = orb(label, col).move_to(pos)
            orbs.add(o)
            self.cue(word, lead=0.15)
            self.play(GrowFromCenter(o), run_time=0.25, rate_func=rate_functions.ease_out_back)
        for i, o in enumerate(orbs):
            o.base = o.get_center().copy()
            o.add_updater(lambda m, dt, i=i: m.move_to(m.base + 0.07 * np.array([np.sin(self.now * 2 + i), np.cos(self.now * 1.7 + i), 0])))

        # One inbox: messages arc in from every channel.
        panel = shadow_card(6.4, 5.3).move_to(RIGHT * 2.9 + DOWN * 0.55)
        ptitle = VGroup(icon("inbox", BRAND, 0.22), T("Inbox", 24, TEXT, weight="BOLD")).arrange(RIGHT, buff=0.18)
        ptitle.next_to(panel[1].get_corner(UL), DR, buff=0.28)
        msgs = [("Ana Lopez", "Table for four at 7pm?", 2), ("Ben Ng", "Is my order ready?", 0),
                ("chloe@example.com", "Quote for 40 guests", 3), ("Dev Patel", "Do you deliver?", 1),
                ("Visitor", "Are you open Sunday?", 4)]
        rows = VGroup()
        for name, txt, ch in msgs:
            bg = RoundedRectangle(width=5.9, height=0.74, corner_radius=0.14, stroke_width=0).set_fill(BG, 1)
            bar = RoundedRectangle(width=0.1, height=0.5, corner_radius=0.05, stroke_width=0).set_fill(CH[ch][1], 1)
            nm = T(name, 18, TEXT, weight="SEMIBOLD")
            tx = T(txt, 15, MUTED)
            body = VGroup(nm, tx).arrange(DOWN, aligned_edge=LEFT, buff=0.06)
            VGroup(bar, body).arrange(RIGHT, buff=0.22).move_to(bg).align_to(bg, LEFT).shift(RIGHT * 0.2)
            rows.add(VGroup(bg, bar, body))
        rows.arrange(DOWN, buff=0.12).next_to(ptitle, DOWN, buff=0.25).align_to(ptitle, LEFT)
        self.cue("land", lead=0.35)
        self.play(FadeIn(panel, shift=LEFT * 0.5), FadeIn(ptitle), run_time=0.35)
        flights = []
        for row, (_, _, ch) in zip(rows, msgs):
            dot = Dot(radius=0.1, color=CH[ch][1]).move_to(orbs[ch][1].get_center())
            path = ArcBetweenPoints(orbs[ch][1].get_center(), row.get_left() + RIGHT * 0.2, angle=-0.9)
            flights.append(Succession(MoveAlongPath(dot, path, run_time=0.45, rate_func=rate_functions.ease_in_out_sine),
                                      AnimationGroup(FadeOut(dot, run_time=0.1), FadeIn(row, shift=LEFT * 0.4, run_time=0.25))))
        self.play(LaggedStart(*flights, lag_ratio=0.22), run_time=1.6)

        # Matched to the right customer: punch in, a contact card slides out of the row.
        self.cue("matched", lead=0.3)
        for o in orbs:
            o.clear_updaters()
        self.play(FadeOut(orbs, shift=LEFT * 0.5), FadeOut(head, shift=UP * 0.3),
                  self.focus.animate.move_to(RIGHT * 0.6 + UP * 0.2), self.zoom.animate.set_value(0.86), run_time=0.45)
        contact = shadow_card(3.6, 1.7, color=BRAND).move_to(LEFT * 3.0 + UP * 1.2)
        cav = Circle(radius=0.3, stroke_width=0).set_fill(SKY2, 1)
        cinit = T("AL", 18, "#FFFFFF", weight="BOLD").move_to(cav)
        cname = T("Ana Lopez", 22, TEXT, weight="BOLD")
        cmeta = T("Customer · 6 visits · VIP", 15, MUTED)
        info = VGroup(cname, cmeta).arrange(DOWN, aligned_edge=LEFT, buff=0.08)
        VGroup(VGroup(cav, cinit), info).arrange(RIGHT, buff=0.25).move_to(contact[1])
        link = CurvedArrow(rows[0].get_left() + LEFT * 0.05, contact[1].get_right() + RIGHT * 0.05, angle=0.6,
                           color=BRAND, stroke_width=3)
        tick = VGroup(icon("check", MINT, 0.22), T("matched", 16, MINT, weight="SEMIBOLD")).arrange(RIGHT, buff=0.08)
        tick.next_to(contact[1], DOWN, buff=0.15).align_to(contact[1], RIGHT)
        self.play(rows[0][0].animate.set_fill(ACCENT_BG, 1), Create(link),
                  FadeIn(VGroup(contact, cav, cinit, info), shift=LEFT * 0.4), run_time=0.5)
        self.play(FadeIn(tick, scale=1.4), run_time=0.25)

        # New leads go to the right person.
        self.cue("leads", lead=0.3)
        rep = VGroup(Circle(radius=0.38, stroke_width=0).set_fill(BRAND, 1), T("SK", 20, "#FFFFFF", weight="BOLD"))
        rep[1].move_to(rep[0])
        rep_l = T("Sam · Sales", 16, TEXT, weight="SEMIBOLD").next_to(rep, DOWN, buff=0.1)
        repg = VGroup(rep, rep_l).move_to(LEFT * 3.0 + DOWN * 1.3)
        self.play(FadeIn(repg, scale=0.6), run_time=0.25)
        lead_chip = pill("New lead · Chloe", CORAL, 16).move_to(rows[2].get_left() + RIGHT * 1.2)
        self.play(FadeIn(lead_chip, scale=1.2), run_time=0.2)
        self.play(lead_chip.animate.move_to(rep.get_center()).scale(0.4).set_opacity(0), run_time=0.45,
                  rate_func=rate_functions.ease_in_cubic)
        ring = Circle(radius=0.4, stroke_color=BRAND, stroke_width=4).move_to(rep)
        self.play(ring.animate.scale(2.4).set_stroke(opacity=0), run_time=0.35)

        # A reply is drafted, ready to send.
        self.cue("reply", lead=0.3)
        box = RoundedRectangle(width=5.9, height=0.8, corner_radius=0.3, stroke_color=INFO, stroke_width=2)
        box.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(INFO), 0.1), 1)
        box.move_to(rows[4])
        tag = pill("AI", INFO, 13).move_to(box).align_to(box, LEFT).shift(RIGHT * 0.2)
        text = T("Yes, 7pm is free. Book it?", 17, TEXT).next_to(tag, RIGHT, buff=0.18)
        send = pill("Send", BRAND, 17, fill_opacity=1, text_color="#FFFFFF").move_to(box).align_to(box, RIGHT).shift(LEFT * 0.15)
        self.play(rows[4].animate.set_opacity(0), FadeIn(box), FadeIn(tag), run_time=0.25)
        self.play(AddTextLetterByLetter(text, time_per_char=0.03), run_time=1.2)
        self.play_cue("send", FadeIn(send, scale=1.3), run_time=0.25, lead=0.25)
        r2 = Circle(radius=0.3, stroke_color=BRAND, stroke_width=4).move_to(send)
        self.play(r2.animate.scale(3).set_stroke(opacity=0), send.animate.scale(0.92), run_time=0.3)
        self.outro()
