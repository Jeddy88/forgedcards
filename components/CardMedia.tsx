import React from "react";
import { cardAsset, materialAsset } from "@/lib/tiers";

/**
 * Static card render. The assets are the REAL on-chain image SVGs exported by
 * the renderer test harness (test-artifacts/) and copied to /public/cards:
 *
 *  - variant="card" (default): background-stripped, viewBox cropped to the
 *    card, transparent surroundings — the page's own dark background does the
 *    work (owner request). SMIL sway retained.
 *  - variant="scene": the verbatim square 1000x1000 marketplace scene.
 *
 * In production the dApp agent swaps `src` for the tokenURI `image` data URI —
 * rendered exactly like this, via <img>, never injected into the DOM
 * (untrusted at the render layer). The card-only look is a display-layer crop;
 * the on-chain image itself keeps its dark canvas.
 */
export default function CardMedia({
  material,
  alt,
  variant = "card",
  className = "",
}: {
  material: string;
  alt: string;
  variant?: "card" | "scene";
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={variant === "card" ? cardAsset(material) : materialAsset(material)}
      alt={alt}
      loading="lazy"
      draggable={false}
      className={`select-none ${className}`}
      data-source="CardsOnChain.tokenURI(tokenId) → image (data URI)"
    />
  );
}
