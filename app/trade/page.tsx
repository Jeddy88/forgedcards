"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBalance, usePublicClient, useReadContract } from "wagmi";
import { formatUnits, parseEventLogs, zeroAddress, type Abi, type TransactionReceipt } from "viem";
import { Button, ErrorState, PageTitle, Panel, SkeletonPanel } from "@/components/ui";
import LaunchCurve from "@/components/LaunchCurve";
import { MintRevealModal } from "@/components/CardRevealModal";
import LiquidityPanel from "@/components/LiquidityPanel";
import { useApp, useSnapshot } from "@/lib/live";
import { formatEth, formatOcards, formatUnits18, parseUnits18, shortAddress } from "@/lib/format";
import { cardsOnChainAbi, cardsTokenAbi, universalRouterAbi } from "@/lib/contracts/abis";
import { addressOf, permit2Address, sellsViaPermit2 } from "@/lib/contracts/config";
import { quoteBuy, quoteSell } from "@/lib/chain/quote";
import { buildBuySwap, buildSellSwap } from "@/lib/chain/swap";
import { permit2Abi, MAX_UINT160, MAX_UINT48 } from "@/lib/chain/positions";
import { decodeRevert } from "@/lib/chain/revert";
import { approveStep, useTx, type TxStep } from "@/lib/tx";

const WAD = 10n ** 18n;
const SLIPPAGE_PRESETS = [50n, 100n, 300n] as const; // bps
// Kept back from a "Max" BUY so the wallet can still pay gas (the swap itself
// refunds any unfilled ETH, but gas is paid on top and would fail at full balance).
const ETH_GAS_RESERVE = 3_000_000_000_000_000n; // ~0.003 ETH

/**
 * Token ids minted to `wallet` in this buy, read from the receipt's ERC-721
 * Transfer(from=0x0 → wallet) logs on the CardsOnChain contract. (The FORGE
 * ERC-20 Transfer has an un-indexed value, so it doesn't decode as this event.)
 */
function mintedIdsFromReceipts(
  receipts: TransactionReceipt[],
  cardsAddress: string,
  wallet: string,
): bigint[] {
  const cards = cardsAddress.toLowerCase();
  const to = wallet.toLowerCase();
  const ids: bigint[] = [];
  for (const r of receipts) {
    const logs = parseEventLogs({ abi: cardsOnChainAbi, eventName: "Transfer", logs: r.logs });
    for (const log of logs) {
      const a = log.args as { from: `0x${string}`; to: `0x${string}`; tokenId: bigint };
      if (
        log.address.toLowerCase() === cards &&
        a.from.toLowerCase() === zeroAddress &&
        a.to.toLowerCase() === to
      ) {
        ids.push(a.tokenId);
      }
    }
  }
  return ids;
}

