import type { DeckState } from "./deckState";

/*
 * The drawing is sized so that at a 300px Creator panel one user unit is one
 * CSS pixel: the window's content box is 274x110 and the viewBox is 272x110,
 * so `meet` resolves to scale 1 and a flange of R=51 renders 102px across.
 * The reels are the point of the stage — the composition gives them the whole
 * height and lets the tape path live in the gap between them.
 */
const VB_W = 272;
const VB_H = 110;
const CY = 55;

const R = 51; // flange radius
const PACK_R = 44; // wound tape, seen through the flange cut-outs
const HOLE_R = 13.5;
const HOLE_AT = 29;
const SCREW_AT = 9.5;

const LEFT_X = 61;
const RIGHT_X = 211;

/*
 * Tape spans pack edge to pack edge and dips over the head between the reels.
 * The dip is not decoration: with flanges this large the only tape the panel
 * can show is the ~48px between them, and a straight line there reads as a
 * scratch. The curve gives the shimmer something to travel along.
 */
const TAPE_PATH = `M ${LEFT_X + PACK_R} ${CY} C 116 57 121 66 136 66 C 151 66 156 57 ${RIGHT_X - PACK_R} ${CY}`;

/** One reel: brushed-metal flange with three cut-outs over a wound tape pack. */
function Reel({ x, side }: { x: number; side: "left" | "right" }) {
  const holes = [-90, 30, 150];
  const screws = [0, 60, 120, 180, 240, 300];
  return (
    <g transform={`translate(${x} ${CY})`}>
      {/* The rotating group's own box is symmetric about (0,0), which is what
          makes `transform-box: fill-box; transform-origin: center` spin it
          around its hub instead of the SVG's origin. */}
      <g className={`reel reel-${side}`}>
        {/* Wound tape pack, seen through the flange cut-outs. */}
        <circle r={PACK_R} fill="#2A2523" />
        {[19, 23, 28, 32, 37, 41].map((r) => (
          <circle key={r} r={r} fill="none" stroke="#3B342F" strokeWidth="0.6" />
        ))}
        {/* Flange */}
        <g mask={`url(#reel-holes-${side})`}>
          <circle r={R} fill="url(#reel-metal)" />
          {/* brushed rings */}
          {[16, 21, 26, 31, 36, 41, 45, 48].map((r) => (
            <circle key={r} r={r} fill="none" stroke="#FFFFFF" strokeOpacity="0.10" strokeWidth="0.7" />
          ))}
          {[18, 23, 29, 34, 38, 43, 47].map((r) => (
            <circle key={r} r={r} fill="none" stroke="#000000" strokeOpacity="0.08" strokeWidth="0.6" />
          ))}
        </g>
        {/* Cut-out rims */}
        {holes.map((angle) => (
          <circle
            key={angle}
            r={HOLE_R}
            cx={HOLE_AT * Math.cos((angle * Math.PI) / 180)}
            cy={HOLE_AT * Math.sin((angle * Math.PI) / 180)}
            fill="none"
            stroke="#14120F"
            strokeWidth="1"
          />
        ))}
        {/* Outer rim + inner highlight */}
        <circle r={R} fill="none" stroke="#121110" strokeWidth="1.4" />
        <circle r={R - 1.6} fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="0.7" />
        {/* Hub */}
        <circle r="15" fill="url(#reel-hub)" stroke="#121110" strokeWidth="1" />
        <circle r="13.8" fill="none" stroke="#FFFFFF" strokeOpacity="0.2" strokeWidth="0.6" />
        {screws.map((angle) => (
          <circle
            key={angle}
            r="1.5"
            cx={SCREW_AT * Math.cos((angle * Math.PI) / 180)}
            cy={SCREW_AT * Math.sin((angle * Math.PI) / 180)}
            fill="#17150F"
            stroke="#8C867F"
            strokeWidth="0.45"
          />
        ))}
        <circle r="3.7" fill="#1B1916" stroke="#6E6862" strokeWidth="0.6" />
      </g>
    </g>
  );
}

