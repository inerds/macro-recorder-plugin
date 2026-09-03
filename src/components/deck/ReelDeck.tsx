import type { DeckState } from "./deckState";

/*
 * The drawing is sized so that at a 300px Creator panel one user unit is one
 * CSS pixel: the window's content box is 274x110 and the viewBox is 272x110,
 * so `meet` resolves to scale 1 and a flange of R=44 renders 88px across.
 *
 * The composition follows a studio deck's faceplate: two spun-metal reels
 * fill the height, the tape leaves each pack for a guide roller in the
 * bottom corner and runs behind a riveted nameplate between them. The plate
 * is "furniture" and is the first thing a short panel drops.
 */
const VB_W = 272;
const VB_H = 110;
const CY = 47;

const R = 44; // flange radius
const PACK_R = 38.5; // wound tape, seen through the cut-outs
const HUB_R = 17;
const BOLT_AT = 11.6;

/* Three parallel-sided spokes; the cut-outs between them have filleted
   corners. `CUT_OUT`/`CUT_IN` are the cut-out's outer/inner radii. */
const CUT_OUT = 39;
const CUT_IN = 20.5;
const SPOKE_HW = 5.2; // half the spoke width
const CORNER = 2.6; // fillet radius

const LEFT_X = 60;
const RIGHT_X = 212;

const ROLLER_R = 8;
const ROLLER_Y = 96;
const ROLLER_LX = 14;
const ROLLER_RX = VB_W - ROLLER_LX;

const PLATE = { x: 97, y: 83, w: 78, h: 23 };

type Pt = [number, number];
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const polar = (r: number, d: number): Pt => [r * Math.cos(rad(d)), r * Math.sin(rad(d))];
const add = (a: Pt, b: Pt, k: number): Pt => [a[0] + k * b[0], a[1] + k * b[1]];
const pt = ([x, y]: Pt) => `${x.toFixed(2)} ${y.toFixed(2)}`;
const arc = (r: number, sweep: 0 | 1, p: Pt) => `A ${r} ${r} 0 0 ${sweep} ${pt(p)}`;

/**
 * One cut-out: the annular sector between two spokes, with every corner
 * filleted. The spokes keep a constant width, so the sector's angular span
 * is wider at the rim than at the hub; the fillet centres are the vertices
 * of the sector shrunk by `CORNER`, which is what makes the arcs meet the
 * edges tangentially.
 */
function cutoutPath(spokeA: number, spokeB: number): string {
  const c = CORNER;
  const hw = SPOKE_HW + c;
  const rOut = CUT_OUT - c;
  const rIn = CUT_IN + c;
  const dOut = deg(Math.asin(hw / rOut));
  const dIn = deg(Math.asin(hw / rIn));
  // Unit normals across each spoke, pointing toward increasing angle.
  const vA: Pt = [-Math.sin(rad(spokeA)), Math.cos(rad(spokeA))];
  const vB: Pt = [-Math.sin(rad(spokeB)), Math.cos(rad(spokeB))];
  const v1 = polar(rOut, spokeA + dOut);
  const v2 = polar(rOut, spokeB - dOut);
  const v3 = polar(rIn, spokeB - dIn);
  const v4 = polar(rIn, spokeA + dIn);
  return [
    `M ${pt(polar(CUT_OUT, spokeA + dOut))}`,
    arc(CUT_OUT, 1, polar(CUT_OUT, spokeB - dOut)),
    arc(c, 1, add(v2, vB, c)),
    `L ${pt(add(v3, vB, c))}`,
    arc(c, 1, polar(CUT_IN, spokeB - dIn)),
    arc(CUT_IN, 0, polar(CUT_IN, spokeA + dIn)),
    arc(c, 1, add(v4, vA, -c)),
    `L ${pt(add(v1, vA, -c))}`,
    arc(c, 1, polar(CUT_OUT, spokeA + dOut)),
    "Z",
  ].join(" ");
}

function cutouts(spokes: number[]): string[] {
  return spokes.map((a, i) => cutoutPath(a, i === spokes.length - 1 ? spokes[0] + 360 : spokes[i + 1]));
}

/* The two reels rest at different angles, the way they do after a wind. */
const SPOKES: Record<"left" | "right", number[]> = {
  left: [90, 210, 330],
  right: [30, 150, 270],
};

