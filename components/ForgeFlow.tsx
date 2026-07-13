"use client";

/**
 * ForgeFlow — the "given ONE card, forge it" flow, extracted from the Forge
 * page so it can be reused in a modal (e.g. from the card detail page).
 *
 * Self-contained: give it a `card` and it reads everything else from
 * `useSnapshot()`. Renders, for that card:
 *  - the target-tier picker (live tierSlotsRemaining, stake, on-chain duration),
 *  - the 3-case stake verdict (ready / stake&forge-from-wallet / need more
 *    FORGE) + the conflict states (downward, tier full) + wallet/staked readout,
 *  - the tx actions (forge / stakeAndForge via useTx + @/lib/actions),
 *  - and, when the card is ALREADY forging, the on-chain ForgeProgress panel
 *    with Claim / Cancel.
 *
 * ALL behavior/wording is preserved verbatim from the original Forge page — this
 * is a refactor for reuse, not a redesign.
 */
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import Countdown from "@/components/Countdown";
import TierBadge from "@/components/TierBadge";
import { Button, Row } from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";
import { formatOcards, formatDurationLabel } from "@/lib/format";
import { CLAIM_WINDOW, TIERS, tierInfo } from "@/lib/tiers";
import type { CardFixture, ForgeView } from "@/lib/fixtures/types";
import { useReadContract } from "wagmi";
import type { Abi } from "viem";
import { cardsTokenAbi, stakingVaultAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";
import { approveStep, useTx, type TxStep } from "@/lib/tx";
import { cancelForgeAction, claimForgeAction } from "@/lib/actions";

/** "in ~12 hours (Sat 04 Jul, 21:30)" — decoded intent timing for forges. */
function timeFromNow(offsetSeconds: bigint): string {
  const at = new Date(Date.now() + Number(offsetSeconds) * 1000);
  return at.toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Live forge-progress panel for a card that's already forging. EVERY value is
 * on-chain: the forge view (maturesAt / claimDeadline / isMature /
 * isSweepable) plus the per-network on-chain tier duration for the bar's total.
 * No tiers.ts durations feed any countdown, bar, or claim-eligibility check.
 *
 * States, driven by the chain flags:
 *  - Forging (!isMature): progress bar + live countdown to maturesAt.
 *  - Matured (isMature): upgrade CTA — allowed UNTIL swept. Inside the 3-hour
 *    window it shows the claimDeadline countdown; past it, still upgradeable but
 *    anyone may sweep (the only thing that ends the chance).
 */
export function ForgeProgress({
  forgeId,
  t,
  totalSeconds,
  onClaim,
  onCancel,
}: {
  forgeId: bigint;
  t: ForgeView;
  /** CardsOnChain.tierDuration(targetTier) in seconds — the bar's full span. */
  totalSeconds: bigint;
  onClaim: () => void;
  onCancel: () => void;
}) {
  // Tick locally (1s) so the progress bar advances like the Countdown component.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const total = Number(totalSeconds);
  const start = Number(t.maturesAt) - total; // maturesAt - full duration
  const progress = total > 0 ? Math.min(1, Math.max(0, (nowSec - start) / total)) : 1;
  const target = tierInfo(t.targetTier);
  // Flip state the instant a deadline passes (chain flags are a slower poll).
  const matured = t.isMature || nowSec >= Number(t.maturesAt);
  const swept = t.isSweepable || nowSec >= Number(t.claimDeadline);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-3">
        <TierBadge tier={t.targetTier} />
        <span className="text-xs text-faint">
          {matured ? "forging complete" : "forging in progress"}
        </span>
      </div>

      {/* progress bar — tier-accented, matches the tier-occupancy bar style */}
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full transition-[width] duration-1000 ease-linear"
            style={{
              width: `${(progress * 100).toFixed(1)}%`,
              backgroundColor: swept ? "#ff7088" : matured ? "#ffd56b" : target.color,
            }}
          />
        </div>
        <p className="mt-1 text-right text-[11px] tabular-nums text-faint">
          {(progress * 100).toFixed(0)}%
        </p>
      </div>

      <Row label="Forging to" value={target.name} source="StakingVault.getForge(id).targetTier" />
      <Row
        label="FORGE locked"
        value={formatOcards(t.amount, 0)}
        source="StakingVault.getForge(id).amount"
      />

      {/* State 1 — still maturing */}
      {!matured && (
        <div className="rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-sm">
          <p className="text-muted" data-source="StakingVault.getForge(id).maturesAt / .isMature">
            Matures in <Countdown to={t.maturesAt} tone="neutral" />
          </p>
          <p className="mt-1 text-xs leading-relaxed text-faint">
            When it matures, a 3-hour claim window opens — be ready to claim.
          </p>
        </div>
      )}

      {/* Matured — the staker can upgrade ANY time until the forge is swept. In
          the 3-hour window the countdown shows; past it, upgrade is still allowed
          but anyone may sweep (which is the only thing that ends the chance). */}
      {matured && (
        <div
          className={`rounded-xl border px-3 py-2.5 ${
            swept ? "border-danger/40 bg-danger/10" : "border-warn/40 bg-warn/10"
          }`}
          data-source="StakingVault.getForge(id).isMature / .claimDeadline / .isSweepable"
        >
          {swept ? (
            <p className="text-sm font-semibold text-danger">
              ⏳ Forging complete — upgrade now! The 3-hour window lapsed, so anyone can sweep this
              forge. You can still upgrade until they do.
            </p>
          ) : (
            <p className="text-sm font-semibold text-warn">
              ⏳ Ready to upgrade — claim within <Countdown to={t.claimDeadline} tone="warn" />{" "}
              before anyone can sweep it
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" onClick={onClaim}>
              Upgrade Card
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-faint">
        Live countdowns and the sweep board also appear on{" "}
        <Link href="/cards" className="underline hover:text-muted">
          My Cards
        </Link>
        . Forge id #{forgeId.toString()}.
      </p>
    </div>
  );
}

export default function ForgeFlow({
  card,
  onDone,
  headingPrefix = "Forge",
}: {
  /** The single card to forge. */
  card: CardFixture;
  /** Called after a tx is submitted (e.g. to close a host modal). Optional. */
  onDone?: () => void;
  /** Prefix for the single combined header line, e.g. "2 · FORGE". The suffix
   *  ("— PICK THE TARGET TIER" / "— REVIEW") is appended per wizard step. */
  headingPrefix?: string;
}) {
  const { connected, wallet } = useApp();
  const snap = useSnapshot();
  const tx = useTx();
  const v = snap.stakingVault;

  const [targetTier, setTargetTier] = useState<number | null>(null);
  // Two-step wizard: the tier picker (A) slides out and Review (B) slides in.
  const [step, setStep] = useState<"tier" | "review">("tier");

  // A single uppercase header line that reflects the current view. When
  // headingPrefix is empty (e.g. inside a Modal that already has a title), only
  // the step suffix is shown.
  const heading = (suffix: string) => (
    <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
      {headingPrefix ? `${headingPrefix} — ${suffix}` : suffix}
    </h2>
  );

 // If this card is already forging, its live forge (all chain data).
  const activeForge =
    card.activeForgeId !== 0n
      ? { id: card.activeForgeId, t: v.forges[card.activeForgeId.toString()] }
      : null;

  const claimActiveForge = () => {
    if (!activeForge?.t) return;
    const a = claimForgeAction(activeForge.id, activeForge.t);
    tx.run(a.intent, a.steps, onDone);
  };
  const cancelActiveForge = () => {
    if (!activeForge?.t) return;
    const a = cancelForgeAction(activeForge.id, activeForge.t);
    tx.run(a.intent, a.steps, onDone);
  };

  // Approval state for the stake-and-forge path.
  const allowanceQ = useReadContract({
    address: addressOf("cardsToken"),
    abi: cardsTokenAbi,
    functionName: "allowance",
    args: [wallet, addressOf("stakingVault")],
    query: { enabled: connected, refetchInterval: 12_000 },
  });
  const allowance = (allowanceQ.data as bigint | undefined) ?? 0n;
  const vaultAbi = stakingVaultAbi as unknown as Abi;

  const startForge = (viaStakeAndForge: boolean) => {
    if (targetTier === null) return;
    const t = tierInfo(targetTier);
    // Maturation duration is read from CHAIN (per-network: mainnet hours,
    // Sepolia minutes) — never the tiers.ts constant.
    const durationSeconds = snap.cardsOnChain.tierDurations[targetTier];
    const durationLabel = formatDurationLabel(durationSeconds);
    const shortfall = viaStakeAndForge ? t.stake - v.freeStakeOf : 0n;
    const rows = [
      { label: "Card", value: `#${card.tokenId.toString()} · ${card.material}` },
      { label: "Target tier", value: t.name },
      { label: "FORGE locked (returned at the end)", value: formatOcards(t.stake, 0) },
      ...(viaStakeAndForge
        ? [{ label: "Freshly staked in this tx", value: formatOcards(shortfall, 2) }]
        : []),
      { label: `Matures in ${durationLabel}`, value: `≈ ${timeFromNow(durationSeconds)}` },
      {
        label: "Claim deadline (3-HOUR window)",
        value: `≈ ${timeFromNow(durationSeconds + CLAIM_WINDOW)}`,
      },
    ];
    const steps: TxStep[] = [];
    if (viaStakeAndForge) {
      if (shortfall <= 0n) return;
      if (allowance < shortfall) steps.push(approveStep("stakingVault", shortfall));
      steps.push({
        label: `Stake ${formatOcards(shortfall, 2)} & start forging card #${card.tokenId}`,
        call: {
          contract: "stakingVault",
          abi: vaultAbi,
          functionName: "stakeAndForge",
          args: [shortfall, card.tokenId, targetTier],
        },
      });
    } else {
      steps.push({
        label: `Start forging card #${card.tokenId} → ${t.name}`,
        call: {
          contract: "stakingVault",
          abi: vaultAbi,
          functionName: "forge",
          args: [card.tokenId, targetTier],
        },
      });
    }
    tx.run(
      {
        title: `Forge card #${card.tokenId} → ${t.name}`,
        action: viaStakeAndForge
          ? "StakingVault.stakeAndForge(stakeAmount, tokenId, targetTier)"
          : "StakingVault.forge(tokenId, targetTier)",
        verb: "Forging",
        rows,
      },
      steps,
      () => {
        setTargetTier(null);
        onDone?.();
      },
    );
  };

  // Conflict analysis for the chosen tier — mirrors the vault's checks.
  const verdict = useMemo(() => {
    if (targetTier === null) return null;
    const t = tierInfo(targetTier);
    if (card.activeForgeId !== 0n)
      return { ok: false, reason: "This card is already being forged (one forge per card)." };
    if (targetTier <= card.tier)
      return { ok: false, reason: "Forging only goes upward — pick a tier above the card's current tier." };
    if (v.tierSlotsRemaining[targetTier] === 0n)
      return { ok: false, reason: `${t.name} is full — every forge slot is taken by cards or active forges. Slots reopen when a card is forged onward, or a forge is cancelled or swept.` };

    // FORGE requirement: distinguish STAKED (free) vs WALLET balance so a user
    // with tokens in their wallet but nothing staked isn't told "you have 0".
    const stake = t.stake; //                CardsOnChain.tierStake(targetTier)
    const free = v.freeStakeOf; //           StakingVault.freeStakeOf(wallet)
    const walletBal = snap.cardsToken.balanceOf; // CardsToken.balanceOf(wallet)
    if (free < stake) {
      const shortfall = stake - free;
      if (walletBal >= shortfall) {
        // Not an error: they can cover the shortfall from the wallet in one
        // combined stakeAndForge tx. This is the ready-to-go primary path.
        return {
          ok: false,
          canStakeAndForge: true as const,
          reason: `This locks ${formatOcards(stake, 0)}. You have ${formatOcards(free, 0)} staked + ${formatOcards(walletBal, 0)} in your wallet — use “Stake & forge in one transaction” to lock ${formatOcards(shortfall, 0)} straight from your wallet.`,
        };
      }
      // Genuinely not enough FORGE anywhere — the only real "need more" case.
      return {
        ok: false,
        needMoreOcards: true as const,
        reason: `You need ${formatOcards(stake, 0)} tokens to forge to ${t.name}. You have ${formatOcards(free, 0)} staked + ${formatOcards(walletBal, 0)} in your wallet.`,
      };
    }
    return { ok: true as const, reason: "" };
  }, [card, targetTier, v, snap.cardsToken.balanceOf]);

  // ---------------------------------------------------------- already forging
  // Unchanged: a card that's already forging shows the on-chain progress panel
  // directly (no tier step / no wizard).
  if (activeForge?.t) {
    return (
      <div>
        {headingPrefix && (
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
            {headingPrefix}
          </h2>
        )}
        <ForgeProgress
          forgeId={activeForge.id}
          t={activeForge.t}
          totalSeconds={snap.cardsOnChain.tierDurations[activeForge.t.targetTier]}
          onClaim={claimActiveForge}
          onCancel={cancelActiveForge}
        />
      </div>
    );
  }

  // Legendary can't be forged further.
  if (card.tier >= 4) {
    return (
      <div>
        {heading("TOP TIER")}
        <p className="py-6 text-center text-sm text-muted">
          Card #{card.tokenId.toString()} is Legendary — the top of the chain. There&apos;s
          nothing higher to forge it into.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------- forge wizard
  const pickTier = (tier: number) => {
    setTargetTier(tier);
    setStep("review");
  };

  return (
    <div>
      {heading(step === "review" ? "REVIEW" : "PICK THE TARGET TIER")}

      {/* Two-step wizard track: Step A (tier picker) and Step B (review) sit
          side by side on a 200%-wide flex row; translating it by -50% slides B
          in. overflow-hidden clips the off-screen step. Reduced-motion users get
          an instant swap (motion-reduce:transition-none). */}
      <div className="overflow-hidden">
        <div
          className={`flex w-[200%] transition-transform duration-300 ease-out motion-reduce:transition-none ${
            step === "review" ? "-translate-x-1/2" : "translate-x-0"
          }`}
        >
          {/* ---------------- Step A · tier picker ---------------- */}
          <section className="w-1/2 shrink-0 pr-0.5" aria-hidden={step === "review"}>
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {TIERS.filter((t) => t.tier > 0).map((t) => {
                const remaining = v.tierSlotsRemaining[t.tier]; // StakingVault.tierSlotsRemaining(tier)
                const full = remaining === 0n;
                const below = t.tier <= card.tier;
                const disabled = full || below;
                const active = targetTier === t.tier;
                return (
                  <button
                    key={t.tier}
                    onClick={() => pickTier(t.tier)}
                    disabled={disabled}
                    className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors ${
                      active ? "bg-raised" : disabled ? "opacity-45" : "hover:bg-raised/60"
                    }`}
                  >
                    <span
                      className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                        active ? "border-accent bg-accent" : "border-faint"
                      }`}
                    />
                    <div className="min-w-0 shrink-0">
                      <TierBadge tier={t.tier} />
                    </div>
                    {/* Flexible 3-stat block — no fixed widths, tight gaps, so it
                        never overflows the (narrower) panel or modal. */}
                    <div className="ml-auto flex shrink-0 gap-x-4 text-right text-xs">
                      <div>
                        <p className="text-faint">Stake</p>
                        <p className="mt-0.5 font-semibold tabular-nums text-ink" data-source="CardsOnChain.tierStake(tier)">
                          {(t.stake / 10n ** 18n).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-faint">Wait</p>
                        <p className="mt-0.5 whitespace-nowrap font-semibold text-ink" data-source="CardsOnChain.tierDuration(tier)">
                          {formatDurationLabel(snap.cardsOnChain.tierDurations[t.tier])}
                        </p>
                      </div>
                      <div>
                        <p className="text-faint">Slots</p>
                        <p
                          className="mt-0.5 whitespace-nowrap font-semibold tabular-nums"
                          style={{ color: full ? "#ff7088" : t.color }}
                          data-source="StakingVault.tierSlotsRemaining(tier)"
                        >
                          {remaining.toLocaleString()}
                          <span className="text-faint"> / {t.cap.toLocaleString()}</span>
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              Straight to target — no ladder. A Common card can be forged directly to Legendary
              by staking that tier&apos;s full amount. Each tier&apos;s yield weight:{" "}
              {TIERS.map((t) => `${t.name} ${t.weight}×`).join(" · ")}.
            </p>
          </section>

          {/* ---------------- Step B · review & forge ---------------- */}
          <section className="w-1/2 shrink-0 pl-0.5" aria-hidden={step === "tier"}>
            <button
              onClick={() => setStep("tier")}
              className="mb-3 text-xs font-semibold text-muted hover:text-ink"
            >
              ← Back to tiers
            </button>
            {targetTier === null ? (
              <p className="py-6 text-center text-sm text-faint">
                Pick a target tier to preview the forge.
              </p>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-center gap-3">
                  <TierBadge tier={card.tier} />
                  <span className="text-faint">→</span>
                  <TierBadge tier={targetTier} />
                </div>
                <Row label="Card" value={`#${card.tokenId.toString()} · ${card.material}`} />
                <Row
                  label="FORGE locked"
                  value={formatOcards(tierInfo(targetTier).stake, 0)}
                  source="CardsOnChain.tierStake(targetTier)"
                  strong
                />
                <Row
                  label="Maturation"
                  value={formatDurationLabel(snap.cardsOnChain.tierDurations[targetTier])}
                  source="CardsOnChain.tierDuration(targetTier)"
                />
                <Row label="Claim window" value="3 HOURS after maturity" source="StakingVault.CLAIM_WINDOW" />
                <Row
                  label="In your wallet"
                  value={formatOcards(snap.cardsToken.balanceOf, 0)}
                  source="CardsToken.balanceOf(wallet)"
                />
                <Row
                  label="Already staked (free)"
                  value={formatOcards(v.freeStakeOf, 0)}
                  source="StakingVault.freeStakeOf(wallet)"
                />
                <Row
                  label="New material"
                  value={`re-rolled from ${tierInfo(targetTier).name}'s set`}
                  source="CardMaterials.materialOf(artSeed, newTier) — same art seed, new tier"
                />

                {/* canStakeAndForge is a ready-to-go state, not an error — show it
                    in a neutral/accent tone. needMoreOcards + the other conflicts
                    are real blockers — show them red. */}
                {verdict && "canStakeAndForge" in verdict && verdict.canStakeAndForge && (
                  <p className="mt-4 rounded-xl border border-accent/25 bg-accent/5 px-3 py-2.5 text-xs leading-relaxed text-muted">
                    {verdict.reason}
                  </p>
                )}
                {verdict && !verdict.ok && !("canStakeAndForge" in verdict && verdict.canStakeAndForge) && (
                  <p className="mt-4 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2.5 text-xs leading-relaxed text-danger">
                    {verdict.reason}
                    {"needMoreOcards" in verdict && verdict.needMoreOcards && (
                      <>
                        {" "}
                        <Link href="/trade" className="font-semibold underline hover:text-ink">
                          Buy more FORGE →
                        </Link>
                      </>
                    )}
                  </p>
                )}

                {verdict && "canStakeAndForge" in verdict && verdict.canStakeAndForge ? (
                  <Button className="mt-4 w-full" onClick={() => startForge(true)}>
                    Stake &amp; forge in one transaction
                  </Button>
                ) : verdict && "needMoreOcards" in verdict && verdict.needMoreOcards ? (
                  <Link href="/trade" className="mt-4 block">
                    <Button className="w-full">Buy FORGE</Button>
                  </Link>
                ) : (
                  <Button
                    className="mt-4 w-full"
                    disabled={!verdict?.ok}
                    onClick={() => startForge(false)}
                  >
                    Start forging
                  </Button>
                )}

                <ul className="mt-5 space-y-2 text-xs leading-relaxed text-faint">
                  <li>• Your forge slot is reserved the moment you start (first come, first served).</li>
                  <li>• Locked tokens keep earning staker rewards and, on upgrade / cancel / sweep, unlock back to your <em>free stake</em> (they stay staked — never sent to your wallet, never spent).</li>
                  <li>• Upgrade needs you to still own the card. You can upgrade any time after maturity, until the forge is swept — after the 3-hour window anyone may sweep it, which reopens the slot and unlocks your FORGE back to your free stake.</li>
                  <li>• Cancel any time before upgrading.</li>
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
