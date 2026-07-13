/**
 * Interactive card viewer — a SANDBOXED iframe pointed at the app's own
 * /embed/card/[id] route, which serves the card's on-chain interactive HTML
 * (tokenURI `animation_url`) as a standalone document with its OWN strict CSP
 * (sandbox allow-scripts; default-src 'none'; inline script/style only).
 *
 * Why a route instead of srcdoc/data:? Documents from local schemes (srcdoc,
 * data:, blob:) INHERIT the parent page's CSP, which would either block the
 * card's inline script or force the whole app to loosen its policy. A
 * same-origin route + `sandbox="allow-scripts"` (no allow-same-origin) gives
 * the untrusted on-chain document a unique opaque origin, its own tight CSP,
 * and zero access to the app — §14.2: never inject tokenURI output into the
 * DOM.
 */
import React from "react";

export default function InteractiveCard({
  tokenId,
  title,
  className = "",
  refreshKey,
}: {
  tokenId: bigint;
  title: string;
  className?: string;
  /** Changing this reloads the iframe (and busts the embed route's short cache)
   *  so the art updates the instant a card's tier/owner changes — e.g. right
   *  after an upgrade — without a manual page refresh. */
  refreshKey?: string | number;
}) {
  const src =
    refreshKey === undefined
      ? `/embed/card/${tokenId.toString()}`
      : `/embed/card/${tokenId.toString()}?v=${encodeURIComponent(String(refreshKey))}`;
  return (
    <iframe
      key={src}
      src={src}
      title={title}
      sandbox="allow-scripts"
      loading="lazy"
      className={`h-full w-full rounded-2xl border border-line bg-black ${className}`}
      data-source="CardsOnChain.tokenURI(tokenId) → animation_url (data URI)"
    />
  );
}