function HoleMask({ side }: { side: "left" | "right" }) {
  return (
    <mask
      id={`reel-holes-${side}`}
      maskUnits="userSpaceOnUse"
      x={-R - 1}
      y={-R - 1}
      width={2 * R + 2}
      height={2 * R + 2}
    >
      <circle r={R} fill="#fff" />
      {[-90, 30, 150].map((angle) => (
        <circle
          key={angle}
          r={HOLE_R}
          cx={HOLE_AT * Math.cos((angle * Math.PI) / 180)}
          cy={HOLE_AT * Math.sin((angle * Math.PI) / 180)}
          fill="#000"
        />
      ))}
    </mask>
  );
}

/** A tape guide: the tape wraps its face, so it is drawn over the path. */
function Guide({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="4.6" fill="url(#reel-metal)" stroke="#121110" strokeWidth="0.8" />
      <circle cx={x} cy={y} r="1.6" fill="#1B1916" stroke="#6E6862" strokeWidth="0.4" />
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
          <radialGradient id="reel-metal" cx="36%" cy="28%" r="80%">
            <stop offset="0%" stopColor="#E4E0D8" />
            <stop offset="38%" stopColor="#BAB5AD" />
            <stop offset="78%" stopColor="#908B84" />
            <stop offset="100%" stopColor="#6C6862" />
          </radialGradient>
          <radialGradient id="reel-hub" cx="36%" cy="28%" r="85%">
            <stop offset="0%" stopColor="#6B655F" />
            <stop offset="70%" stopColor="#2E2A27" />
            <stop offset="100%" stopColor="#1A1816" />
          </radialGradient>
          <linearGradient id="plate-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#B9B4AC" />
            <stop offset="100%" stopColor="#847F79" />
          </linearGradient>
          <HoleMask side="left" />
          <HoleMask side="right" />
        </defs>

        {/* Head block. Drawn BEFORE the tape, because the tape runs across
            the head face — that contact is the whole point of a head. */}
        <g className="deck-furniture">
          <rect x="121" y="58" width="30" height="24" rx="2.5" fill="url(#plate-metal)" stroke="#4A453F" strokeWidth="0.8" />
          <rect x="125" y="61" width="22" height="16" rx="1.5" fill="#1E1B19" stroke="#5F5A54" strokeWidth="0.6" />
          <line x1="136" y1="61" x2="136" y2="77" stroke="#7E7871" strokeWidth="0.6" />
          {[125, 147].map((cx) => (
            <circle key={cx} cx={cx} cy={79.5} r="1.4" fill="#2A2623" stroke="#8C867F" strokeWidth="0.35" />
          ))}
        </g>

        {/* Tape path: pack edge to pack edge, across the head. */}
        <path
          className="tape"
          d={TAPE_PATH}
          fill="none"
          stroke="#463C34"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        {/* The secondary motion layer. Three-fold symmetric reels can say
            "turning" but never "which way"; this travelling highlight is what
            makes rewind read as reverse. */}
        <path
          className="tape-shimmer"
          d={TAPE_PATH}
          fill="none"
          stroke="#C6A57B"
          strokeWidth="1.6"
          strokeLinecap="round"
        />

        {/* Guides, rivets and silkscreen are the parts a short panel drops. */}
        <g className="deck-furniture">
          <Guide x={113} y={57} />
          <Guide x={159} y={57} />
          {[
            [8, 8],
            [264, 8],
            [8, 102],
            [264, 102],
          ].map(([cx, cy]) => (
            <g key={`${cx}-${cy}`}>
              <circle cx={cx} cy={cy} r="2.8" fill="url(#reel-hub)" stroke="#121110" strokeWidth="0.5" />
              <line x1={(cx as number) - 1.5} y1={cy} x2={(cx as number) + 1.5} y2={cy} stroke="#8C867F" strokeWidth="0.5" />
            </g>
          ))}
          <text
            x="136"
            y="17"
            textAnchor="middle"
            fontSize="6.4"
            fontWeight="700"
            letterSpacing="1.5"
            fill="#8F877D"
            fontFamily="var(--font-mono)"
          >
            MACRO-REC
          </text>
          <text
            x="136"
            y="101"
            className="deck-model"
            textAnchor="middle"
            fontSize="5.4"
            letterSpacing="1.4"
            fill="#6E675F"
            fontFamily="var(--font-mono)"
          >
            MR-300
          </text>
        </g>

        <Reel x={LEFT_X} side="left" />
        <Reel x={RIGHT_X} side="right" />
      </svg>
    </div>
  );
}
