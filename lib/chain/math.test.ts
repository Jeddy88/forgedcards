/**
 * Unit tests for the pure swap-path helpers: the hookData encoding invariant,
 * BalanceDelta decoding, sqrt-price slippage limits, and the client-side
 * material derivation mirror. Run: npm run test:unit
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  Q96,
  decodeBalanceDelta,
  encodeMintRecipient,
  expectedSqrtPriceAfterBuy,
  isqrt,
  priceImpactBps,
  sqrtPriceLimitFor,
} from "./math";
import { materialOf, materialIndexOf } from "./material";
import { getSqrtRatioAtTick } from "./liquidity";

test("encodeMintRecipient == abi.encode(address) — the MintHook hookData word", () => {
  // MintHook._decodeRecipient requires EXACTLY 32 bytes, upper 96 bits clean.
  const encoded = encodeMintRecipient("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  assert.equal(
    encoded,
    "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  );
  assert.equal((encoded.length - 2) / 2, 32); // exactly one word
});

test("decodeBalanceDelta unpacks signed int128 halves", () => {
  // amount0 = -5, amount1 = +7
  const word = ((-5n & ((1n << 128n) - 1n)) << 128n) | 7n;
  // interpret as int256 two's complement (top bit set → negative word)
  const signed = word >= 1n << 255n ? word - (1n << 256n) : word;
  const { amount0, amount1 } = decodeBalanceDelta(signed);
  assert.equal(amount0, -5n);
  assert.equal(amount1, 7n);

  const zero = decodeBalanceDelta(0n);
  assert.equal(zero.amount0, 0n);
  assert.equal(zero.amount1, 0n);
});

test("isqrt exact and floor cases", () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(1n), 1n);
  assert.equal(isqrt(4n), 2n);
  assert.equal(isqrt(99n), 9n);
  assert.equal(isqrt(10n ** 36n), 10n ** 18n);
  assert.throws(() => isqrt(-1n));
});

test("sqrtPriceLimitFor moves the right way and clamps", () => {
  const sqrtP = 2n ** 96n; // price 1
  const buyLimit = sqrtPriceLimitFor(sqrtP, true, 100n); // 1% down
  const sellLimit = sqrtPriceLimitFor(sqrtP, false, 100n); // 1% up
  assert.ok(buyLimit < sqrtP, "buy limit must be below current");
  assert.ok(sellLimit > sqrtP, "sell limit must be above current");
  // ~0.5% sqrt-price move for a 1% price tolerance
  const bps = ((sqrtP - buyLimit) * 10_000n) / sqrtP;
  assert.ok(bps >= 49n && bps <= 51n, `expected ~50bps sqrt move, got ${bps}`);
  // clamping
  assert.equal(sqrtPriceLimitFor(MIN_SQRT_PRICE, true, 9_999n), MIN_SQRT_PRICE + 1n);
  assert.equal(sqrtPriceLimitFor(MAX_SQRT_PRICE, false, 9_999n), MAX_SQRT_PRICE - 1n);
  assert.throws(() => sqrtPriceLimitFor(sqrtP, true, 10_000n));
});

test("expectedSqrtPriceAfterBuy inverts amount1 = L·Δsqrt/Q96", () => {
  // Pick L and a target end price, derive the amount1 that lands there, and
  // confirm the helper recovers that end price.
  const L = 1_648n * 10n ** 18n; // ~ our launch pool's liquidity
  const sqrtP0 = 706n * Q96; // arbitrary start (sqrt of ~499k)
  const sqrtP1Target = 692n * Q96; // ~4% price drop
  const amount1 = (L * (sqrtP0 - sqrtP1Target)) / Q96; // FORGE out to reach the target
  const got = expectedSqrtPriceAfterBuy(sqrtP0, amount1, L);
  // exact up to the floor division in the amount1 derivation
  assert.ok(got <= sqrtP1Target && sqrtP1Target - got <= Q96, `end price off: ${got}`);
  assert.ok(got < sqrtP0, "buy must move price down");

  // Degenerate inputs → 0 (caller falls back to the spot-based limit).
  assert.equal(expectedSqrtPriceAfterBuy(sqrtP0, 0n, L), 0n);
  assert.equal(expectedSqrtPriceAfterBuy(sqrtP0, amount1, 0n), 0n);
  // A buy larger than the whole range drains it → 0 (fall back).
  assert.equal(expectedSqrtPriceAfterBuy(sqrtP0, L * 1_000_000n, L), 0n);
});

test("curve-aware limit lets an in-size buy fill (limit below expected end)", () => {
  // With the curve-aware approach, the on-chain limit is derived from the buy's
  // OWN expected end price, then relaxed by slippage — so it sits BELOW the end
  // price and never truncates the intended fill.
  const L = 1_648n * 10n ** 18n;
  const sqrtP0 = 706n * Q96;
  const amount1 = (L * (14n * Q96)) / Q96; // moves sqrt down ~14 (a few % impact)
  const expectedEnd = expectedSqrtPriceAfterBuy(sqrtP0, amount1, L);
  const limit = sqrtPriceLimitFor(expectedEnd, true, 100n); // +1% tolerance
  assert.ok(expectedEnd > 0n && expectedEnd < sqrtP0, "sane end price");
  assert.ok(limit < expectedEnd, "limit must sit below the expected end (room to fill fully)");
});

test("priceImpactBps measures |Δ(price)| in bps, direction-agnostic", () => {
  // price ∝ sqrtP²; a 1% sqrt drop ≈ ~1.99% price drop.
  const sqrtP0 = 1n << 96n;
  const sqrtP1 = (sqrtP0 * 99n) / 100n; // 1% sqrt drop
  const bps = priceImpactBps(sqrtP0, sqrtP1);
  assert.ok(bps >= 198n && bps <= 200n, `expected ~199bps, got ${bps}`);
  assert.equal(priceImpactBps(sqrtP0, sqrtP0), 0n);
  // symmetric for an increase of the same sqrt ratio
  assert.ok(priceImpactBps(sqrtP1, sqrtP0) > 0n);
});

test("audit M-1 regression: real launch first-buy shows real walk-up, never ~0%", () => {
  // Audit finding M-1 (2026-07-13): quoteBuy passed 0n liquidity into
  // expectedSqrtPriceAfterBuy, so EVERY buy displayed ~0.00% price impact.
  // Pin the fixed behavior against the REAL launch constants: pool initialized
  // at tick 131,220, seeded L = 1400785248632165643341 (fork-proven), and the
  // measured 0.1 ETH first buy (46,984.81 FORGE out — CurveModel.md 2026-07-13
  // table), whose true on-chain walk-up was tick 131,220 → 130,257 ≈ 9.2%.
  const sqrtP0 = getSqrtRatioAtTick(131_220);
  const L = 1400785248632165643341n;
  const bought = 46984806981488699224970n;
  const end = expectedSqrtPriceAfterBuy(sqrtP0, bought, L);
  assert.ok(end > 0n && end < sqrtP0, "sane end price");
  const bps = priceImpactBps(sqrtP0, end);
  assert.ok(bps >= 850n && bps <= 1_000n, `expected ~920bps walk-up, got ${bps}`);
  // The old bug shape (0n liquidity) must keep degrading to the 0-impact
  // fallback rather than throwing — quoteBuy skips the stat in that corner.
  assert.equal(expectedSqrtPriceAfterBuy(sqrtP0, bought, 0n), 0n);
});

test("materialOf mirrors CardMaterials.materialOf partitioning", () => {
  const seed = "0x5eed0000000000000000000000000000000000000000000000000000000000ff" as const;
  // Every tier's material must come from that tier's partition.
  const ranges: [number, number][] = [
    [0, 3], // Common
    [4, 7], // Uncommon
    [8, 10], // Rare
    [11, 13], // Epic
    [14, 15], // Legendary
  ];
  for (let tier = 0; tier <= 4; tier++) {
    const idx = materialIndexOf(seed, tier);
    assert.ok(idx >= ranges[tier][0] && idx <= ranges[tier][1], `tier ${tier} idx ${idx}`);
    assert.equal(typeof materialOf(seed, tier), "string");
  }
  // deterministic
  assert.equal(materialIndexOf(seed, 2), materialIndexOf(seed, 2));
  assert.throws(() => materialIndexOf(seed, 5));
});
