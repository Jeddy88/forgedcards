/**
 * Unit tests for the liquidity/tick math. The strongest anchors: our
 * getSqrtRatioAtTick port must reproduce Uniswap's canonical MIN/MAX sqrt-price
 * bounds EXACTLY (those constants ARE getSqrtRatioAtTick(MIN_TICK/MAX_TICK)), and
 * tick 0 → 2^96. Plus liquidity↔amounts round-trips. Run: npm run test:unit
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MIN_SQRT_PRICE, MAX_SQRT_PRICE, Q96 } from "./math";
import {
  MAX_TICK,
  MIN_TICK,
  amountsFromOneSide,
  getAmountsForLiquidity,
  getLiquidityForAmounts,
  getSqrtRatioAtTick,
  nearestUsableTick,
  singleSidedTicks,
  ticksForPreset,
  RANGE_PRESETS,
} from "./liquidity";

test("getSqrtRatioAtTick reproduces Uniswap's exact anchors", () => {
  // tick 0 → 2^96
  assert.equal(getSqrtRatioAtTick(0), Q96);
  // The canonical MIN/MAX sqrt ratios ARE getSqrtRatioAtTick(MIN_TICK/MAX_TICK).
  assert.equal(getSqrtRatioAtTick(MIN_TICK), MIN_SQRT_PRICE);
  assert.equal(getSqrtRatioAtTick(MAX_TICK), MAX_SQRT_PRICE);
});

test("getSqrtRatioAtTick is monotonic and reciprocal", () => {
  assert.ok(getSqrtRatioAtTick(60) > getSqrtRatioAtTick(0));
  assert.ok(getSqrtRatioAtTick(0) > getSqrtRatioAtTick(-60));
  // sqrt(t) * sqrt(-t) ≈ 2^192 (price(t)·price(-t) = 1), within rounding.
  for (const t of [60, 1000, 92100, 131220]) {
    const prod = getSqrtRatioAtTick(t) * getSqrtRatioAtTick(-t);
    const target = 1n << 192n;
    const diff = prod > target ? prod - target : target - prod;
    // allow a tiny relative slack for the round-up in each direction
    assert.ok((diff * 10n ** 12n) / target < 10n, `reciprocal off at tick ${t}`);
  }
});

test("liquidity ↔ amounts round-trips (in-range)", () => {
  // Current price at tick 110000; a range around it.
  const sqrtP = getSqrtRatioAtTick(110000);
  const sqrtA = getSqrtRatioAtTick(100000);
  const sqrtB = getSqrtRatioAtTick(120000);
  const L = 5_000n * 10n ** 18n;
  const { amount0, amount1 } = getAmountsForLiquidity(sqrtP, sqrtA, sqrtB, L);
  assert.ok(amount0 > 0n && amount1 > 0n, "in-range position holds both tokens");
  // Recovering liquidity from those amounts returns ~L (min of the two legs).
  const L2 = getLiquidityForAmounts(sqrtP, sqrtA, sqrtB, amount0, amount1);
  const diff = L > L2 ? L - L2 : L2 - L;
  assert.ok((diff * 10_000n) / L < 5n, `round-trip liquidity off: ${L} vs ${L2}`);
});

test("amountsFromOneSide derives the pair from one entered amount", () => {
  const sqrtP = getSqrtRatioAtTick(110000);
  const sa = getSqrtRatioAtTick(100000);
  const sb = getSqrtRatioAtTick(120000);
  // Truth: a position of L holds these amounts.
  const L = 5_000n * 10n ** 18n;
  const truth = getAmountsForLiquidity(sqrtP, sa, sb, L);

  // Entering ETH (amount0) must recover ~amount1 (and ~L).
  const fromEth = amountsFromOneSide(sqrtP, sa, sb, "amount0", truth.amount0);
  assert.ok(fromEth, "eth side drives in-range");
  const d1 = truth.amount1 > fromEth!.amount1 ? truth.amount1 - fromEth!.amount1 : fromEth!.amount1 - truth.amount1;
  assert.ok((d1 * 10_000n) / truth.amount1 < 5n, "derived FORGE ~ truth");

  // Entering FORGE (amount1) must recover ~amount0.
  const fromOcards = amountsFromOneSide(sqrtP, sa, sb, "amount1", truth.amount1);
  assert.ok(fromOcards, "ocards side drives in-range");
  const d0 = truth.amount0 > fromOcards!.amount0 ? truth.amount0 - fromOcards!.amount0 : fromOcards!.amount0 - truth.amount0;
  assert.ok((d0 * 10_000n) / truth.amount0 < 5n, "derived ETH ~ truth");

  // Zero / wrong-side single-sided → null.
  assert.equal(amountsFromOneSide(sqrtP, sa, sb, "amount0", 0n), null);
  assert.equal(amountsFromOneSide(getSqrtRatioAtTick(90000), sa, sb, "amount1", 1n), null); // below range: FORGE can't drive
});

test("getAmountsForLiquidity is single-sided outside the range", () => {
  const sqrtA = getSqrtRatioAtTick(100000);
  const sqrtB = getSqrtRatioAtTick(120000);
  const L = 1_000n * 10n ** 18n;
  // Price below range → all token0.
  const below = getAmountsForLiquidity(getSqrtRatioAtTick(90000), sqrtA, sqrtB, L);
  assert.equal(below.amount1, 0n);
  assert.ok(below.amount0 > 0n);
  // Price above range → all token1.
  const above = getAmountsForLiquidity(getSqrtRatioAtTick(130000), sqrtA, sqrtB, L);
  assert.equal(above.amount0, 0n);
  assert.ok(above.amount1 > 0n);
});

test("singleSidedTicks sit entirely on one side of the price", () => {
  const cur = 130099; // near the current launch tick
  const eth = singleSidedTicks(cur, "amount0"); // ETH-only → above price
  assert.ok(eth.tickLower > cur, "ETH-only range is strictly above the price");
  assert.ok(eth.tickUpper > eth.tickLower);
  assert.equal(Math.abs(eth.tickLower % 60), 0);
  assert.equal(Math.abs(eth.tickUpper % 60), 0);

  const ocards = singleSidedTicks(cur, "amount1"); // FORGE-only → below price
  assert.ok(ocards.tickUpper < cur, "FORGE-only range is strictly below the price");
  assert.ok(ocards.tickLower < ocards.tickUpper);
  assert.equal(Math.abs(ocards.tickLower % 60), 0);

  // A price sitting outside these ranges yields a single-sided position:
  // ETH-only (price below the ETH range) → all token0.
  const sqrtP = getSqrtRatioAtTick(cur);
  const a = amountsFromOneSide(sqrtP, getSqrtRatioAtTick(eth.tickLower), getSqrtRatioAtTick(eth.tickUpper), "amount0", 10n ** 16n);
  assert.ok(a && a.amount1 === 0n && a.amount0 > 0n, "ETH-only deposits only ETH");
  const b = amountsFromOneSide(sqrtP, getSqrtRatioAtTick(ocards.tickLower), getSqrtRatioAtTick(ocards.tickUpper), "amount1", 10n ** 18n);
  assert.ok(b && b.amount0 === 0n && b.amount1 > 0n, "FORGE-only deposits only FORGE");
});

test("nearestUsableTick + presets snap to spacing and bracket the price", () => {
  assert.equal(nearestUsableTick(131), 120);
  assert.equal(nearestUsableTick(150), 180);
  const sqrtP = getSqrtRatioAtTick(110000);
  for (const p of RANGE_PRESETS) {
    const { tickLower, tickUpper } = ticksForPreset(p, sqrtP);
    // Math.abs normalizes JS negative-zero (e.g. -887220 % 60 === -0).
    assert.equal(Math.abs(tickLower % 60), 0);
    assert.equal(Math.abs(tickUpper % 60), 0);
    assert.ok(tickLower < tickUpper, `preset ${p.key} lower<upper`);
  }
});
