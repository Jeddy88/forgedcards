"use client";

/**
 * Liquidity tab (inside the Trade panel): add liquidity to the ETH/FORGE pool
 * across a preset price range, and remove your existing positions. Uses the real
 * Uniswap PositionManager (each add mints a position NFT you own). All math is
 * unit-tested (lib/chain/liquidity), the encoding is grounded in the installed
 * Actions library (lib/chain/positions), and every tx simulates before signing.
 */
import Link from "next/link";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBalance, usePublicClient, useReadContract } from "wagmi";
import { Button, ConnectGate, Row } from "@/components/ui";
import { useApp, useSnapshot } from "@/lib/live";
import { useTx } from "@/lib/tx";
import { formatEth, formatOcards, parseUnits18 } from "@/lib/format";
import { addressOf, permit2Address, positionManagerAddress } from "@/lib/contracts/config";
import { cardsTokenAbi } from "@/lib/contracts/abis";
import { canonicalPoolKey } from "@/lib/chain/swap";
import { readSqrtPriceX96 } from "@/lib/chain/quote";
import {
  RANGE_PRESETS,
  amountsFromOneSide,
  getSqrtRatioAtTick,
  singleSidedTicks,
  ticksForPreset,
  tickFromSqrtPrice,
} from "@/lib/chain/liquidity";
import {
  buildAddLiquiditySteps,
  buildRemoveLiquiditySteps,
  fetchUserPoolPositions,
  permit2Abi,
  type PoolPosition,
} from "@/lib/chain/positions";

const pad = (x: bigint) => x + x / 100n + 1n; // +1% slippage cap (add)
const floorSlip = (x: bigint) => x - x / 100n; // −1% min (remove)
const WAD = 10n ** 18n;

/** 18-dec bigint → plain decimal string (NO separators) for an input's value. */
function plain(x: bigint, dec = 8): string {
  const neg = x < 0n;
  const a = neg ? -x : x;
  const frac = (a % WAD).toString().padStart(18, "0").slice(0, dec).replace(/0+$/, "");
  return `${neg ? "-" : ""}${(a / WAD).toString()}${frac ? "." + frac : ""}`;
}

