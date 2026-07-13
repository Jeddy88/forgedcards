import React from "react";
import { tierInfo } from "@/lib/tiers";

/**
 * Tier badge — the ONLY place (plus timers/slot meters) where tier colors
 * appear in the UI. Colors are CardMaterials.tierColor(tier).
 */
export default function TierBadge({
  tier,
  size = "md",
}: {
  tier: number;
  size?: "sm" | "md";
}) {
  const t = tierInfo(tier);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-[0.14em] ${
        size === "sm" ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]"
      }`}
      style={{
        color: t.color,
        borderColor: `${t.color}44`,
        backgroundColor: `${t.color}14`,
      }}
      data-source="CardsOnChain.tierOf(tokenId)"
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: t.color }}
      />
      {t.name}
    </span>
  );
}
