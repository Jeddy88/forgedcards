"use client";

import Link from "next/link";
import React from "react";
import CardMedia from "@/components/CardMedia";
import TierBadge from "@/components/TierBadge";
import { Button, ErrorState, Panel, Skeleton, SkeletonPanel, Stat } from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";
import { formatEth, formatOcards, percentOf } from "@/lib/format";
import { TIERS, UNCAPPED } from "@/lib/tiers";
import { CHAIN_LABEL } from "@/lib/contracts/config";

export default function LandingPage() {
  const { dataMode } = useApp();
  const snap = useSnapshot();

  return (
    <div className="space-y-16">
      {/* ------------------------------------------------ hero */}
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted">
            2,222 cards · <span className="text-brand">{CHAIN_LABEL}</span> · 100% on-chain
          </p>
          <h1 className="font-script text-5xl leading-tight text-brand sm:text-6xl">
            Forged Cards
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            Interactive collectible cards that live entirely on-chain — art, animation and
            all. Buy FORGE from the pool and cards mint to you automatically. Stake FORGE
            tokens to forge your cards into rarer tiers — the cards themselves never leave
            your wallet. Every card earns a share of trading fees.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/trade">
              <Button>Buy FORGE &amp; mint</Button>
            </Link>
            <Link href="/docs">
              <Button variant="ghost">How it works</Button>
            </Link>
          </div>
          {!snap.mintHook.tradingEnabled && (
            <p
              className="inline-block rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn"
              data-source="MintHook.tradingEnabled()"
            >
              Trading hasn&apos;t been enabled yet — the pool opens with a one-shot launch
              transaction.
            </p>
          )}
        </div>

        {/* Card showcase: real on-chain art, background-stripped (card-only) —
            the page's own dark canvas does the work */}
        <div className="relative mx-auto h-[380px] w-full max-w-[460px] sm:h-[430px]">
          <div className="absolute left-0 top-8 w-[44%] -rotate-6 transition-transform hover:-translate-y-2">
            <CardMedia
              material="Jade"
              alt="Rare Jade card"
              className="w-full drop-shadow-[0_25px_30px_rgba(0,0,0,0.65)]"
            />
          </div>
          <div className="absolute right-0 top-10 w-[44%] rotate-6 transition-transform hover:-translate-y-2">
            <CardMedia
              material="Ruby"
              alt="Epic Ruby card"
              className="w-full drop-shadow-[0_25px_30px_rgba(0,0,0,0.65)]"
            />
          </div>
          <div className="absolute left-1/2 top-0 z-10 w-[48%] -translate-x-1/2 transition-transform hover:-translate-y-2">
            <CardMedia
              material="Diamond"
              alt="Legendary Diamond card"
              className="w-full drop-shadow-[0_30px_40px_rgba(0,0,0,0.7)]"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ live stats */}
      <section aria-label="Live collection stats">
        {dataMode === "loading" ? (
          <Panel className="grid grid-cols-2 gap-6 p-6 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-28" />
              </div>
            ))}
          </Panel>
        ) : dataMode === "error" ? (
          <ErrorState />
        ) : (
          <Panel className="p-6">
            <dl className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <Stat
                label="Cards minted"
                value={
                  <>
                    {snap.cardsOnChain.totalSupply.toLocaleString()}
                    <span className="text-faint"> / 2,222</span>
                  </>
                }
                sub={`${snap.cardsOnChain.remainingMintable.toLocaleString()} still mintable`}
                source="CardsOnChain.totalSupply() / maxSupply() / remainingMintable()"
              />
              <Stat
                label="FORGE staked"
                value={formatOcards(snap.stakingVault.totalStaked, 0)}
                sub={`${percentOf(snap.stakingVault.totalStaked, snap.cardsToken.totalSupply)} of the fixed 1,000,000 supply`}
                source="StakingVault.totalStaked() / CardsToken.totalSupply()"
              />
              <Stat
                label="Paid to token stakers"
                value={formatEth(snap.eventTotals.stakerRewardsDeposited)}
                sub="1% of every buy"
                source="Σ StakingVault.RewardsDeposited events"
              />
              <Stat
                label="Paid to card holders"
                value={formatEth(snap.eventTotals.cardYieldDeposited)}
                sub="1% of every sell"
                source="Σ CardYield.RewardsDeposited events"
              />
            </dl>
          </Panel>
        )}
      </section>

      {/* ------------------------------------------------ tier occupancy */}
      <section className="space-y-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-ink">Tiers</h2>
          <Link href="/forge" className="text-sm text-muted hover:text-ink">
            Forge a card →
          </Link>
        </div>
        {dataMode === "loading" ? (
          <SkeletonPanel lines={5} />
        ) : dataMode === "error" ? null : (
          <Panel className="divide-y divide-line">
            {TIERS.map((t) => {
              const count = snap.cardsOnChain.tierCount[t.tier];
              const capped = t.cap !== UNCAPPED;
              const pct = capped ? Number((count * 100n) / t.cap) : 0;
              return (
                <div key={t.tier} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-28 shrink-0">
                    <TierBadge tier={t.tier} />
                  </div>
                  <div className="hidden w-44 shrink-0 text-xs text-faint sm:block">
                    {t.materials.join(" · ")}
                  </div>
                  <div className="min-w-0 flex-1">
                    {capped ? (
                      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: t.color }}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-faint">Every card mints here — uncapped</p>
                    )}
                  </div>
                  <div
                    className="w-28 shrink-0 text-right text-sm tabular-nums text-ink/90"
                    data-source="CardsOnChain.tierCount(tier) / tierCap(tier)"
                    title="CardsOnChain.tierCount(tier) / tierCap(tier)"
                  >
                    {capped ? (
                      <>
                        {count.toLocaleString()}
                        <span className="text-faint"> / {t.cap.toLocaleString()}</span>
                      </>
                    ) : (
                      count.toLocaleString()
                    )}
                  </div>
                </div>
              );
            })}
          </Panel>
        )}
        <p className="text-xs leading-relaxed text-faint">
          Tier occupancy counts cards at the tier <em>plus cards being forged into it</em> —
          a forge slot is claimed the moment forging starts.
        </p>
      </section>

      {/* ------------------------------------------------ how it works */}
      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Buy → mint",
            body: "Buying FORGE from the pool mints 1 card per whole 1,000 FORGE bought — and you keep the tokens. The only mint path; 2,222 cards, ever.",
            href: "/trade",
            cta: "Trade",
          },
          {
            title: "Stake → forge",
            body: "Stake FORGE tokens and lock a tier's amount to forge a card into a rarer tier — Uncommon to Legendary, first come, first served. Tokens are locked, never spent, and keep earning while locked.",
            href: "/forge",
            cta: "Forge",
          },
          {
            title: "Hold → earn",
            body: "1% of every buy pays token stakers. 1% of every sell pays card holders, weighted by tier (1×–30×). Yield sticks to the card until its owner claims.",
            href: "/rewards",
            cta: "Rewards",
          },
        ].map((c) => (
          <Panel key={c.title} className="flex flex-col gap-3 p-6">
            <h3 className="font-script text-2xl text-ink">{c.title}</h3>
            <p className="flex-1 text-sm leading-relaxed text-muted">{c.body}</p>
            <Link href={c.href} className="text-sm font-semibold text-accent hover:text-ink">
              {c.cta} →
            </Link>
          </Panel>
        ))}
      </section>
    </div>
  );
}