/** Debounce a string value (quote requests). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function TradePage() {
  const { dataMode, connected, connect, wallet, hasInjected } = useApp();
  const snap = useSnapshot();
  const publicClient = usePublicClient();
  const tx = useTx();
  const [side, setSide] = useState<"buy" | "sell" | "liquidity">("buy");
  const [input, setInput] = useState("0.25");
  const [slippageBps, setSlippageBps] = useState<bigint>(100n);
  const [mintReveal, setMintReveal] = useState<bigint[] | null>(null); // cards minted by the last buy

  const amountIn = parseUnits18(input);
  const debouncedAmount = useDebounced(amountIn, 350);
  const preLaunch = !snap.mintHook.tradingEnabled; // MintHook.tradingEnabled()

  // Native ETH balance (for the buy-side "Max"; the snapshot only tracks FORGE).
  const ethBalanceQ = useBalance({
    address: connected ? wallet : undefined,
    query: { enabled: connected, refetchInterval: 12_000 },
  });
  const ethBalance = ethBalanceQ.data?.value ?? 0n;
  const ocardsBalance = snap.cardsToken.balanceOf;

  // The most this side can put in: full FORGE balance for a sell; ETH balance
  // minus a small gas reserve for a buy. 0n → nothing to max (hides the button).
  const maxIn =
    side === "sell"
      ? ocardsBalance
      : ethBalance > ETH_GAS_RESERVE
        ? ethBalance - ETH_GAS_RESERVE
        : 0n;

  // formatUnits (viem) prints a plain decimal with NO separators, so the result
  // round-trips back through parseUnits18 (formatUnits18 adds commas → rejected).
  const fillMax = () => setInput(formatUnits(maxIn, 18));

  // Live curve position: current price (FORGE/ETH) → ETH per card (per 1,000
  // FORGE), and cards minted so far. Fed to LaunchCurve to draw the live marker.
  const ocardsPerEth = snap.curve.ocardsPerEth;
  const livePerCardEth = ocardsPerEth > 0n ? 1000 / Number(ocardsPerEth) : undefined;
  const cardsMinted = Number(snap.cardsOnChain.totalSupply);

  // Live quote = eth_call SIMULATION of the exact router call the button sends
  // (state overrides stand in for balance/allowance; see lib/chain/quote.ts).
  const quoteQ = useQuery({
    queryKey: [
      "swapQuote",
      side,
      debouncedAmount?.toString() ?? "",
      slippageBps.toString(),
      connected ? wallet : "readonly",
    ],
    queryFn: async () => {
      const account = connected ? wallet : undefined;
      return side === "buy"
        ? quoteBuy(publicClient!, debouncedAmount!, slippageBps, account)
        : quoteSell(publicClient!, debouncedAmount!, slippageBps, account);
    },
    enabled:
      side !== "liquidity" &&
      !!publicClient &&
      !preLaunch &&
      debouncedAmount !== null &&
      debouncedAmount > 0n,
    refetchInterval: 15_000,
    retry: 0,
  });

  // Sell approvals. The real UniversalRouter pulls FORGE through Permit2 (two
  // allowances: FORGE→Permit2, then Permit2→router); the local stand-in pulls
  // with a plain transferFrom (one allowance: FORGE→router).
  const erc20AllowQ = useReadContract({
    address: addressOf("cardsToken"),
    abi: cardsTokenAbi,
    functionName: "allowance",
    args: [wallet, sellsViaPermit2 ? permit2Address : addressOf("swapRouter")],
    query: { enabled: connected && side === "sell", refetchInterval: 12_000 },
  });
  const permit2AllowQ = useReadContract({
    address: permit2Address,
    abi: permit2Abi,
    functionName: "allowance",
    args: [wallet, addressOf("cardsToken"), addressOf("swapRouter")],
    query: { enabled: connected && side === "sell" && sellsViaPermit2, refetchInterval: 12_000 },
  });

  const quote = useMemo(() => {
    const q = quoteQ.data;
    if (!q || amountIn === null || amountIn !== debouncedAmount) return null;
    if (side === "buy") {
      const tokensOut = q.amount1; // FORGE credited to the swapper
      const spent = q.amount0 < 0n ? -q.amount0 : 0n; // ETH the swap consumes (= amountIn, exact-in)
      const hookFee = spent / 100n; // MintHook FEE_DIVISOR: 1% of the ETH swapped
      const lpFee = ((spent - hookFee) * 3n) / 1000n; // 0.3% LP tier (estimate)
      let mints = tokensOut / (1000n * WAD); // MintHook.TOKENS_PER_MINT
      if (mints > snap.cardsOnChain.remainingMintable) mints = snap.cardsOnChain.remainingMintable;
      return {
        out: tokensOut,
        spent,
        hookFee,
        lpFee,
        mints,
        minOut: q.minAmountOut,
        impactBps: q.priceImpactBps,
      };
    }
    const ethOutNet = q.amount0; // net ETH to the swapper (hook fee already applied)
    const hookFee = ethOutNet / 99n; // 1% of the pool ETH leg (estimate from net)
    const lpFee = (((ethOutNet + hookFee) * 100n) / 99n / 997n) * 3n; // estimate
    return {
      out: ethOutNet,
      spent: amountIn,
      hookFee,
      lpFee,
      mints: 0n,
      minOut: q.minAmountOut,
      impactBps: 0n,
    };
  }, [quoteQ.data, amountIn, debouncedAmount, side, snap.cardsOnChain.remainingMintable]);

  const quoteError = quoteQ.isError ? decodeRevert(quoteQ.error) : null;

  const submit = () => {
    if (!quote || amountIn === null || amountIn <= 0n) return;
    if (side === "buy") {
      // buildBuySwap hardcodes hookData = abi.encode(wallet) — the explicit
      // recipient of the minted cards, for exact attribution (the contract
      // would otherwise fall back to tx.origin, the wrong holder for
      // smart-contract-wallet users). This is the ONLY buy path in the app.
      // Slippage protection = minimum-received: the UniversalRouter fills the
      // whole buy within tolerance or reverts (nothing is spent but gas).
      const call = buildBuySwap(amountIn, wallet, quote.minOut);
      const buyWarnings: string[] = [];
      if (quote.mints === 0n) {
        buyWarnings.push("This buy is under 1,000 FORGE — it mints NO card, you only receive tokens.");
      }
      tx.run(
        {
          title: "Buy FORGE & mint cards",
          action: "UniversalRouter.execute(V4_SWAP: exact-in buy + abi.encode(recipient))",
          verb: "Buying",
          rows: [
            { label: "You pay", value: formatEth(amountIn, 6) },
            { label: "You receive (est.)", value: formatOcards(quote.out, 2) },
            { label: "Minimum received (or the tx reverts)", value: formatOcards(quote.minOut, 2) },
            { label: `Cards minted to ${shortAddress(wallet)}`, value: quote.mints.toString() },
            { label: "Price impact (curve walk-up)", value: `~${(Number(quote.impactBps) / 100).toFixed(2)}%` },
            { label: "1% buy fee → token stakers", value: formatEth(quote.hookFee, 6) },
            { label: "0.3% LP fee (est.)", value: formatEth(quote.lpFee, 6) },
            { label: "Max slippage", value: `${Number(slippageBps) / 100}% under the quoted fill` },
          ],
          warnings: buyWarnings.length > 0 ? buyWarnings : undefined,
        },
        [
          {
            label: `Swap ${formatEth(amountIn, 6)} → FORGE (mints ${quote.mints.toString()} card${quote.mints === 1n ? "" : "s"})`,
            call: {
              contract: "swapRouter",
              abi: universalRouterAbi as unknown as Abi,
              functionName: "execute",
              args: call.args as unknown as readonly unknown[],
              value: call.value,
            },
          },
        ],
        // On confirm, reveal the freshly minted cards (read from the receipt logs).
        (receipts) => {
          const ids = mintedIdsFromReceipts(receipts, addressOf("cardsOnChain"), wallet);
          if (ids.length > 0) setMintReveal(ids);
        },
        // Suppress the toast when a card reveal will show; a sub-1,000-FORGE buy
        // (no card) has no reveal, so it gets the normal success toast instead.
        { toast: quote.mints === 0n },
      );
    } else {
      const call = buildSellSwap(amountIn, quote.minOut);
      const erc20Allowance = (erc20AllowQ.data as bigint | undefined) ?? 0n;
      const permit2Allowance = ((permit2AllowQ.data as readonly bigint[] | undefined)?.[0]) ?? 0n;
      const steps: TxStep[] = [];
      if (sellsViaPermit2) {
        // The UniversalRouter pulls FORGE through Permit2 — same two-allowance
        // dance as the Liquidity tab's PositionManager flow.
        if (erc20Allowance < amountIn) {
          steps.push({
            label: "Approve FORGE to Permit2",
            call: {
              contract: "cardsToken",
              abi: cardsTokenAbi as unknown as Abi,
              functionName: "approve",
              args: [permit2Address, MAX_UINT160],
            },
          });
        }
        if (permit2Allowance < amountIn) {
          steps.push({
            label: "Permit2: allow the UniversalRouter to use FORGE",
            call: {
              address: permit2Address,
              abi: permit2Abi as unknown as Abi,
              functionName: "approve",
              args: [addressOf("cardsToken"), addressOf("swapRouter"), MAX_UINT160, MAX_UINT48],
            },
          });
        }
      } else if (erc20Allowance < amountIn) {
        steps.push(approveStep("swapRouter", amountIn));
      }
      steps.push({
        label: `Swap ${formatOcards(amountIn, 2)} → ETH`,
        call: {
          contract: "swapRouter",
          abi: universalRouterAbi as unknown as Abi,
          functionName: "execute",
          args: call.args as unknown as readonly unknown[],
          value: 0n,
        },
      });
      tx.run(
        {
          title: "Sell FORGE",
          action: "UniversalRouter.execute(V4_SWAP: exact-in sell, hookData 0x)",
          verb: "Selling",
          rows: [
            { label: "You pay", value: formatOcards(amountIn, 2) },
            { label: "You receive (est.)", value: formatEth(quote.out, 6) },
            { label: "Minimum received (or the tx reverts)", value: formatEth(quote.minOut, 6) },
            { label: "1% sell fee → card holders (est.)", value: formatEth(quote.hookFee, 6) },
            { label: "0.3% LP fee (est.)", value: formatEth(quote.lpFee, 6) },
            {
              label: "Approvals",
              value:
                steps.length > 1
                  ? sellsViaPermit2
                    ? "via Permit2 (industry standard)"
                    : `exactly ${formatOcards(amountIn, 2)}`
                  : "already sufficient",
            },
            { label: "Max slippage", value: `${Number(slippageBps) / 100}% under the quoted fill` },
          ],
        },
        steps,
      );
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle
        kicker="Trade"
        title="ETH ⇄ FORGE"
        lede="One pool on Uniswap v4. Buying FORGE automatically mints cards to your wallet — 1 card per whole 1,000 FORGE bought, up to 2,222 — and you keep every token. It's a single ascending curve: early buyers pay the least (~0.002 ETH per card) and each buy nudges the price up, so buying big raises your own cost. Fees: 1% of every trade rewards stakers or card holders, and a 0.3% LP fee stays in the pool (locked 1 year)."
      />

      {dataMode === "loading" ? (
        <SkeletonPanel lines={6} className="p-8" />
      ) : dataMode === "error" ? (
        <ErrorState />
      ) : (
        <div className="space-y-4">
          {preLaunch && (
            <Panel className="border-warn/30 bg-warn/5 p-5" tone="raised">
              <p className="text-sm leading-relaxed text-warn" data-source="MintHook.tradingEnabled()">
                <span className="font-semibold">Pre-launch.</span> Swaps are blocked until the
                one-shot launch transaction enables trading. The first card-sized buy will cost
                about 0.002 ETH; the curve climbs from there with no price ceiling.
              </p>
            </Panel>
          )}

          {/* Trade panel (left) + launch curve (right): an equal-height two-up
              grid on large screens (stretch, not items-start). */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,25rem)_1fr]">
          <Panel className="flex h-full flex-col p-6">
            {/* direction toggle */}
            <div className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-raised p-1">
              {(["buy", "sell", "liquidity"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
                    side === s ? "bg-ink text-bg" : "text-muted hover:text-ink"
                  }`}
                >
                  {s === "buy" ? "Buy" : s === "sell" ? "Sell" : "Liquidity"}
                </button>
              ))}
            </div>

            {side === "liquidity" ? (
              <LiquidityPanel />
            ) : (
            <>
            {/* amount in */}
            <label className="block rounded-2xl border border-line bg-bg p-4">
              <span className="flex items-baseline justify-between gap-3 text-xs text-faint">
                <span>You pay</span>
                {connected && (
                  <span className="flex items-center gap-2">
                    <span
                      data-source={
                        side === "buy" ? "wallet native ETH balance" : "CardsToken.balanceOf(wallet)"
                      }
                    >
                      Balance: {side === "buy" ? formatEth(ethBalance, 4) : formatOcards(ocardsBalance)}
                    </span>
                    {maxIn > 0n && (
                      <button
                        type="button"
                        onClick={fillMax}
                        className="rounded bg-raised px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent transition-colors hover:text-ink"
                        title={
                          side === "buy"
                            ? "Fill your entire ETH balance, less a small gas reserve"
                            : "Fill your entire FORGE balance"
                        }
                      >
                        Max
                      </button>
                    )}
                  </span>
                )}
              </span>
              <span className="mt-1 flex items-center gap-3">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.0"
                  className="w-full bg-transparent text-2xl font-semibold tabular-nums text-ink outline-none placeholder:text-faint"
                  aria-label="Amount in"
                />
                <span className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-sm font-semibold text-ink">
                  {side === "buy" ? "ETH" : "FORGE"}
                </span>
              </span>
            </label>

            <div className="my-2 text-center text-faint">↓</div>

            {/* amount out */}
            <div className="rounded-2xl border border-line bg-bg p-4">
              <p className="text-xs text-faint">
                You receive (estimated
                {quoteQ.isFetching && debouncedAmount ? ", updating…" : ""})
              </p>
              <p className="mt-1 flex items-center justify-between gap-3">
                <span
                  className="text-2xl font-semibold tabular-nums text-ink"
                  data-source="eth_call simulation of PoolSwapTest.swap (BalanceDelta)"
                >
                  {quote ? formatUnits18(quote.out, side === "buy" ? 2 : 5) : "0"}
                </span>
                <span className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-sm font-semibold text-ink">
                  {side === "buy" ? "FORGE" : "ETH"}
                </span>
              </p>
            </div>

            {/* quote error (decoded) */}
            {quoteError && !preLaunch && (
              <p className="mt-3 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-danger">
                Quote failed: {quoteError}
              </p>
            )}

            {/* compact result: the headline (cards minted) + this buy's price
                impact. The full fee / minimum-received breakdown appears on confirm. */}
            {side === "buy" && quote && (
              <p
                className="mt-3 text-center text-sm text-ink"
                data-source="floor(FORGE out / 1,000), clamped to remainingMintable()"
              >
                Mints <span className="font-bold tabular-nums">{quote.mints.toString()}</span>{" "}
                card{quote.mints === 1n ? "" : "s"}
                {quote.impactBps > 0n && (
                  <span className="text-faint">
                    {" · "}~{(Number(quote.impactBps) / 100).toFixed(2)}% price impact
                  </span>
                )}
              </p>
            )}

            {/* slippage */}
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-raised/60 px-4 py-2.5">
              <span
                className="text-xs text-muted"
                title="Applied ON TOP of this trade's own curve movement: enforced on-chain as a minimum received. If the price moves more than this % worse than quoted (e.g. front-running), the whole swap reverts and you keep your funds (only gas is spent). Trades also expire after 20 minutes."
              >
                Max slippage
              </span>
              <span className="flex gap-1">
                {SLIPPAGE_PRESETS.map((bps) => (
                  <button
                    key={bps.toString()}
                    onClick={() => setSlippageBps(bps)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums ${
                      slippageBps === bps ? "bg-ink text-bg" : "bg-surface text-muted hover:text-ink"
                    }`}
                  >
                    {Number(bps) / 100}%
                  </button>
                ))}
              </span>
            </div>

            <div className="mt-auto pt-5">
              {!connected ? (
                <Button className="w-full" onClick={connect} disabled={!hasInjected}>
                  {hasInjected ? "Connect wallet to trade" : "Install a wallet to trade (read-only mode)"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={preLaunch || !quote}
                  onClick={submit}
                >
                  {preLaunch ? "Trading not enabled yet" : side === "buy" ? "Buy FORGE" : "Sell FORGE"}
                </Button>
              )}
            </div>
            </>
            )}
          </Panel>

          {/* launch price curve (right) — always visible; carries the LIVE
              progress marker and the migrated educational text below the graph. */}
          <Panel className="flex h-full flex-col p-4 sm:p-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">Launch price curve</h2>
              <span className="text-xs text-faint">first ~0.002 ETH → no ceiling</span>
            </div>
            <LaunchCurve livePerCardEth={livePerCardEth} cardsMinted={cardsMinted} />
            <p className="mt-auto pt-4 text-center text-xs text-faint">
              New to the curve?{" "}
              <Link href="/docs#launch-curve" className="text-muted underline hover:text-ink">
                Read how launch pricing works
              </Link>
              .
            </p>
          </Panel>
          </div>
        </div>
      )}

      {/* reveal minted cards after a buy confirms on-chain */}
      <MintRevealModal
        open={!!mintReveal && mintReveal.length > 0}
        ids={mintReveal ?? []}
        owner={wallet}
        onClose={() => setMintReveal(null)}
      />
    </div>
  );
}
