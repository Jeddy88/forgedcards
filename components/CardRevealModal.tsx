"use client";

/**
 * Post-transaction card reveals:
 *  - <UpgradeRevealModal>: the single freshly-upgraded card, with a spring +
 *    shine + tier-glow animation (fired right after the upgrade tx confirms).
 *  - <MintRevealModal>: the cards minted by a buy, in a simple fade-in grid.
 *
 * Both pull the REAL on-chain art via `useTokenUri` (image data URI) — never
 * injecting tokenURI HTML into the DOM (§14.2). The tier is part of the cache
 * key, so passing the NEW tier fetches the upgraded art immediately (the page's
 * own reads may still be catching up). Keyframes live in an inline <style>,
 * which the app CSP permits (style-src 'unsafe-inline').
 */
import Link from "next/link";
import React, { useEffect, useState } from "react";
import Modal from "./Modal";
import TierBadge from "./TierBadge";
import { Button } from "./ui";
import { useTokenUri } from "@/lib/chain/hooks";
import { tierInfo } from "@/lib/tiers";

const REVEAL_KEYFRAMES = `
@keyframes cocReveal {
  0%   { transform: scale(.6) rotate(-8deg); opacity: 0; }
  55%  { transform: scale(1.06) rotate(3deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); }
}
@keyframes cocGlow  { 0%,100% { opacity: .3; } 50% { opacity: .85; } }
@keyframes cocShine { 0% { transform: translateX(-130%) skewX(-18deg); } 100% { transform: translateX(240%) skewX(-18deg); } }
@keyframes cocFade  { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;

/** Cards per page in the mint reveal (2×3 on mobile, 3×2 on desktop → bounded height). */
const MINT_PAGE_SIZE = 6;

/** The card's on-chain image, with a shimmer placeholder while it loads. */
function RevealCardImage({
  tokenId,
  tier,
  owner,
  className = "",
}: {
  tokenId: bigint;
  tier: number;
  owner: string;
  className?: string;
}) {
  const uri = useTokenUri(tokenId, tier, owner);
  if (!uri.data) {
    return <div className={`aspect-square animate-pulse rounded-2xl bg-raised ${className}`} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={uri.data.image}
      alt={`Card #${tokenId.toString()}`}
      draggable={false}
      className={`aspect-square w-full select-none rounded-2xl ${className}`}
      data-source="CardsOnChain.tokenURI(tokenId) → image (data URI)"
    />
  );
}

export function UpgradeRevealModal({
  open,
  tokenId,
  tier,
  owner,
  onClose,
}: {
  open: boolean;
  tokenId: bigint;
  /** The NEW (post-upgrade) tier. */
  tier: number;
  owner: string;
  onClose: () => void;
}) {
  const t = tierInfo(tier);
  return (
    <Modal open={open} onClose={onClose} title="Upgrade complete" className="max-w-lg">
      <style>{REVEAL_KEYFRAMES}</style>
      <div className="text-center">
        {/* Bigger on desktop (w-96), still safe within the modal on mobile (w-72). */}
        <div className="relative mx-auto w-72 max-w-full sm:w-96">
          {/* tier glow */}
          <div
            className="absolute -inset-6 rounded-full blur-2xl"
            style={{
              background: `radial-gradient(closest-side, ${t.color}66, transparent)`,
              animation: "cocGlow 2.2s ease-in-out infinite",
            }}
          />
          {/* card + shine sweep */}
          <div
            className="relative overflow-hidden rounded-2xl shadow-card"
            style={{ animation: "cocReveal .8s cubic-bezier(.2,.9,.25,1.2) both" }}
          >
            <RevealCardImage tokenId={tokenId} tier={tier} owner={owner} />
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent"
                style={{ animation: "cocShine 1.1s ease-in-out .35s both" }}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2">
          <span className="text-lg font-semibold text-ink">Card #{tokenId.toString()}</span>
          <span className="text-faint">is now</span>
          <TierBadge tier={tier} />
        </div>
        <p className="mt-1 text-sm text-muted">
          Upgraded to <span className="font-semibold text-ink">{t.name}</span> — new material and
          art, {t.name === "Legendary" ? "the top of the chain." : "ready to forge onward."}
        </p>

        <Button className="mt-6 w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

export function MintRevealModal({
  open,
  ids,
  owner,
  onClose,
}: {
  open: boolean;
  ids: bigint[];
  owner: string;
  onClose: () => void;
}) {
  const n = ids.length;
  const pages = Math.max(1, Math.ceil(n / MINT_PAGE_SIZE));
  const [page, setPage] = useState(0);
  // Reset to the first page whenever the modal opens or a new set of ids arrives.
  useEffect(() => setPage(0), [open, ids]);
  const clampedPage = Math.min(page, pages - 1);
  const shown = ids.slice(clampedPage * MINT_PAGE_SIZE, clampedPage * MINT_PAGE_SIZE + MINT_PAGE_SIZE);

  return (
    <Modal open={open} onClose={onClose} title={`${n} new card${n === 1 ? "" : "s"} minted`} className="max-w-lg">
      <style>{REVEAL_KEYFRAMES}</style>
      <p className="mb-4 text-sm text-muted">
        Your buy minted <span className="font-semibold text-ink">{n}</span> new Common
        card{n === 1 ? "" : "s"} to your wallet. Forge them into rarer tiers whenever you like.
      </p>
      {/* Fixed-ish height page so the modal never grows unbounded on big buys. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((id, i) => (
          <Link
            key={id.toString()}
            href={`/cards/${id.toString()}`}
            className="block"
            style={{ animation: `cocFade .35s ease-out ${Math.min(i, 6) * 0.04}s both` }}
          >
            <RevealCardImage
              tokenId={id}
              tier={0}
              owner={owner}
              className="transition-transform hover:scale-[1.03]"
            />
            <p className="mt-1 text-center text-xs font-semibold tabular-nums text-muted">
              #{id.toString()}
            </p>
          </Link>
        ))}
      </div>

      {/* pagination (only when the buy minted more than one page) */}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ‹ Prev
          </Button>
          <span className="text-xs tabular-nums text-muted">
            Page {clampedPage + 1} of {pages}
          </span>
          <Button
            variant="ghost"
            disabled={clampedPage >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          >
            Next ›
          </Button>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <Link href="/cards" className="flex-1">
          <Button variant="ghost" className="w-full">
            View my cards
          </Button>
        </Link>
        <Button className="flex-1" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
