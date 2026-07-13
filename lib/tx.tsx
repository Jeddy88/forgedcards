"use client";

/**
 * Transaction runner (§14.2 transaction safety):
 *
 * - EVERY write flows through here: decoded human-readable intent (what you
 *   approve / spend / receive, maturation + claim deadline for forges) is shown
 *   and confirmed BEFORE the wallet is asked to sign — no blind signing.
 * - Each step is `simulateContract`-ed first; the signed request is the
 *   simulated one. Reverts surface as decoded custom errors (lib/chain/revert).
 * - Approvals are separate, visible steps and always EXACT-amount
 *   (`approveStep`) — this app never requests infinite approvals.
 * - Writes are pinned to the configured chain id; a wallet on any other
 *   network cannot be asked to sign.
 * - The canonical target contract address is displayed (with copy) in the
 *   dialog so users can cross-check against published addresses (phishing
 *   resistance).
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Abi, Address, TransactionReceipt } from "viem";
import { cardsTokenAbi } from "@/lib/contracts/abis";
import { addressOf, type ContractName } from "@/lib/contracts/config";
import { chain } from "@/lib/wagmi";
import { decodeRevert } from "@/lib/chain/revert";
import { formatOcards, shortAddress } from "@/lib/format";
import { useApp } from "@/lib/live";
import { Button, Panel, Row } from "@/components/ui";

/* ------------------------------------------------------------------ types */

export interface TxCall {
  /** A known app contract (resolved via addressOf) … */
  contract?: ContractName;
  /** … OR a raw target address (external contracts: PositionManager / Permit2). */
  address?: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

/** Resolve a step's target address (raw address wins; else the app contract). */
export function callTarget(call: TxCall): Address {
  if (call.address) return call.address;
  if (call.contract) return addressOf(call.contract);
  throw new Error("TxCall needs a contract or address");
}

export interface TxStep {
  /** Short human label ("Approve 500 FORGE to StakingVault"). */
  label: string;
  call: TxCall;
}

export interface TxIntent {
  /** Dialog title ("Start forging Card #12"). */
  title: string;
  /** The on-chain API being called, verbatim (the forge API: forge / stakeAndForge / etc.). */
  action: string;
  /** Present-continuous verb shown on the working button ("Staking", "Upgrading",
   *  "Claiming"). Falls back to "Working" when omitted. */
  verb?: string;
  /** Decoded intent rows: what is spent / approved / received / when. */
  rows: { label: string; value: string }[];
  /** Amber warnings (e.g. the 3-hour claim window). */
  warnings?: string[];
}

type Phase =
  | { kind: "review"; preflight?: string | null }
  | { kind: "running"; step: number; sub: "simulating" | "signing" | "pending"; hash?: `0x${string}` }
  | { kind: "success"; hashes: `0x${string}`[] }
  | { kind: "error"; step: number; message: string };

interface ActiveTx {
  intent: TxIntent;
  steps: TxStep[];
  onSuccess?: (receipts: TransactionReceipt[]) => void;
  /** Show a bottom-right success toast on confirmation. Default true; the flows
   *  that pop their OWN result modal (buy mint / forge upgrade) pass false. */
  toast: boolean;
}

interface Toast {
  id: number;
  title: string;
}

interface TxApi {
  /** Open the confirm dialog for a write flow. On success the dialog ALWAYS
   *  auto-closes (no manual "Done"); `onSuccess` receives the mined receipts,
   *  and a success toast appears unless `opts.toast === false`. */
  run: (
    intent: TxIntent,
    steps: TxStep[],
    onSuccess?: (receipts: TransactionReceipt[]) => void,
    opts?: { toast?: boolean },
  ) => void;
}

const TxContext = createContext<TxApi | null>(null);

export function useTx(): TxApi {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTx must be used inside TxProvider");
  return ctx;
}

/** Exact-amount FORGE approval step (the ONLY approval builder in the app). */
export function approveStep(spender: ContractName, amount: bigint): TxStep {
  return {
    label: `Approve exactly ${formatOcards(amount, 4)} to ${spender} (${shortAddress(addressOf(spender))})`,
    call: {
      contract: "cardsToken",
      abi: cardsTokenAbi as unknown as Abi,
      functionName: "approve",
      args: [addressOf(spender), amount],
    },
  };
}

/* --------------------------------------------------------------- provider */

export function TxProvider({ children }: { children: React.ReactNode }) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { wallet, connected, wrongNetwork } = useApp();

