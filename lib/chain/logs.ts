/**
 * Event-derived reads (§8-style enumeration): owned token ids, live/sweepable
 * forges, all-time reward totals, per-card history. Everything here is a HINT
 * assembled from logs and re-verified against view functions before it drives a
 * transaction (e.g. sweepability is confirmed by
 * `StakingVault.getForge(id).isSweepable`, ownership by `ownerOf`).
 *
 * Scans are chunked (LOG_CHUNK) because public mainnet RPCs cap block ranges.
 * The launch checklist carries "swap log scans for an indexer at scale".
 */
import { parseAbiItem, type Address, type PublicClient } from "viem";
import { addressOf, ENV, LOG_CHUNK } from "@/lib/contracts/config";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
const FORGE_STARTED = parseAbiItem(
  "event ForgeStarted(uint256 indexed forgeId, address indexed staker, uint256 indexed tokenId, uint8 targetTier, uint256 amount, uint64 maturesAt)",
);
const FORGE_CANCELLED = parseAbiItem(
  "event ForgeCancelled(uint256 indexed forgeId, address indexed staker, uint256 indexed tokenId, uint8 targetTier)",
);
const FORGE_CLAIMED = parseAbiItem(
  "event ForgeClaimed(uint256 indexed forgeId, address indexed staker, uint256 indexed tokenId, uint8 targetTier)",
);
const FORGE_SWEPT = parseAbiItem(
  "event ForgeSwept(uint256 indexed forgeId, address indexed sweeper, address indexed staker, uint256 tokenId, uint8 targetTier, uint256 amount)",
);
const REWARDS_DEPOSITED_VAULT = parseAbiItem(
  "event RewardsDeposited(address indexed from, uint256 amount, uint256 accRewardPerToken, uint256 pendingPool)",
);
const REWARDS_DEPOSITED_YIELD = parseAbiItem(
  "event RewardsDeposited(address indexed from, uint256 amount, uint256 accPerWeight, uint256 pendingPool)",
);
const TIER_CHANGED = parseAbiItem(
  "event TierChanged(uint256 indexed tokenId, uint8 indexed previousTier, uint8 indexed newTier)",
);

/**
 * Chunked block-range walk for range-capped RPCs. `fetchRange` does the actual
 * typed `client.getLogs` call for one range (viem infers `.args` cleanly at the
 * call site, with `strict: true`); this only handles the [deploymentBlock,
 * latest] chunking so the fetcher's return type is preserved (no casts).
 */
async function scan<T>(
  client: PublicClient,
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
): Promise<T[]> {
  const latest = await client.getBlockNumber();
  const from = ENV.deploymentBlock;
  if (LOG_CHUNK === 0n) return fetchRange(from, latest);
  const out: T[] = [];
  for (let start = from; start <= latest; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n > latest ? latest : start + LOG_CHUNK - 1n;
    out.push(...(await fetchRange(start, end)));
  }
  return out;
}

/** Token ids currently owned by `wallet` (Transfer replay; mint = from 0x0). */
export async function fetchOwnedTokenIds(client: PublicClient, wallet: Address): Promise<bigint[]> {
  const cards = addressOf("cardsOnChain");
  const [incoming, outgoing] = await Promise.all([
    scan(client, (fromBlock, toBlock) =>
      client.getLogs({ address: cards, event: TRANSFER, args: { to: wallet }, strict: true, fromBlock, toBlock }),
    ),
    scan(client, (fromBlock, toBlock) =>
      client.getLogs({ address: cards, event: TRANSFER, args: { from: wallet }, strict: true, fromBlock, toBlock }),
    ),
  ]);
  // blockNumber / logIndex are non-null for mined logs (pending logs are
  // excluded from a fixed [from, to] range); coalesce defensively for the type.
  const all = [...incoming, ...outgoing].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? Number((a.logIndex ?? 0) - (b.logIndex ?? 0))
      : Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)),
  );
  const owned = new Set<bigint>();
  for (const log of all) {
    const { to, tokenId } = log.args;
    if (tokenId === undefined || to === undefined) continue;
    if (to.toLowerCase() === wallet.toLowerCase()) owned.add(tokenId);
    else owned.delete(tokenId);
  }
  return [...owned].sort((a, b) => (a < b ? -1 : 1));
}

