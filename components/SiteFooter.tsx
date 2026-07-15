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
            <a
              href="https://opensea.io/collection/forged-cards"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs text-muted hover:text-ink"
              aria-label="Forged Cards collection on OpenSea"
            >
              {/* OpenSea logo */}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.374 0 0 5.374 0 12s5.374 12 12 12 12-5.374 12-12S18.629 0 12 0ZM5.92 12.403l.051-.081 3.123-4.884a.107.107 0 0 1 .187.014c.52 1.169.972 2.623.76 3.528-.088.372-.335.876-.614 1.342a2.405 2.405 0 0 1-.117.199.106.106 0 0 1-.09.045H6.013a.106.106 0 0 1-.091-.163Zm13.914 1.68a.109.109 0 0 1-.065.101c-.243.103-1.07.485-1.414.962-.878 1.222-1.548 2.97-3.048 2.97H9.053c-2.216 0-4.011-1.802-4.011-4.027v-.072c0-.058.048-.106.108-.106h3.485c.07 0 .12.063.115.132-.026.226.017.459.125.67.206.42.636.682 1.099.682h1.726v-1.347H9.99a.11.11 0 0 1-.089-.173l.063-.09c.16-.231.391-.586.621-.992.156-.274.308-.566.43-.86.024-.052.043-.107.065-.16.033-.094.067-.182.091-.269a4.57 4.57 0 0 0 .065-.223c.057-.25.081-.514.081-.787 0-.108-.004-.221-.014-.327-.005-.117-.02-.235-.034-.352a3.415 3.415 0 0 0-.048-.312 6.494 6.494 0 0 0-.098-.468l-.014-.06c-.03-.108-.056-.21-.09-.317a11.824 11.824 0 0 0-.328-.972 5.212 5.212 0 0 0-.142-.355c-.072-.178-.146-.339-.213-.49a3.564 3.564 0 0 1-.094-.197 4.658 4.658 0 0 0-.103-.213c-.024-.053-.053-.104-.072-.152l-.211-.388a.069.069 0 0 1 .077-.1l1.32.357h.01l.173.05.192.054.07.02v-.783c0-.379.302-.686.678-.686a.66.66 0 0 1 .477.202.69.69 0 0 1 .2.484V6.65l.141.04c.01.005.022.01.031.017.034.024.084.062.147.11.05.038.103.086.166.136a8.302 8.302 0 0 1 .574.504c.214.199.454.432.684.691.065.074.127.146.192.226.062.079.132.156.19.232.079.104.16.212.235.325.033.053.074.108.105.161.096.142.178.288.257.435.034.067.067.142.096.213.089.197.159.396.202.598a.65.65 0 0 1 .029.132v.01c.014.057.019.12.024.184a2.057 2.057 0 0 1-.106.874c-.031.084-.06.17-.098.253-.077.176-.165.355-.271.518-.036.062-.077.127-.118.19-.043.067-.091.13-.132.19a3.526 3.526 0 0 1-.181.23c-.06.081-.118.163-.185.235-.091.11-.181.213-.276.311-.055.065-.115.132-.178.19-.06.067-.124.127-.18.18-.099.099-.18.173-.248.235l-.161.144a.106.106 0 0 1-.073.028h-1.242v1.347h1.562c.35 0 .682-.124.951-.352.091-.079.492-.427.966-.951a.106.106 0 0 1 .05-.032l3.65-1.055a.107.107 0 0 1 .137.102v.773Z" />
              </svg>
              forged-cards — OpenSea collection
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
