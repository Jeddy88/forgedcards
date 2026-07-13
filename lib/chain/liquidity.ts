/**
 * Uniswap v4 liquidity + tick math, ported to bigint (no floating point on any
 * token amount). Formulas are transcribed VERBATIM from the installed libraries:
 *  - LiquidityAmounts (v4-periphery/src/libraries/LiquidityAmounts.sol)
 *  - TickMath.getSqrtRatioAtTick (v4-core) — the exact fixed-point algorithm.
 * getAmountsForLiquidity mirrors the canonical v3/v4 inverse. Unit-tested in
 * liquidity.test.ts against known anchors (tick 0 → 2^96, round-trips).
 *
 * These power the Liquidity tab: pick a price range (preset → ticks), enter
 * amounts → compute the position `liquidity` + the token amounts the mint pulls.
 */
import { Q96, MIN_SQRT_PRICE, MAX_SQRT_PRICE } from "./math";

/** Uniswap tick bounds. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
/** Our pool's tick spacing (MintHook.TICK_SPACING for the 0.3% tier). */
export const TICK_SPACING = 60;

const Q32 = 1n << 32n;
const UINT256_MAX = (1n << 256n) - 1n;

/** TickMath.getSqrtRatioAtTick — exact bigint port (magic constants verbatim). */
export function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = BigInt(tick < 0 ? -tick : tick);
  if (absTick > BigInt(MAX_TICK)) throw new Error("tick out of range");

  let ratio =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  const m = (bit: bigint, k: bigint) => {
    if ((absTick & bit) !== 0n) ratio = (ratio * k) >> 128n;
  };
  m(0x2n, 0xfff97272373d413259a46990580e213an);
  m(0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn);
  m(0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n);
  m(0x10n, 0xffcb9843d60f6159c9db58835c926644n);
  m(0x20n, 0xff973b41fa98c081472e6896dfb254c0n);
  m(0x40n, 0xff2ea16466c96a3843ec78b326b52861n);
  m(0x80n, 0xfe5dee046a99a2a811c461f1969c3053n);
  m(0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
  m(0x200n, 0xf987a7253ac413176f2b074cf7815e54n);
  m(0x400n, 0xf3392b0822b70005940c7a398e4b70f3n);
  m(0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n);
  m(0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n);
  m(0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n);
  m(0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n);
  m(0x8000n, 0x31be135f97d08fd981231505542fcfa6n);
  m(0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  m(0x20000n, 0x5d6af8dedb81196699c329225ee604n);
  m(0x40000n, 0x2216e584f5fa1ea926041bedfe98n);
  m(0x80000n, 0x48a170391f7dc42444e8fa2n);

  if (tick > 0) ratio = UINT256_MAX / ratio;

  // sqrtPriceX96 = ratio >> 32, rounding UP if there is any remainder.
  return (ratio >> 32n) + (ratio % Q32 === 0n ? 0n : 1n);
}

/** Snap a tick to the nearest valid multiple of `spacing` (toward zero floor). */
export function nearestUsableTick(tick: number, spacing = TICK_SPACING): number {
  const rounded = Math.round(tick / spacing) * spacing;
  if (rounded < MIN_TICK) return rounded + spacing;
  if (rounded > MAX_TICK) return rounded - spacing;
  return rounded;
}

/** Approx current tick from the pool sqrtPrice (float log — used only to CENTER
 *  a range; the exact sqrt for the chosen ticks comes from getSqrtRatioAtTick). */
export function tickFromSqrtPrice(sqrtPriceX96: bigint): number {
  const ratio = Number(sqrtPriceX96) / Number(Q96); // ~hundreds; float-safe ratio
  const price = ratio * ratio; // token1/token0
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

/** Tick offset for a ± price fraction (e.g. 0.1 → +~953 ticks). */
export function tickOffsetForFraction(fraction: number): number {
  return Math.round(Math.log(1 + fraction) / Math.log(1.0001));
}

// --------------------------------------------------------------------------
// LiquidityAmounts (verbatim from v4-periphery) — bigint full-precision.
// --------------------------------------------------------------------------

function sortSqrt(a: bigint, b: bigint): [bigint, bigint] {
  return a > b ? [b, a] : [a, b];
}

export function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  [sqrtA, sqrtB] = sortSqrt(sqrtA, sqrtB);
  const intermediate = (sqrtA * sqrtB) / Q96;
  return (amount0 * intermediate) / (sqrtB - sqrtA);
}

export function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  [sqrtA, sqrtB] = sortSqrt(sqrtA, sqrtB);
  return (amount1 * Q96) / (sqrtB - sqrtA);
}

/** Max liquidity obtainable from (amount0, amount1) across a range at price P. */
export function getLiquidityForAmounts(
  sqrtP: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  [sqrtA, sqrtB] = sortSqrt(sqrtA, sqrtB);
  if (sqrtP <= sqrtA) return getLiquidityForAmount0(sqrtA, sqrtB, amount0);
  if (sqrtP < sqrtB) {
    const l0 = getLiquidityForAmount0(sqrtP, sqrtB, amount0);
    const l1 = getLiquidityForAmount1(sqrtA, sqrtP, amount1);
    return l0 < l1 ? l0 : l1;
  }
  return getLiquidityForAmount1(sqrtA, sqrtB, amount1);
}

export function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  [sqrtA, sqrtB] = sortSqrt(sqrtA, sqrtB);
  return ((liquidity << 96n) * (sqrtB - sqrtA)) / sqrtB / sqrtA;
}

export function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  [sqrtA, sqrtB] = sortSqrt(sqrtA, sqrtB);
  return (liquidity * (sqrtB - sqrtA)) / Q96;
}