export default function LiquidityPanel() {
  const { connected, wallet } = useApp();
  const snap = useSnapshot();
  const client = usePublicClient();
  const tx = useTx();

  const [tab, setTab] = useState<"add" | "positions">("add");
  const [presetKey, setPresetKey] = useState<string>("wide");
  const [ethIn, setEthIn] = useState("");
  const [ocardsIn, setOcardsIn] = useState("");
  // Which field the user is driving; the other is auto-derived from the range.
  const [lastEdited, setLastEdited] = useState<"eth" | "ocards">("eth");

  const poolKey = canonicalPoolKey();
  const preset = RANGE_PRESETS.find((p) => p.key === presetKey) ?? RANGE_PRESETS[0];

  // Live pool price (drives range ticks + amount preview).
  const sqrtQ = useQuery({
    queryKey: ["lpSqrt"],
    queryFn: () => readSqrtPriceX96(client!),
    enabled: !!client,
    refetchInterval: 15_000,
  });
  const sqrtP = sqrtQ.data ?? 0n;

  const ethBalQ = useBalance({ address: connected ? wallet : undefined, query: { enabled: connected } });
  const ethBal = ethBalQ.data?.value ?? 0n;
  const ocardsBal = snap.cardsToken.balanceOf;

  // Approval state (FORGE is pulled through Permit2).
  const erc20AllowQ = useReadContract({
    address: addressOf("cardsToken"),
    abi: cardsTokenAbi,
    functionName: "allowance",
    args: [wallet, permit2Address],
    query: { enabled: connected },
  });
  const permit2AllowQ = useReadContract({
    address: permit2Address,
    abi: permit2Abi,
    functionName: "allowance",
    args: [wallet, addressOf("cardsToken"), positionManagerAddress],
    query: { enabled: connected },
  });

  // Drive from the field the user last edited; derive the OTHER side from the
  // range + current price (the standard "enter one, see the pair" LP UX).
  const driver = lastEdited === "eth" ? "amount0" : "amount1";
  const driverAmount = parseUnits18(lastEdited === "eth" ? ethIn : ocardsIn) ?? 0n;
  const currentTick = sqrtP > 0n ? tickFromSqrtPrice(sqrtP) : 0;

  // Range ticks. One-sided ranges sit entirely on the side of the token you
  // enter (ETH → above market; FORGE → below market), so they take a single token.
  const ticks =
    sqrtP === 0n
      ? { tickLower: 0, tickUpper: 0 }
      : preset.oneSided
        ? singleSidedTicks(currentTick, driver)
        : ticksForPreset(preset, sqrtP);
  const preview = useMemo(() => {
    if (sqrtP === 0n) return null;
    return amountsFromOneSide(
      sqrtP,
      getSqrtRatioAtTick(ticks.tickLower),
      getSqrtRatioAtTick(ticks.tickUpper),
      driver,
      driverAmount,
    );
  }, [sqrtP, ticks.tickLower, ticks.tickUpper, driver, driverAmount]);

  // The driven field shows the user's text; the other shows the derived amount
  // (plain decimal, no separators, so it re-parses if the user edits it).
  const ethDisplay = lastEdited === "eth" ? ethIn : preview ? plain(preview.amount0) : "";
  const ocardsDisplay = lastEdited === "ocards" ? ocardsIn : preview ? plain(preview.amount1) : "";

  const overBalance =
    !!preview && (preview.amount0 > ethBal || preview.amount1 > ocardsBal);

  const addLiquidity = () => {
    if (!preview) return;
    const steps = buildAddLiquiditySteps({
      poolKey,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
      liquidity: preview.liquidity,
      amount0Max: pad(preview.amount0),
      amount1Max: pad(preview.amount1),
      recipient: wallet,
      erc20ToPermit2Allowance: (erc20AllowQ.data as bigint | undefined) ?? 0n,
      permit2ToPosmAllowance: ((permit2AllowQ.data as readonly bigint[] | undefined)?.[0]) ?? 0n,
    });
    tx.run(
      {
        title: "Add liquidity",
        action: "PositionManager.modifyLiquidities(MINT_POSITION + SETTLE_PAIR + SWEEP)",
        verb: "Adding liquidity",
        rows: [
          { label: "Price range", value: preset.label },
          { label: "Deposits", value: `${formatEth(preview.amount0, 6)} + ${formatOcards(preview.amount1, 2)}` },
          { label: "Position", value: "a new Uniswap NFT you own (removable anytime)" },
        ],
      },
      steps,
      () => {
        setEthIn("");
        setOcardsIn("");
      },
    );
  };

  // Your positions in this pool.
  const posQ = useQuery({
    queryKey: ["lpPositions", wallet],
    queryFn: () => fetchUserPoolPositions(client!, wallet),
    enabled: connected && !!client,
    refetchInterval: 30_000,
  });
  const positions = posQ.data ?? [];

  const removePosition = (p: PoolPosition) => {
    const steps = buildRemoveLiquiditySteps({
      poolKey,
      tokenId: p.tokenId,
      amount0Min: floorSlip(p.amount0),
      amount1Min: floorSlip(p.amount1),
      recipient: wallet,
    });
    tx.run(
      {
        title: `Remove liquidity — position #${p.tokenId}`,
        action: "PositionManager.modifyLiquidities(BURN_POSITION + TAKE_PAIR)",
        verb: "Removing liquidity",
        rows: [
          { label: "Returns (approx.)", value: `${formatEth(p.amount0, 6)} + ${formatOcards(p.amount1, 2)}` },
          { label: "Plus", value: "any LP fees the position earned" },
        ],
      },
      steps,
    );
  };

  if (!connected) {
    return <ConnectGate>Connect your wallet to add or remove liquidity.</ConnectGate>;
  }

  return (
    <div>
      {/* add / positions sub-toggle */}
      <div className="mb-4 flex gap-4 border-b border-line text-sm">
        {(["add", "positions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-1 pb-2 font-semibold capitalize transition-colors ${
              tab === t ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t === "add" ? "Add" : `Your positions${positions.length ? ` (${positions.length})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "add" ? (
        <div className="space-y-4">
          {/* range presets */}
          <div>
            <p className="mb-1.5 text-xs text-faint">Price range</p>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPresetKey(p.key)}
                  className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                    presetKey === p.key ? "bg-ink text-bg" : "text-muted hover:text-ink"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* amount inputs — edit either one; the other auto-derives. The
              field you're NOT editing shows a subtle "auto" tag. */}
          {[
            {
              sym: "ETH",
              value: ethDisplay,
              bal: ethBal,
              fmt: formatEth,
              driven: lastEdited === "eth",
              onChange: (v: string) => {
                setEthIn(v);
                setLastEdited("eth");
              },
            },
            {
              sym: "FORGE",
              value: ocardsDisplay,
              bal: ocardsBal,
              fmt: formatOcards,
              driven: lastEdited === "ocards",
              onChange: (v: string) => {
                setOcardsIn(v);
                setLastEdited("ocards");
              },
            },
          ].map((f) => (
            <label key={f.sym} className="block rounded-2xl border border-line bg-bg p-4">
              <span className="flex items-baseline justify-between text-xs text-faint">
                <span>Deposit {f.sym}{!f.driven && f.value ? " · auto" : ""}</span>
                <span>Balance: {f.fmt(f.bal, 4)}</span>
              </span>
              <span className="mt-1 flex items-center gap-3">
                <input
                  value={f.value}
                  onChange={(e) => f.onChange(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.0"
                  className="w-full bg-transparent text-xl font-semibold tabular-nums text-ink outline-none placeholder:text-faint"
                  aria-label={`Deposit ${f.sym}`}
                />
                <span className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-sm font-semibold text-ink">
                  {f.sym}
                </span>
              </span>
            </label>
          ))}

          {/* preview */}
          {preview && (
            <div className="rounded-2xl bg-raised/60 px-4 py-2">
              <Row
                label="You deposit"
                value={
                  preview.amount0 > 0n && preview.amount1 > 0n
                    ? `${formatEth(preview.amount0, 6)} + ${formatOcards(preview.amount1, 2)}`
                    : preview.amount1 === 0n
                      ? formatEth(preview.amount0, 6)
                      : formatOcards(preview.amount1, 2)
                }
              />
              <Row label="Range" value={preset.label} source="ticks from current price (getSqrtRatioAtTick)" />
            </div>
          )}

          {preset.oneSided ? (
            <p className="text-xs leading-relaxed text-faint">
              <span className="font-semibold text-ink">One-sided</span> — deposit a single token:
              enter <span className="font-semibold text-ink">ETH</span> for an above-market range, or{" "}
              <span className="font-semibold text-ink">FORGE</span> for a below-market range. It earns
              the 0.3% swap fee once the price reaches your range, and mints a position NFT you can
              remove anytime.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-faint">
              Enter either amount — the other is derived from your range. Adding liquidity earns a
              share of the 0.3% swap fee and mints a position NFT you can remove anytime. It does{" "}
              <span className="font-semibold text-ink">not</span> mint cards.
            </p>
          )}

          {overBalance && (
            <p className="rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
              That needs more than your balance — lower an amount.
            </p>
          )}

          <Button className="w-full" disabled={!preview || overBalance} onClick={addLiquidity}>
            {preview ? "Add liquidity" : "Enter an amount"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {posQ.isPending ? (
            <p className="py-6 text-center text-sm text-faint">Loading your positions…</p>
          ) : positions.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-sm text-faint">
              You have no liquidity positions in this pool yet. Add some from the{" "}
              <button onClick={() => setTab("add")} className="text-accent underline hover:text-ink">
                Add
              </button>{" "}
              tab.
            </p>
          ) : (
            positions.map((p) => {
              const inRange = currentTick >= p.tickLower && currentTick < p.tickUpper;
              return (
                <div key={p.tokenId.toString()} className="rounded-2xl border border-line bg-bg p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      Position #{p.tokenId.toString()}
                    </span>
                    <span className={`text-[11px] font-semibold ${inRange ? "text-tier1" : "text-faint"}`}>
                      {inRange ? "● in range" : "○ out of range"}
                    </span>
                  </div>
                  <div className="rounded-xl bg-raised/60 px-3 py-1.5">
                    <Row label="ETH" value={formatEth(p.amount0, 6)} />
                    <Row label="FORGE" value={formatOcards(p.amount1, 2)} />
                  </div>
                  <Button variant="ghost" className="mt-3 w-full" onClick={() => removePosition(p)}>
                    Remove (return tokens + fees)
                  </Button>
                </div>
              );
            })
          )}
          <p className="text-center text-[11px] text-faint">
            Removing burns the position NFT and returns its ETH + FORGE (plus earned fees) to your
            wallet. Your locked launch liquidity isn&apos;t shown here — it lives in the UNCX lock.
          </p>
          <p className="text-center text-[11px] text-faint">
            <Link href="/docs#launch-curve" className="text-muted underline hover:text-ink">
              How the pool works
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