/** Ids of forges started but not yet cancelled/claimed/swept. */
export async function fetchLiveForgeIds(client: PublicClient): Promise<bigint[]> {
  const vault = addressOf("stakingVault");
  const [started, cancelled, claimed, swept] = await Promise.all([
    scan(client, (fromBlock, toBlock) =>
      client.getLogs({ address: vault, event: FORGE_STARTED, strict: true, fromBlock, toBlock }),
    ),
    scan(client, (fromBlock, toBlock) =>
      client.getLogs({ address: vault, event: FORGE_CANCELLED, strict: true, fromBlock, toBlock }),
    ),
    scan(client, (fromBlock, toBlock) =>
      client.getLogs({ address: vault, event: FORGE_CLAIMED, strict: true, fromBlock, toBlock }),
    ),
    scan(client, (fromBlock, toBlock) =>
      client.getLogs({ address: vault, event: FORGE_SWEPT, strict: true, fromBlock, toBlock }),
    ),
  ]);
  const live = new Set<bigint>();
  for (const log of started) {
    if (log.args.forgeId !== undefined) live.add(log.args.forgeId);
  }
  for (const log of [...cancelled, ...claimed, ...swept]) {
    if (log.args.forgeId !== undefined) live.delete(log.args.forgeId);
  }
  return [...live].sort((a, b) => (a < b ? -1 : 1));
}

/**
 * Token ids that have EVER held a non-Common tier — the only cards a raid can target.
 *
 * A card reaches tier >= 1 exclusively through `TierChanged` (emitted by `setTier` on a
 * completed forge, and twice by `swapTiers` on a resolved raid). So the set of every
 * tokenId that ever appeared in a `TierChanged` log is a superset of today's non-Common
 * cards — a card can be knocked BACK to Common by losing a raid, so this is a HINT that
 * the caller must re-verify with a live `tierOf` / `raidStatusOf` read before it drives a
 * transaction (the house rule for every log-derived list here).
 *
 * Cheap in practice: bounded by the tier caps (555+266+111+22 = 954 max), not by the
 * 2,222 supply, and typically far smaller.
 */
export async function fetchEverNonCommonTokenIds(client: PublicClient): Promise<bigint[]> {
  const cards = addressOf("cardsOnChain");
  const changed = await scan(client, (fromBlock, toBlock) =>
    client.getLogs({ address: cards, event: TIER_CHANGED, strict: true, fromBlock, toBlock }),
  );
  const ids = new Set<bigint>();
  for (const log of changed) {
    // `newTier > 0` on at least one event => the card has been non-Common at some point.
    if (log.args.tokenId !== undefined && Number(log.args.newTier) > 0) ids.add(log.args.tokenId);
  }
  return [...ids].sort((a, b) => (a < b ? -1 : 1));
}

/** Σ RewardsDeposited per contract — the two all-time fee-stream totals. */
export async function fetchRewardTotals(
  client: PublicClient,
): Promise<{ stakerRewardsDeposited: bigint; cardYieldDeposited: bigint }> {
  const [vaultLogs, yieldLogs] = await Promise.all([
    scan(client, (fromBlock, toBlock) =>
      client.getLogs({ address: addressOf("stakingVault"), event: REWARDS_DEPOSITED_VAULT, strict: true, fromBlock, toBlock }),
    ),
    scan(client, (fromBlock, toBlock) =>
      client.getLogs({ address: addressOf("cardYield"), event: REWARDS_DEPOSITED_YIELD, strict: true, fromBlock, toBlock }),
    ),
  ]);
  const sum = (logs: { args: { amount?: bigint } }[]) =>
    logs.reduce((acc, l) => acc + (l.args.amount ?? 0n), 0n);
  return { stakerRewardsDeposited: sum(vaultLogs), cardYieldDeposited: sum(yieldLogs) };
}

export interface TierHistoryEntry {
  label: string;
  detail: string;
  blockNumber: bigint;
}

/** Mint + tier-change history of one card (newest first). */
export async function fetchCardHistory(
  client: PublicClient,
  tokenId: bigint,
  tierNames: readonly string[],
  tierStakes: readonly bigint[],
  tierDurations: readonly string[],
): Promise<TierHistoryEntry[]> {
  const changes = await scan(client, (fromBlock, toBlock) =>
    client.getLogs({ address: addressOf("cardsOnChain"), event: TIER_CHANGED, args: { tokenId }, strict: true, fromBlock, toBlock }),
  );
  const entries: TierHistoryEntry[] = changes.map((log) => {
    const t = Number(log.args.newTier ?? 0);
    return {
      label: `Forged to ${tierNames[t]}`,
      detail: `${(tierStakes[t] / 10n ** 18n).toLocaleString()} FORGE locked ${tierDurations[t]}, then returned`,
      blockNumber: log.blockNumber ?? 0n,
    };
  });
  entries.push({ label: "Minted at Common", detail: "via a pool buy", blockNumber: 0n });
  return entries.reverse();
}