/** The token amounts a position of `liquidity` across [sqrtA,sqrtB] holds at P. */
export function getAmountsForLiquidity(
  sqrtP: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  [sqrtA, sqrtB] = sortSqrt(sqrtA, sqrtB);
  if (sqrtP <= sqrtA) return { amount0: getAmount0ForLiquidity(sqrtA, sqrtB, liquidity), amount1: 0n };
  if (sqrtP < sqrtB) {
    return {
      amount0: getAmount0ForLiquidity(sqrtP, sqrtB, liquidity),
      amount1: getAmount1ForLiquidity(sqrtA, sqrtP, liquidity),
    };
  }
  return { amount0: 0n, amount1: getAmount1ForLiquidity(sqrtA, sqrtB, liquidity) };
}

/**
 * Given a range + current price, compute the position amounts + liquidity when
 * the user provides ONE side (the other is derived — the standard "enter one,
 * see the pair" LP UX). Returns null if that side can't drive the position
 * (e.g. supplying FORGE for a range entirely below the price = all-ETH), or the
 * amount is zero.
 */
export function amountsFromOneSide(
  sqrtP: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  side: "amount0" | "amount1",
  amount: bigint,
): { liquidity: bigint; amount0: bigint; amount1: bigint } | null {
  if (amount <= 0n || sqrtP <= 0n) return null;
  [sqrtA, sqrtB] = sortSqrt(sqrtA, sqrtB);

  if (sqrtP <= sqrtA) {
    // Price at/below range → position is all token0 (ETH); only amount0 drives.
    if (side !== "amount0") return null;
    const L = getLiquidityForAmount0(sqrtA, sqrtB, amount);
    return { liquidity: L, amount0: getAmount0ForLiquidity(sqrtA, sqrtB, L), amount1: 0n };
  }
  if (sqrtP >= sqrtB) {
    // Price at/above range → all token1 (FORGE); only amount1 drives.
    if (side !== "amount1") return null;
    const L = getLiquidityForAmount1(sqrtA, sqrtB, amount);
    return { liquidity: L, amount0: 0n, amount1: getAmount1ForLiquidity(sqrtA, sqrtB, L) };
  }
  // In range → both tokens; either side determines liquidity, then derive both.
  const L =
    side === "amount0"
      ? getLiquidityForAmount0(sqrtP, sqrtB, amount)
      : getLiquidityForAmount1(sqrtA, sqrtP, amount);
  return {
    liquidity: L,
    amount0: getAmount0ForLiquidity(sqrtP, sqrtB, L),
    amount1: getAmount1ForLiquidity(sqrtA, sqrtP, L),
  };
}

// --------------------------------------------------------------------------
// Range presets → tick bounds (currency0 = ETH, currency1 = FORGE).
// --------------------------------------------------------------------------

export interface RangePreset {
  key: string;
  label: string;
  /** null → full range; else ± fraction around the current price. Ignored when
   *  `oneSided` (the range then sits entirely on one side, set by the token). */
  fraction: number | null;
  /** true → a single-token range (side chosen by which token is deposited). */
  oneSided?: boolean;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { key: "full", label: "Full range", fraction: null },
  { key: "wide", label: "±50%", fraction: 0.5 },
  { key: "narrow", label: "±10%", fraction: 0.1 },
  { key: "single", label: "One-sided", fraction: null, oneSided: true },
] as const;

/**
 * Tick bounds for a SINGLE-SIDED position, entirely on one side of the current
 * price so it holds only one token:
 *  - side "amount0" (ETH-only)   → a band strictly ABOVE the current price;
 *  - side "amount1" (FORGE-only) → a band strictly BELOW the current price.
 * Width ≈ a 50% price move. (currency0 = ETH, currency1 = FORGE.)
 */
export function singleSidedTicks(
  currentTick: number,
  side: "amount0" | "amount1",
  spacing = TICK_SPACING,
): { tickLower: number; tickUpper: number } {
  const band = Math.max(spacing, Math.round(tickOffsetForFraction(0.5) / spacing) * spacing);
  if (side === "amount0") {
    const lower = Math.floor(currentTick / spacing) * spacing + spacing; // strictly above
    return { tickLower: nearestUsableTick(lower, spacing), tickUpper: nearestUsableTick(lower + band, spacing) };
  }
  const upper = Math.ceil(currentTick / spacing) * spacing - spacing; // strictly below
  return { tickLower: nearestUsableTick(upper - band, spacing), tickUpper: nearestUsableTick(upper, spacing) };
}

/** Full-range tick bounds, snapped to spacing. */
export function fullRangeTicks(spacing = TICK_SPACING): { tickLower: number; tickUpper: number } {
  return {
    tickLower: nearestUsableTick(MIN_TICK, spacing),
    tickUpper: nearestUsableTick(MAX_TICK, spacing),
  };
}

/** Tick bounds for a preset around the current price. */
export function ticksForPreset(
  preset: RangePreset,
  sqrtPriceX96: bigint,
  spacing = TICK_SPACING,
): { tickLower: number; tickUpper: number } {
  if (preset.fraction === null) return fullRangeTicks(spacing);
  const mid = tickFromSqrtPrice(sqrtPriceX96);
  const off = tickOffsetForFraction(preset.fraction);
  return {
    tickLower: nearestUsableTick(mid - off, spacing),
    tickUpper: nearestUsableTick(mid + off, spacing),
  };
}

/** Clamp a sqrt price into the valid pool range (defensive). */
export function clampSqrt(sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 <= MIN_SQRT_PRICE) return MIN_SQRT_PRICE + 1n;
  if (sqrtPriceX96 >= MAX_SQRT_PRICE) return MAX_SQRT_PRICE - 1n;
  return sqrtPriceX96;
}