/*
 * Tape. ONE continuous path, the way a deck threads: it leaves the supply
 * (left) pack on its outer side, wraps the guide roller in the bottom-left
 * corner, runs along the bottom behind the nameplate, wraps the right roller
 * and climbs onto the take-up (right) pack. A second, short run between the
 * packs passes over the nameplate the other way (see RETURN_PATH). Runs
 * between the packs and the rollers are true external tangents, so the tape neither cuts into a pack
 * nor floats off it. The roller wraps sit one unit outside the roller rim so
 * they stay visible around it.
 *
 * Direction is the whole point: forward travel is left-to-right along this
 * path, which means tape peels off the LEFT side of the supply reel moving
 * down and arrives on the RIGHT side of the take-up reel moving up — so
 * both reels turn counter-clockwise in play/record and clockwise in rewind
 * (deck.css). Change the path and re-derive the rotation.
 */
const WRAP_R = ROLLER_R + 1;

/** External tangent of two circles on the side that `pick` selects. */
function tangent(a: Pt, ra: number, b: Pt, rb: number, pick: 1 | -1): [Pt, Pt] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const phi = deg(Math.atan2(dy, dx));
  const alpha = deg(Math.acos((ra - rb) / Math.hypot(dx, dy)));
  const t = phi + pick * alpha;
  return [add(a, polar(ra, t), 1), add(b, polar(rb, t), 1)];
}

const LEFT_PACK: Pt = [LEFT_X, CY];
const RIGHT_PACK: Pt = [RIGHT_X, CY];
const LEFT_ROLLER: Pt = [ROLLER_LX, ROLLER_Y];
const RIGHT_ROLLER: Pt = [ROLLER_RX, ROLLER_Y];
const [supplyOff, leftOn] = tangent(LEFT_PACK, PACK_R, LEFT_ROLLER, WRAP_R, 1);
const [takeupOn, rightOn] = tangent(RIGHT_PACK, PACK_R, RIGHT_ROLLER, WRAP_R, -1);
const TAPE_PATH = [
  `M ${pt(supplyOff)}`,
  `L ${pt(leftOn)}`,
  arc(WRAP_R, 0, [ROLLER_LX, ROLLER_Y + WRAP_R]),
  `L ${ROLLER_RX} ${ROLLER_Y + WRAP_R}`,
  arc(WRAP_R, 0, rightOn),
  `L ${pt(takeupOn)}`,
].join(" ");

/*
 * The short run: from the bottom of the take-up pack to the nameplate's
 * shoulders and back up to the supply pack. It is authored RIGHT-TO-LEFT on
 * purpose (user decision, 2026-09-03): the dash animation follows path
 * direction, so this run travels opposite to the outer tape and the two
 * read as one loop going round rather than two lines sliding the same way.
 */
const packEdge = (cx: number, angle: number): Pt => add([cx, CY], polar(PACK_R, angle), 1);
const RETURN_PATH = [
  `M ${pt(packEdge(RIGHT_X, 102))}`,
  `L ${PLATE.x + PLATE.w} ${PLATE.y + 5.5}`,
  `L ${PLATE.x} ${PLATE.y + 5.5}`,
  `L ${pt(packEdge(LEFT_X, 78))}`,
].join(" ");

function Tape({ d }: { d: string }) {
  return (
    <g>
      <path className="tape" d={d} fill="none" stroke="#5E4231" strokeWidth="2" strokeLinecap="round" />
      {/* The secondary motion layer. Three-fold symmetric reels can say
          "turning" but never "which way"; this travelling highlight is what
          makes rewind read as reverse. */}
      <path className="tape-shimmer" d={d} fill="none" stroke="#C6A57B" strokeWidth="1.2" strokeLinecap="round" />
    </g>
  );
}

