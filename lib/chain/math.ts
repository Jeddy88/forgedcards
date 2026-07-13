/**
 * Pure bigint helpers for the swap path — NO app-config imports so these are
 * unit-testable under plain node (see math.test.ts). All amount math is
 * bigint; no floating point ever touches a token quantity (§14.2).
 */
import { encodeAbiParameters, type Address } from "viem";

/** TickMath.MIN_SQRT_PRICE / MAX_SQRT_PRICE (v4-core). */
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

/** Fixed-point scaling factor for sqrtPriceX96 (2^96). */
export const Q96 = 1n << 96n;

/** abi.encode(recipient) — the exact 32-byte word `MintHook._decodeRecipient` expects. */
export function encodeMintRecipient(recipient: Address): `0x${string}` {
  return encodeAbiParameters([{ type: "address" }], [recipient]);
}

/** Floor integer sqrt of a non-negative bigint (Newton). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Slippage guard: the sqrt-price the swap may not cross, `slippageBps` of
 * PRICE movement away from the current price. The bootstrap router
 * (PoolSwapTest) has no minAmountOut or deadline, so the price limit is the
 * only on-chain slippage control; if the limit is reached an exact-in swap
 * PART-FILLS (spends less, receives proportionally less) instead of executing
 * past it.
 */
export function sqrtPriceLimitFor(currentSqrtPriceX96: bigint, buy: boolean, slippageBps: bigint): bigint {
  if (slippageBps < 0n || slippageBps >= 10_000n) throw new Error("slippageBps out of range");
  // price scales with sqrtP^2 → sqrtLimit = sqrtP * sqrt(1 ± slip)
  const scale = buy ? 10_000n - slippageBps : 10_000n + slippageBps;
  const limit = (currentSqrtPriceX96 * isqrt(scale * 10_000n)) / 10_000n;
  // clamp inside the valid tick range
  if (limit <= MIN_SQRT_PRICE) return MIN_SQRT_PRICE + 1n;
  if (limit >= MAX_SQRT_PRICE) return MAX_SQRT_PRICE - 1n;
  return limit;
}

/**
 * Expected pool sqrt-price AFTER an exact-in BUY that takes `amount1Out` FORGE
 * out, at constant in-range liquidity `L`. Our launch pool is ONE range position
 * spanning the whole curve, so L is constant across any realistic buy — making
 * this exact until the curve is fully sold. A buy moves the price DOWN:
 *   amount1 = L·(sqrtP0 − sqrtP1) / Q96  ⇒  sqrtP1 = sqrtP0 − amount1·Q96 / L.
 * Returns 0n (signalling "fall back to the spot-based limit") when inputs are
 * unusable or the buy would drain the whole range.
 */
export function expectedSqrtPriceAfterBuy(sqrtP0: bigint, amount1Out: bigint, liquidity: bigint): bigint {
  if (liquidity <= 0n || amount1Out <= 0n || sqrtP0 <= 0n) return 0n;
  const drop = (amount1Out * Q96) / liquidity;
  if (drop >= sqrtP0) return 0n; // buy would exhaust the range — caller falls back
  return sqrtP0 - drop;
}

/**
 * Price impact in basis points between a start and end sqrt-price (price ∝ sqrtP²).
 * Direction-agnostic: returns the magnitude. `|p0² − p1²| / p0² · 10000`.
 */
export function priceImpactBps(sqrtP0: bigint, sqrtP1: bigint): bigint {
  if (sqrtP0 <= 0n || sqrtP1 <= 0n) return 0n;
  const p0 = sqrtP0 * sqrtP0;
  const p1 = sqrtP1 * sqrtP1;
  const diff = p0 > p1 ? p0 - p1 : p1 - p0;
  return (diff * 10_000n) / p0;
}

/** Unpack a v4 BalanceDelta word: amount0 = top int128 (ETH), amount1 = bottom int128 (FORGE). */
export function decodeBalanceDelta(word: bigint): { amount0: bigint; amount1: bigint } {
  const U256 = 1n << 256n;
  const U128 = 1n << 128n;
  const w = word < 0n ? word + U256 : word;
  const toSigned = (v: bigint) => (v >= U128 >> 1n ? v - U128 : v);
  return { amount0: toSigned(w >> 128n), amount1: toSigned(w & (U128 - 1n)) };
}
