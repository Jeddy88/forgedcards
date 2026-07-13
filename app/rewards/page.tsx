"use client";

import Link from "next/link";
import React from "react";
import TierBadge from "@/components/TierBadge";
import {
  Button,
  ConnectGate,
  EmptyState,
  ErrorState,
  PageTitle,
  Panel,
  Row,
  SkeletonPanel,
  Stat,
} from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";
import { formatEth } from "@/lib/format";
import {
  claimYieldAction,
  claimYieldManyAction,
  settleStakingAction,
  withdrawStakingAction,
  withdrawYieldAction,
} from "@/lib/actions";
import { useTx } from "@/lib/tx";

export default function RewardsPage() {
  const { dataMode, connected } = useApp();
  const snap = useSnapshot();
  const tx = useTx();
  const v = snap.stakingVault;

  const totalAccrued = snap.myCards.reduce((acc, c) => acc + c.accrued, 0n);

  return (
    <div>
      <PageTitle
        kicker="Rewards"
        title="Two streams, both in ETH"
        lede="Every swap pays somebody: 1% of buys goes to FORGE stakers, 1% of sells goes to card holders weighted by tier. Both use a pull pattern — settle, then withdraw."
      />

      {/* protocol-wide totals */}
      {dataMode === "success" || dataMode === "empty" ? (
        <Panel className="mb-8 p-6">
          <dl className="grid grid-cols-2 gap-6">
            <Stat
              label="All-time to stakers"
              value={formatEth(snap.eventTotals.stakerRewardsDeposited)}
              sub="1% of every buy's ETH"
              source="Σ StakingVault.RewardsDeposited events"
            />
            <Stat
              label="All-time to card holders"
              value={formatEth(snap.eventTotals.cardYieldDeposited)}
              sub="1% of every sell's ETH"
              source="Σ CardYield.RewardsDeposited events"
            />
          </dl>
        </Panel>
      ) : null}

      {dataMode === "loading" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonPanel lines={6} />
          <SkeletonPanel lines={6} />
        </div>
      ) : dataMode === "error" ? (
        <ErrorState />
      ) : !connected ? (
        <ConnectGate>Connect your wallet to see and withdraw both reward streams.</ConnectGate>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {/* ------------------------------- staker stream */}
          <Panel className="p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Staking rewards</h2>
              <span className="rounded-full bg-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                from buy fees
              </span>
            </div>
            <p className="mb-5 text-sm text-muted">
              Pro-rata to your staked FORGE — locked stake included.
            </p>
            {v.stakedOf === 0n ? (
              <EmptyState
                title="Not staking yet"
                body="Stake FORGE to earn a share of every buy."
                action={
                  <Link href="/stake">
                    <Button variant="ghost">Go to Stake</Button>
                  </Link>
                }
              />
            ) : (
              <>
                <Row
                  label="Pending (settles on next action)"
                  value={formatEth(v.pendingRewards)}
                  source="StakingVault.pendingRewards(wallet)"
                  strong
                />
                <Row
                  label="Ready to withdraw"
                  value={formatEth(v.claimable)}
                  source="StakingVault.claimable(wallet)"
                />
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
              </>
            )}
          </Panel>

          {/* ------------------------------- card yield stream */}
          <Panel className="p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Card yield</h2>
              <span className="rounded-full bg-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                from sells
              </span>
            </div>
            <p className="mb-5 text-sm text-muted">
              Per card, weighted by tier: Common 1× · Uncommon 2× · Rare 5× · Epic 12× ·
              Legendary 30×.
            </p>
            {snap.myCards.length === 0 ? (
              <EmptyState
                title="No cards yet"
                body="Buy FORGE to mint cards; every card earns from sells."
                action={
                  <Link href="/trade">
                    <Button variant="ghost">Go to Trade</Button>
                  </Link>
                }
              />
            ) : (
              <>
                <div className="divide-y divide-line">
                  {snap.myCards.map((c) => (
                    <div key={c.tokenId.toString()} className="flex items-center gap-3 py-2.5">
                      <Link
                        href={`/cards/${c.tokenId}`}
                        className="w-14 shrink-0 text-sm font-semibold tabular-nums text-ink hover:underline"
                      >
                        #{c.tokenId.toString()}
                      </Link>
                      <TierBadge tier={c.tier} size="sm" />
                      <span className="text-xs text-faint">{c.weight.toString()}×</span>
                      <span
                        className="ml-auto text-sm tabular-nums text-ink/90"
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
                  ))}
                </div>
                <div className="mt-4 border-t border-line pt-4">
                  <Row
                    label="Total unclaimed on your cards"
                    value={formatEth(totalAccrued)}
                    source="Σ CardYield.accruedOf(tokenId)"
                    strong
                  />
                  <Row
                    label="Ready to withdraw"
                    value={formatEth(snap.cardYield.claimable)}
                    source="CardYield.claimable(wallet)"
                  />
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
                </div>
              </>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