/** One reel: spun-metal flange with three spokes over a wound tape pack. */
function Reel({ x, side }: { x: number; side: "left" | "right" }) {
  const cuts = cutouts(SPOKES[side]);
  const bolts = [0, 60, 120, 180, 240, 300];
  const brushed: number[] = [];
  for (let r = HUB_R + 1.5; r < R - 1; r += 1.5) brushed.push(Number(r.toFixed(2)));
  return (
    <g transform={`translate(${x} ${CY})`}>
      {/* Seat shadow: the reel stands proud of the plate. */}
      <circle r={R + 5} fill={`url(#reel-shadow)`} />
      {/* The rotating group's own box is symmetric about (0,0), which is what
          makes `transform-box: fill-box; transform-origin: center` spin it
          around its hub instead of the SVG's origin. */}
      <g className={`reel reel-${side}`}>
        {/* Wound tape pack, seen through the cut-outs. */}
        <circle r={PACK_R} fill="url(#pack)" />
        {[22, 24.5, 27, 29.5, 32, 34.5, 37].map((r) => (
          <circle key={r} r={r} fill="none" stroke="#3A332E" strokeWidth="0.55" />
        ))}
        {/* Flange: rim lip + three spokes, cut with the mask. */}
        <g mask={`url(#reel-cut-${side})`}>
          <circle r={R} fill="url(#reel-metal)" />
          {/* Spun finish: fine concentric rings, alternately lit and shaded. */}
          {brushed.map((r, i) => (
            <circle
              key={r}
              r={r}
              fill="none"
              stroke={i % 2 === 0 ? "#FFFFFF" : "#000000"}
              strokeOpacity={i % 2 === 0 ? 0.1 : 0.08}
              strokeWidth="0.55"
            />
          ))}
          {/* Groove where the lip steps down to the spoked field. */}
          <circle r={CUT_OUT + 1.6} fill="none" stroke="#000000" strokeOpacity="0.35" strokeWidth="0.9" />
          <circle r={CUT_OUT + 2.5} fill="none" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="0.6" />
        </g>
        {/* Cut-out edges: a lit lip on one side and the shadow line on the
            other read as machined thickness. */}
        {cuts.map((d) => (
          <path key={`hi-${d}`} d={d} transform="translate(0.5 0.5)" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="0.7" />
        ))}
        {cuts.map((d) => (
          <path key={`lo-${d}`} d={d} fill="none" stroke="#0A0908" strokeOpacity="0.85" strokeWidth="1.1" />
        ))}
        {/* Outer rim + lip highlight */}
        <circle r={R} fill="none" stroke="#0A0908" strokeWidth="1.2" />
        <circle r={R - 1.3} fill="none" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="0.7" />
        {/* Hub */}
        <circle r={HUB_R} fill="url(#hub-metal)" stroke="#0A0908" strokeWidth="0.9" />
        <circle r={HUB_R - 1.2} fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="0.6" />
        <circle r={HUB_R - 4.2} fill="none" stroke="#000000" strokeOpacity="0.22" strokeWidth="0.6" />
        {bolts.map((angle) => {
          const [bx, by] = polar(BOLT_AT, angle);
          return (
            <g key={angle} transform={`translate(${bx.toFixed(2)} ${by.toFixed(2)})`}>
              <circle r="1.8" fill="#1B1917" stroke="#DAD7D1" strokeWidth="0.45" />
              <circle r="0.55" cx="-0.5" cy="-0.5" fill="#FFFFFF" fillOpacity="0.55" />
            </g>
          );
        })}
        {/* Axle cap */}
        <circle r="5.9" fill="url(#hub-metal)" stroke="#0A0908" strokeWidth="0.8" />
        <circle r="4" fill="#131110" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="0.5" />
        <circle r="1.1" cx="-1.3" cy="-1.4" fill="#FFFFFF" fillOpacity="0.55" />
      </g>
      {/* One lamp, high and left, that does NOT turn with the reel: the fixed
          sheen is what makes the spinning read as a lit object rather than a
          rotating picture. */}
      <circle r={R} fill="url(#reel-light)" />
    </g>
  );
}

function CutMask({ side }: { side: "left" | "right" }) {
  return (
    <mask id={`reel-cut-${side}`} maskUnits="userSpaceOnUse" x={-R - 1} y={-R - 1} width={2 * R + 2} height={2 * R + 2}>
      <circle r={R} fill="#fff" />
      {cutouts(SPOKES[side]).map((d) => (
        <path key={d} d={d} fill="#000" />
      ))}
    </mask>
  );
}

/** A guide roller: silver rim, dark tyre, silver axle. The tape wraps it. */
function Roller({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={ROLLER_R + 3} fill="url(#reel-shadow)" />
      <circle r={ROLLER_R} fill="url(#hub-metal)" stroke="#0A0908" strokeWidth="0.8" />
      <circle r={ROLLER_R - 1.1} fill="none" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="0.6" />
      <circle r="5.2" fill="#1A1816" stroke="#FFFFFF" strokeOpacity="0.25" strokeWidth="0.5" />
      <circle r="2.2" fill="url(#hub-metal)" stroke="#0A0908" strokeWidth="0.5" />
      <circle r="0.6" cx="-0.5" cy="-0.6" fill="#FFFFFF" fillOpacity="0.6" />
    </g>
  );
}

