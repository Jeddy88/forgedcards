"use client";

import React, { useMemo, useState } from "react";
import Countdown from "@/components/Countdown";
import RaidPicker from "@/components/RaidPicker";
import TierBadge from "@/components/TierBadge";
import { Button, Panel, Row } from "@/components/ui";
import { formatOcards, parseUnits18, shortAddress } from "@/lib/format";
import { tierInfo } from "@/lib/tiers";
import {
  addProtectionAction,
  cancelRaidAction,
  defendAction,
  protectionRequired,
  raidAction,
  removeProtectionAction,
  resolveRaidAction,
  voidRaidAction,
} from "@/lib/actions";
import { useTx } from "@/lib/tx";

/** The live raid on a card, mirrored from StakingVault.getRaid(id). The `raidId`
 *  is the key the page queried by (from `activeRaidOf`), threaded in here. */
export interface RaidInfo {
  raidId: bigint;
  attacker: `0x${string}`;
  attackerTokenId: bigint;
  victimTokenId: bigint;
  targetTier: number;
  attackerOldTier: number;
  amount: bigint;
  resolvesAt: bigint;
  /** The EFFECTIVE stake the victim must reach to repel: 50% normally, or just the 25%
   *  safe line if they acquired the card mid-raid. */
  defenseStake: bigint;
  victimProtection: bigint;
  isResolvable: boolean;
  /** True once the ATTACKER card changed hands — the raid is dead, anyone may clear it. */
  isVoid: boolean;
}

