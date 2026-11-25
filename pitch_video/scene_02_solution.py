from manim import *

from common import *


def hexagon(radius: float, color: str):
    return RegularPolygon(6, radius=radius, stroke_color=color, stroke_width=3).set_fill(color, opacity=0.12)


def core_mark(radius: float = 1.0):
    """The Meroidea core: the website's logo tile (public icon.svg) with a soft brand halo and the
    'Meroidea' wordmark beneath. Index 1 is the tile, index 3 the wordmark."""
    size = radius * 1.55
    halo = VGroup(*[RoundedRectangle(width=size * (1 + 0.16 * i), height=size * (1 + 0.16 * i),
                                     corner_radius=size * 0.25, stroke_width=0).set_fill(INFO, opacity=0.05)
                    for i in range(5, 0, -1)])
    mark = logo_mark(size)
    word = T("Meroidea", 30 * radius, TEXT, weight="SEMIBOLD")
    word.next_to(mark, DOWN, buff=0.22 * radius)
    return VGroup(halo, mark[0], VGroup(mark[1], mark[2]), word)


def lock(color: str = MINT, s: float = 1.0):
    body = RoundedRectangle(width=0.34 * s, height=0.26 * s, corner_radius=0.05 * s,
                            stroke_color=color, stroke_width=2).set_fill(color, opacity=0.25)
    shackle = Arc(radius=0.11 * s, start_angle=0, angle=PI, stroke_color=color, stroke_width=2.4)
    shackle.next_to(body, UP, buff=0)
    return VGroup(shackle, body)


class Solution(PitchScene):
    SID = "s02"

    def construct(self):
        rng = np.random.default_rng(3)
        k = kicker("02 · THE SOLUTION")

        # Echo of the tangle from scene 1.
        pts = ring_points(6, 3.2, phase=PI / 6)
        pts = [p * np.array([1.35, 0.85, 1]) for p in pts]
        dots = VGroup(*[glow_dot(c, 0.09) .move_to(p) for p, c in zip(pts, [SKY, SKY2, GLOW, GOLD, MINT, CORAL])])
        tangle = VGroup()
        for i in range(6):
            for j in range(i + 1, 6):
                a, b = pts[i], pts[j]
                o = rng.uniform(-2.4, 2.4, 4)
                tangle.add(CubicBezier(a, a + [o[0], o[1], 0], b + [o[2], o[3], 0], b,
                                       stroke_color=CORAL, stroke_width=2, stroke_opacity=0.5))
        self.add(k, tangle, dots)

        core = core_mark(1.0)
        flows = VGroup(*[Line(p, ORIGIN, stroke_color=SKY, stroke_width=2.4, stroke_opacity=0.7) for p in pts])
        straight = VGroup(*[flows[i % 6].copy() for i in range(len(tangle))])

        self.cue("meroidea", lead=0.2)
        self.play(ReplacementTransform(tangle, straight), run_time=1.3, rate_func=smooth)
        self.play(FadeIn(core, scale=0.6), *[d.animate.scale(0.8) for d in dots], run_time=0.9)
        self.remove(straight)
        self.add(flows, core, dots)
        packets = VGroup(*[glow_dot(SKY, 0.05, 3).move_to(p) for p in pts])
        self.play(LaggedStart(*[MoveAlongPath(pk, f) for pk, f in zip(packets, flows)], lag_ratio=0.1),
                  run_time=1.2, rate_func=smooth)
        self.remove(*packets)

        # Three promises, stacked on the right.
        self.play(FadeOut(flows), FadeOut(dots), core.animate.scale(0.85).move_to(LEFT * 4.6 + UP * 0.25), run_time=0.8)
        promises = VGroup(
            pill("One login", GLOW, 26),
            pill("One record · every customer, every staff member", SKY, 26),
            pill("One database · hosted in Sydney (ap-southeast-2)", MINT, 26),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.42).move_to(RIGHT * 1.75)
        for word, p in zip(["login", "record", "database"], promises):
            self.play_cue(word, FadeIn(p, shift=LEFT * 0.3), run_time=0.6, lead=0.25)

        # Sealed workspaces, each with its own feature switches.
        self.cue("each", lead=0.3)
        self.play(FadeOut(promises, shift=RIGHT * 0.3), core.animate.scale(0.57).move_to(UP * 2.35), run_time=0.9)

        tenants = [("Restaurant", GOLD), ("Migration agency", SKY), ("Retail shop", CORAL)]
        cells = VGroup()
        rng2 = np.random.default_rng(11)
        grids = VGroup()
        for i, (name, col) in enumerate(tenants):
            box = card(3.9, 2.85, color=col, stroke_width=3)
            box.set_fill(interpolate_color(ManimColor(PANEL), ManimColor(col), 0.06), opacity=1)
            title = T(name, 24, TEXT, weight="SEMIBOLD").next_to(box.get_top(), DOWN, buff=0.28).align_to(box, LEFT).shift(RIGHT * 0.3)
            lk = lock(col).next_to(box.get_corner(UR), DL, buff=0.25)
            on = rng2.random(26) < [0.45, 0.6, 0.5][i]
            grid = VGroup(*[Circle(radius=0.085, stroke_color=col, stroke_width=1.5).set_fill(col, opacity=0.0)
                            for _ in range(26)]).arrange_in_grid(rows=2, cols=13, buff=0.075)
            grid.move_to(box).shift(DOWN * 0.45)
            for c, flag in zip(grid, on):
                c.lit = bool(flag)
            cells.add(VGroup(box, title, lk))
            grids.add(grid)
        cells.arrange(RIGHT, buff=0.45).move_to(DOWN * 1.05)
        for cell, grid in zip(cells, grids):
            grid.move_to(cell[0]).shift(DOWN * 0.45)
        links = VGroup(*[Line(core[3].get_bottom() + DOWN * 0.08, c[0].get_top(), stroke_color=GLOW, stroke_width=2, stroke_opacity=0.6)
                         for c in cells])
        self.play_cue("sealed", LaggedStart(*[Create(l) for l in links], lag_ratio=0.15),
                      LaggedStart(*[FadeIn(c, shift=UP * 0.2) for c in cells], lag_ratio=0.15), run_time=1.1, lead=0.4)

        self.cue("features", lead=0.3)
        self.play(LaggedStart(*[FadeIn(g) for g in grids], lag_ratio=0.1), run_time=0.6)
        self.play(*[c.animate.set_fill(c.get_stroke_color(), opacity=0.9) for g in grids for c in g if c.lit],
                  run_time=0.9, rate_func=smooth)

        badge = VGroup(T("26", 54, GLOW, weight="BOLD", font=MONO), T("switchable features", 24, TEXT))
        badge.arrange(RIGHT, buff=0.25)
        badge.next_to(cells, DOWN, buff=0.38)
        self.play_cue("twentysix", FadeIn(badge, shift=UP * 0.2), run_time=0.7, lead=0.3)
        self.outro()
