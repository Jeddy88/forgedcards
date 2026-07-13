"use client";

/**
 * Live card image: renders the REAL on-chain art from
 * `CardsOnChain.tokenURI(tokenId).image` (an SVG data URI) via an <img>
 * element — the tokenURI output is untrusted and is NEVER injected into the
 * DOM (§14.2). While the render loads, the material's static export (the same
 * renderer's output, checked into /public/cards) stands in so grids don't
 * flash empty.
 */
import React from "react";
import CardMedia from "./CardMedia";
import { useTokenUri } from "@/lib/chain/hooks";

export default function LiveCardMedia({
  tokenId,
  tier,
  owner,
  material,
  alt,
  className = "",
}: {
  tokenId: bigint;
  tier: number;
  owner: string;
  /** Fallback material asset while the on-chain render loads. */
  material: string;
  alt: string;
  className?: string;
}) {
  const uri = useTokenUri(tokenId, tier, owner);

  if (!uri.data) {
    return <CardMedia material={material} alt={alt} variant="scene" className={className} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={uri.data.image}
      alt={alt}
      loading="lazy"
      draggable={false}
      className={`select-none ${className}`}
      data-source="CardsOnChain.tokenURI(tokenId) → image (data URI)"
    />
  );
}