  const [active, setActive] = useState<ActiveTx | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "review" });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const close = useCallback(() => {
    setActive(null);
    setPhase({ kind: "review" });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((title: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, title }]);
    // Auto-dismiss after a few seconds (users can also close it manually).
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const run = useCallback(
    (
      intent: TxIntent,
      steps: TxStep[],
      onSuccess?: (receipts: TransactionReceipt[]) => void,
      opts?: { toast?: boolean },
    ) => {
      setActive({ intent, steps, onSuccess, toast: opts?.toast ?? true });
      setPhase({ kind: "review", preflight: undefined });
      // Preflight: simulate the FIRST step immediately so obvious reverts show
      // up in review (later steps may depend on earlier ones landing).
      const first = steps[0];
      simulateContract(config, {
        address: callTarget(first.call),
        abi: first.call.abi,
        functionName: first.call.functionName,
        args: first.call.args as unknown[],
        value: first.call.value,
        account: wallet,
        chainId: chain.id,
      })
        .then(() => setPhase((p) => (p.kind === "review" ? { kind: "review", preflight: null } : p)))
        .catch((err) =>
          setPhase((p) => (p.kind === "review" ? { kind: "review", preflight: decodeRevert(err) } : p)),
        );
    },
    [config, wallet],
  );

  const confirm = useCallback(async () => {
    if (!active) return;
    const receipts: TransactionReceipt[] = [];
    for (let i = 0; i < active.steps.length; i++) {
      const step = active.steps[i];
      try {
        setPhase({ kind: "running", step: i, sub: "simulating" });
        const { request } = await simulateContract(config, {
          address: callTarget(step.call),
          abi: step.call.abi,
          functionName: step.call.functionName,
          args: step.call.args as unknown[],
          value: step.call.value,
          account: wallet,
          chainId: chain.id,
        });
        setPhase({ kind: "running", step: i, sub: "signing" });
        const hash = await writeContract(config, request);
        setPhase({ kind: "running", step: i, sub: "pending", hash });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: chain.id });
        if (receipt.status !== "success") throw new Error(`transaction reverted (${hash})`);
        receipts.push(receipt);
      } catch (err) {
        setPhase({ kind: "error", step: i, message: decodeRevert(err) });
        void queryClient.invalidateQueries();
        return;
      }
    }
    void queryClient.invalidateQueries();
    // Success: ALWAYS auto-close (no manual "Done"). Flows with their own result
    // modal (buy mint / forge upgrade) pass `toast:false` and reveal via onSuccess;
    // everything else pops a bottom-right success toast.
    const done = active;
    close();
    done.onSuccess?.(receipts);
    if (done.toast) pushToast(done.intent.title);
  }, [active, config, wallet, queryClient, close, pushToast]);

  const api = useMemo(() => ({ run }), [run]);

  return (
    <TxContext.Provider value={api}>
      {children}
      {active && (
        <TxDialog
          active={active}
          phase={phase}
          canConfirm={connected && !wrongNetwork}
          wrongNetwork={wrongNetwork}
          onConfirm={confirm}
          onClose={close}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </TxContext.Provider>
  );
}

/* ------------------------------------------------------------------ toasts */

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-xs flex-col gap-2">
      <style>{`@keyframes cocToastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card"
          style={{ animation: "cocToastIn .25s ease-out" }}
        >
          <span className="mt-0.5 text-base leading-none" style={{ color: "#3ecf8e" }}>
            ✓
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Confirmed on-chain</p>
            <p className="truncate text-xs text-muted">{t.title}</p>
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="ml-1 text-faint hover:text-ink"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- dialog */

function CopyAddress({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex items-center gap-1.5 rounded-lg bg-raised px-2 py-1 text-xs tabular-nums text-muted hover:text-ink"
      title={`${address} — click to copy`}
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {shortAddress(address)}
      <span className="text-faint">{copied ? "✓ copied" : "⧉"}</span>
    </button>
  );
}

function TxDialog({
  active,
  phase,
  canConfirm,
  wrongNetwork,
  onConfirm,
  onClose,
}: {
  active: ActiveTx;
  phase: Phase;
  canConfirm: boolean;
  wrongNetwork: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { intent, steps } = active;
  const running = phase.kind === "running";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={intent.title}
    >
      <Panel className="max-h-[90vh] w-full max-w-md overflow-y-auto p-6" tone="raised">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{intent.title}</h2>
          {!running && (
            <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <p className="mb-4 text-xs text-faint">{intent.action}</p>

        {/* decoded intent */}
        <div className="rounded-2xl bg-bg/60 px-4 py-1.5">
          {intent.rows.map((r, i) => (
            <Row key={i} label={r.label} value={r.value} />
          ))}
        </div>

        {/* warnings */}
        {(intent.warnings ?? []).map((w, i) => (
          <p
            key={i}
            className="mt-3 rounded-xl border border-warn/25 bg-warn/5 px-3 py-2 text-xs leading-relaxed text-warn"
          >
            {w}
          </p>
        ))}

        {/* steps + canonical addresses */}
        <div className="mt-4 space-y-2">
          {steps.map((s, i) => {
            const state =
              phase.kind === "running" && phase.step === i
                ? phase.sub
                : phase.kind === "error" && phase.step === i
                  ? "failed"
                  : (phase.kind === "running" && phase.step > i) || phase.kind === "success"
                    ? "done"
                    : "queued";
            return (
              <div key={i} className="flex items-start justify-between gap-2 text-xs">
                <span className={state === "done" ? "text-muted line-through" : "text-ink/90"}>
                  {steps.length > 1 && <span className="mr-1 text-faint">{i + 1}.</span>}
                  {s.label}
                  <span className="ml-2 text-faint">
                    {state === "simulating" && "simulating…"}
                    {state === "signing" && "confirm in wallet…"}
                    {state === "pending" && "waiting for confirmation…"}
                    {state === "done" && "✓"}
                    {state === "failed" && "✕"}
                  </span>
                </span>
                <CopyAddress address={callTarget(s.call)} />
              </div>
            );
          })}
        </div>

        {/* preflight / errors / success */}
        {phase.kind === "review" && phase.preflight === undefined && (
          <p className="mt-4 text-xs text-faint">Simulating…</p>
        )}
        {phase.kind === "review" && typeof phase.preflight === "string" && (
          <p className="mt-4 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-danger">
            Simulation failed: {phase.preflight}
          </p>
        )}
        {phase.kind === "error" && (
          <p className="mt-4 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-danger">
            {phase.message}
          </p>
        )}
        {wrongNetwork && phase.kind === "review" && (
          <p className="mt-4 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-xs text-danger">
            Wrong network — switch your wallet to {chain.name} (chain id {chain.id}) first.
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={running} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!canConfirm || running || (phase.kind === "review" && typeof phase.preflight === "string")}
            onClick={onConfirm}
          >
            {phase.kind === "error" ? "Retry" : running ? `${intent.verb ?? "Working"}…` : "Confirm"}
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Verify the contract address in your wallet matches the address shown above before
          signing.
        </p>
      </Panel>
    </div>
  );
}
