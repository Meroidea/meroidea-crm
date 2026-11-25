from manim import *

from common import *


class Inbox(PitchScene):
    SID = "s07"

    def construct(self):
        k = kicker("07 · ONE INBOX, EVERY CHANNEL", CORAL)
        self.add(k)

        channels = [("Facebook", "#7DA0FA"), ("Instagram", "#F3797E"), ("WhatsApp", "#6EE7B7"),
                    ("TikTok", "#E6EAF2"), ("Email", "#F5C46B"), ("Live chat", "#8B8AF0")]
        centre = LEFT * 3.7 + DOWN * 0.3
        pts = ring_points(6, 2.15, phase=PI / 2)
        orbs = VGroup()
        for (name, col), p in zip(channels, pts):
            o = glow_dot(col, 0.16, 5, 2.4).move_to(centre + p)
            lab = T(name, 20, TEXT, weight="MEDIUM").next_to(o, DOWN if p[1] < 0 else UP, buff=0.14)
            orbs.add(VGroup(o, lab))
        hub = T("Customers", 22, MUTED, weight="SEMIBOLD").move_to(centre)
        self.play_cue("customers", FadeIn(hub), run_time=0.6, lead=0.05)
        orbit = DashedVMobject(Circle(radius=2.15, stroke_color=EDGE, stroke_width=2), num_dashes=48).move_to(centre)
        self.play_cue("everywhere", Create(orbit), Rotate(orbit, PI / 3), run_time=1.4, lead=0.3)
        for (name, _), orb in zip(channels, orbs):
            word = {"Live chat": "live", "TikTok": "tiktok"}.get(name, name.lower())
            self.play_cue(word, FadeIn(orb, scale=0.6), run_time=0.3, lead=0.2)

        # The inbox list.
        panel = card(6.3, 4.45, color=EDGE).move_to(RIGHT * 3.0 + UP * 0.55)
        ptitle = T("Inbox", 24, TEXT, weight="SEMIBOLD").next_to(panel.get_corner(UL), DR, buff=0.25)
        msgs = [("Ana Lopez", "Is the 7pm table still free?", 2), ("Ben Ng", "Invoice received, thanks", 4),
                ("chloe@example.com", "Quote for 40 guests?", 0), ("Dev Patel", "Can I change my shift?", 5)]
        rows = VGroup()
        for name, text, ch in msgs:
            col = channels[ch][1]
            bar = Rectangle(width=0.08, height=0.6, stroke_width=0).set_fill(col, 1)
            n = T(name, 19, TEXT, weight="SEMIBOLD")
            m = T(text, 17, MUTED)
            txt = VGroup(n, m).arrange(DOWN, aligned_edge=LEFT, buff=0.08)
            row = VGroup(bar, txt).arrange(RIGHT, buff=0.22)
            bg = RoundedRectangle(width=5.8, height=0.8, corner_radius=0.1, stroke_width=0).set_fill("#1E2733", 1)
            row.move_to(bg).align_to(bg, LEFT).shift(RIGHT * 0.15)
            rows.add(VGroup(bg, row))
        rows.arrange(DOWN, buff=0.1).next_to(ptitle, DOWN, aligned_edge=LEFT, buff=0.25)
        rows.align_to(panel, LEFT).shift(RIGHT * 0.25)

        self.cue("arrive", lead=0.3)
        self.play(FadeIn(panel), FadeIn(ptitle), run_time=0.4)
        streams = []
        for orb, row in zip([orbs[2], orbs[4], orbs[4], orbs[5]], rows):
            d = glow_dot(orb[0][1].get_color(), 0.07, 3).move_to(orb[0].get_center())
            streams.append(Succession(d.animate(run_time=0.55).move_to(row.get_left()), FadeOut(d, run_time=0.05),
                                      FadeIn(row, shift=LEFT * 0.2, run_time=0.3)))
        self.play(LaggedStart(*streams, lag_ratio=0.25), run_time=1.8)

        # Matched to the contact.
        self.cue("matched", lead=0.3)
        contact = card(3.2, 1.25, color=SKY).set_fill(interpolate_color(ManimColor(PANEL), ManimColor(SKY), 0.1), 1)
        c1 = T("Ana Lopez · contact", 19, TEXT, weight="SEMIBOLD")
        c2 = T("2 open deals · last visit Fri", 16, MUTED)
        VGroup(c1, c2).arrange(DOWN, aligned_edge=LEFT, buff=0.08).move_to(contact)
        cgroup = VGroup(contact, c1, c2).move_to(centre)
        link = DashedLine(cgroup.get_right(), rows[0].get_left(), stroke_color=SKY, stroke_width=2.5, dash_length=0.12)
        self.play(FadeOut(orbs, scale=0.8), FadeOut(hub), FadeIn(cgroup, scale=0.9), run_time=0.5)
        self.play(Create(link), rows[0][0].animate.set_fill("#26324A", 1), run_time=0.5)

        # AI drafts, a person sends.
        self.cue("drafts", lead=0.4)
        draft_box = RoundedRectangle(width=5.3, height=0.9, corner_radius=0.2, stroke_color=GLOW, stroke_width=2)
        draft_box.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(GLOW), 0.12), 1)
        draft_t = T("“Yes, 7pm is free for four. Shall I book it?”", 18, TEXT).move_to(draft_box)
        tag = pill("AI draft", GLOW, 16).next_to(draft_box, UP, buff=0.1).align_to(draft_box, LEFT)
        draft = VGroup(draft_box, draft_t, tag).next_to(panel, DOWN, buff=0.25).align_to(panel, LEFT)
        draft.shift(RIGHT * 0.25).align_to(rows, LEFT)
        self.play(FadeIn(draft, shift=UP * 0.15), run_time=0.5)
        self.cue("person", lead=0.25)
        sent = pill("✓ Sent by Sam", MINT, 18, fill_opacity=0.3).next_to(draft_box, UP, buff=0.1).align_to(draft_box, RIGHT)
        self.play(FadeIn(sent, scale=0.8), draft_box.animate.set_stroke(MINT), run_time=0.5)
        self.outro()
