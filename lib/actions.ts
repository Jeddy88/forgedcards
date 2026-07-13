/**
 * Shared write-flow builders (intent + steps) for flows that appear on more
 * than one screen. Trade/stake/forge-start flows live in their pages; these
 * are the forge lifecycle + reward flows.
 */
import type { Abi } from "viem";
import { cardYieldAbi, stakingVaultAbi } from "@/lib/contracts/abis";
import type { ForgeView } from "@/lib/fixtures/types";
import { formatEth, formatOcards, shortAddress } from "@/lib/format";
import { tierInfo } from "@/lib/tiers";
import { approveStep, type TxIntent, type TxStep } from "@/lib/tx";

const vaultAbi = stakingVaultAbi as unknown as Abi;
const yieldAbi = cardYieldAbi as unknown as Abi;

function deadlineClock(t: ForgeView): string {
  return new Date(Number(t.claimDeadline) * 1000).toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function claimForgeAction(id: bigint, t: ForgeView): { intent: TxIntent; steps: TxStep[] } {
  const target = tierInfo(t.targetTier);
  return {
    intent: {
      title: `Upgrade to ${target.name} — card #${t.tokenId}`,
      action: "StakingVault.upgradeCard(forgeId)",
      verb: "Upgrading",
      rows: [
        { label: "Card becomes", value: target.name },
        { label: "Unlocks (stays staked)", value: formatOcards(t.amount, 0) },
        { label: "Claim deadline", value: deadlineClock(t) },
      ],
    },
    steps: [
      {
        label: `Upgrade card #${t.tokenId} → ${target.name}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "upgradeCard", args: [id] },
      },
    ],
  };
}

export function cancelForgeAction(id: bigint, t: ForgeView): { intent: TxIntent; steps: TxStep[] } {
  const target = tierInfo(t.targetTier);
  return {
    intent: {
      title: `Cancel forge — card #${t.tokenId}`,
      action: "StakingVault.cancel(forgeId)",
      verb: "Cancelling",
      rows: [
        { label: "Forge abandoned", value: `→ ${target.name}` },
        { label: "Unlocks (stays staked)", value: formatOcards(t.amount, 0) },
        { label: "The card", value: "stays at its current tier" },
        { label: `${target.name} slot`, value: "reopens for everyone" },
      ],
    },
    steps: [
      {
        label: `Cancel forge #${id}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "cancel", args: [id] },
      },
    ],
  };
}

export function sweepForgeAction(id: bigint, t: ForgeView): { intent: TxIntent; steps: TxStep[] } {
  const target = tierInfo(t.targetTier);
  return {
    intent: {
      title: `Sweep lapsed forge #${id}`,
      action: "StakingVault.sweep(forgeId)",
      verb: "Sweeping",
      rows: [
        { label: "Card", value: `#${t.tokenId}` },
        { label: `${target.name} slot`, value: "reopens for everyone" },
        { label: "Locked tokens", value: `${formatOcards(t.amount, 0)} → ${shortAddress(t.staker)}'s stake (stays staked)` },
        { label: "You receive", value: "nothing — you pay only gas" },
      ],
    },
    steps: [
      {
        label: `Sweep forge #${id}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "sweep", args: [id] },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Protection & raids (the "steal" game mechanic). All of these move STAKED
// FORGE between the free/locked sub-ledgers — no token approval or transfer is
// ever involved, so there is never an approve step.
// ---------------------------------------------------------------------------

/** 25% of a tier's forge stake — the standing protection that makes a card safe. */
export function protectionRequired(tier: number): bigint {
  return tierInfo(tier).stake / 4n;
}

/** 50% of a tier's forge stake — the emergency stake to repel a live raid. */
export function defenseStake(tier: number): bigint {
  return tierInfo(tier).stake / 2n;
}

export function addProtectionAction(
  tokenId: bigint,
  tier: number,
  amount: bigint,
): { intent: TxIntent; steps: TxStep[] } {
  const safe = protectionRequired(tier);
  return {
    intent: {
      title: `Protect card #${tokenId}`,
      action: "StakingVault.addProtection(tokenId, amount)",
      verb: "Protecting",
      rows: [
        { label: "Protection added", value: formatOcards(amount, 0) },
        { label: "Safe line (25%)", value: formatOcards(safe, 0) },
        { label: "Source", value: "your free staked FORGE (stays staked, keeps earning)" },
      ],
    },
    steps: [
      {
        label: `Protect card #${tokenId}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "addProtection", args: [tokenId, amount] },
      },
    ],
  };
}

export function removeProtectionAction(
  tokenId: bigint,
  amount: bigint,
  exposes: boolean,
): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: `Reduce protection — card #${tokenId}`,
      action: "StakingVault.removeProtection(tokenId, amount)",
      verb: "Unprotecting",
      rows: [
        { label: "Protection released", value: formatOcards(amount, 0) },
        { label: "Returns to", value: "your free stake (unlocked, still staked)" },
      ],
      warnings: exposes
        ? ["This drops the card below its 25% safe line — it can be raided until you top it back up."]
        : undefined,
    },
    steps: [
      {
        label: `Reduce protection on card #${tokenId}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "removeProtection", args: [tokenId, amount] },
      },
    ],
  };
}

/**
 * `shortfall` > 0 routes through `stakeAndRaid` — cold-staking the missing FORGE from the
 * wallet in the SAME transaction (the raid's own guards still apply, and a rejected raid
 * rolls the stake back atomically). `shortfall == 0` uses the plain `raid`.
 */
export function raidAction(
  attackerTokenId: bigint,
  victimTokenId: bigint,
  targetTier: number,
  amount: bigint,
  victimMaterial: string,
  shortfall: bigint,
  allowance: bigint,
): { intent: TxIntent; steps: TxStep[] } {
  const target = tierInfo(targetTier);
  const viaStakeAndRaid = shortfall > 0n;

  const steps: TxStep[] = [];
  if (viaStakeAndRaid) {
    if (allowance < shortfall) steps.push(approveStep("stakingVault", shortfall));
    steps.push({
      label: `Stake ${formatOcards(shortfall, 2)} & raid card #${victimTokenId}`,
      call: {
        contract: "stakingVault",
        abi: vaultAbi,
        functionName: "stakeAndRaid",
        args: [shortfall, attackerTokenId, victimTokenId],
      },
    });
  } else {
    steps.push({
      label: `Raid card #${victimTokenId}`,
      call: { contract: "stakingVault", abi: vaultAbi, functionName: "raid", args: [attackerTokenId, victimTokenId] },
    });
  }

  return {
    intent: {
      title: `Raid card #${victimTokenId} for ${victimMaterial} ${target.name}`,
      action: viaStakeAndRaid
        ? "StakingVault.stakeAndRaid(stakeAmount, attackerTokenId, victimTokenId)"
        : "StakingVault.raid(attackerTokenId, victimTokenId)",
      verb: "Raiding",
      rows: [
        { label: "Your card", value: `#${attackerTokenId}` },
        { label: "Target", value: `#${victimTokenId} (${victimMaterial} ${target.name})` },
        { label: "You lock", value: `${formatOcards(amount, 0)} (full ${target.name} stake)` },
        ...(viaStakeAndRaid
          ? [{ label: "Freshly staked in this tx", value: formatOcards(shortfall, 2) }]
          : []),
        { label: "Defense window", value: target.durationLabel },
        { label: "If you win", value: `your card becomes a ${victimMaterial} ${target.name} — the exact card you fought for` },
        { label: "Your card's look", value: `passes to #${victimTokenId} (the two cards swap appearances)` },
      ],
      warnings: [
        "The owner has the full window to defend. If they reach the 50% defense stake in time, your stake is refunded and nothing changes.",
      ],
    },
    steps,
  };
}

/**
 * `target` is the raid's EFFECTIVE defense stake (`getRaid().defenseStake`): the 50%
 * penalty for the owner who let the card slip below its safe line, or just the 25% safe
 * line if they acquired the card mid-raid.
 */
export function defendAction(
  victimTokenId: bigint,
  targetTier: number,
  currentProtection: bigint,
  target: bigint,
): { intent: TxIntent; steps: TxStep[] } {
  const shortfall = target > currentProtection ? target - currentProtection : 0n;
  const safe = protectionRequired(targetTier);
  const atSafeLine = target <= safe;
  return {
    intent: {
      title: `Defend card #${victimTokenId}`,
      action: "StakingVault.defend(victimTokenId)",
      verb: "Defending",
      rows: [
        { label: "Stake to defend", value: formatOcards(shortfall, 0) },
        {
          label: "Brings protection to",
          value: `${formatOcards(target, 0)} (${atSafeLine ? "25% safe line" : "50% defense stake"})`,
        },
        { label: "Attacker", value: "fully refunded — nothing changes" },
        atSafeLine
          ? { label: "Why only 25%", value: "you acquired this card mid-raid — no penalty for the seller's lapse" }
          : { label: "After the raid", value: `you can drop back to ${formatOcards(safe, 0)} (25% safe line)` },
      ],
    },
    steps: [
      {
        label: `Defend card #${victimTokenId}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "defend", args: [victimTokenId] },
      },
    ],
  };
}

export function voidRaidAction(raidId: bigint, victimTokenId: bigint): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: `Clear dead raid #${raidId}`,
      action: "StakingVault.voidRaid(raidId)",
      verb: "Clearing",
      rows: [
        { label: "Why", value: "the attacker sold their raiding card, so the raid is dead" },
        { label: "Card", value: `#${victimTokenId} keeps its tier` },
        { label: "The attacker", value: "gets their stake back in full" },
        { label: "You receive", value: "nothing — you pay only gas" },
      ],
    },
    steps: [
      {
        label: `Void raid #${raidId}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "voidRaid", args: [raidId] },
      },
    ],
  };
}

export function resolveRaidAction(
  raidId: bigint,
  attackerTokenId: bigint,
  victimTokenId: bigint,
): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: `Resolve raid #${raidId}`,
      action: "StakingVault.resolveRaid(raidId)",
      verb: "Resolving",
      rows: [
        { label: "Cards", value: `#${attackerTokenId} ⇄ #${victimTokenId}` },
        { label: "Outcome", value: "the two cards swap tiers (window lapsed, undefended)" },
        { label: "You receive", value: "nothing — you pay only gas" },
      ],
    },
    steps: [
      {
        label: `Resolve raid #${raidId}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "resolveRaid", args: [raidId] },
      },
    ],
  };
}

export function cancelRaidAction(raidId: bigint, amount: bigint): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: `Cancel raid #${raidId}`,
      action: "StakingVault.cancelRaid(raidId)",
      verb: "Cancelling",
      rows: [
        { label: "Your locked stake", value: `${formatOcards(amount, 0)} → free stake` },
        { label: "The target", value: "untouched" },
      ],
    },
    steps: [
      {
        label: `Cancel raid #${raidId}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "cancelRaid", args: [raidId] },
      },
    ],
  };
}

export function claimYieldAction(tokenId: bigint, accrued: bigint): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: `Claim yield — card #${tokenId}`,
      action: "CardYield.claim(tokenId)",
      verb: "Claiming",
      rows: [
        { label: "Accrued on the card", value: formatEth(accrued, 6) },
        { label: "Moves to", value: "your withdrawable balance (pull pattern)" },
      ],
    },
    steps: [
      {
        label: `Claim ${formatEth(accrued, 6)} from card #${tokenId}`,
        call: { contract: "cardYield", abi: yieldAbi, functionName: "claim", args: [tokenId] },
      },
    ],
  };
}

export function claimYieldManyAction(tokenIds: bigint[], total: bigint): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: `Claim yield — ${tokenIds.length} cards`,
      action: "CardYield.claimMany(tokenIds)",
      verb: "Claiming",
      rows: [
        { label: "Cards", value: tokenIds.map((i) => `#${i}`).join(", ") },
        { label: "Total accrued", value: formatEth(total, 6) },
        { label: "Moves to", value: "your withdrawable balance (pull pattern)" },
      ],
    },
    steps: [
      {
        label: `Claim yield on ${tokenIds.length} cards`,
        call: { contract: "cardYield", abi: yieldAbi, functionName: "claimMany", args: [tokenIds] },
      },
    ],
  };
}

export function withdrawYieldAction(claimable: bigint): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: "Withdraw card yield",
      action: "CardYield.withdraw()",
      verb: "Withdrawing",
      rows: [{ label: "ETH to your wallet", value: formatEth(claimable, 6) }],
    },
    steps: [
      {
        label: `Withdraw ${formatEth(claimable, 6)}`,
        call: { contract: "cardYield", abi: yieldAbi, functionName: "withdraw", args: [] },
      },
    ],
  };
}

export function settleStakingAction(pending: bigint): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: "Settle staking rewards",
      action: "StakingVault.claimRewards()",
      verb: "Settling",
      rows: [
        { label: "Pending → withdrawable", value: formatEth(pending) },
        { label: "Then", value: "withdraw sends the ETH (pull pattern)" },
      ],
    },
    steps: [
      {
        label: "Settle pending rewards",
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "claimRewards", args: [] },
      },
    ],
  };
}

export function withdrawStakingAction(claimable: bigint): { intent: TxIntent; steps: TxStep[] } {
  return {
    intent: {
      title: "Withdraw staking rewards",
      action: "StakingVault.withdrawRewards()",
      verb: "Withdrawing",
      rows: [{ label: "ETH to your wallet", value: formatEth(claimable) }],
    },
    steps: [
      {
        label: `Withdraw ${formatEth(claimable)}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "withdrawRewards", args: [] },
      },
    ],
  };
}
