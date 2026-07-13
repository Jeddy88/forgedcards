"use client";

/** Client hooks for on-chain render data. */
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { fetchTokenUri, type ParsedTokenUri } from "./tokenUri";

/**
 * Fetch + parse a card's tokenURI. Cache key includes tier and owner because
 * the on-chain art embeds both (tier drives material, the footer shows the
 * current owner) — a forge or transfer must invalidate the cached render.
 */
export function useTokenUri(tokenId: bigint | null, tier?: number, owner?: string) {
  const client = usePublicClient();
  return useQuery<ParsedTokenUri>({
    queryKey: ["tokenUri", tokenId?.toString(), tier ?? -1, owner ?? ""],
    queryFn: () => fetchTokenUri(client!, tokenId!),
    enabled: tokenId !== null && !!client,
    staleTime: Infinity, // immutable for a given (id, tier, owner)
    gcTime: 10 * 60 * 1000,
  });
}
