/**
 * View-based enumeration — the replacement for full-history log scans.
 *
 * WHY (2026-09-01): Robinhood Chain produces ~10 blocks/second, so the range
 * between the deployment block and head grows by ~860,000 blocks per DAY. Log
 * scans walked that whole range in `LOG_CHUNK` slices, which had already become
 * ~4,775 `eth_getLogs` calls per scan (~43,000 per page load) and grew without
 * bound — instantly rate-limiting any public RPC. Rate-limit replies carry no
 * CORS headers, so browsers surfaced the failures as "CORS errors" and no data
 * loaded at all.
 *
 * These helpers ask the contracts directly instead. Every card id is readable
 * because ids are sequential with no burns (`ForgedCards` mints `startId + i`
 * and never burns), so ids are exactly 1..totalEverMinted. Reads are aggregated
 * through Multicall3 (deployed on Robinhood Chain, wired in lib/wagmi.ts), so a
 * full sweep of the collection costs a handful of `eth_call`s.
 *
 * Cost is bounded FOREVER by the 2,222-card supply cap — it does not grow with
 * chain height. These are also exact CURRENT state (not log-derived hints), so
 * they need no re-verification before driving a transaction.
 */
import type { Address, PublicClient } from "viem";
import { cardsOnChainAbi, stakingVaultAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";

/** [1n, 2n, … n] — every minted token id (sequential, never burned). */
function tokenIdsUpTo(totalEverMinted: bigint): bigint[] {
  const n = Number(totalEverMinted);
  if (!Number.isFinite(n) || n <= 0) return [];
  return Array.from({ length: n }, (_, i) => BigInt(i + 1));
}

/**
 * Token ids currently owned by `wallet`, from `ownerOf` across the collection.
 * `allowFailure` absorbs ids that revert (defensive — no burn path exists).
 */
export async function fetchOwnedTokenIds(
  client: PublicClient,
  wallet: Address,
  totalEverMinted: bigint,
): Promise<bigint[]> {
  const ids = tokenIdsUpTo(totalEverMinted);
  if (ids.length === 0) return [];
  const cards = addressOf("cardsOnChain");
  const owners = await client.multicall({
    contracts: ids.map((tokenId) => ({
      address: cards,
      abi: cardsOnChainAbi,
      functionName: "ownerOf" as const,
      args: [tokenId] as const,
    })),
    allowFailure: true,
  });
  const want = wallet.toLowerCase();
  return ids.filter((_, i) => {
    const r = owners[i];
    return r.status === "success" && String(r.result).toLowerCase() === want;
  });
}

/**
 * Every LIVE forge id across the collection (the sweep board), from the vault's
 * `activeForge(tokenId)` mapping — 0 means "no live forge on this card".
 */
export async function fetchLiveForgeIds(
  client: PublicClient,
  totalEverMinted: bigint,
): Promise<bigint[]> {
  const ids = tokenIdsUpTo(totalEverMinted);
  if (ids.length === 0) return [];
  const vault = addressOf("stakingVault");
  const active = await client.multicall({
    contracts: ids.map((tokenId) => ({
      address: vault,
      abi: stakingVaultAbi,
      functionName: "activeForge" as const,
      args: [tokenId] as const,
    })),
    allowFailure: true,
  });
  const forgeIds: bigint[] = [];
  for (const r of active) {
    if (r.status === "success" && typeof r.result === "bigint" && r.result !== 0n) {
      forgeIds.push(r.result);
    }
  }
  return forgeIds.sort((a, b) => (a < b ? -1 : 1));
}

/**
 * Token ids CURRENTLY above Common — the raid board's candidate set, from
 * `tierOf`. Strictly better than the log-derived version it replaces: that one
 * returned an "ever non-Common" superset that callers had to re-verify, while
 * this is exact current state.
 */
export async function fetchNonCommonTokenIds(
  client: PublicClient,
  totalEverMinted: bigint,
): Promise<bigint[]> {
  const ids = tokenIdsUpTo(totalEverMinted);
  if (ids.length === 0) return [];
  const cards = addressOf("cardsOnChain");
  const tiers = await client.multicall({
    contracts: ids.map((tokenId) => ({
      address: cards,
      abi: cardsOnChainAbi,
      functionName: "tierOf" as const,
      args: [tokenId] as const,
    })),
    allowFailure: true,
  });
  return ids.filter((_, i) => {
    const r = tiers[i];
    return r.status === "success" && Number(r.result) > 0;
  });
}
