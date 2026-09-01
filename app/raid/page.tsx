"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useReadContracts } from "wagmi";
import Countdown from "@/components/Countdown";
import RaidPicker, { type RaidTarget } from "@/components/RaidPicker";
import TierBadge from "@/components/TierBadge";
import {
  Button,
  EmptyState,
  ErrorState,
  PageTitle,
  Panel,
  SkeletonPanel,
  Stat,
} from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";
import { formatOcards, shortAddress } from "@/lib/format";
import { tierInfo } from "@/lib/tiers";
import { cardsOnChainAbi, stakingVaultAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";
import { materialOf } from "@/lib/chain/material";
import { fetchNonCommonTokenIds } from "@/lib/chain/views";
import { protectionRequired } from "@/lib/actions";

/** One non-Common card, assembled from the live views (never from logs alone). */
interface BoardCard {
  tokenId: bigint;
  tier: number;
  owner: `0x${string}`;
  material: string;
  protection: bigint;
  /** StakingVault.raidStatusOf: 1 Grace · 2 Protected · 3 Vulnerable · 4 Under attack · 5 Raiding */
  raidStatus: number;
}

const STRIDE = 5;

export default function RaidBoardPage() {
  const { dataMode, connected, wallet } = useApp();
  const publicClient = usePublicClient();
  const snap = useSnapshot();
  const totalEverMinted = snap.cardsOnChain.totalEverMinted;
  const [target, setTarget] = useState<RaidTarget | null>(null);

  const cards = addressOf("cardsOnChain");
  const vault = addressOf("stakingVault");

  // Only non-Common cards can be raided. Read from `tierOf` across the
  // collection (lib/chain/views.ts) rather than a full-history log scan — the
  // sweep is Multicall3-aggregated and bounded by the 2,222-card cap, and it
  // returns EXACT current tiers instead of an "ever non-Common" superset.
  const idsQ = useQuery({
    queryKey: ["nonCommonTokenIds", totalEverMinted.toString()],
    queryFn: () => fetchNonCommonTokenIds(publicClient!, totalEverMinted),
    enabled: !!publicClient && totalEverMinted > 0n,
    refetchInterval: 30_000,
  });
  const ids = useMemo(() => idsQ.data ?? [], [idsQ.data]);

  const detailQ = useReadContracts({
    allowFailure: false,
    contracts: ids.flatMap((id) => [
      { address: cards, abi: cardsOnChainAbi, functionName: "tierOf" as const, args: [id] as const },
      { address: cards, abi: cardsOnChainAbi, functionName: "ownerOf" as const, args: [id] as const },
      { address: cards, abi: cardsOnChainAbi, functionName: "artSeedOf" as const, args: [id] as const },
      { address: vault, abi: stakingVaultAbi, functionName: "raidStatusOf" as const, args: [id] as const },
      { address: vault, abi: stakingVaultAbi, functionName: "protectionOf" as const, args: [id] as const },
    ]),
    query: { enabled: ids.length > 0, refetchInterval: 12_000 },
  });

  const board: BoardCard[] = useMemo(() => {
    if (!detailQ.data) return [];
    const d = detailQ.data as unknown[];
    return ids
      .map((id, i) => {
        const tier = Number(d[i * STRIDE + 0] as number);
        const artSeed = d[i * STRIDE + 2] as `0x${string}`;
        return {
          tokenId: id,
          tier,
          owner: d[i * STRIDE + 1] as `0x${string}`,
          material: materialOf(artSeed, tier),
          raidStatus: Number(d[i * STRIDE + 3] as number),
          protection: d[i * STRIDE + 4] as bigint,
        };
      })
      // A card can be knocked back to Common by losing a raid — drop those.
      .filter((c) => c.tier >= 1);
  }, [detailQ.data, ids]);

  const isMine = (c: BoardCard) => connected && c.owner.toLowerCase() === wallet.toLowerCase();
  const openTargets = board.filter((c) => c.raidStatus === 3 && !isMine(c));
  // Your cards, split by what you'd actually do about them: top up protection (vulnerable /
  // in grace) vs defend right now (a live raid is already targeting them).
  const myVulnerable = board.filter((c) => isMine(c) && (c.raidStatus === 3 || c.raidStatus === 1));
  const myUnderAttack = board.filter((c) => isMine(c) && c.raidStatus === 4);
  const liveRaids = board.filter((c) => c.raidStatus === 4);
  const protectedCount = board.filter((c) => c.raidStatus === 2).length;

  const loading = dataMode === "loading" || idsQ.isPending || (ids.length > 0 && detailQ.isPending);
  const errored = dataMode === "error" || idsQ.isError || detailQ.isError;

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle
        kicker="Raid board"
        title="Take a rarer card's tier"
        lede="Every non-Common card must keep 25% of its forge cost staked as protection. Cards below that line are open to raids: point one of your lower-tier cards at one, lock the full stake of the tier you're contesting, and if the owner doesn't defend in time the two cards swap tiers — and appearances. You inherit the exact card you fought for."
      />

      {loading ? (
        <div className="space-y-4">
          <SkeletonPanel lines={3} />
          <SkeletonPanel lines={6} />
        </div>
      ) : errored ? (
        <ErrorState />
      ) : (
        <div className="space-y-8">
          {/* ------------------------------------------------ at a glance */}
          <Panel className="p-6">
            <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Stat label="Non-Common cards" value={board.length.toString()} source="TierChanged log scan + tierOf" />
              <Stat
                label="Open to raids"
                value={openTargets.length.toString()}
                sub="below the 25% safe line"
                source="StakingVault.raidStatusOf == 3"
              />
              <Stat label="Protected" value={protectedCount.toString()} source="raidStatusOf == 2" />
              <Stat label="Under attack" value={liveRaids.length.toString()} source="raidStatusOf == 4" />
            </dl>
          </Panel>

          {/* --------------------------- your cards: under attack (act NOW) + vulnerable */}
          {connected && (myUnderAttack.length > 0 || myVulnerable.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {/* Under attack first — it's the one with a running clock. */}
              {myUnderAttack.length > 0 && (
                <Panel className="border-danger/30 bg-danger/5 p-5">
                  <h2 className="mb-2 text-sm font-semibold text-danger">
                    ⚔️ {myUnderAttack.length} of your cards {myUnderAttack.length === 1 ? "is" : "are"} under
                    attack
                  </h2>
                  <p className="mb-3 text-xs leading-relaxed text-muted">
                    A raid is live against {myUnderAttack.length === 1 ? "this card" : "these cards"}. Defend
                    before the window closes or {myUnderAttack.length === 1 ? "it loses its" : "they lose their"}{" "}
                    tier — and material — to the raider.
                  </p>
                  <div className="space-y-2">
                    {myUnderAttack.map((c) => (
                      <Link
                        key={c.tokenId.toString()}
                        href={`/cards/${c.tokenId}`}
                        className="flex items-center justify-between gap-2 rounded-xl border border-danger/30 bg-bg px-3 py-2 text-sm hover:border-danger"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums text-ink">#{c.tokenId.toString()}</span>
                          <TierBadge tier={c.tier} size="sm" />
                          <span className="text-muted">{c.material}</span>
                        </span>
                        <span className="text-xs font-semibold text-danger">Defend →</span>
                      </Link>
                    ))}
                  </div>
                </Panel>
              )}

              {myVulnerable.length > 0 && (
                <Panel className="border-warn/30 bg-warn/5 p-5">
                  <h2 className="mb-2 text-sm font-semibold text-warn">
                    ⚠️ {myVulnerable.length} of your cards {myVulnerable.length === 1 ? "is" : "are"} vulnerable
                  </h2>
                  <p className="mb-3 text-xs leading-relaxed text-muted">
                    These sit below their 25% safe line, so anyone with a lower-tier card can raid them. Top up
                    their protection before someone does.
                  </p>
                  <div className="space-y-2">
                    {myVulnerable.map((c) => (
                      <Link
                        key={c.tokenId.toString()}
                        href={`/cards/${c.tokenId}`}
                        className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm hover:border-accent"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums text-ink">#{c.tokenId.toString()}</span>
                          <TierBadge tier={c.tier} size="sm" />
                          <span className="text-muted">{c.material}</span>
                        </span>
                        {c.raidStatus === 1 ? (
                          <span className="text-xs font-semibold text-tier1">🕐 in grace</span>
                        ) : (
                          <span className="text-xs font-semibold text-warn">Protect →</span>
                        )}
                      </Link>
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          )}

          {/* ------------------------------------------------ open targets */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
              Open targets ({openTargets.length})
            </h2>
            {openTargets.length === 0 ? (
              <EmptyState
                title="No cards are open to raids"
                body="Every non-Common card is currently protected, inside its grace window, or already committed to a raid. Check back — protection can be withdrawn at any time."
              />
            ) : (
              <Panel className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.15em] text-faint">
                      <th className="px-5 py-3">Card</th>
                      <th className="px-5 py-3">Tier</th>
                      <th className="px-5 py-3">Material</th>
                      <th className="px-5 py-3">Owner</th>
                      <th className="px-5 py-3">Protection</th>
                      <th className="px-5 py-3">Cost to raid</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody data-source="StakingVault.raidStatusOf(tokenId) == 3 (Vulnerable)">
                    {openTargets.map((c) => {
                      const t = tierInfo(c.tier);
                      const required = protectionRequired(c.tier);
                      return (
                        <tr key={c.tokenId.toString()} className="border-b border-line/60 last:border-0">
                          <td className="px-5 py-3.5">
                            <Link
                              href={`/cards/${c.tokenId}`}
                              className="font-semibold tabular-nums text-ink hover:underline"
                            >
                              #{c.tokenId.toString()}
                            </Link>
                          </td>
                          <td className="px-5 py-3.5">
                            <TierBadge tier={c.tier} size="sm" />
                          </td>
                          <td className="px-5 py-3.5 text-muted">{c.material}</td>
                          <td className="px-5 py-3.5 tabular-nums text-muted">{shortAddress(c.owner)}</td>
                          <td className="px-5 py-3.5 tabular-nums text-danger" title="below the 25% safe line">
                            {formatOcards(c.protection, 0)} / {formatOcards(required, 0)}
                          </td>
                          <td className="px-5 py-3.5 tabular-nums text-ink">
                            {formatOcards(t.stake, 0)}
                            <span className="ml-1 text-xs text-faint">· {t.durationLabel}</span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <Button
                              variant="ghost"
                              className="!px-3 !py-1.5 text-xs"
                              disabled={!connected}
                              onClick={() =>
                                setTarget({ tokenId: c.tokenId, tier: c.tier, material: c.material })
                              }
                            >
                              {connected ? "⚔️ Raid" : "Connect to raid"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Panel>
            )}
          </section>

          {/* ------------------------------------------------ live raids */}
          {liveRaids.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
                Raids in progress ({liveRaids.length})
              </h2>
              <Panel className="divide-y divide-line/60">
                {liveRaids.map((c) => (
                  <div key={c.tokenId.toString()} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="flex items-center gap-3 text-sm">
                      <Link href={`/cards/${c.tokenId}`} className="font-semibold tabular-nums text-ink hover:underline">
                        #{c.tokenId.toString()}
                      </Link>
                      <TierBadge tier={c.tier} size="sm" />
                      <span className="text-muted">{c.material}</span>
                      <span className="text-xs text-faint">{shortAddress(c.owner)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-danger">⚔️ under attack</span>
                      <Link href={`/cards/${c.tokenId}`}>
                        <Button variant="ghost" className="!px-3 !py-1.5 text-xs">
                          {isMine(c) ? "Defend" : "View"}
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </Panel>
            </section>
          )}

          {/* ------------------------------------------------ how it works */}
          <Panel className="p-5" tone="raised">
            <h2 className="mb-2 text-sm font-semibold text-ink">How raiding works</h2>
            <ul className="space-y-1.5 text-sm leading-relaxed text-muted">
              <li>• Only cards below their <strong>25% safe line</strong> can be raided. Protection keeps earning — it&apos;s locked, never spent.</li>
              <li>• Attack with any card at a <em>lower</em> tier. You lock the full forge stake of the tier you&apos;re contesting.</li>
              <li>• The owner gets that tier&apos;s forge duration to defend by staking <strong>50%</strong> (or just 25% if they bought the card mid-raid).</li>
              <li>• Undefended, the cards <strong>swap tiers and appearances</strong> — you inherit the exact material you fought for; you keep 25% as the won card&apos;s protection.</li>
              <li>• Freshly bought or freshly upgraded cards are un-raidable during a short <strong>grace window</strong>.</li>
              <li>• If you sell your attacking card mid-raid the raid dies and your stake is refunded — see it through.</li>
            </ul>
          </Panel>
        </div>
      )}

      {target && <RaidPicker open onClose={() => setTarget(null)} target={target} />}
    </div>
  );
}
