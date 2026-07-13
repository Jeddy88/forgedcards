/**
 * Unit tests for the shared bigint format/parse utils (§14.2: no floats,
 * tested parse). Run: npm run test:unit  (plain `node --test`, no framework).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  formatEth,
  formatMintDate,
  formatOcards,
  formatUnits18,
  parseUnits18,
  percentOf,
  shortAddress,
} from "./format";

const WAD = 10n ** 18n;

test("parseUnits18: plain integers and decimals", () => {
  assert.equal(parseUnits18("0"), 0n);
  assert.equal(parseUnits18("1"), WAD);
  assert.equal(parseUnits18("1000"), 1000n * WAD);
  assert.equal(parseUnits18("0.25"), WAD / 4n);
  assert.equal(parseUnits18("1.5"), (3n * WAD) / 2n);
  assert.equal(parseUnits18(".5"), WAD / 2n);
  assert.equal(parseUnits18("2."), 2n * WAD);
  assert.equal(parseUnits18("0.000000000000000001"), 1n); // full 18 decimals
});

test("parseUnits18: rejects malformed input", () => {
  assert.equal(parseUnits18(""), null);
  assert.equal(parseUnits18("."), null);
  assert.equal(parseUnits18("-1"), null);
  assert.equal(parseUnits18("+1"), null);
  assert.equal(parseUnits18("1e18"), null);
  assert.equal(parseUnits18("1,000"), null);
  assert.equal(parseUnits18("0x10"), null);
  assert.equal(parseUnits18("1.2.3"), null);
  assert.equal(parseUnits18("abc"), null);
  assert.equal(parseUnits18(" 1"), null);
  // 19 fraction digits: reject rather than silently truncate
  assert.equal(parseUnits18("0.0000000000000000001"), null);
});

test("parseUnits18 round-trips through formatUnits18", () => {
  for (const s of ["0", "1", "123.456", "0.000001", "999999.999999"]) {
    const parsed = parseUnits18(s)!;
    assert.equal(parseUnits18(formatUnits18(parsed, 18).replace(/,/g, "")), parsed);
  }
});

test("formatUnits18: floor behavior, separators, negatives", () => {
  assert.equal(formatUnits18(0n), "0");
  assert.equal(formatUnits18(WAD), "1");
  assert.equal(formatUnits18(1500n * WAD, 0), "1,500");
  assert.equal(formatUnits18(WAD / 4n), "0.25");
  assert.equal(formatUnits18(-WAD / 2n), "-0.5");
  // truncation, not rounding (never overstate a balance)
  assert.equal(formatUnits18(999999999999999999n, 2), "0.99");
});

test("formatEth / formatOcards suffixes", () => {
  assert.equal(formatEth(WAD / 100n), "0.01 ETH");
  assert.equal(formatOcards(500n * WAD, 0), "500 FORGE");
});

test("shortAddress", () => {
  assert.equal(
    shortAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
    "0xf39F…2266",
  );
});

test("formatMintDate matches the on-card format", () => {
  assert.equal(formatMintDate(1751587200n), "04 JUL 2025");
});

test("percentOf", () => {
  assert.equal(percentOf(1n, 4n), "25.0%");
  assert.equal(percentOf(0n, 0n), "0%");
});
