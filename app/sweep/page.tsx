"use client";

import React from "react";
import Countdown from "@/components/Countdown";
import TierBadge from "@/components/TierBadge";
import {
  Button,
  EmptyState,
  ErrorState,
  PageTitle,
  Panel,
  SkeletonPanel,
} from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";
import { formatDuration, formatOcards, shortAddress } from "@/lib/format";
import { sweepForgeAction } from "@/lib/actions";
import { useTx } from "@/lib/tx";

export default function SweepPage() {
  const { dataMode, connected, connect, hasInjected } = useApp();
  const snap = useSnapshot();
  const tx = useTx();

  const rows = snap.sweepableIds
    .map((id) => ({ id, t: snap.stakingVault.forges[id.toString()] }))
    .filter((r) => r.t?.isSweepable);

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle
        kicker="Sweep board"
        title="Keep the protocol tidy"
        lede="When a matured forge isn't claimed within its 3-hour window, anyone can sweep it. Sweeping reopens the forge slot for everyone and unlocks the staker's tokens back to them — the sweeper earns nothing but a cleaner protocol. A community-keeper role."
      />

      {dataMode === "loading" ? (
        <SkeletonPanel lines={6} />
      ) : dataMode === "error" ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing to sweep"
          body="No forge has outlived its claim window right now. Check back — lapsed forges show up here for anyone to clear."
        />
      ) : (
        <div className="space-y-4">
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.15em] text-faint">
                  <th className="px-5 py-3">Card</th>
                  <th className="px-5 py-3">Target tier</th>
                  <th className="px-5 py-3">Staker</th>
                  <th className="px-5 py-3">Locked</th>
                  <th className="px-5 py-3">Window lapsed</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody data-source="StakingVault.getForge(id) where isSweepable == true">
                {rows.map(({ id, t }) => (
                  <tr key={id.toString()} className="border-b border-line/60 last:border-0">
                    <td className="px-5 py-3.5 font-semibold tabular-nums text-ink">
                      #{t.tokenId.toString()}
                    </td>
                    <td className="px-5 py-3.5">
                      <TierBadge tier={t.targetTier} size="sm" />
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-muted">
                      {shortAddress(t.staker)}
                    </td>
                    <td
                      className="px-5 py-3.5 tabular-nums text-muted"
                      title="StakingVault.getForge(id).amount"
                    >
                      {formatOcards(t.amount, 0)}
                    </td>
                    <td className="px-5 py-3.5 text-danger" suppressHydrationWarning>
                      {formatDuration(Number(snap.now - t.claimDeadline))} ago
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {connected ? (
                        <Button
                          variant="ghost"
                          className="!px-3 !py-1.5 text-xs"
                          onClick={() => {
                            const a = sweepForgeAction(id, t);
                            tx.run(a.intent, a.steps);
                          }}
                        >
                          Sweep
                        </Button>
                      ) : (
                        <Button
                          variant="quiet"
                          className="!px-3 !py-1.5 text-xs"
                          disabled={!hasInjected}
                          onClick={connect}
                        >
                          Connect to sweep
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel className="p-5" tone="raised">
            <h2 className="mb-2 text-sm font-semibold text-ink">What sweeping does</h2>
            <ul className="space-y-1.5 text-sm leading-relaxed text-muted">
              <li>• Returns the target tier&apos;s forge slot to the open pool — someone else can forge into it.</li>
              <li>• Unlocks the FORGE back into the <em>original staker&apos;s</em> free stake — they stay staked (never to you, never to their wallet).</li>
              <li>• The card itself is untouched; it simply stays at its current tier.</li>
              <li>• You pay only gas. Sweeping is a public service, not a bounty.</li>
            </ul>
            {/* Countdown demo of the next-to-lapse window, if any user tx is mature */}
            {snap.stakingVault.forgesOf.length > 0 && (
              <p className="mt-3 text-xs text-faint">
                Watching your own forges? Claim windows are shown on{" "}
                <a href="/cards" className="underline hover:text-muted">
                  My Cards
                </a>{" "}
                with live countdowns
                {(() => {
                  const mine = snap.stakingVault.forgesOf
                    .map((x) => snap.stakingVault.forges[x.toString()])
                    .find((x) => x?.isMature && !x.isSweepable);
                  return mine ? (
                    <>
                      {" "}
                      — your next deadline:{" "}
                      <Countdown to={mine.claimDeadline} tone="warn" />
                    </>
                  ) : null;
                })()}
                .
              </p>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
