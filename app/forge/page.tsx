"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import CardForgeOverlay from "@/components/CardForgeOverlay";
import CardMedia from "@/components/CardMedia";
import ForgeFlow from "@/components/ForgeFlow";
import TierBadge from "@/components/TierBadge";
import {
  Button,
  ConnectGate,
  EmptyState,
  ErrorState,
  PageTitle,
  SkeletonPanel,
} from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";

export default function ForgePage() {
  const { dataMode, connected } = useApp();
  const snap = useSnapshot();
  const [selectedCard, setSelectedCard] = useState<bigint | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const card = snap.myCards.find((c) => c.tokenId === selectedCard) ?? null;

  // On small screens (single column) bring the flow into view when a card is
  // picked, so tier selection is immediately visible without a manual scroll.
  useEffect(() => {
    if (card && typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      flowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [card]);

  return (
    <div>
      <PageTitle
        kicker="Forge"
        title="Forge a card into a rarer tier"
        lede="Lock the target tier's stake of FORGE tokens, wait out the maturation (12–48 hours by tier), then claim within a tight 3-hour window. Forge slots are first come, first served — your tokens are only ever locked, never spent."
      />

      {dataMode === "loading" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonPanel lines={6} />
          <SkeletonPanel lines={6} />
        </div>
      ) : dataMode === "error" ? (
        <ErrorState />
      ) : !connected ? (
        <ConnectGate>
          Connect your wallet to pick one of your cards and start forging.
        </ConnectGate>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* ---------------------------------- left: pick a card */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
              1 · Pick one of your cards
            </h2>
            {snap.myCards.length === 0 ? (
              <EmptyState
                title="No cards yet"
                body="Cards mint automatically when you buy FORGE — 1 card per whole 1,000 FORGE bought."
                action={
                  <Link href="/trade">
                    <Button>Buy FORGE</Button>
                  </Link>
                }
              />
            ) : (
              // Capped, scrollable grid so a large collection never pushes the
              // forge flow off-screen; a little right padding clears the scrollbar.
              <div className="max-h-[60vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {snap.myCards.map((c) => {
                    const busy = c.activeForgeId !== 0n;
                    // The live forge record: drives the SAME phase-aware overlay as
                    // My Cards ("Forging" → "Forging complete · claim within …" →
                    // "Upgrade now · sweepable"), so a card due for its upgrade is
                    // just as visible here as on the collection grid.
                    const forge = busy
                      ? snap.stakingVault.forges[c.activeForgeId.toString()] ?? null
                      : null;
                    const active = selectedCard === c.tokenId;
                    return (
                      <button
                        key={c.tokenId.toString()}
                        onClick={() => setSelectedCard(c.tokenId)}
                        className={`group relative rounded-2xl border p-2 text-left transition-colors ${
                          active
                            ? "border-accent/60 bg-raised"
                            : "border-line bg-surface hover:border-accent/30"
                        }`}
                      >
                        {/* relative wrapper scopes the overlay (tag + progress bar)
                            to the card IMAGE, not the whole tile */}
                        <div className="relative overflow-hidden rounded-xl">
                          <CardMedia
                            material={c.material}
                            alt={`Card #${c.tokenId} — ${c.material}`}
                            className={`w-full rounded-xl ${busy ? "opacity-50" : ""}`}
                          />
                          {forge && (
                            <CardForgeOverlay
                              forge={forge}
                              durationSec={snap.cardsOnChain.tierDurations[forge.targetTier]}
                            />
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-1 px-1 pb-1">
                          <span className="text-xs font-semibold tabular-nums text-ink">
                            #{c.tokenId.toString()}
                          </span>
                          <TierBadge tier={c.tier} size="sm" />
                        </div>
                        {/* fallback tag for the brief moment the forge record hasn't
                            loaded yet (overlay takes over once it has) */}
                        {busy && !forge && (
                          <span
                            className="absolute left-3 top-3 z-10 rounded-full bg-bg/85 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-warn"
                            data-source="StakingVault.activeForge(tokenId) != 0"
                          >
                            Forging
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* ---------------------------------- right: forge flow (sticky) */}
          {/* No Panel wrapper: ForgeFlow renders its OWN combined header (an
              <h2> matching the left "1 · …" header), so the two column headers
              sit on the same horizontal line. */}
          <div ref={flowRef} className="sticky top-24">
            {card ? (
              <ForgeFlow card={card} headingPrefix="2 · FORGE" />
            ) : (
              <>
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
                  2 · FORGE
                </h2>
                <p className="rounded-2xl border border-line bg-surface px-6 py-8 text-center text-sm text-faint">
                  Pick one of your cards to begin — tier selection and the forge review appear
                  here.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
