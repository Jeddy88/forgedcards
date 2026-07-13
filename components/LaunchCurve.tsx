"use client";

import React, { useId, useState } from "react";

/**
 * LaunchCurve — the FORGE ascending bonding curve (anti-whale by design).
 *
 * Data is the MEASURED launch table from script/CurveModel.md (Foundry run
 * 2026-07-13, real production pool shape with the 0.3% LP + 1% hook fee active).
 * These are fixed launch config, NOT live chain data — hardcoded on purpose.
 * The dApp agent should NOT wire this to the pool; the live current price lives
 * on the Trade page instead.
 *
 * Plot: X = cumulative FORGE sold (with a cards-minted echo), Y = effective
 * ETH price per card (per 1,000 FORGE) on a LOG scale — an ascending curve with
 * NO ceiling: early buyers pay ~0.002 ETH/card, the price keeps climbing without
 * limit (the extended curve never sells out; ~1,600x from launch by 80 ETH in).
 */

/** One measured cumulative point on the curve (script/CurveModel.md table). */
interface CurvePoint {
  cumEth: number; // cumulative ETH into the pool
  cumOcards: number; // cumulative FORGE sold
  cards: number; // cumulative cards minted on the primary walk
  perCard: number; // effective ETH per 1,000 FORGE = price per card at this step
}

/** script/CurveModel.md — "Measured table (Foundry, fees included)", verbatim. */
export const LAUNCH_CURVE: readonly CurvePoint[] = [
  { cumEth: 0.1, cumOcards: 46_985, cards: 46, perCard: 0.0021 },
  { cumEth: 0.5, cumOcards: 197_758, cards: 196, perCard: 0.0027 },
  { cumEth: 1.0, cumOcards: 330_213, cards: 328, perCard: 0.0038 },
  { cumEth: 2.0, cumOcards: 496_481, cards: 494, perCard: 0.006 },
  { cumEth: 4.0, cumOcards: 663_532, cards: 661, perCard: 0.012 },
  { cumEth: 6.0, cumOcards: 747_352, cards: 744, perCard: 0.0239 },
  { cumEth: 8.0, cumOcards: 797_739, cards: 794, perCard: 0.0397 },
  { cumEth: 11.0, cumOcards: 844_313, cards: 840, perCard: 0.0644 },
  { cumEth: 14.0, cumOcards: 873_452, cards: 869, perCard: 0.103 },
  { cumEth: 20.0, cumOcards: 907_921, cards: 903, perCard: 0.1741 },
  { cumEth: 40.0, cumOcards: 951_739, cards: 946, perCard: 0.4564 },
  { cumEth: 80.0, cumOcards: 975_273, cards: 969, perCard: 1.6997 },
] as const;