/** The riveted nameplate between the rollers. */
function Nameplate() {
  const { x, y, w, h } = PLATE;
  const my = y + h / 2;
  return (
    <g>
      <rect x={x - 1} y={y} width={w + 2} height={h + 1.5} rx="4" fill="#000000" fillOpacity="0.55" />
      <rect x={x} y={y} width={w} height={h} rx="3" fill="url(#plate-metal)" stroke="#0A0908" strokeWidth="0.8" />
      <rect x={x + 0.8} y={y + 0.8} width={w - 1.6} height={h - 1.6} rx="2.4" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="0.6" />
      {[x + 5.5, x + w - 5.5].map((rx) => (
        <g key={rx} transform={`translate(${rx} ${my})`}>
          <circle r="2.1" fill="url(#hub-metal)" stroke="#0A0908" strokeWidth="0.5" />
          <circle r="0.9" fill="#2A2724" />
          <circle r="0.45" cx="-0.4" cy="-0.4" fill="#FFFFFF" fillOpacity="0.6" />
        </g>
      ))}
      <text
        x={x + w / 2}
        y={y + 9.6}
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        letterSpacing="0.9"
        fill="#2B2825"
        fontFamily="var(--font-mono)"
      >
        MACRO-REC
      </text>
      <text
        x={x + w / 2}
        y={y + 18.4}
        textAnchor="middle"
        fontSize="5.8"
        fontWeight="700"
        letterSpacing="0.8"
        fill="#3D3935"
        fontFamily="var(--font-mono)"
      >
        {`V${__APP_VERSION__}`}
      </text>
    </g>
  );
}

/**
 * The reel-to-reel stage. Pure decoration — every state it shows is also
 * spelled out by the lamp and the label in `DeckTransport`, which is what
 * keeps it honest under `prefers-reduced-motion` and behind `aria-hidden`.
 */
export function ReelDeck({ state }: { state: DeckState }) {
  return (
    <div className="deck-stage" data-deck={state} aria-hidden="true">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
        role="presentation"
      >
        <defs>
          <radialGradient id="reel-metal" cx="38%" cy="26%" r="80%">
            <stop offset="0%" stopColor="#F3F1ED" />
            <stop offset="32%" stopColor="#D3D0CA" />
            <stop offset="68%" stopColor="#A29E97" />
            <stop offset="100%" stopColor="#66625C" />
          </radialGradient>
          <radialGradient id="hub-metal" cx="38%" cy="28%" r="82%">
            <stop offset="0%" stopColor="#EEECE8" />
            <stop offset="45%" stopColor="#BDB9B2" />
            <stop offset="100%" stopColor="#77736C" />
          </radialGradient>
          <radialGradient id="pack" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2A2624" />
            <stop offset="85%" stopColor="#1F1C1A" />
            <stop offset="100%" stopColor="#100F0E" />
          </radialGradient>
          <radialGradient id="reel-shadow" cx="50%" cy="52%" r="50%">
            <stop offset="84%" stopColor="#000000" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="reel-light" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.16" />
            <stop offset="42%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="60%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="plate-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E2DFDA" />
            <stop offset="55%" stopColor="#C2BEB7" />
            <stop offset="100%" stopColor="#9C9891" />
          </linearGradient>
          <CutMask side="left" />
          <CutMask side="right" />
        </defs>

        {/* Tape first: it runs behind the reels, the rollers and the plate. */}
        <Tape d={TAPE_PATH} />
        <Tape d={RETURN_PATH} />
        {/* The rollers stay with the tape at every size — a wrap around
            nothing would look like a kink. */}
        <Roller x={ROLLER_LX} y={ROLLER_Y} />
        <Roller x={ROLLER_RX} y={ROLLER_Y} />

        {/* The nameplate and the bottom-edge screws are the parts a short
            panel drops: at 72px its legend is unreadable anyway. */}
        <g className="deck-furniture">
          <Nameplate />
          {[44, 66, 206, 228].map((cx) => (
            <g key={cx} transform={`translate(${cx} 104.5)`}>
              <circle r="1.6" fill="#1B1917" stroke="#8C867F" strokeWidth="0.45" />
              <line x1="-0.9" y1="0" x2="0.9" y2="0" stroke="#8C867F" strokeWidth="0.45" />
            </g>
          ))}
        </g>

        <Reel x={LEFT_X} side="left" />
        <Reel x={RIGHT_X} side="right" />
      </svg>
    </div>
  );
}