interface CardLite {
  tokenId: bigint;
  tier: number;
  owner: `0x${string}`;
  /** Derived from the card's ART seed — what a raider inherits if they win. */
  material: string;
  protection: bigint;
  protector: `0x${string}`;
  activeForgeId: bigint;
  activeRaidId: bigint;
  raidGraceFrom: bigint;
  /** StakingVault raid status: 0 Not raidable · 1 Grace · 2 Protected · 3 Vulnerable ·
   *  4 Under attack · 5 Raiding. The single source of truth for this panel's state. */
  raidStatus: number;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export default function RaidPanel({
  card,
  isOwner,
  wallet,
  freeStake,
  raid,
  nowS,
  raidGrace,
}: {
  card: CardLite;
  isOwner: boolean;
  wallet: `0x${string}`;
  /** Free (unlocked) staked FORGE — drives the protection controls below. */
  freeStake: bigint;
  raid: RaidInfo | null;
  nowS: number;
  /** StakingVault.RAID_GRACE() — read from chain (mainnet 6h, Sepolia testnet 15m). */
  raidGrace: bigint;
}) {
  const tx = useTx();
  const required = protectionRequired(card.tier);
  // The contract only counts protection posted by the CURRENT owner — a previous
  // owner's lingering stake never protects a buyer (they can withdraw it at will).
  const safe = card.raidStatus === 2;
  const inGrace = card.raidStatus === 1;
  const graceEndsAt = card.raidGraceFrom + raidGrace;
  const staleProtection =
    card.protection >= required &&
    card.protector !== ZERO_ADDR &&
    card.protector.toLowerCase() !== card.owner.toLowerCase();
  const shortfall = required > card.protection ? required - card.protection : 0n;

  const [amount, setAmount] = useState("");
  const [raidPick, setRaidPick] = useState(false);

  // Prefill the protection input with the amount needed to reach the safe line.
  const defaultAmount = useMemo(
    () => (shortfall > 0n ? formatOcards(shortfall, 0).replace(/,/g, "") : formatOcards(required, 0).replace(/,/g, "")),
    [shortfall, required],
  );
  const amtWei = parseUnits18(amount || defaultAmount);

  // Common cards have no rarity to protect or steal.
  if (card.tier === 0) return null;

  const voidRaid = !!raid && raid.isVoid;
  const isVictim = !!raid && !voidRaid && raid.victimTokenId === card.tokenId;
  const isAttackerCard = !!raid && !voidRaid && raid.attackerTokenId === card.tokenId;
  const windowOpen = !!raid && nowS < Number(raid.resolvesAt);
  const resolvable = !!raid && !voidRaid && nowS >= Number(raid.resolvesAt);
  const forging = card.activeForgeId !== 0n;
  const graceLeft = inGrace && nowS < Number(graceEndsAt);

  const run = (a: { intent: Parameters<typeof tx.run>[0]; steps: Parameters<typeof tx.run>[1] }) =>
    tx.run(a.intent, a.steps);

  const fullStake = tierInfo(card.tier).stake;
  // Raidable exactly when the contract says so: status 3 (Vulnerable). This already
  // excludes Protected, Grace, and cards committed to a live raid.
  const raidable = card.raidStatus === 3 && !forging;

  return (
    <Panel className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
          Protection &amp; raids
        </h2>
        {!raid &&
          (safe ? (
            <span className="rounded-full bg-tier1/15 px-2.5 py-0.5 text-xs font-semibold text-tier1">
              🛡️ Protected
            </span>
          ) : graceLeft ? (
            <span className="rounded-full bg-tier1/15 px-2.5 py-0.5 text-xs font-semibold text-tier1">
              🕐 Grace period
            </span>
          ) : (
            <span className="rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-semibold text-danger">
              ⚠️ Vulnerable
            </span>
          ))}
      </div>

      {/* ------------------------------ grace window (newly acquired / upgraded) */}
      {!raid && graceLeft && (
        <div className="mb-4 rounded-xl border border-tier1/30 bg-tier1/5 p-3">
          <p className="text-sm font-semibold text-tier1">
            🕐 Safe for <Countdown to={graceEndsAt} /> — grace period
          </p>
          <p className="mt-1 text-xs text-muted">
            This card recently changed hands or changed tier, so raiders can&apos;t touch it yet.
            {isOwner
              ? " Post the protection below before the clock runs out."
              : " Its owner has until then to protect it."}
          </p>
        </div>
      )}

      {/* ------------------- a previous owner's stake does NOT protect this card */}
      {!raid && staleProtection && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn/5 p-3">
          <p className="text-sm font-semibold text-warn">
            ⚠️ Protected by a previous owner — not by you
          </p>
          <p className="mt-1 text-xs text-muted">
            {formatOcards(card.protection, 0)} of {shortAddress(card.protector)}&apos;s FORGE still
            sits on this card, but it doesn&apos;t defend it — they can withdraw it at any moment.
            {isOwner ? " Post your own protection to secure the card." : ""}
          </p>
        </div>
      )}

      {/* ------------------------- dead raid: the attacker sold their raiding card */}
      {voidRaid && (
        <div className="mb-4 rounded-xl border border-line bg-raised/60 p-3">
          <p className="text-sm font-semibold text-ink">💀 Raid dead — the attacker sold their card</p>
          <p className="mt-1 text-xs text-muted">
            A raider has to see their own attack through. Card #{raid!.attackerTokenId.toString()} changed
            hands, so this raid can never resolve. Clear it to free both cards — the attacker gets their
            stake back in full.
          </p>
          <Button
            className="mt-3"
            variant="ghost"
            onClick={() => run(voidRaidAction(raid!.raidId, raid!.victimTokenId))}
          >
            Clear dead raid
          </Button>
        </div>
      )}

      {/* ---------------------------------------------- live raid banner */}
      {isVictim && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-3">
          <p className="text-sm font-semibold text-danger">
            ⚔️ Under attack by {shortAddress(raid!.attacker)}&apos;s card #{raid!.attackerTokenId.toString()}
          </p>
          <p className="mt-1 text-xs text-muted">
            {windowOpen ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                Defend within <Countdown to={raid!.resolvesAt} tone="warn" /> or this card is swapped
                down to <TierBadge tier={raid!.attackerOldTier} size="sm" /> (the attacker&apos;s tier).
              </span>
            ) : (
              "The defense window has closed. Anyone can now resolve the raid — the cards will swap tiers."
            )}
          </p>
          <div className="mt-3 flex gap-2">
            {isOwner && windowOpen && (
              <Button
                onClick={() =>
                  run(defendAction(card.tokenId, raid!.targetTier, raid!.victimProtection, raid!.defenseStake))
                }
              >
                Defend — stake{" "}
                {formatOcards(
                  raid!.defenseStake > raid!.victimProtection ? raid!.defenseStake - raid!.victimProtection : 0n,
                  0,
                )}
              </Button>
            )}
            {resolvable && (
              <Button
                variant="ghost"
                onClick={() => run(resolveRaidAction(raid!.raidId, raid!.attackerTokenId, raid!.victimTokenId))}
              >
                Resolve raid
              </Button>
            )}
          </div>
        </div>
      )}

      {isAttackerCard && (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <p className="text-sm font-semibold text-ink">
            🗡️ This card is raiding #{raid!.victimTokenId.toString()} for {tierInfo(raid!.targetTier).name}
          </p>
          <p className="mt-1 text-xs text-muted">
            {windowOpen ? (
              <>
                Resolves in <Countdown to={raid!.resolvesAt} /> if the owner doesn&apos;t defend.
              </>
            ) : (
              "Window closed — resolve to complete the swap."
            )}
          </p>
          {isOwner && (
            <div className="mt-3 flex gap-2">
              {resolvable && (
                <Button onClick={() => run(resolveRaidAction(raid!.raidId, raid!.attackerTokenId, raid!.victimTokenId))}>
                  Resolve &amp; claim tier
                </Button>
              )}
              <Button variant="ghost" onClick={() => run(cancelRaidAction(raid!.raidId, raid!.amount))}>
                Cancel raid
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------- protection meter */}
      {!raid && (
        <>
          <div className="mb-1 flex justify-between text-xs text-faint">
            <span>Protection</span>
            <span className="tabular-nums" data-source="StakingVault.protectionOf(tokenId)">
              {formatOcards(card.protection, 0)} / {formatOcards(required, 0)} safe
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-raised">
            <div
              className={`h-full ${safe ? "bg-tier1/80" : "bg-danger/70"}`}
              style={{ width: `${pct(card.protection, required)}%` }}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            {safe
              ? "The owner's own stake is at or above the 25% safe line — this card can't be raided. Reduce it any time to free the stake (it stays staked either way)."
              : "Below the 25% safe line — a lower-tier card can raid it. Only the current owner's own stake counts, so top up to lock it down."}
          </p>
        </>
      )}

      {/* ---------------------------------------------- owner controls */}
      {isOwner && !raid && (
        <div className="mt-4">
          {forging ? (
            <p className="rounded-xl border border-warn/25 bg-warn/5 px-3 py-2 text-xs text-warn">
              This card is being forged — protection is paused until the forge completes.
            </p>
          ) : (
            <>
              <label className="block rounded-2xl border border-line bg-bg p-3">
                <span className="flex items-baseline justify-between text-xs text-faint">
                  <span>Amount</span>
                  <span data-source="StakingVault.freeStakeOf(wallet)">
                    Free stake: {formatOcards(freeStake, 0)}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={defaultAmount}
                    inputMode="decimal"
                    className="w-full bg-transparent text-lg font-semibold tabular-nums text-ink outline-none"
                    aria-label="Protection amount"
                  />
                  <span className="shrink-0 rounded-lg bg-raised px-2.5 py-1 text-xs font-semibold text-ink">
                    FORGE
                  </span>
                </span>
              </label>
              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1"
                  disabled={amtWei === null || amtWei <= 0n || (amtWei ?? 0n) > freeStake}
                  onClick={() => run(addProtectionAction(card.tokenId, card.tier, amtWei!))}
                >
                  Add protection
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={amtWei === null || amtWei <= 0n || (amtWei ?? 0n) > card.protection}
                  onClick={() =>
                    run(
                      removeProtectionAction(
                        card.tokenId,
                        amtWei!,
                        card.protection - amtWei! < required,
                      ),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------- raider controls */}
      {!isOwner && raidable && (
        <div className="mt-4">
          <Row label="Full stake to raid" value={`${formatOcards(fullStake, 0)} FORGE`} />
          <Button className="mt-3 w-full" onClick={() => setRaidPick(true)}>
            ⚔️ Raid this card
          </Button>
        </div>
      )}

      {/* ---------------------------------------------- attacker-card picker */}
      <RaidPicker
        open={raidPick}
        onClose={() => setRaidPick(false)}
        target={{ tokenId: card.tokenId, tier: card.tier, material: card.material }}
      />
    </Panel>
  );
}

/** Percentage (0-100) of `have` toward `target`, clamped. */
function pct(have: bigint, target: bigint): number {
  if (target === 0n) return 100;
  const p = Number((have * 100n) / target);
  return Math.max(0, Math.min(100, p));
}