// Plot geometry (viewBox units; responsive via width=100%).
const W = 720;
const H = 420;
const M = { top: 28, right: 24, bottom: 56, left: 60 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

// Domains. Y is LOG-scaled — the extended curve has no price ceiling, so the
// climb spans three orders of magnitude (~0.002 → ~1.7 ETH/card measured).
const X_MAX = 1_000_000; // FORGE
const Y_MIN = 0.002; // ETH per card (launch price)
const Y_MAX = 2; // ETH per card (top of the plotted window — NOT a ceiling)

const xOf = (ocards: number) => M.left + (ocards / X_MAX) * PLOT_W;
const yOf = (price: number) => {
  const clamped = Math.min(Math.max(price, Y_MIN), Y_MAX);
  const t = Math.log(clamped / Y_MIN) / Math.log(Y_MAX / Y_MIN);
  return M.top + (1 - t) * PLOT_H;
};

/**
 * Inverse of the curve: cumulative FORGE sold at a given price-per-card (ETH).
 * Linear-interpolates the measured table so a live spot price maps to a point
 * that lies exactly on the plotted line. Below the first point ⇒ 0 sold; above
 * the last ⇒ fully sold.
 */
function cumOcardsForPerCard(perCard: number): number {
  const first = LAUNCH_CURVE[0];
  const last = LAUNCH_CURVE[LAUNCH_CURVE.length - 1];
  if (perCard <= first.perCard) return 0;
  if (perCard >= last.perCard) return last.cumOcards;
  for (let i = 0; i < LAUNCH_CURVE.length - 1; i++) {
    const a = LAUNCH_CURVE[i];
    const b = LAUNCH_CURVE[i + 1];
    if (perCard >= a.perCard && perCard <= b.perCard) {
      const t = (perCard - a.perCard) / (b.perCard - a.perCard);
      return a.cumOcards + t * (b.cumOcards - a.cumOcards);
    }
  }
  return last.cumOcards;
}

/** Smooth cubic path through the points (Catmull-Rom → Bézier). */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function LaunchCurve({
  className = "",
  livePerCardEth,
  cardsMinted,
}: {
  className?: string;
  /** Current pool price as ETH per card (per 1,000 FORGE) → draws the live marker. */
  livePerCardEth?: number;
  /** Cards minted so far (for the live caption below the graph). */
  cardsMinted?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);

  const pts = LAUNCH_CURVE.map((p) => ({ x: xOf(p.cumOcards), y: yOf(p.perCard) }));
  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${(M.top + PLOT_H).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(M.top + PLOT_H).toFixed(1)} Z`;

  // Live "you are here" marker, derived from the current spot price.
  const live = typeof livePerCardEth === "number" && isFinite(livePerCardEth) && livePerCardEth > 0;
  const liveCum = live ? cumOcardsForPerCard(livePerCardEth as number) : 0;
  const liveX = xOf(liveCum);
  const liveY = yOf(live ? (livePerCardEth as number) : Y_MIN);
  const livePct = Math.min(100, Math.round((liveCum / X_MAX) * 100));

  // Y gridlines at meaningful prices (log scale — decade-ish steps).
  const yTicks = [0.002, 0.01, 0.05, 0.2, 1];
  // X gridlines every 200k FORGE.
  const xTicks = [0, 200_000, 400_000, 600_000, 800_000, 1_000_000];

  const first = LAUNCH_CURVE[0]; // deployer first-buy ceiling point (0.1 ETH)

  return (
    <figure className={`w-full ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="FORGE launch price curve: an ascending bonding curve with no price ceiling. The effective ETH price per card starts at roughly 0.002 ETH and keeps climbing without limit as supply sells — about 1,600 times the launch price after 80 ETH of buying, and still rising."
      >
        <defs>
          <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd44d" stopOpacity="0.28" />
            <stop offset="1" stopColor="#ffd44d" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gid}-line`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#3ecf8e" />
            <stop offset="0.5" stopColor="#5b8cff" />
            <stop offset="1" stopColor="#ffd44d" />
          </linearGradient>
        </defs>

        {/* gridlines + Y axis (price per card) */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={M.left}
              x2={M.left + PLOT_W}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke="rgba(232,232,240,0.08)"
              strokeWidth="1"
            />
            <text
              x={M.left - 10}
              y={yOf(t) + 3.5}
              textAnchor="end"
              className="fill-[#5e626b]"
              fontSize="11"
            >
              {t < 0.01 ? t.toFixed(3) : t < 1 ? String(t) : t.toFixed(0)}
            </text>
          </g>
        ))}

        {/* X axis ticks (FORGE sold) */}
        {xTicks.map((t) => (
          <text
            key={`x${t}`}
            x={xOf(t)}
            y={M.top + PLOT_H + 20}
            textAnchor="middle"
            className="fill-[#5e626b]"
            fontSize="11"
          >
            {t === 0 ? "0" : `${(t / 1000).toLocaleString()}k`}
          </text>
        ))}

        {/* axis title (Y only — the X axis is self-explanatory from its ticks
            and the live caption below the graph). */}
        <text
          transform={`translate(15 ${M.top + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-[#9aa0ac]"
          fontSize="12"
          fontWeight="600"
        >
          Price per card (ETH)
        </text>

        {/* area + curve */}
        <path d={area} fill={`url(#${gid}-fill)`} />
        <path d={line} fill="none" stroke={`url(#${gid}-line)`} strokeWidth="3" strokeLinecap="round" />

        {/* data points (hover to inspect) */}
        {LAUNCH_CURVE.map((p, i) => {
          const x = xOf(p.cumOcards);
          const y = yOf(p.perCard);
          const on = active === i;
          return (
            <g key={p.cumEth}>
              {on && (
                <line x1={x} x2={x} y1={y} y2={M.top + PLOT_H} stroke="rgba(232,232,240,0.18)" strokeDasharray="3 3" />
              )}
              <circle
                cx={x}
                cy={y}
                r={on ? 6 : 3.5}
                className="fill-[#0e0e14]"
                stroke={on ? "#e8e8f0" : "#8a8f98"}
                strokeWidth="2"
              />
              {/* generous invisible hit target for mouse + touch */}
              <circle
                cx={x}
                cy={y}
                r={18}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onTouchStart={() => setActive(i)}
                style={{ cursor: "pointer" }}
              />
            </g>
          );
        })}

        {/* hover tooltip */}
        {active !== null && (() => {
          const p = LAUNCH_CURVE[active];
          const x = xOf(p.cumOcards);
          const y = yOf(p.perCard);
          const boxW = 150;
          const flip = x + boxW + 14 > W;
          const bx = flip ? x - boxW - 12 : x + 12;
          const by = Math.min(Math.max(y - 34, M.top), M.top + PLOT_H - 58);
          return (
            <g pointerEvents="none">
              <rect x={bx} y={by} width={boxW} height={58} rx="8" className="fill-[#14141c]" stroke="rgba(232,232,240,0.14)" />
              <text x={bx + 10} y={by + 18} fontSize="11.5" fontWeight="700" className="fill-[#e8e8f0]">
                ~{p.perCard.toFixed(4)} ETH / card
              </text>
              <text x={bx + 10} y={by + 34} fontSize="10.5" className="fill-[#9aa0ac]">
                {p.cards} cards · {(p.cumOcards / 1000).toFixed(0)}k FORGE
              </text>
              <text x={bx + 10} y={by + 48} fontSize="10.5" className="fill-[#9aa0ac]">
                {p.cumEth} ETH in cumulatively
              </text>
            </g>
          );
        })()}

        {/* annotation: first card */}
        <g>
          <circle cx={xOf(first.cumOcards)} cy={yOf(first.perCard)} r="4.5" className="fill-[#3ecf8e]" stroke="#07070a" strokeWidth="1.5" />
          <text x={xOf(first.cumOcards) + 10} y={yOf(first.perCard) - 22} fontSize="11" fontWeight="700" className="fill-[#3ecf8e]">
            First card ~0.002 ETH
          </text>
          <text x={xOf(first.cumOcards) + 10} y={yOf(first.perCard) + 6} fontSize="9.5" className="fill-[#5e626b]">
            deployer first buy ≤ 0.1 ETH (46 cards)
          </text>
        </g>

        {/* annotation: no ceiling — the curve keeps climbing off the top of the plot */}
        <g>
          <text x={xOf(975_273) - 12} y={yOf(1.6997) - 14} textAnchor="end" fontSize="11" fontWeight="700" className="fill-[#ffd44d]">
            No price ceiling ↗
          </text>
          <text x={xOf(975_273) - 12} y={yOf(1.6997) - 1} textAnchor="end" fontSize="9.5" className="fill-[#5e626b]">
            ~1,600× launch by 80 ETH in — and still climbing
          </text>
        </g>

        {/* LIVE "you are here" marker — tracks the pool's current spot price. */}
        {live && (
          <g>
            <rect
              x={xOf(0)}
              y={M.top}
              width={Math.max(0, liveX - xOf(0))}
              height={PLOT_H}
              fill="rgba(91,140,255,0.09)"
            />
            <line x1={liveX} x2={liveX} y1={M.top} y2={M.top + PLOT_H} stroke="#5b8cff" strokeWidth="1.5" strokeDasharray="4 3" />
            <circle cx={liveX} cy={liveY} r="5.5" className="fill-[#5b8cff]" stroke="#07070a" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {live && (
        <p className="mt-3 text-center text-xs">
          <span className="text-[#5b8cff]">●</span>{" "}
          <span className="text-muted">
            Live · price now{" "}
            <span className="font-semibold text-ink">~{(livePerCardEth as number).toFixed(4)} ETH/card</span>{" "}
            · ~<span className="font-semibold text-ink">{livePct}%</span> along the curve ·{" "}
            <span className="font-semibold text-ink">{(cardsMinted ?? 0).toLocaleString()}</span> cards minted
          </span>
        </p>
      )}

      <figcaption className="mt-3 text-center text-xs leading-relaxed text-faint">
        Early is cheaper: the price per card climbs along the single ascending pool with no
        ceiling — the pool itself supports the price all the way up (log scale above). Buying
        big pushes your own price up — the built-in anti-whale. One pool, LP locked 1 year.{" "}
        <span className="text-[#5e626b]">Source: measured launch model (CurveModel.md).</span>
      </figcaption>
    </figure>
  );
}
