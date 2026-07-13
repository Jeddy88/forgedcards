"use client";

/** Small shared primitives of the design system (see DESIGN.md). */

import React from "react";
import { useApp } from "@/lib/live";

export function PageTitle({
  kicker,
  title,
  lede,
}: {
  kicker?: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="mb-10">
      {kicker && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-muted">
          {kicker}
        </p>
      )}
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {lede && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{lede}</p>}
    </header>
  );
}

export function Panel({
  children,
  className = "",
  tone = "default",
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  tone?: "default" | "raised";
}) {
  return (
    <div
      className={`rounded-2xl border border-line ${
        tone === "raised" ? "bg-raised" : "bg-surface"
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  source,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** The view function this number comes from — kept in the DOM as a data
   *  attribute so designers/devs can trace every figure. */
  source: string;
}) {
  return (
    <div data-source={source} title={source} className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
        {label}
      </dt>
      <dd className="mt-1.5 truncate text-xl font-semibold tabular-nums text-ink">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
    </div>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "quiet";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const styles: Record<BtnVariant, string> = {
    primary:
      "bg-ink text-bg hover:bg-white disabled:bg-raised disabled:text-faint",
    ghost:
      "border border-line bg-transparent text-ink hover:border-accent/50 hover:bg-raised disabled:text-faint disabled:hover:bg-transparent",
    danger:
      "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-40",
    quiet: "text-muted hover:text-ink disabled:text-faint",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-raised ${className}`} />;
}

/** Loading placeholder for a whole panel/section. */
export function SkeletonPanel({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <Panel className={`space-y-3 p-6 ${className}`}>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i % 2 ? "w-2/3" : "w-5/6"}`} />
      ))}
    </Panel>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <ChainDots />
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </Panel>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { refetch } = useApp();
  return (
    <Panel className="flex flex-col items-center gap-3 border-danger/30 px-6 py-14 text-center">
      <span className="text-2xl text-danger">⚠</span>
      <h3 className="text-lg font-semibold text-ink">Couldn&apos;t reach the chain</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        The RPC request failed. Your funds and cards are unaffected — this page only reads
        on-chain state. Retry, or check your connection.
      </p>
      <Button variant="ghost" onClick={() => (onRetry ? onRetry() : refetch())}>
        Retry
      </Button>
    </Panel>
  );
}

/** Wallet-disconnected gate for wallet-scoped sections. */
export function ConnectGate({ children }: { children?: React.ReactNode }) {
  const { connect, hasInjected } = useApp();
  return (
    <Panel className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <ChainDots />
      <h3 className="text-lg font-semibold text-ink">Connect a wallet</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        {children ?? "Connect your wallet to see your cards, stake, and rewards."}
      </p>
      <Button onClick={connect} disabled={!hasInjected}>
        Connect wallet
      </Button>
      {!hasInjected && (
        <p className="text-[11px] text-faint">
          No browser wallet detected — install MetaMask (or any injected wallet) to
          transact. Everything on this page stays readable without one.
        </p>
      )}
    </Panel>
  );
}

/** Tiny decorative three-link chain, echoing the monogram. */
function ChainDots() {
  return (
    <svg viewBox="0 0 76 28" width="57" height="21" fill="none" stroke="currentColor" className="text-faint">
      <circle cx="14" cy="14" r="10" strokeWidth="3" />
      <circle cx="38" cy="14" r="10" strokeWidth="3" />
      <circle cx="62" cy="14" r="10" strokeWidth="3" />
    </svg>
  );
}

/** Inline label -> value row used in preview/fee breakdowns. */
export function Row({
  label,
  value,
  source,
  strong,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  source?: string;
  strong?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 py-1.5 text-sm"
      data-source={source}
      title={source}
    >
      <span className="text-muted">{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold text-ink" : "text-ink/90"}`}>
        {value}
      </span>
    </div>
  );
}
