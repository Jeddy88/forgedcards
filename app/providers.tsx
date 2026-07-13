"use client";

/**
 * Client-side provider tree: wagmi (wallet + chain clients), react-query
 * (all reads), the live snapshot assembler, and the transaction runner.
 * Everything wallet-scoped lives strictly client-side — SSR output never
 * contains per-wallet state (§14.2).
 */
import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { LiveProvider } from "@/lib/live";
import { TxProvider } from "@/lib/tx";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            refetchOnWindowFocus: true,
            staleTime: 4_000,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <LiveProvider>
          <TxProvider>{children}</TxProvider>
        </LiveProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
