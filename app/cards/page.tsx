"use client";

import Link from "next/link";
import React from "react";
import TierBadge from "@/components/TierBadge";
import CardForgeOverlay from "@/components/CardForgeOverlay";
import {
  Button,
  ConnectGate,
  EmptyState,
  ErrorState,
  PageTitle,
  Panel,
  SkeletonPanel,
  Stat,
} from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";
import { formatEth } from "@/lib/format";
import { tierInfo } from "@/lib/tiers";
import LiveCardMedia from "@/components/LiveCardMedia";
import ForgeAlarms from "@/components/ForgeAlarms";
import {
  claimYieldAction,
  claimYieldManyAction,
  settleStakingAction,
  withdrawStakingAction,
  withdrawYieldAction,
} from "@/lib/actions";
import { useTx } from "@/lib/tx";

/** StakingVault.raidStatusOf codes → the badge shown on the card. Protected (2) and
 *  Not raidable (0) get no badge — only states the owner may need to act on. */
const RAID_BADGE: Record<number, { label: string; className: string }> = {
  1: { label: "🕐 Grace", className: "bg-tier1 text-bg" },
  3: { label: "⚠️ Vulnerable", className: "bg-warn text-white" },
  4: { label: "⚔️ Under attack", className: "bg-danger text-white" },
  5: { label: "🗡️ Raiding", className: "bg-accent text-bg" },
};

