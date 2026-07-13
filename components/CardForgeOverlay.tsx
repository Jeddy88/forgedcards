"use client";

/**
 * Per-card forge overlay shown ON a card's display area (image). Two overlays,
 * meant to sit inside a `relative` parent (the card media wrapper):
 *  - a phase-aware status tag (top-left): "Forging" while maturing, then
 *    "Forging complete · claim within <countdown>" once the duration expires,
 *    then "Claim window lapsed" if the 3-hour window passes;
 *  - a progress bar (bottom) with the target tier + state.
 *
 * Used on both My Cards (the grid) and the card detail page (over the
 * interactive card). The actual Upgrade / Cancel actions live on the detail page.
 */
import React from "react";
import Countdown from "./Countdown";
import { useNowSeconds } from "@/lib/live";
import { tierInfo } from "@/lib/tiers";
import type { ForgeView } from "@/lib/fixtures/types";

export default function CardForgeOverlay({
  forge,
  durationSec,
}: {
  forge: ForgeView;
  durationSec: bigint;
}) {
  // Live 1s clock so the tag flips to "complete"/"lapsed" the instant the
  // deadline passes (the chain flags are a slower ~12s poll; we OR them in).
  const nowS = useNowSeconds();
  const target = tierInfo(forge.targetTier);
  const dur = Number(durationSec) || 1;
  const started = Number(forge.maturesAt) - dur;
  const pct = Math.max(0, Math.min(100, ((nowS - started) / dur) * 100));
  const matured = forge.isMature || nowS >= Number(forge.maturesAt);
  const swept = forge.isSweepable || nowS >= Number(forge.claimDeadline);
  const phase = swept ? "lapsed" : matured ? "complete" : "forging";
  const bar = phase === "lapsed" ? "bg-danger" : phase === "complete" ? "bg-warn" : "bg-accent";
  const barPct = phase === "forging" ? pct : 100;

  return (
    <>
      {/* status tag (top-left) — phase-aware. pointer-events-none so the
          interactive card underneath (detail page) stays clickable. */}
      <span
        className={`pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] rounded-full bg-bg/85 px-2 py-0.5 text-[9px] font-semibold leading-tight ${
          phase === "lapsed" ? "text-danger" : "text-warn"
        } ${phase === "forging" ? "uppercase tracking-wider" : ""}`}
      >
        {phase === "forging" ? (
          "Forging"
        ) : phase === "complete" ? (
          <>
            Forging complete · claim within <Countdown to={forge.claimDeadline} tone="warn" />
          </>
        ) : (
          "Upgrade now · sweepable"
        )}
      </span>

      {/* progress indicator — bottom of the card display area */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 space-y-1 bg-gradient-to-t from-bg/95 via-bg/70 to-transparent px-2 pb-2 pt-6"
        data-source="StakingVault.getForge(activeForge(tokenId))"
      >
        <div className="flex items-center justify-between gap-2 text-[10px] font-semibold leading-none">
          <span className="text-faint">→ {target.name}</span>
          {phase === "forging" ? (
            <span className="tabular-nums text-muted">
              matures in <Countdown to={forge.maturesAt} tone="neutral" />
            </span>
          ) : phase === "complete" ? (
            <span className="text-warn">ready to upgrade</span>
          ) : (
            <span className="text-danger">upgrade now!</span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg/70">
          <div
            className={`h-full ${bar} transition-[width] duration-500`}
            style={{ width: `${barPct}%` }}
          />
        </div>
      </div>
    </>
  );
}
