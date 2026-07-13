/** Display formatting helpers. All chain quantities are bigints (wei / 18 dec).
 *  No floating point ever touches a token amount (§14.2). */

const WAD = 10n ** 18n;

/**
 * Strict decimal-string → 18-dec bigint parse for user inputs.
 * Returns null for anything that isn't a plain non-negative decimal number
 * (no exponents, no signs, no separators). Extra fraction digits beyond 18
 * are rejected rather than silently truncated.
 */
export function parseUnits18(s: string): bigint | null {
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return null;
  const [wholeRaw = "", fracRaw = ""] = s.split(".");
  if (fracRaw.length > 18) return null;
  const whole = BigInt(wholeRaw || "0");
  const frac = BigInt((fracRaw + "0".repeat(18)).slice(0, 18));
  return whole * WAD + frac;
}

/** Format an 18-decimal bigint with up to `maxFrac` fraction digits (floor). */
export function formatUnits18(value: bigint, maxFrac = 4): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / WAD;
  const frac = abs % WAD;
  let fracStr = frac.toString().padStart(18, "0").slice(0, maxFrac);
  fracStr = fracStr.replace(/0+$/, "");
  const wholeStr = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeStr}${fracStr ? "." + fracStr : ""}`;
}

/** ETH amounts: show enough precision for fee-sized values. */
export function formatEth(wei: bigint, maxFrac = 5): string {
  return `${formatUnits18(wei, maxFrac)} ETH`;
}

/** FORGE amounts: whole-token oriented. */
export function formatOcards(wei: bigint, maxFrac = 2): string {
  return `${formatUnits18(wei, maxFrac)} FORGE`;
}

/** 0x1234…abcd — matches the card-face footer shortening. */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** "03 JUL 2026" — matches the on-card mint-date format (src/render/DateFormat.sol). */
export function formatMintDate(timestampSeconds: bigint): string {
  const d = new Date(Number(timestampSeconds) * 1000);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${day} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Human duration from seconds: "4d 12h", "2h 05m", "3m 12s". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

/**
 * Human label for a (usually round) duration in seconds — for on-chain tier
 * maturations that differ per network ("15 minutes", "1 hour", "12 hours").
 * Picks the largest whole unit; falls back to compact `formatDuration` for
 * anything that isn't a clean multiple.
 */
export function formatDurationLabel(seconds: bigint): string {
  if (seconds <= 0n) return "—";
  const plural = (n: bigint, unit: string) => `${n} ${unit}${n === 1n ? "" : "s"}`;
  if (seconds % 86400n === 0n) return plural(seconds / 86400n, "day");
  if (seconds % 3600n === 0n) return plural(seconds / 3600n, "hour");
  if (seconds % 60n === 0n) return plural(seconds / 60n, "minute");
  return formatDuration(Number(seconds));
}

/** Percentage of a bigint pair, one decimal. */
export function percentOf(part: bigint, whole: bigint): string {
  if (whole === 0n) return "0%";
  return `${(Number((part * 1000n) / whole) / 10).toFixed(1)}%`;
}
