"use client";

import React from "react";
import { useReadContract } from "wagmi";
import type { Abi } from "viem";
import Modal from "@/components/Modal";
import TierBadge from "@/components/TierBadge";
import { Button } from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";
import { formatOcards } from "@/lib/format";
import { tierInfo } from "@/lib/tiers";
import { cardsTokenAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";
import { raidAction } from "@/lib/actions";
import { useTx } from "@/lib/tx";

export interface RaidTarget {
  tokenId: bigint;
  tier: number;
  material: string;
}

/**
 * Shared "pick which of my cards attacks this one" dialog. Used by both the Raid board
 * (discovery) and the card detail page's Protection & raids panel, so the eligibility
 * rules and the confirmation copy can never drift apart.
 *
 * Eligible attackers are the caller's cards at a STRICTLY lower tier that are idle (no
 * live forge, no live raid) — exactly what `StakingVault.raid` enforces on-chain.
 *
 * Stake verdict (mirrors ForgeFlow's three cases):
 *  - enough free stake            → plain `raid`
 *  - short, but wallet covers it  → `stakeAndRaid` cold-stakes the shortfall in one tx
 *  - not enough FORGE anywhere   → blocked, with the exact amount still needed
 */
export default function RaidPicker({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: RaidTarget;
}) {
  const tx = useTx();
  const { connected, wallet } = useApp();
  const snap = useSnapshot();

  const t = tierInfo(target.tier);
  const fullStake = t.stake;
  const freeStake = snap.stakingVault.freeStakeOf;
  const walletBalance = snap.cardsToken.balanceOf;

  const shortfall = fullStake > freeStake ? fullStake - freeStake : 0n;
  const viaStakeAndRaid = shortfall > 0n;
  const canCoverFromWallet = walletBalance >= shortfall;
  const stillNeeded = shortfall > walletBalance ? shortfall - walletBalance : 0n;

  // Vault allowance decides whether an approve step is prepended (exact-amount approvals).
  const allowanceQ = useReadContract({
    address: addressOf("cardsToken"),
    abi: cardsTokenAbi as unknown as Abi,
    functionName: "allowance",
    args: [wallet, addressOf("stakingVault")],
    query: { enabled: connected && viaStakeAndRaid, refetchInterval: 12_000 },
  });
  const allowance = (allowanceQ.data as bigint | undefined) ?? 0n;

  const eligible = snap.myCards.filter(
    (c) => c.tier < target.tier && c.activeForgeId === 0n && c.activeRaidId === 0n && c.tokenId !== target.tokenId,
  );
  const blocked = viaStakeAndRaid && !canCoverFromWallet;

  return (
    <Modal open={open} onClose={onClose} title={`Raid card #${target.tokenId.toString()}`}>
      <p className="mb-4 text-sm text-muted">
        Pick which of your lower-tier cards challenges this {target.material} {t.name}. You&apos;ll lock{" "}
        {formatOcards(fullStake, 0)} FORGE; if the owner doesn&apos;t defend within {t.durationLabel}, the two
        cards swap tiers <em>and appearances</em> — your card becomes this exact {target.material} {t.name}.
      </p>

      {/* ------------------------------------------------ stake verdict */}
      {eligible.length > 0 && (
        <div className="mb-4 rounded-xl border border-line bg-raised/60 px-3 py-2 text-xs leading-relaxed">
          {!viaStakeAndRaid ? (
            <span className="text-muted">
              You have {formatOcards(freeStake, 0)} free staked FORGE — enough to lock the{" "}
              {formatOcards(fullStake, 0)} this raid needs.
            </span>
          ) : canCoverFromWallet ? (
            <span className="text-muted">
              You&apos;re {formatOcards(shortfall, 2)} short on staked FORGE. This raid will{" "}
              <strong className="text-ink">stake it from your wallet in the same transaction</strong> —
              locked by the raid, never spent, and earning the whole time.
            </span>
          ) : (
            <span className="text-danger">
              Not enough FORGE. This raid locks {formatOcards(fullStake, 0)}; you have{" "}
              {formatOcards(freeStake, 0)} staked + {formatOcards(walletBalance, 2)} in your wallet. You need{" "}
              {formatOcards(stillNeeded, 2)} more.
            </span>
          )}
        </div>
      )}

      {eligible.length === 0 ? (
        <p className="rounded-xl border border-line bg-raised/60 px-3 py-2 text-xs text-faint">
          You need one of your own cards at a tier below {t.name} (and not busy forging or raiding) to attack
          with.
        </p>
      ) : (
        <div className="space-y-2">
          {eligible.map((c) => (
            <button
              key={c.tokenId.toString()}
              disabled={blocked}
              onClick={() => {
                onClose();
                const a = raidAction(
                  c.tokenId,
                  target.tokenId,
                  target.tier,
                  fullStake,
                  target.material,
                  shortfall,
                  allowance,
                );
                tx.run(a.intent, a.steps);
              }}
              className="flex w-full items-center justify-between rounded-xl border border-line bg-bg px-4 py-3 text-left enabled:hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="font-semibold tabular-nums text-ink">#{c.tokenId.toString()}</span>
              <span className="flex items-center gap-2 text-sm text-muted">
                {c.material}
                <TierBadge tier={c.tier} size="sm" />
              </span>
            </button>
          ))}
          {viaStakeAndRaid && canCoverFromWallet && (
            <p className="pt-1 text-center text-[11px] text-faint">
              Picking a card will stake {formatOcards(shortfall, 2)} FORGE and raid in one go.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
