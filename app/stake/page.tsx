"use client";

import Link from "next/link";
import React, { useState } from "react";
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
import { formatEth, formatOcards, parseUnits18, percentOf } from "@/lib/format";
import { useReadContract } from "wagmi";
import type { Abi } from "viem";
import { cardsTokenAbi, stakingVaultAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";
import { protectionRequired } from "@/lib/actions";
import { approveStep, useTx, type TxStep } from "@/lib/tx";

export default function StakePage() {
  const { dataMode, connected, wallet } = useApp();
  const snap = useSnapshot();
  const tx = useTx();
  const [tab, setTab] = useState<"stake" | "unstake">("stake");
  const [amount, setAmount] = useState("1000");

  const v = snap.stakingVault;
  const hasStake = v.stakedOf > 0n;
  const amountWei = parseUnits18(amount);

  // Protection the connected wallet posted itself and can release on unstake
  // (skip cards under a live raid — their protection is committed until it clears).
  const releasableCards = snap.myCards
    .filter(
      (c) =>
        c.protection > 0n &&
        c.activeRaidId === 0n &&
        c.protector.toLowerCase() === wallet.toLowerCase(),
    )
    .sort((a, b) => (a.protection < b.protection ? -1 : 1)); // release smallest first
  const releasableProtection = releasableCards.reduce((s, c) => s + c.protection, 0n);
  // Everything else locked (active forges + any live-raid stake) can't be freed here.
  const forgeLocked = v.lockedOf > releasableProtection ? v.lockedOf - releasableProtection : 0n;

  // Approval state is always visible: current vault allowance.
  const allowanceQ = useReadContract({
    address: addressOf("cardsToken"),
    abi: cardsTokenAbi,
    functionName: "allowance",
    args: [wallet, addressOf("stakingVault")],
    query: { enabled: connected, refetchInterval: 12_000 },
  });
  const allowance = (allowanceQ.data as bigint | undefined) ?? 0n;

  const vaultAbi = stakingVaultAbi as unknown as Abi;

  const submitStakeOrUnstake = () => {
    if (amountWei === null || amountWei <= 0n) return;
    if (tab === "stake") {
      const steps: TxStep[] = [];
      if (allowance < amountWei) steps.push(approveStep("stakingVault", amountWei));
      steps.push({
        label: `Stake ${formatOcards(amountWei, 2)}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "stake", args: [amountWei] },
      });
      tx.run(
        {
          title: "Stake FORGE",
          action: "StakingVault.stake(amount)",
          verb: "Staking",
          rows: [
            { label: "You stake", value: formatOcards(amountWei, 2) },
            {
              label: "Vault approval",
              value: allowance < amountWei ? `exactly ${formatOcards(amountWei, 2)}` : "already sufficient",
            },
            { label: "Earns", value: "1% of every buy's ETH, pro-rata" },
            { label: "Lock-up", value: "none — unstake free stake any time" },
          ],
        },
        steps,
      );
    } else {
      const free = v.freeStakeOf;
      const steps: TxStep[] = [];
      const exposed: bigint[] = [];

      // If unstaking dips past free stake, auto-release the wallet's own card
      // protection to cover the shortfall (smallest cards first), then unstake.
      if (amountWei > free) {
        let shortfall = amountWei - free;
        for (const c of releasableCards) {
          if (shortfall <= 0n) break;
          const take = c.protection < shortfall ? c.protection : shortfall;
          steps.push({
            label: `Unprotect card #${c.tokenId} (−${formatOcards(take, 0)})`,
            call: {
              contract: "stakingVault",
              abi: vaultAbi,
              functionName: "removeProtection",
              args: [c.tokenId, take],
            },
          });
          if (c.protection - take < protectionRequired(c.tier)) exposed.push(c.tokenId);
          shortfall -= take;
        }
      }
      steps.push({
        label: `Unstake ${formatOcards(amountWei, 2)}`,
        call: { contract: "stakingVault", abi: vaultAbi, functionName: "unstake", args: [amountWei] },
      });

      const overCap = amountWei > free + releasableProtection;
      const warnings: string[] = [];
      if (overCap) {
        warnings.push(
          "This exceeds your free stake plus releasable card protection. The remainder is locked behind active forges (or a live raid) — cancel a forge to free it.",
        );
      } else if (exposed.length > 0) {
        warnings.push(
          `To free this amount, protection is first removed from ${exposed
            .map((id) => `card #${id}`)
            .join(", ")}, leaving ${exposed.length > 1 ? "them" : "it"} open to raids until you re-protect.`,
        );
      }

      tx.run(
        {
          title: "Unstake FORGE",
          action: "StakingVault.unstake(amount)",
          verb: "Unstaking",
          rows: [
            { label: "You unstake", value: formatOcards(amountWei, 2) },
            { label: "Free stake", value: formatOcards(free, 2) },
            ...(releasableProtection > 0n
              ? [{ label: "Your card protection", value: `${formatOcards(releasableProtection, 2)} (auto-released as needed)` }]
              : []),
            { label: "Tokens return to", value: "your wallet, immediately" },
          ],
          warnings: warnings.length ? warnings : undefined,
        },
        steps,
      );
    }
  };

  const settleRewards = () =>
    tx.run(
      {
        title: "Settle staking rewards",
        action: "StakingVault.claimRewards()",
        verb: "Settling",
        rows: [
          { label: "Pending → withdrawable", value: formatEth(v.pendingRewards) },
          { label: "Then", value: "withdraw sends the ETH (pull pattern)" },
        ],
      },
      [
        {
          label: "Settle pending rewards",
          call: { contract: "stakingVault", abi: vaultAbi, functionName: "claimRewards", args: [] },
        },
      ],
    );

  const withdrawRewards = () =>
    tx.run(
      {
        title: "Withdraw staking rewards",
        action: "StakingVault.withdrawRewards()",
        verb: "Withdrawing",
        rows: [{ label: "ETH to your wallet", value: formatEth(v.claimable) }],
      },
      [
        {
          label: `Withdraw ${formatEth(v.claimable)}`,
          call: { contract: "stakingVault", abi: vaultAbi, functionName: "withdrawRewards", args: [] },
        },
      ],
    );

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle
        kicker="Stake"
        title="Stake FORGE, earn buy fees"
        lede="1% of the ETH on every buy goes to token stakers, pro-rata. Staked FORGE tokens also power forging — locked amounts keep earning the whole time."
      />

      {dataMode === "loading" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonPanel lines={5} />
          <SkeletonPanel lines={5} />
        </div>
      ) : dataMode === "error" ? (
        <ErrorState />
      ) : !connected ? (
        <ConnectGate>
          Connect your wallet to stake FORGE, see your free / locked split, and withdraw your
          share of buy fees.
        </ConnectGate>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* ------------------------------------------ position */}
          <div className="space-y-4">
            <Panel className="p-6">
              <h2 className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
                Your position
              </h2>
              {!hasStake ? (
                <EmptyState
                  title="Nothing staked yet"
                  body="Stake FORGE to start earning a share of every buy. You can unstake the free portion any time."
                />
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-6">
                    <Stat
                      label="Total staked"
                      value={formatOcards(v.stakedOf, 0)}
                      source="StakingVault.stakedOf(wallet)"
                    />
                    <Stat
                      label="Pool share"
                      value={percentOf(v.stakedOf, v.totalStaked)}
                      sub={`of ${formatOcards(v.totalStaked, 0)} staked`}
                      source="stakedOf(wallet) / StakingVault.totalStaked()"
                    />
                  </dl>
                  {/* free vs locked split */}
                  <div className="mt-6">
                    <div className="flex h-2 overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full bg-accent/80"
                        style={{
                          width: `${Number((v.freeStakeOf * 100n) / v.stakedOf)}%`,
                        }}
                      />
                      <div className="h-full flex-1 bg-tier3/60" />
                    </div>
                    <div className="mt-2 flex justify-between text-xs">
                      <span className="text-muted" data-source="StakingVault.freeStakeOf(wallet)">
                        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent/80" />
                        Free {formatOcards(v.freeStakeOf, 0)}
                      </span>
                      <span className="text-muted" data-source="StakingVault.lockedOf(wallet)">
                        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-tier3/60" />
                        Locked {formatOcards(v.lockedOf, 0)}
                      </span>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-faint">
                      Locked tokens back your{" "}
                      <Link href="/cards" className="underline hover:text-muted">
                        active forges
                      </Link>
                      . They still earn rewards and return to you at claim, cancel, or sweep —
                      tokens are never spent.
                    </p>
                  </div>
                </>
              )}
            </Panel>

            {/* ------------------------------------------ rewards */}
            <Panel className="p-6">
              <h2 className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-faint">
                Staking rewards — earned from buy fees
              </h2>
              <dl className="grid grid-cols-2 gap-6">
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
              <div className="mt-5 flex gap-2">
                <Button
                  variant="ghost"
                  disabled={v.pendingRewards === 0n}
                  onClick={settleRewards}
                >
                  Settle rewards
                </Button>
                <Button
                  disabled={v.claimable === 0n}
                  onClick={withdrawRewards}
                >
                  Withdraw staking rewards
                </Button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-faint">
                Two steps by design (pull pattern): settling moves accrued fees into your
                withdrawable balance; withdrawing sends the ETH.
              </p>
            </Panel>
          </div>

          {/* ------------------------------------------ stake/unstake form */}
          <Panel className="h-fit p-6">
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
              {(["stake", "unstake"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-lg py-2 text-sm font-semibold capitalize ${
                    tab === t ? "bg-ink text-bg" : "text-muted hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <label className="block rounded-2xl border border-line bg-bg p-4">
              <span className="flex items-baseline justify-between text-xs text-faint">
                <span>Amount</span>
                <span
                  data-source={
                    tab === "stake" ? "CardsToken.balanceOf(wallet)" : "StakingVault.freeStakeOf(wallet)"
                  }
                >
                  {tab === "stake"
                    ? `Wallet: ${formatOcards(snap.cardsToken.balanceOf)}`
                    : `Free: ${formatOcards(v.freeStakeOf, 0)}`}
                </span>
              </span>
              <span className="mt-1 flex items-center gap-3">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  className="w-full bg-transparent text-2xl font-semibold tabular-nums text-ink outline-none"
                  aria-label="Amount"
                />
                <span className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-sm font-semibold text-ink">
                  FORGE
                </span>
              </span>
            </label>

            {tab === "unstake" && (releasableProtection > 0n || forgeLocked > 0n) && (
              <div className="mt-3 space-y-2">
                {releasableProtection > 0n && (
                  <p className="rounded-xl border border-line bg-raised/60 px-3 py-2 text-xs leading-relaxed text-muted">
                    {formatOcards(releasableProtection, 0)} is protecting your cards. You can still
                    unstake it — the app releases the protection first (you&apos;ll see which cards it
                    exposes), leaving those cards raidable until you re-protect.
                  </p>
                )}
                {forgeLocked > 0n && (
                  <p className="rounded-xl border border-warn/25 bg-warn/5 px-3 py-2 text-xs leading-relaxed text-warn">
                    {formatOcards(forgeLocked, 0)} is locked behind active forges or a live raid and
                    can&apos;t be unstaked until they finish (or you cancel a forge).
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 rounded-2xl bg-raised/60 px-4 py-2">
              <Row
                label="Earns from"
                value="1% of every buy's ETH"
                source="MintHook → StakingVault.depositRewards()"
              />
              <Row label="Lock-up" value="None for free stake" />
              {tab === "stake" && (
                <Row
                  label="Current vault approval"
                  value={formatOcards(allowance, 2)}
                  source="CardsToken.allowance(wallet, StakingVault) — approvals are always exact-amount"
                />
              )}
              <Row
                label="Also unlocks"
                value={<Link href="/forge" className="underline hover:text-accent">Forging →</Link>}
              />
            </div>

            <Button
              className="mt-5 w-full"
              disabled={amountWei === null || amountWei <= 0n}
              onClick={submitStakeOrUnstake}
            >
              {tab === "stake" ? "Stake FORGE" : "Unstake free FORGE"}
            </Button>
          </Panel>
        </div>
      )}
    </div>
  );
}