export default function MyCardsPage() {
  const { dataMode, connected } = useApp();
  const snap = useSnapshot();
  const tx = useTx();
  const v = snap.stakingVault;

  const totalAccrued = snap.myCards.reduce((acc, c) => acc + c.accrued, 0n);
  const activeForges = v.forgesOf
    .map((id) => ({ id, t: v.forges[id.toString()] }))
    .filter((x) => x.t);

  return (
    <div>
      <PageTitle
        kicker="My cards"
        title="Your collection"
        lede="Each card accrues sell-fee yield by tier weight. Yield sticks to the card until claimed — sell a card and its unclaimed earnings go with it."
      />

      {dataMode === "loading" ? (
        <div className="space-y-4">
          <SkeletonPanel lines={2} />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonPanel key={i} lines={3} />
            ))}
          </div>
        </div>
      ) : dataMode === "error" ? (
        <ErrorState />
      ) : !connected ? (
        <ConnectGate>Connect your wallet to see your cards, active forges, and earnings.</ConnectGate>
      ) : snap.myCards.length === 0 ? (
        <EmptyState
          title="No cards yet"
          body="Cards mint automatically when you buy FORGE from the pool — 1 card per whole 1,000 FORGE bought. Every card starts at Common."
          action={
            <Link href="/trade">
              <Button>Buy FORGE &amp; mint</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-10">
          {/* --------------- your earnings: two clearly separated streams --------------- */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
              Your earnings
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {/* Stream 1: staking rewards (buy fees) */}
              <Panel className="flex flex-col p-5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink">Staking rewards</h3>
                  <span className="rounded-full bg-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    from buy fees
                  </span>
                </div>
                <p className="mb-4 text-xs leading-relaxed text-muted">
                  Earned by your staked FORGE tokens: 1% of the ETH on every buy, split
                  across all stakers.
                </p>
                <dl className="grid flex-1 grid-cols-2 gap-4">
                  <Stat
                    label="Pending"
                    value={formatEth(v.pendingRewards)}
                    source="StakingVault.pendingRewards(wallet)"
                  />
                  <Stat
                    label="Ready to withdraw"
                    value={formatEth(v.claimable)}
                    source="StakingVault.claimable(wallet)"
                  />
                </dl>
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={v.pendingRewards === 0n}
                    onClick={() => {
                      const a = settleStakingAction(v.pendingRewards);
                      tx.run(a.intent, a.steps);
                    }}
                  >
                    Settle
                  </Button>
                  <Button
                    disabled={v.claimable === 0n}
                    onClick={() => {
                      const a = withdrawStakingAction(v.claimable);
                      tx.run(a.intent, a.steps);
                    }}
                  >
                    Withdraw staking rewards
                  </Button>
                </div>
              </Panel>

              {/* Stream 2: card yield (sell fees) */}
              <Panel className="flex flex-col p-5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink">Card yield</h3>
                  <span className="rounded-full bg-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    from sell fees
                  </span>
                </div>
                <p className="mb-4 text-xs leading-relaxed text-muted">
                  Earned by the cards themselves: 1% of the ETH on every sell, split across
                  all cards by tier weight. Unclaimed yield travels with each card.
                </p>
                <dl className="grid flex-1 grid-cols-2 gap-4">
                  <Stat
                    label="Unclaimed on your cards"
                    value={formatEth(totalAccrued)}
                    source="Σ CardYield.accruedOf(tokenId) over owned cards"
                  />
                  <Stat
                    label="Ready to withdraw"
                    value={formatEth(snap.cardYield.claimable)}
                    source="CardYield.claimable(wallet)"
                  />
                </dl>
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={totalAccrued === 0n}
                    onClick={() => {
                      const ids = snap.myCards.filter((c) => c.accrued > 0n).map((c) => c.tokenId);
                      const a = claimYieldManyAction(ids, totalAccrued);
                      tx.run(a.intent, a.steps);
                    }}
                  >
                    Claim all card yield
                  </Button>
                  <Button
                    disabled={snap.cardYield.claimable === 0n}
                    onClick={() => {
                      const a = withdrawYieldAction(snap.cardYield.claimable);
                      tx.run(a.intent, a.steps);
                    }}
                  >
                    Withdraw card yield
                  </Button>
                </div>
              </Panel>
            </div>
          </section>

          {/* ------------------------------------ cards grid */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
              Cards ({snap.myCards.length})
            </h2>

            {/* Forge alarms stay here so the SAFETY-CRITICAL 3-hour claim-window
                notifications keep firing even though the old per-forge list is
                gone. One compact control regardless of how many cards forge. */}
            {activeForges.length > 0 && (
              <div className="mb-4">
                <ForgeAlarms forges={activeForges} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {snap.myCards.map((c) => {
                const forge =
                  c.activeForgeId !== 0n ? v.forges[c.activeForgeId.toString()] ?? null : null;
                // A forging card is busy — its raid state isn't actionable right now.
                const badge = c.activeForgeId === 0n ? RAID_BADGE[c.raidStatus] : undefined;
                return (
                  <Panel key={c.tokenId.toString()} className="group flex flex-col overflow-hidden">
                    <Link href={`/cards/${c.tokenId}`} className="relative block">
                      <LiveCardMedia
                        tokenId={c.tokenId}
                        tier={c.tier}
                        owner={c.owner}
                        material={c.material}
                        alt={`Card #${c.tokenId} — ${tierInfo(c.tier).name} ${c.material}`}
                        className="w-full transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      {badge && (
                        <span
                          className={`absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-card ${badge.className}`}
                          data-source="StakingVault.raidStatusOf(tokenId)"
                        >
                          {badge.label}
                        </span>
                      )}
                      {forge && (
                        <CardForgeOverlay
                          forge={forge}
                          durationSec={snap.cardsOnChain.tierDurations[forge.targetTier]}
                        />
                      )}
                    </Link>
                    <div className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/cards/${c.tokenId}`}
                          className="text-sm font-semibold tabular-nums text-ink hover:underline"
                        >
                          #{c.tokenId.toString()}
                        </Link>
                        <TierBadge tier={c.tier} size="sm" />
                      </div>
                      <p className="text-xs text-muted">
                        {c.material} · weight {c.weight.toString()}×
                      </p>
                      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                        <span
                          className="text-xs tabular-nums text-ink/90"
                          data-source="CardYield.accruedOf(tokenId)"
                          title="CardYield.accruedOf(tokenId)"
                        >
                          {formatEth(c.accrued, 6)}
                        </span>
                        <button
                          className="text-xs font-semibold text-accent hover:text-ink disabled:text-faint"
                          disabled={c.accrued === 0n}
                          onClick={() => {
                            const a = claimYieldAction(c.tokenId, c.accrued);
                            tx.run(a.intent, a.steps);
                          }}
                        >
                          Claim
                        </button>
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
