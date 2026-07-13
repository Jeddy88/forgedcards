/**
 * Tier constants — mirrors of the FROZEN pure functions in src/CardsOnChain.sol
 * and src/render/CardMaterials.sol. These never change on-chain (no admin edits,
 * ever), so the dApp agent may keep them as local constants or re-read them from
 * the contract:
 *
 *   cap        <- CardsOnChain.tierCap(tier)        (Common: UNCAPPED sentinel)
 *   stake      <- CardsOnChain.tierStake(tier)      (FORGE wei)
 *   duration   <- CardsOnChain.tierDuration(tier)   (seconds)
 *   weight     <- CardsOnChain.tierWeight(tier)     (sell-fee yield weight)
 *   name/color <- CardMaterials.tierName/tierColor  (frozen render constants)
 *   materials  <- CardMaterials tier partition (global indices 0-15)
 *
 * NOTE (2026-07-04): stakes (500/1,500/3,000/5,000), the staggered maturations
 * (12h/24h/36h/48h), and the 3-HOUR claim window reflect the owner's
 * re-pricing; the contracts are being updated in parallel. The dApp agent must
 * confirm the deployed tierStake/tierDuration/CLAIM_WINDOW values match before
 * wiring.
 */

export type Tier = 0 | 1 | 2 | 3 | 4;

/** Sentinel returned by CardsOnChain.tierCap(0) — Common is uncapped. */
export const UNCAPPED = 2n ** 256n - 1n;

/** StakingVault.CLAIM_WINDOW — 3 HOURS, in seconds (owner re-pricing
 *  2026-07-04). The grace period between maturation and sweepability is tight:
 *  claim-deadline countdowns are SAFETY-CRITICAL UX (see DESIGN.md). */
export const CLAIM_WINDOW = 3n * 60n * 60n;

/** StakingVault.RAID_GRACE() — the MAINNET value, 6 HOURS in seconds (owner decision
 *  2026-07-07). A card cannot be raided until this long after it last changed hands, was
 *  upgraded, or was knocked into a new tier by a lost raid — the window that lets a buyer
 *  post their own protection (a seller's lingering protection never shields the buyer).
 *
 *  DO NOT use this for live UI: the Sepolia `StakingVaultTestnet` shortens it to 15
 *  minutes. Read `snap.stakingVault.raidGrace` (the on-chain `RAID_GRACE()`) instead.
 *  Kept only as the documented mainnet reference value. */
export const RAID_GRACE_MAINNET = 6n * 60n * 60n;

export interface TierInfo {
  tier: Tier;
  name: string; // CardMaterials.tierName(tier)
  color: string; // CardMaterials.tierColor(tier) — UI badges/timers only
  cap: bigint; // CardsOnChain.tierCap(tier)
  stake: bigint; // CardsOnChain.tierStake(tier), FORGE wei
  durationSeconds: bigint; // CardsOnChain.tierDuration(tier)
  durationLabel: string;
  weight: bigint; // CardsOnChain.tierWeight(tier)
  materials: string[]; // CardMaterials tier partition (by real-world scarcity)
}

const HOUR = 60n * 60n;

export const TIERS: TierInfo[] = [
  {
    tier: 0,
    name: "Common",
    color: "#9aa0ac",
    cap: UNCAPPED, // all 2,222 cards mint at Common
    stake: 0n,
    durationSeconds: 0n,
    durationLabel: "—",
    weight: 1n,
    materials: ["Paper", "Wood", "Ceramic", "Granite"],
  },
  {
    tier: 1,
    name: "Uncommon",
    color: "#3ecf8e",
    cap: 555n,
    stake: 500n * 10n ** 18n, // owner re-pricing 2026-07-04 (contracts updating in parallel)
    durationSeconds: 12n * HOUR,
    durationLabel: "12 hours",
    weight: 2n,
    materials: ["Glass", "Copper", "Steel", "Chrome"],
  },
  {
    tier: 2,
    name: "Rare",
    color: "#5b8cff",
    cap: 266n,
    stake: 1500n * 10n ** 18n,
    durationSeconds: 24n * HOUR,
    durationLabel: "24 hours",
    weight: 5n,
    materials: ["Amber", "Jade", "Obsidian"],
  },
  {
    tier: 3,
    name: "Epic",
    color: "#b478ff",
    cap: 111n,
    stake: 3000n * 10n ** 18n,
    durationSeconds: 36n * HOUR,
    durationLabel: "36 hours",
    weight: 12n,
    materials: ["Ruby", "Sapphire", "Gold"],
  },
  {
    tier: 4,
    name: "Legendary",
    color: "#ffd44d",
    cap: 22n,
    stake: 5000n * 10n ** 18n,
    durationSeconds: 48n * HOUR,
    durationLabel: "48 hours",
    weight: 30n,
    materials: ["Platinum", "Diamond"],
  },
];

export const tierInfo = (tier: number): TierInfo => TIERS[tier];

/** Material display name -> full-scene art asset in /public/cards (verbatim
 *  renderer export: square 1000x1000 scene with dark backdrop, as marketplaces
 *  render it from tokenURI). */
export const materialAsset = (material: string) =>
  `/cards/material_${material.toLowerCase()}.svg`;

/** Card-only variant: the same renderer output with the full-canvas dark
 *  background and backdrop glow stripped and the viewBox cropped to the card —
 *  transparent around the card, so the page's own background does the work
 *  (owner request, 2026-07-04). Used for all in-app card display. */
export const cardAsset = (material: string) => `/cards/card_${material.toLowerCase()}.svg`;
