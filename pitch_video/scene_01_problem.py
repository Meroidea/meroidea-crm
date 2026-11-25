from manim import *

from common import *


class Problem(PitchScene):
    SID = "s01"

    def construct(self):
        rng = np.random.default_rng(7)
        k = kicker("01 · THE PROBLEM")

        title = T("Every small business runs on a tangle.", 46, TEXT, weight="SEMIBOLD")
        hero_waves, wclock = waves(height=3.0)
        self.add(wclock, hero_waves)
        self.play_cue("every", FadeIn(k, shift=RIGHT * 0.2), FadeIn(hero_waves), Write(title), run_time=1.4, lead=0.0)

        tools = [
            ("Leads · spreadsheet", "spreadsheet", np.array([-4.5, 2.0, 0]), SKY),
            ("Customers · shared inbox", "inbox", np.array([0.6, 2.75, 0]), SKY2),
            ("Roster · whiteboard", "whiteboard", np.array([4.6, 1.35, 0]), GLOW),
            ("Timesheets · paper", "paper", np.array([-4.9, -1.2, 0]), GOLD),
            ("Invoices · template", "template", np.array([-0.4, -2.1, 0]), MINT),
            ("The story · WhatsApp", "whatsapp", np.array([4.3, -1.75, 0]), CORAL),
        ]
        nodes = []
        for label, _, pos, col in tools:
            n = node(label, col, size=22)
            n.move_to(pos)
            nodes.append(n)

        # Tangled wires between every pair, redrawn each frame with a slow, noisy jitter.
        clock = ValueTracker(0)
        pairs = [(i, j) for i in range(6) for j in range(i + 1, 6)]
        seeds = rng.uniform(0, 2 * np.pi, size=(len(pairs), 4))
        offsets = rng.uniform(-2.6, 2.6, size=(len(pairs), 4))
        shown = [False] * 6

        def make_wires():
            t = clock.get_value()
            g = VGroup()
            for p, (i, j) in enumerate(pairs):
                if not (shown[i] and shown[j]):
                    continue
                a, b = nodes[i].get_center(), nodes[j].get_center()
                s, o = seeds[p], offsets[p]
                c1 = a + np.array([o[0] + 0.5 * np.sin(t * 1.3 + s[0]), o[1] + 0.5 * np.cos(t * 1.1 + s[1]), 0])
                c2 = b + np.array([o[2] + 0.5 * np.sin(t * 0.9 + s[2]), o[3] + 0.5 * np.cos(t * 1.5 + s[3]), 0])
                g.add(CubicBezier(a, c1, c2, b, stroke_color=CORAL, stroke_width=2.2, stroke_opacity=0.6))
            return g

        wires = always_redraw(make_wires)
        self.add(wires)
        clock.add_updater(lambda m, dt: m.increment_value(dt))
        self.add(clock)

        # Title makes room as the first tool appears.
        self.cue("leads", lead=0.35)
        self.play(FadeOut(title, shift=UP * 0.3), FadeOut(hero_waves), run_time=0.5)
        self.remove(hero_waves, wclock)

        for idx, (_, word, pos, col) in enumerate(tools):
            self.cue(word, lead=0.45)
            shown[idx] = True
            self.play(FadeIn(nodes[idx], scale=0.85), run_time=0.55)

        # Nodes drift and collide gently: the tangle is alive.
        for n in nodes:
            n.base = n.get_center().copy()
            phase = rng.uniform(0, 2 * np.pi)
            n.add_updater(lambda m, dt, ph=phase: m.move_to(
                m.base + 0.12 * np.array([np.sin(clock.get_value() * 0.8 + ph), np.cos(clock.get_value() * 0.7 + ph), 0])))

        # Context leaks out of every hand-off and falls away.
        self.cue("handoff", lead=0.3)
        self.play(self.camera.frame.animate.scale(0.96), run_time=1.2, rate_func=smooth)
        drops = VGroup()
        anims = []
        for p, (i, j) in enumerate(pairs):
            a, b = nodes[i].get_center(), nodes[j].get_center()
            start = a + (b - a) * rng.uniform(0.3, 0.7)
            d = glow_dot(SKY, radius=0.07, layers=4)
            d.move_to(start)
            drops.add(d)
            anims.append(Succession(FadeIn(d, run_time=0.3),
                                    d.animate(run_time=1.6, rate_func=rate_functions.ease_in_quad)
                                    .shift(DOWN * rng.uniform(2.5, 4.0)).set_opacity(0)))
        self.cue("loses", lead=0.2)
        self.play(LaggedStart(*anims, lag_ratio=0.05), run_time=2.6)

        caption = T("Every hand-off loses context.", 34, CORAL, weight="SEMIBOLD")
        caption.to_edge(DOWN, buff=0.45).shift(UP * 0.05)
        bg = BackgroundRectangle(caption, color=BG, fill_opacity=0.85, buff=0.18)
        self.play_cue("money", FadeIn(bg), Write(caption), run_time=0.9, lead=0.6)
        self.outro()
