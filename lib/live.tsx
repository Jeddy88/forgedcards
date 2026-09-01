"use client";

/**
 * Live chain data layer — replaces the design mock's `lib/demo.tsx`.
 *
 * Every number in the Snapshot comes from the contract views named in
 * lib/fixtures/types.ts (the fixture shapes are kept as the type contract);
 * enumerations (owned cards, live forges) come from Multicall3-aggregated VIEW
 * sweeps in lib/chain/views.ts — exact current state, bounded by the 2,222-card
 * cap. They replaced full-history event scans, which on a ~10-blocks-per-second
 * chain had grown to ~43,000 requests per page load and rate-limited every RPC.
 *
 * Wallet state comes from wagmi (injected connector); loading/error states
 * come from the query layer. There is no mock mode and no preview panel.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContracts,
  useSwitchChain,
} from "wagmi";
import type { Address, EIP1193Provider } from "viem";
import type { CardFixture, Snapshot, ForgeView } from "@/lib/fixtures/types";
import { cardsOnChainAbi, cardsTokenAbi, cardYieldAbi, mintHookAbi, stakingVaultAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";
import { chain } from "@/lib/wagmi";
import { materialOf } from "@/lib/chain/material";
import { fetchLiveForgeIds, fetchOwnedTokenIds } from "@/lib/chain/views";
import { ocardsPerEthFromSqrtPrice, readSqrtPriceX96 } from "@/lib/chain/quote";
import { setWalletReadProvider } from "@/lib/chain/walletTransport";

export type DataMode = "success" | "loading" | "empty" | "error";

const POLL_MS = 12_000;
const LOG_POLL_MS = 30_000;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const EMPTY_SNAPSHOT: Snapshot = {
  now: 0n,
  cardsOnChain: {
    totalSupply: 0n,
    totalEverMinted: 0n,
    maxSupply: 2222n,
    remainingMintable: 2222n,
    tierCount: [0n, 0n, 0n, 0n, 0n],
    // Placeholder until the chain read lands (mainnet seconds); the live read
    // overrides this per-network. Never used for a live countdown.
    tierDurations: [0n, 12n * 3600n, 24n * 3600n, 36n * 3600n, 48n * 3600n],
  },
  cardsToken: { totalSupply: 1_000_000n * 10n ** 18n, balanceOf: 0n },
  mintHook: { tradingEnabled: false, tradingEnabledAt: 0n, deployerBoughtTokens: 0n },
  stakingVault: {
    totalStaked: 0n,
    stakedOf: 0n,
    lockedOf: 0n,
    freeStakeOf: 0n,
    pendingRewards: 0n,
    claimable: 0n,
    tierSlotsRemaining: [0n, 555n, 266n, 111n, 22n],
    // Mainnet default until the chain read lands; the live read overrides per-network.
    raidGrace: 6n * 3600n,
    forgesOf: [],
    forges: {},
  },
  cardYield: { totalWeight: 0n, claimable: 0n },
  curve: { ocardsPerEth: 0n },
  myCards: [],
  sweepableIds: [],
};

interface LiveState {
  snap: Snapshot;
  dataMode: DataMode;
  refetch: () => void;
  connected: boolean;
  wallet: Address;
  wrongNetwork: boolean;
  hasInjected: boolean;
  connect: () => void;
  disconnect: () => void;
  switchToPinned: () => void;
}

const LiveContext = createContext<LiveState | null>(null);

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { address, isConnected, chainId, connector } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wallet = (address ?? ZERO) as Address;
  const connected = isConnected && !!address;
  const wrongNetwork = connected && chainId !== chain.id;

  // Reads follow the wallet (owner decision 2026-09-01): once connected, the
  // visitor's own wallet RPC serves reads instead of the shared public
  // endpoint — see lib/chain/walletTransport.ts. Registered ONLY while the
  // wallet is on the pinned chain: a wallet parked on another network would
  // answer from THAT chain, so on a mismatch we stay on the public RPC and the
  // "wrong network" banner asks the user to switch. Cleared on disconnect and
  // on unmount so a stale provider can never serve reads.
  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !connector || chainId !== chain.id) {
      setWalletReadProvider(null);
      return;
    }
    connector
      .getProvider()
      .then((provider) => {
        if (!cancelled) setWalletReadProvider((provider as EIP1193Provider) ?? null);
      })
      .catch(() => {
        if (!cancelled) setWalletReadProvider(null);
      });
    return () => {
      cancelled = true;
      setWalletReadProvider(null);
    };
  }, [isConnected, connector, chainId]);

  const cards = addressOf("cardsOnChain");
  const token = addressOf("cardsToken");
  const hook = addressOf("mintHook");
  const vault = addressOf("stakingVault");
  const cardYield = addressOf("cardYield");

  // ---------------------------------------------------------------- protocol
  // Explicit tuple (no .map spreads): wagmi infers per-element call/return
  // types only from a literal `contracts` tuple. Index layout is read back in
  // the assembler below; keep the two in lockstep.
  const protocolQ = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: cards, abi: cardsOnChainAbi, functionName: "totalSupply" }, // 0
      { address: cards, abi: cardsOnChainAbi, functionName: "remainingMintable" }, // 1
      { address: cards, abi: cardsOnChainAbi, functionName: "tierCount", args: [0] }, // 2
      { address: cards, abi: cardsOnChainAbi, functionName: "tierCount", args: [1] }, // 3
      { address: cards, abi: cardsOnChainAbi, functionName: "tierCount", args: [2] }, // 4
      { address: cards, abi: cardsOnChainAbi, functionName: "tierCount", args: [3] }, // 5
      { address: cards, abi: cardsOnChainAbi, functionName: "tierCount", args: [4] }, // 6
      { address: token, abi: cardsTokenAbi, functionName: "totalSupply" }, // 7
      { address: hook, abi: mintHookAbi, functionName: "tradingEnabled" }, // 8
      { address: hook, abi: mintHookAbi, functionName: "tradingEnabledAt" }, // 9
      { address: hook, abi: mintHookAbi, functionName: "deployerBoughtTokens" }, // 10
      { address: vault, abi: stakingVaultAbi, functionName: "totalStaked" }, // 11
      { address: vault, abi: stakingVaultAbi, functionName: "tierSlotsRemaining", args: [1] }, // 12
      { address: vault, abi: stakingVaultAbi, functionName: "tierSlotsRemaining", args: [2] }, // 13
      { address: vault, abi: stakingVaultAbi, functionName: "tierSlotsRemaining", args: [3] }, // 14
      { address: vault, abi: stakingVaultAbi, functionName: "tierSlotsRemaining", args: [4] }, // 15
      { address: cardYield, abi: cardYieldAbi, functionName: "totalWeight" }, // 16
      { address: cards, abi: cardsOnChainAbi, functionName: "tierDuration", args: [0] }, // 17
      { address: cards, abi: cardsOnChainAbi, functionName: "tierDuration", args: [1] }, // 18
      { address: cards, abi: cardsOnChainAbi, functionName: "tierDuration", args: [2] }, // 19
      { address: cards, abi: cardsOnChainAbi, functionName: "tierDuration", args: [3] }, // 20
      { address: cards, abi: cardsOnChainAbi, functionName: "tierDuration", args: [4] }, // 21
      { address: vault, abi: stakingVaultAbi, functionName: "RAID_GRACE" }, // 22
      // 23 — drives the collection view sweeps below (ids are 1..totalEverMinted).
      { address: cards, abi: cardsOnChainAbi, functionName: "totalEverMinted" }, // 23
    ],
    query: { refetchInterval: POLL_MS },
  });

  // ------------------------------------------------------------------ wallet
  const walletQ = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: token, abi: cardsTokenAbi, functionName: "balanceOf", args: [wallet] },
      { address: vault, abi: stakingVaultAbi, functionName: "stakedOf", args: [wallet] },
      { address: vault, abi: stakingVaultAbi, functionName: "lockedOf", args: [wallet] },
      { address: vault, abi: stakingVaultAbi, functionName: "freeStakeOf", args: [wallet] },
      { address: vault, abi: stakingVaultAbi, functionName: "pendingRewards", args: [wallet] },
      { address: vault, abi: stakingVaultAbi, functionName: "claimable", args: [wallet] },
      { address: vault, abi: stakingVaultAbi, functionName: "forgesOf", args: [wallet] },
      { address: cardYield, abi: cardYieldAbi, functionName: "claimable", args: [wallet] },
    ],
    query: { enabled: connected, refetchInterval: POLL_MS },
  });

  // --------------------------------------------------- collection enumeration
  // View sweeps over the collection (lib/chain/views.ts), NOT log scans: on a
  // ~10-blocks-per-second chain a full-history scan had grown to ~43,000
  // requests per page load and rate-limited every RPC. These cost a handful of
  // Multicall3-aggregated `eth_call`s and stay bounded by the 2,222-card cap.
  const totalEverMinted = (protocolQ.data?.[23] as bigint | undefined) ?? 0n;

  const ownedIdsQ = useQuery({
    queryKey: ["ownedTokenIds", wallet, totalEverMinted.toString()],
    queryFn: () => fetchOwnedTokenIds(publicClient!, wallet, totalEverMinted),
    enabled: connected && !!publicClient && totalEverMinted > 0n,
    refetchInterval: LOG_POLL_MS,
  });

  const liveForgeIdsQ = useQuery({
    queryKey: ["liveForgeIds", totalEverMinted.toString()],
    queryFn: () => fetchLiveForgeIds(publicClient!, totalEverMinted),
    enabled: !!publicClient && totalEverMinted > 0n,
    refetchInterval: LOG_POLL_MS,
  });

  const curveQ = useQuery({
    queryKey: ["sqrtPrice"],
    queryFn: async () => ocardsPerEthFromSqrtPrice(await readSqrtPriceX96(publicClient!)),
    enabled: !!publicClient,
    refetchInterval: POLL_MS,
  });

  // ------------------------------------------------- per-card + per-forge detail
  const ownedIds = useMemo(() => ownedIdsQ.data ?? [], [ownedIdsQ.data]);
  const cardsDetailQ = useReadContracts({
    allowFailure: false,
    contracts: ownedIds.flatMap((id) => [
      { address: cards, abi: cardsOnChainAbi, functionName: "tierOf" as const, args: [id] as const },
      // ART seed, not the mint seed: a card that won or lost a raid renders from the
      // other card's seed, so this is what the material must be derived from.
      { address: cards, abi: cardsOnChainAbi, functionName: "artSeedOf" as const, args: [id] as const },
      { address: cards, abi: cardsOnChainAbi, functionName: "mintedAt" as const, args: [id] as const },
      { address: cardYield, abi: cardYieldAbi, functionName: "accruedOf" as const, args: [id] as const },
      { address: cardYield, abi: cardYieldAbi, functionName: "weightOf" as const, args: [id] as const },
      { address: vault, abi: stakingVaultAbi, functionName: "activeForge" as const, args: [id] as const },
      { address: vault, abi: stakingVaultAbi, functionName: "protectionOf" as const, args: [id] as const },
      { address: vault, abi: stakingVaultAbi, functionName: "protectorOf" as const, args: [id] as const },
      { address: vault, abi: stakingVaultAbi, functionName: "activeRaidOf" as const, args: [id] as const },
      { address: vault, abi: stakingVaultAbi, functionName: "raidStatusOf" as const, args: [id] as const },
    ]),
    query: { enabled: connected && ownedIds.length > 0, refetchInterval: POLL_MS },
  });

  const walletForgeIds = useMemo(
    () => (walletQ.data?.[6] as readonly bigint[] | undefined) ?? [],
    [walletQ.data],
  );
  const allForgeIds = useMemo(() => {
    const set = new Set<bigint>([...walletForgeIds, ...(liveForgeIdsQ.data ?? [])]);
    return [...set].sort((a, b) => (a < b ? -1 : 1));
  }, [walletForgeIds, liveForgeIdsQ.data]);

  const forgesQ = useReadContracts({
    allowFailure: false,
    contracts: allForgeIds.map((id) => ({
      address: vault,
      abi: stakingVaultAbi,
      functionName: "getForge" as const,
      args: [id] as const,
    })),
    query: { enabled: allForgeIds.length > 0, refetchInterval: POLL_MS },
  });

  // --------------------------------------------------------------- assemble
  const [nowSec, setNowSec] = useState(0n);
  useEffect(() => {
    setNowSec(BigInt(Math.floor(Date.now() / 1000)));
    const t = setInterval(() => setNowSec(BigInt(Math.floor(Date.now() / 1000))), 10_000);
    return () => clearInterval(t);
  }, []);

  const snap: Snapshot = useMemo(() => {
    const p = protocolQ.data;
    if (!p) return EMPTY_SNAPSHOT;
    const w = connected ? walletQ.data : undefined;

    const forges: Record<string, ForgeView> = {};
    if (forgesQ.data) {
      forgesQ.data.forEach((raw, i) => {
        const t = raw as {
          staker: Address;
          tokenId: bigint;
          targetTier: number;
          amount: bigint;
          maturesAt: bigint;
          claimDeadline: bigint;
          isMature: boolean;
          isSweepable: boolean;
        };
        forges[allForgeIds[i].toString()] = {
          staker: t.staker,
          tokenId: t.tokenId,
          targetTier: Number(t.targetTier),
          amount: t.amount,
          maturesAt: BigInt(t.maturesAt),
          claimDeadline: BigInt(t.claimDeadline),
          isMature: t.isMature,
          isSweepable: t.isSweepable,
        };
      });
    }

    const myCards: CardFixture[] = [];
    if (connected && cardsDetailQ.data && ownedIds.length > 0) {
      const d = cardsDetailQ.data as unknown[];
      const STRIDE = 10;
      ownedIds.forEach((id, i) => {
        const tier = Number(d[i * STRIDE + 0] as number);
        const seed = d[i * STRIDE + 1] as `0x${string}`;
        myCards.push({
          tokenId: id,
          owner: wallet,
          tier,
          seed,
          mintedAt: BigInt(d[i * STRIDE + 2] as bigint),
          material: materialOf(seed, tier),
          accrued: d[i * STRIDE + 3] as bigint,
          weight: d[i * STRIDE + 4] as bigint,
          activeForgeId: d[i * STRIDE + 5] as bigint,
          protection: d[i * STRIDE + 6] as bigint,
          protector: d[i * STRIDE + 7] as Address,
          activeRaidId: d[i * STRIDE + 8] as bigint,
          raidStatus: Number(d[i * STRIDE + 9] as number),
        });
      });
    }

    const sweepableIds = allForgeIds.filter(
      (id) => forges[id.toString()]?.isSweepable,
    );

    return {
      now: nowSec,
      cardsOnChain: {
        totalSupply: p[0] as bigint,
        totalEverMinted: p[23] as bigint,
        maxSupply: 2222n,
        remainingMintable: p[1] as bigint,
        tierCount: [p[2], p[3], p[4], p[5], p[6]] as Snapshot["cardsOnChain"]["tierCount"],
        tierDurations: [
          BigInt(p[17] as bigint),
          BigInt(p[18] as bigint),
          BigInt(p[19] as bigint),
          BigInt(p[20] as bigint),
          BigInt(p[21] as bigint),
        ] as Snapshot["cardsOnChain"]["tierDurations"],
      },
      cardsToken: {
        totalSupply: p[7] as bigint,
        balanceOf: (w?.[0] as bigint) ?? 0n,
      },
      mintHook: {
        tradingEnabled: p[8] as boolean,
        tradingEnabledAt: BigInt(p[9] as bigint),
        deployerBoughtTokens: p[10] as bigint,
      },
      stakingVault: {
        totalStaked: p[11] as bigint,
        stakedOf: (w?.[1] as bigint) ?? 0n,
        lockedOf: (w?.[2] as bigint) ?? 0n,
        freeStakeOf: (w?.[3] as bigint) ?? 0n,
        pendingRewards: (w?.[4] as bigint) ?? 0n,
        claimable: (w?.[5] as bigint) ?? 0n,
        tierSlotsRemaining: [0n, p[12], p[13], p[14], p[15]] as Snapshot["stakingVault"]["tierSlotsRemaining"],
        raidGrace: BigInt(p[22] as bigint),
        forgesOf: [...walletForgeIds],
        forges,
      },
      cardYield: {
        totalWeight: p[16] as bigint,
        claimable: (w?.[7] as bigint) ?? 0n,
      },
      curve: { ocardsPerEth: curveQ.data ?? 0n },
      myCards,
      sweepableIds,
    };
  }, [
    protocolQ.data,
    walletQ.data,
    connected,
    wallet,
    ownedIds,
    cardsDetailQ.data,
    forgesQ.data,
    allForgeIds,
    curveQ.data,
    nowSec,
  ]);

  const anyError =
    protocolQ.isError ||
    (connected && (walletQ.isError || ownedIdsQ.isError || cardsDetailQ.isError)) ||
    liveForgeIdsQ.isError ||
    forgesQ.isError;

  const stillLoading =
    protocolQ.isPending ||
    (connected &&
      (walletQ.isPending ||
        ownedIdsQ.isPending ||
        (ownedIds.length > 0 && cardsDetailQ.isPending))) ||
    (allForgeIds.length > 0 && forgesQ.isPending);

  const dataMode: DataMode = anyError ? "error" : stillLoading ? "loading" : "success";

  const value: LiveState = useMemo(
    () => ({
      snap,
      dataMode,
      refetch: () => queryClient.invalidateQueries(),
      connected,
      wallet,
      wrongNetwork,
      hasInjected: connectors.length > 0,
      connect: () => {
        const injectedConnector = connectors[0];
        if (injectedConnector) connect({ connector: injectedConnector });
      },
      disconnect: () => disconnect(),
      switchToPinned: () => switchChain({ chainId: chain.id }),
    }),
    [snap, dataMode, connected, wallet, wrongNetwork, connectors, connect, disconnect, switchChain, queryClient],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** App-level wallet + data state (successor of the mock's useDemo). */
export function useApp(): LiveState {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useApp must be used inside LiveProvider");
  return ctx;
}

/** The live Snapshot (same shape the design mock consumed). */
export function useSnapshot(): Snapshot {
  return useApp().snap;
}

/** True only after client mount — avoids hydration drift on countdowns. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Live wall-clock in unix SECONDS, re-rendering every second. Used to flip forge
 * state (maturing → complete → lapsed) the instant a deadline passes, rather than
 * waiting for the ~12s chain poll. Safe against the on-chain flags: maturesAt /
 * claimDeadline are fixed timestamps, so `now >= deadline` mirrors the contract.
 */
export function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
