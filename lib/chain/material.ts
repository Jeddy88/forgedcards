/**
 * Client-side mirror of `src/render/CardMaterials.sol` seed→material derivation.
 * The on-chain function is FROZEN (library, no admin), so this mirror is safe;
 * it exists to avoid a tokenURI fetch just to label a card in a grid.
 *
 *   materialOf = tierOffset(tier) + uint256(keccak256(abi.encodePacked(seed, tier))) % setSize(tier)
 */
import { concatHex, keccak256, numberToHex, type Hex } from "viem";

export const MATERIAL_NAMES = [
  "Paper",
  "Wood",
  "Ceramic",
  "Granite",
  "Glass",
  "Copper",
  "Steel",
  "Chrome",
  "Amber",
  "Jade",
  "Obsidian",
  "Ruby",
  "Sapphire",
  "Gold",
  "Platinum",
  "Diamond",
] as const;

const TIER_OFFSET = [0, 4, 8, 11, 14] as const;
const TIER_SET_SIZE = [4, 4, 3, 3, 2] as const;

/** Global material index (0-15) of a card, from its immutable seed + tier. */
export function materialIndexOf(seed: Hex, tier: number): number {
  if (tier < 0 || tier > 4) throw new Error(`invalid tier ${tier}`);
  // abi.encodePacked(bytes32 seed, uint8 tier) = 33 bytes
  const packed = concatHex([seed, numberToHex(tier, { size: 1 })]);
  const hash = BigInt(keccak256(packed));
  return TIER_OFFSET[tier] + Number(hash % BigInt(TIER_SET_SIZE[tier]));
}

/** Display material name ("Jade") of a card. */
export function materialOf(seed: Hex, tier: number): string {
  return MATERIAL_NAMES[materialIndexOf(seed, tier)];
}
