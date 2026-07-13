"use client";

import Link from "next/link";
import React, { useState } from "react";
import Logo from "./Logo";
import { addressOf, lpLockerAddress, ENV, type ContractName } from "@/lib/contracts/config";
import { shortAddress } from "@/lib/format";
import type { Address } from "viem";

/** Canonical contract addresses, displayed site-wide (phishing resistance §14.2). */
const CANONICAL: { name: ContractName; label: string }[] = [
  { name: "cardsToken", label: "FORGE token" },
  { name: "cardsOnChain", label: "Cards (ERC-721)" },
  { name: "stakingVault", label: "Staking vault" },
  { name: "cardYield", label: "Card yield" },
  { name: "mintHook", label: "Pool hook" },
  { name: "swapRouter", label: "Swap router" },
];

function AddressRow({ name, label, address: explicit }: { name?: ContractName; label: string; address?: Address }) {
  const [copied, setCopied] = useState(false);
  const address = explicit ?? addressOf(name!);
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-faint">{label}</span>
      <button
        className="tabular-nums text-muted hover:text-ink"
        title={`${address} — click to copy`}
        onClick={() => {
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {shortAddress(address)} {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

export default function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 text-sm text-muted sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm space-y-3">
          <div className="flex items-center gap-2.5 text-brand">
            <Logo variant="mark" size={18} />
            <span className="font-script text-lg">Forged Cards</span>
          </div>
          <p className="text-xs leading-relaxed text-faint">
            2,222 fully on-chain interactive collectible cards on Robinhood Chain. Cards mint from
            the pool, are forged into rarer tiers by staking FORGE tokens, and earn a share
            of trading fees.
          </p>
          {ENV.name === "local" && (
            <p className="text-xs text-warn/80">
              Local development build — connected to the anvil test chain (id {ENV.chainId}).
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <a
              href="https://x.com/forgedcardsv4"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs text-muted hover:text-ink"
              aria-label="Forged Cards on X (Twitter)"
            >
              {/* X logo */}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              @forgedcardsv4 — official X
            </a>
            <a
              href="https://t.me/forgedcards"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs text-muted hover:text-ink"
              aria-label="Forged Cards on Telegram"
            >
              {/* Telegram logo */}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M21.94 4.667a1.36 1.36 0 0 0-1.386-.223L3.36 11.2c-.85.334-.844 1.54.01 1.865l4.3 1.64 1.66 5.29c.203.65 1.02.86 1.514.386l2.4-2.31 4.28 3.16c.55.406 1.336.11 1.48-.558l3-14.02a1.36 1.36 0 0 0-.464-1.386zM9.9 14.32l-.28 3.95-1.19-3.79 8.71-5.48z" />
              </svg>
              @forgedcards — official Telegram
            </a>
          </div>
        </div>
        <div className="min-w-[240px] space-y-1.5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
            Canonical contracts — verify before you sign
          </p>
          {CANONICAL.map((c) => (
            <AddressRow key={c.name} {...c} />
          ))}
          {/* The LPLocker deploys in the post-deploy LOCK step, so it appears here
              once `sync:addresses` has run after `lock:lp` (null until then). */}
          {lpLockerAddress && <AddressRow label="LP locker (1-year lock)" address={lpLockerAddress} />}
        </div>
        <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm" aria-label="Footer">
          {[
            ["/trade", "Trade"],
            ["/stake", "Stake"],
            ["/forge", "Forge"],
            ["/raid", "Raid board"],
            ["/cards", "My Cards"],
            ["/rewards", "Rewards"],
            ["/sweep", "Sweep board"],
            ["/docs", "Docs"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-ink">
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
