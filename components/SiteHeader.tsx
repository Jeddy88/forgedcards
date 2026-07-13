"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState } from "react";
import Logo from "./Logo";
import { useApp } from "@/lib/live";
import { shortAddress } from "@/lib/format";
import { chain } from "@/lib/wagmi";

const NAV = [
  { href: "/trade", label: "Trade" },
  { href: "/stake", label: "Stake" },
  { href: "/forge", label: "Forge" },
  { href: "/raid", label: "Raid" },
  { href: "/cards", label: "My Cards" },
  { href: "/rewards", label: "Rewards" },
  { href: "/sweep", label: "Sweep" },
  { href: "/docs", label: "Docs" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const { connected, connect, disconnect, wallet, wrongNetwork, switchToPinned, hasInjected } =
    useApp();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-brand" aria-label="Forged Cards — home">
          <Logo variant="mark" size={22} />
          <span className="font-script text-xl leading-none">Forged Cards</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active ? "bg-raised font-semibold text-brand" : "text-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {connected && wrongNetwork && (
            <button
              onClick={switchToPinned}
              className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/20"
              title={`Your wallet is on the wrong network. This app only transacts on ${chain.name} (chain id ${chain.id}).`}
            >
              Wrong network — switch to {chain.name}
            </button>
          )}
          {connected ? (
            <button
              onClick={() => disconnect()}
              className="group flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-accent/40"
              title="Disconnect"
            >
              <span className={`h-2 w-2 rounded-full ${wrongNetwork ? "bg-danger" : "bg-tier1"}`} />
              <span className="tabular-nums">{shortAddress(wallet)}</span>
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={!hasInjected}
              className="rounded-xl bg-ink px-3.5 py-1.5 text-sm font-semibold text-bg hover:bg-white disabled:bg-raised disabled:text-faint"
              title={hasInjected ? "Connect an injected wallet (e.g. MetaMask)" : "No browser wallet detected — read-only mode"}
            >
              Connect wallet
            </button>
          )}
          <button
            className="rounded-lg border border-line p-2 text-muted lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect y="2" width="16" height="2" rx="1" />
              <rect y="7" width="16" height="2" rx="1" />
              <rect y="12" width="16" height="2" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-line px-4 py-3 lg:hidden" aria-label="Mobile">
          <div className="grid grid-cols-2 gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm ${
                  pathname.startsWith(item.href)
                    ? "bg-raised font-semibold text-brand"
                    : "text-muted"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
