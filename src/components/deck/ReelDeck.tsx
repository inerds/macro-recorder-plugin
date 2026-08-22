import type { DeckState } from "./deckState";

const R = 44; // flange radius
const HOLE_R = 12.5;
const HOLE_AT = 25;
const SCREW_AT = 8.2;

/** One reel: brushed-metal flange with three cut-outs over a wound tape pack. */
function Reel({ x, side }: { x: number; side: "left" | "right" }) {
  const holes = [-90, 30, 150];
  const screws = [0, 60, 120, 180, 240, 300];
  return (
    <g transform={`translate(${x} 54)`}>
      {/* The rotating group's own box is symmetric about (0,0), which is what
          makes `transform-box: fill-box; transform-origin: center` spin it
          around its hub instead of the SVG's origin. */}
      <g className={`reel reel-${side}`}>
        {/* Wound tape pack, seen through the flange cut-outs. */}
        <circle r={R - 2} fill="#2A2523" />
        {[16, 20, 24, 28, 32, 36, 40].map((r) => (
          <circle key={r} r={r} fill="none" stroke="#3B342F" strokeWidth="0.5" />
        ))}
        {/* Flange */}
        <g mask={`url(#reel-holes-${side})`}>
          <circle r={R} fill="url(#reel-metal)" />
          {/* brushed rings */}
          {[14, 18, 22, 27, 31, 35, 39, 42].map((r) => (
            <circle key={r} r={r} fill="none" stroke="#FFFFFF" strokeOpacity="0.10" strokeWidth="0.6" />
          ))}
          {[16, 20, 25, 29, 33, 37, 41].map((r) => (
            <circle key={r} r={r} fill="none" stroke="#000000" strokeOpacity="0.08" strokeWidth="0.5" />
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
            strokeWidth="0.9"
          />
        ))}
        {/* Outer rim + inner highlight */}
        <circle r={R} fill="none" stroke="#121110" strokeWidth="1.2" />
        <circle r={R - 1.4} fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="0.6" />
        {/* Hub */}
        <circle r="13" fill="url(#reel-hub)" stroke="#121110" strokeWidth="0.9" />
        <circle r="12" fill="none" stroke="#FFFFFF" strokeOpacity="0.2" strokeWidth="0.5" />
        {screws.map((angle) => (
          <circle
            key={angle}
            r="1.3"
            cx={SCREW_AT * Math.cos((angle * Math.PI) / 180)}
            cy={SCREW_AT * Math.sin((angle * Math.PI) / 180)}
            fill="#17150F"
            stroke="#8C867F"
            strokeWidth="0.4"
          />
        ))}
        <circle r="3.2" fill="#1B1916" stroke="#6E6862" strokeWidth="0.5" />
      </g>
    </g>
  );
}

function HoleMask({ side }: { side: "left" | "right" }) {
  return (
    <mask id={`reel-holes-${side}`} maskUnits="userSpaceOnUse" x={-R - 1} y={-R - 1} width={2 * R + 2} height={2 * R + 2}>
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

/**
 * The reel-to-reel stage. Pure decoration — every state it shows is also
 * spelled out by the lamp and the label in `DeckTransport`, which is what
 * keeps it honest under `prefers-reduced-motion` and behind `aria-hidden`.
 */
export function ReelDeck({ state }: { state: DeckState }) {
  return (
    <div className="deck-stage" data-deck={state} aria-hidden="true">
      <svg
        viewBox="0 0 300 120"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
        role="presentation"
      >
        <defs>
          <radialGradient id="reel-metal" cx="36%" cy="28%" r="80%">
            <stop offset="0%" stopColor="#F1EFEA" />
            <stop offset="40%" stopColor="#C9C5BE" />
            <stop offset="80%" stopColor="#9E9A93" />
            <stop offset="100%" stopColor="#7E7A74" />
          </radialGradient>
          <radialGradient id="reel-hub" cx="36%" cy="28%" r="85%">
            <stop offset="0%" stopColor="#6B655F" />
            <stop offset="70%" stopColor="#2E2A27" />
            <stop offset="100%" stopColor="#1A1816" />
          </radialGradient>
          <linearGradient id="plate-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D8D4CD" />
            <stop offset="100%" stopColor="#ABA69F" />
          </linearGradient>
          <HoleMask side="left" />
          <HoleMask side="right" />
        </defs>

        {/* Tape path: off the left reel, down over the corner rollers, onto the right. */}
        <path
          className="tape"
          d="M 40 80 C 34 92 30 100 22 104 L 278 104 C 270 100 266 92 260 80"
          fill="none"
          stroke="#3A312B"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Rollers, rivets and nameplate are the parts a short panel drops. */}
        <g className="deck-furniture">
          {[
            [20, 104],
            [280, 104],
          ].map(([cx, cy]) => (
            <g key={`${cx}-${cy}`}>
              <circle cx={cx} cy={cy} r="8" fill="url(#reel-metal)" stroke="#121110" strokeWidth="0.9" />
              <circle cx={cx} cy={cy} r="5.5" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="0.6" />
              <circle cx={cx} cy={cy} r="2.2" fill="#1B1916" stroke="#6E6862" strokeWidth="0.4" />
            </g>
          ))}
          {[
            [8, 8],
            [292, 8],
            [8, 112],
            [292, 112],
          ].map(([cx, cy]) => (
            <g key={`${cx}-${cy}`}>
              <circle cx={cx} cy={cy} r="2.6" fill="url(#reel-hub)" stroke="#121110" strokeWidth="0.5" />
              <line x1={cx - 1.4} y1={cy} x2={cx + 1.4} y2={cy} stroke="#8C867F" strokeWidth="0.5" />
            </g>
          ))}
          <rect x="104" y="96" width="92" height="18" rx="2.5" fill="url(#plate-metal)" stroke="#5A554F" strokeWidth="0.7" />
          <rect x="105.5" y="97.5" width="89" height="15" rx="1.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="0.5" />
          {[
            [109, 105],
            [191, 105],
          ].map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r="1.3" fill="#2A2623" stroke="#8C867F" strokeWidth="0.3" />
          ))}
          <text x="150" y="104" textAnchor="middle" fontSize="5.6" fontWeight="700" letterSpacing="0.9" fill="#2A2623" fontFamily="var(--font-mono)">
            MACRO-REC
          </text>
          <text x="150" y="110.6" textAnchor="middle" fontSize="5" letterSpacing="0.9" fill="#3F3A35" fontFamily="var(--font-mono)">
            MR-300
          </text>
        </g>

        <Reel x={80} side="left" />
        <Reel x={220} side="right" />
      </svg>
    </div>
  );
}
