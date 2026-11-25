from manim import *

from common import *


def core_mark(radius: float = 1.0):
    """Logo tile with a soft halo and the wordmark. Index 1 tile, 3 wordmark (used by the close)."""
    size = radius * 1.55
    halo = VGroup(*[RoundedRectangle(width=size * (1 + 0.16 * i), height=size * (1 + 0.16 * i),
                                     corner_radius=size * 0.25, stroke_width=0).set_fill(INFO, opacity=0.05)
                    for i in range(5, 0, -1)])
    mark = logo_mark(size)
    word = T("Meroidea", 30 * radius, TEXT, weight="SEMIBOLD")
    word.next_to(mark, DOWN, buff=0.22 * radius)
    return VGroup(halo, mark[0], VGroup(mark[1], mark[2]), word)


class Solution(PitchScene):
    SID = "s02"

    def construct(self):
        rng = np.random.default_rng(8)

        # The pile, still swirling from the cold open.
        pile = VGroup()
        for i in range(22):
            kind = i % 3
            if kind == 0:
                m = RoundedRectangle(width=1.5, height=0.42, corner_radius=0.2, stroke_width=0).set_fill(
                    interpolate_color(ManimColor(PANEL), ManimColor([SKY2, INFO, CORAL][i % 3]), 0.4), 1)
            elif kind == 1:
                m = Square(0.5, stroke_width=0).set_fill(GOLD, 1)
            else:
                m = shadow_card(0.9, 1.1, radius=0.08)
            m.move_to([rng.uniform(-6, 6), rng.uniform(-3.2, 3.2), 0]).rotate(rng.uniform(-0.6, 0.6))
            pile.add(m)
        self.add(pile)
        pile.add_updater(lambda g, dt: g.rotate(0.12 * dt, about_point=ORIGIN))

        logo = core_mark(1.0)
        self.cue("meroidea", lead=0.25)
        self.sfx("impact", -2)
        self.sfx("sparkle", -8)
        self.play(FadeIn(logo, scale=0.3), run_time=0.4, rate_func=rate_functions.ease_out_back)
        pile.clear_updaters()
        self.sfx("whoosh", -5)
        self.play(*[m.animate.move_to(ORIGIN).scale(0.05).rotate(rng.uniform(2, 5)) for m in pile],
                  logo.animate.scale(1.12), run_time=0.75, rate_func=rate_functions.ease_in_cubic)
        self.remove(pile)
        rings = VGroup(*[Circle(radius=0.9, stroke_color=c, stroke_width=5).move_to(logo[1]) for c in (BRAND, INFO, SKY)])
        self.sfx("chime", -6)
        self.play(LaggedStart(*[r.animate.scale(5).set_stroke(opacity=0) for r in rings], lag_ratio=0.15),
                  logo.animate.scale(1 / 1.12), run_time=0.7)
        self.remove(rings)

        # One workspace: a window opens out of the logo.
        self.cue("workspace", lead=0.3)
        win = laptop(11.6, 6.3).move_to(DOWN * 0.25)
        brand = wordmark(0.32).move_to(win[1]).align_to(win[1], LEFT).shift(RIGHT * 0.95)
        brand.z_index = 5
        self.sfx("swish", -5)
        self.play(ReplacementTransform(logo, brand), FadeIn(win, scale=0.6), run_time=0.55, rate_func=smooth)
        self.bring_to_front(brand)

        specs = [("customers", "Customers", SKY), ("sales", "Sales", BRAND), ("staff", "Staff", INFO),
                 ("roster", "Rosters", SKY), ("payroll", "Payroll", BRAND), ("invoice", "Invoices", INFO),
                 ("books", "Books", SKY), ("inbox", "Inbox", CORAL)]
        tiles = VGroup(*[tile(k, l, c, w=2.5, h=2.15) for k, l, c in specs])
        tiles.arrange_in_grid(2, 4, buff=(0.3, 0.35)).move_to(win[0][1]).shift(DOWN * 0.22)
        slots = [t.get_center().copy() for t in tiles]
        words = ["customers", "sales", "staff", "rosters", "payroll", "invoices", "books"]
        for w, t in zip(words, tiles):
            self.cue(w, lead=0.15)
            self.sfx("pop", -6)
            self.play(FadeIn(t, scale=0.5, shift=UP * 0.2), run_time=0.28, rate_func=rate_functions.ease_out_back)

        # All connected: wires light between tiles with packets racing along them.
        self.cue("connected", lead=0.35)
        self.sfx("pop", -6)
        self.play(FadeIn(tiles[7], scale=0.5), run_time=0.25, rate_func=rate_functions.ease_out_back)
        pairs = [(0, 1), (1, 2), (2, 3), (4, 5), (5, 6), (6, 7), (0, 4), (1, 5), (2, 6), (3, 7), (0, 5), (2, 7)]
        wires = VGroup(*[Line(tiles[a][0][1].get_center(), tiles[b][0][1].get_center(), stroke_color=BRAND,
                              stroke_width=2.5, stroke_opacity=0.45) for a, b in pairs])
        wires.z_index = -1
        for t in tiles:
            t.z_index = 1
        self.sfx("sparkle", -8)
        self.play(LaggedStart(*[Create(wi) for wi in wires], lag_ratio=0.05), run_time=0.6)
        packets = VGroup(*[Dot(radius=0.07, color=INFO).move_to(wi.get_start()) for wi in wires])
        packets.z_index = 2
        self.sfx("swish", -12)
        self.play(LaggedStart(*[MoveAlongPath(p, wi) for p, wi in zip(packets, wires)], lag_ratio=0.04), run_time=0.8)
        self.remove(packets)

        # One login.
        self.cue("login", lead=0.25)
        av = VGroup(Circle(radius=0.15, stroke_width=0).set_fill(BRAND, 1), T("One login", 16, BRAND, weight="SEMIBOLD"))
        av.arrange(RIGHT, buff=0.15).move_to(win[1]).align_to(win[1], RIGHT).shift(LEFT * 0.35)
        self.sfx("ping", -6)
        self.play(FadeIn(av, shift=LEFT * 0.2), Indicate(brand, color=BRAND, scale_factor=1.06), run_time=0.4)

        # Shaped around how your business works: tiles reshuffle into a new layout.
        self.cue("shaped", lead=0.2)
        order = [3, 6, 0, 7, 1, 4, 2, 5]
        self.sfx("whoosh", -7)
        self.play(FadeOut(wires), *[tiles[i].animate.move_to(slots[j]) for j, i in enumerate(order)],
                  self.zoom.animate.set_value(0.94), run_time=0.9, rate_func=smooth)
        self.outro()
