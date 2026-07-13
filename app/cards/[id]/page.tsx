"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import Countdown from "@/components/Countdown";
import ForgeFlow from "@/components/ForgeFlow";
import InteractiveCard from "@/components/InteractiveCard";
import CardForgeOverlay from "@/components/CardForgeOverlay";
import RaidPanel, { type RaidInfo } from "@/components/RaidPanel";
import { UpgradeRevealModal } from "@/components/CardRevealModal";
import Modal from "@/components/Modal";
import TierBadge from "@/components/TierBadge";
import {
  Button,
  EmptyState,
  ErrorState,
  PageTitle,
  Panel,
  Row,
  SkeletonPanel,
} from "@/components/ui";
import { useApp, useNowSeconds, useSnapshot } from "@/lib/live";
import { formatEth, formatMintDate, formatOcards, shortAddress } from "@/lib/format";
import { TIERS, tierInfo } from "@/lib/tiers";
import { cardsOnChainAbi, cardYieldAbi, stakingVaultAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";
import { materialOf } from "@/lib/chain/material";
import { fetchCardHistory } from "@/lib/chain/logs";
import { cancelForgeAction, claimForgeAction, claimYieldAction } from "@/lib/actions";
import { useTx } from "@/lib/tx";

export default function CardDetailPage() {
  const params = useParams<{ id: string }>();
  const { dataMode, connected, wallet } = useApp();
  const snap = useSnapshot();
  const publicClient = usePublicClient();
  const tx = useTx();
  const [forgeOpen, setForgeOpen] = useState(false);
  const [upgradeReveal, setUpgradeReveal] = useState<{ tokenId: bigint; tier: number } | null>(null);

  const id = /^\d+$/.test(params.id) ? BigInt(params.id) : null;
  const cards = addressOf("cardsOnChain");
  const vault = addressOf("stakingVault");
  const cardYield = addressOf("cardYield");

  // Per-card views — allowFailure: ownerOf reverts for nonexistent ids.
  const cardQ = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: cards, abi: cardsOnChainAbi, functionName: "ownerOf", args: [id ?? 0n] },
      { address: cards, abi: cardsOnChainAbi, functionName: "tierOf", args: [id ?? 0n] },
      // ART seed, not the mint seed — a card that won or lost a raid renders from the
      // other card's seed, so the material must be derived from this.
      { address: cards, abi: cardsOnChainAbi, functionName: "artSeedOf", args: [id ?? 0n] },
      { address: cards, abi: cardsOnChainAbi, functionName: "mintedAt", args: [id ?? 0n] },
      { address: cardYield, abi: cardYieldAbi, functionName: "accruedOf", args: [id ?? 0n] },
      { address: cardYield, abi: cardYieldAbi, functionName: "weightOf", args: [id ?? 0n] },
      { address: vault, abi: stakingVaultAbi, functionName: "activeForge", args: [id ?? 0n] },
      { address: vault, abi: stakingVaultAbi, functionName: "protectionOf", args: [id ?? 0n] },
      { address: vault, abi: stakingVaultAbi, functionName: "activeRaidOf", args: [id ?? 0n] },
      { address: vault, abi: stakingVaultAbi, functionName: "protectorOf", args: [id ?? 0n] },
      { address: cards, abi: cardsOnChainAbi, functionName: "raidGraceFrom", args: [id ?? 0n] },
      { address: cards, abi: cardsOnChainAbi, functionName: "raidStatus", args: [id ?? 0n] },
    ],
    query: { enabled: id !== null, refetchInterval: 12_000 },
  });

  const r = cardQ.data;
  const exists = !!r && r[0].status === "success";
  const card = exists
    ? {
        tokenId: id!,
        owner: r![0].result as `0x${string}`,
        tier: Number(r![1].result as number),
        seed: r![2].result as `0x${string}`,
        mintedAt: BigInt(r![3].result as bigint),
        accrued: (r![4].result as bigint) ?? 0n,
        weight: (r![5].result as bigint) ?? 0n,
        activeForgeId: (r![6].result as bigint) ?? 0n,
        protection: (r![7].result as bigint) ?? 0n,
        activeRaidId: (r![8].result as bigint) ?? 0n,
        protector: (r![9].result as `0x${string}`) ?? ("0x0000000000000000000000000000000000000000" as `0x${string}`),
        raidGraceFrom: BigInt((r![10].result as bigint) ?? 0n),
        raidStatus: Number((r![11].result as number) ?? 0),
        material: materialOf(r![2].result as `0x${string}`, Number(r![1].result as number)),
      }
    : null;

  // The live raid on this card (as attacker or victim), when there is one.
  const raidId = card?.activeRaidId ?? 0n;
  const raidQ = useReadContract({
    address: vault,
    abi: stakingVaultAbi,
    functionName: "getRaid",
    args: [raidId],
    query: { enabled: raidId !== 0n, refetchInterval: 12_000 },
  });
  const raidRaw = raidQ.data as
    | {
        attacker: `0x${string}`;
        attackerTokenId: bigint;
        victimTokenId: bigint;
        targetTier: number;
        attackerOldTier: number;
        amount: bigint;
        resolvesAt: bigint;
        defenseStake: bigint;
        victimProtection: bigint;
        isResolvable: boolean;
        isVoid: boolean;
      }
    | undefined;
  const raid: RaidInfo | null =
    raidId !== 0n && raidRaw
      ? {
          raidId,
          attacker: raidRaw.attacker,
          attackerTokenId: raidRaw.attackerTokenId,
          victimTokenId: raidRaw.victimTokenId,
          targetTier: Number(raidRaw.targetTier),
          attackerOldTier: Number(raidRaw.attackerOldTier),
          amount: raidRaw.amount,
          resolvesAt: BigInt(raidRaw.resolvesAt),
          defenseStake: raidRaw.defenseStake,
          victimProtection: raidRaw.victimProtection,
          isResolvable: raidRaw.isResolvable,
          isVoid: raidRaw.isVoid,
        }
      : null;

  const historyQ = useQuery({
    queryKey: ["cardHistory", id?.toString()],
    queryFn: () =>
      fetchCardHistory(
        publicClient!,
        id!,
        TIERS.map((t) => t.name),
        TIERS.map((t) => t.stake),
        TIERS.map((t) => t.durationLabel),
      ),
    enabled: exists && !!publicClient,
    refetchInterval: 60_000,
  });

  const isOwner = connected && !!card && card.owner.toLowerCase() === wallet.toLowerCase();
  const forge =
    card && card.activeForgeId !== 0n
      ? snap.stakingVault.forges[card.activeForgeId.toString()] ?? null
      : null;
  // Live 1s clock so the forge status flips the instant a deadline passes.
  const nowS = useNowSeconds();
  const forgeMatured = !!forge && (forge.isMature || nowS >= Number(forge.maturesAt));
  // Past the 3-hour window: OTHERS may now sweep, but the staker can STILL
  // upgrade until it's actually swept (then the forge vanishes from the snapshot).
  const forgeSweepable = !!forge && (forge.isSweepable || nowS >= Number(forge.claimDeadline));
  const t = card ? tierInfo(card.tier) : null;
  const history = historyQ.data ?? [];
  const loading = dataMode === "loading" || (id !== null && cardQ.isPending);

  return (
    <div>
      <div className="mb-6 text-sm">
        <Link href="/cards" className="text-muted hover:text-ink">
          ← My cards
        </Link>
      </div>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <SkeletonPanel lines={8} className="min-h-[420px]" />
          <SkeletonPanel lines={8} />
        </div>
      ) : dataMode === "error" || (id !== null && cardQ.isError) ? (
        <ErrorState />
      ) : !card || !t ? (
        <EmptyState
          title="Card not found"
          body={`No card with this id exists yet — ${snap.cardsOnChain.totalSupply.toLocaleString()} of 2,222 have been minted so far.`}
          action={
            <Link href="/trade">
              <Button variant="ghost">Mint one by buying FORGE</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_1fr]">
          {/* -------------------------------- interactive card */}
          <div className="space-y-3">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl shadow-card">
              <InteractiveCard
                tokenId={card.tokenId}
                title={`Card #${card.tokenId} — interactive view`}
                // Reload the art the instant tier/owner changes (e.g. after an
                // upgrade) instead of waiting for a manual page refresh.
                refreshKey={`${card.tier}-${card.owner}`}
              />
              {/* forge status tag + progress indicator, same as My Cards */}
              {forge && (
                <CardForgeOverlay
                  forge={forge}
                  durationSec={snap.cardsOnChain.tierDurations[forge.targetTier]}
                />
              )}
            </div>
            <p className="text-center text-xs text-faint">
              Live on-chain render — click to flip, drag to spin. The back matches the face&apos;s
              material. (Sandboxed tokenURI <code>animation_url</code>.)
            </p>
          </div>

          {/* -------------------------------- facts & actions */}
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <h1 className="text-3xl font-semibold tabular-nums text-ink">
                  Card #{card.tokenId.toString()}
                  <span className="text-lg text-faint"> / 2222</span>
                </h1>
                <TierBadge tier={card.tier} />
              </div>
              <p className="font-script text-2xl text-muted">{card.material}</p>
            </div>

            <Panel className="px-5 py-3">
              <Row label="Tier" value={t.name} source="CardsOnChain.tierOf(tokenId)" />
              <Row
                label="Material"
                value={card.material}
                source="CardMaterials.materialOf(artSeedOf(tokenId), tierOf(tokenId))"
              />
              <Row
                label="Yield weight"
                value={`${card.weight.toString()}× per sell`}
                source="CardYield.weightOf(tokenId)"
              />
              <Row
                label="Owner"
                value={
                  <span className="tabular-nums">
                    {shortAddress(card.owner)}
                    {isOwner && <span className="ml-1.5 text-tier1">(you)</span>}
                  </span>
                }
                source="CardsOnChain.ownerOf(tokenId)"
              />
              <Row
                label="Minted"
                value={formatMintDate(card.mintedAt)}
                source="CardsOnChain.mintedAt(tokenId)"
              />
            </Panel>

            {/* yield */}
            <Panel className="p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
                    Unclaimed yield
                  </p>
                  <p
                    className="mt-1 text-2xl font-semibold tabular-nums text-ink"
                    data-source="CardYield.accruedOf(tokenId)"
                  >
                    {formatEth(card.accrued, 6)}
                  </p>
                </div>
                <Button
                  disabled={!isOwner || card.accrued === 0n}
                  onClick={() => {
                    const a = claimYieldAction(card.tokenId, card.accrued);
                    tx.run(a.intent, a.steps);
                  }}
                >
                  Claim yield
                </Button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-faint">
                Yield travels with the card: buy this card and its unclaimed earnings come with
                it. Only the current owner can claim.
                {!isOwner && " You don't own this card, so claiming is disabled."}
              </p>
            </Panel>

            {/* forge status */}
            <Panel className="p-5">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
                Forge status
              </h2>
              {forge ? (
                <div className="space-y-3" data-source="StakingVault.getForge(activeForge(tokenId))">
                  <div className="flex items-center gap-2 text-sm text-ink">
                    <TierBadge tier={card.tier} size="sm" />
                    <span className="text-faint">→</span>
                    <TierBadge tier={forge.targetTier} size="sm" />
                    <span className="ml-auto text-xs tabular-nums text-faint">
                      {formatOcards(forge.amount, 0)} locked
                    </span>
                  </div>
                  {!forgeMatured ? (
                    <p className="text-sm text-muted">
                      Matures in <Countdown to={forge.maturesAt} />
                    </p>
                  ) : forgeSweepable ? (
                    <p className="text-sm font-semibold text-danger">
                      ⏳ Forging complete — upgrade now! The 3-hour window lapsed, so anyone can now
                      sweep this forge. You can still upgrade until they do.
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-warn">
                      ⏳ Ready to upgrade — claim within{" "}
                      <Countdown to={forge.claimDeadline} tone="warn" /> before anyone can sweep it
                    </p>
                  )}
                  {isOwner && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        disabled={!forgeMatured}
                        onClick={() => {
                          const a = claimForgeAction(card.activeForgeId, forge);
                          const upgradedTo = forge.targetTier;
                          tx.run(
                            a.intent,
                            a.steps,
                            // On confirm, auto-close the dialog and reveal the
                            // upgraded card (new tier art) with the animation.
                            () => setUpgradeReveal({ tokenId: card.tokenId, tier: upgradedTo }),
                            { toast: false },
                          );
                        }}
                      >
                        Upgrade Card
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const a = cancelForgeAction(card.activeForgeId, forge);
                          tx.run(a.intent, a.steps);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button variant="ghost" onClick={() => setForgeOpen(true)}>
                        Manage forge
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Not being forged.{" "}
                  {isOwner && card.tier < 4 && (
                    <button
                      onClick={() => setForgeOpen(true)}
                      className="text-accent underline hover:text-ink"
                    >
                      Forge this card →
                    </button>
                  )}
                  {card.tier === 4 && "This card is Legendary — the top of the chain."}
                </p>
              )}
            </Panel>

            {/* Forge modal — the shared flow, pre-selected to THIS card. Shows
                the tier picker (or the live ForgeProgress if already forging).
                Closes on a successful forge/claim/cancel via onDone. */}
            {isOwner && (
              <Modal
                open={forgeOpen}
                onClose={() => setForgeOpen(false)}
                title={`Forge card #${card.tokenId.toString()}`}
              >
                <ForgeFlow card={card} onDone={() => setForgeOpen(false)} headingPrefix="" />
              </Modal>
            )}

            {/* protection & raids (non-Common cards only) */}
            {card.tier >= 1 && (
              <RaidPanel
                card={{
                  tokenId: card.tokenId,
                  tier: card.tier,
                  owner: card.owner,
                  material: card.material,
                  protection: card.protection,
                  protector: card.protector,
                  activeForgeId: card.activeForgeId,
                  activeRaidId: card.activeRaidId,
                  raidGraceFrom: card.raidGraceFrom,
                  raidStatus: card.raidStatus,
                }}
                isOwner={isOwner}
                wallet={wallet}
                freeStake={snap.stakingVault.freeStakeOf}
                raid={raid}
                nowS={nowS}
                raidGrace={snap.stakingVault.raidGrace}
              />
            )}

            {/* history */}
            <Panel className="p-5">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
                History
              </h2>
              <ol
                className="space-y-2.5"
                data-source="TierChanged / Minted events for tokenId (log scan)"
              >
                {history.map((h, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />
                    <div>
                      <p className="text-ink">{h.label}</p>
                      <p className="text-xs text-faint">{h.detail}</p>
                    </div>
                  </li>
                ))}
                {historyQ.isPending && (
                  <li className="text-xs text-faint">Loading history…</li>
                )}
              </ol>
            </Panel>
          </div>
        </div>
      )}

      {/* reveal the freshly-upgraded card after the tx confirms on-chain */}
      {upgradeReveal && (
        <UpgradeRevealModal
          open
          tokenId={upgradeReveal.tokenId}
          tier={upgradeReveal.tier}
          owner={wallet}
          onClose={() => setUpgradeReveal(null)}
        />
      )}
    </div>
  );
}
