/**
 * Wallet-first read transport (owner decision 2026-09-01: no self-hosted RPC).
 *
 * The dApp owns no RPC infrastructure — no Alchemy key, no proxy to run or pay
 * for. Reads are routed like this:
 *
 *   - NO WALLET (initial page load, browsing visitors) → the chain's PUBLIC
 *     keyless RPC over HTTP, with JSON-RPC batching. Everything on the site is
 *     readable without ever connecting.
 *   - WALLET CONNECTED and on the pinned chain → the visitor's OWN wallet RPC
 *     (their MetaMask network config) via its EIP-1193 provider. Each user
 *     brings their own read capacity, so the public endpoint is never the
 *     bottleneck for signed-in sessions. Signing was always the wallet's job
 *     and is unchanged.
 *
 * Safety properties:
 *   - WRONG-NETWORK GUARD: the wallet is used ONLY while its selected chain is
 *     the pinned one. A wallet sitting on another network would answer reads
 *     from THAT chain (silently wrong data), so in that case we keep reading
 *     from the public RPC and let the app's existing "wrong network" banner
 *     prompt the switch.
 *   - AUTOMATIC FALLBACK: any transport-level failure from the wallet (offline,
 *     method unsupported, wallet RPC down) transparently retries on the public
 *     endpoint, so a restrictive wallet can never leave the UI stuck. Execution
 *     reverts are NOT retried — they are real answers, not failures.
 *   - eth_getLogs STAYS ON HTTP: history scans are the one bulk workload (many
 *     ranged requests on first load). The HTTP transport batches them into a
 *     few round-trips, while an EIP-1193 provider must take them one at a time
 *     — and several wallets throttle or refuse the method outright. Keeping it
 *     on the batched public endpoint is what makes a freshly connected wallet
 *     load fast instead of crawling.
 */
import {
  createTransport,
  fallback,
  http,
  type EIP1193Provider,
  type EIP1193RequestFn,
  type Transport,
} from "viem";
import { HTTP_ONLY_METHODS, isRetryableWalletError, shouldUseWallet } from "./rpcRoutingPolicy";

/** JSON-RPC batching for the HTTP leg (wallet providers batch nothing). */
const BATCH = { batch: { batchSize: 50 } } as const;

/**
 * The connected wallet's provider, or null when there is none / it is on the
 * wrong chain. Module-level (not React state) because the transport is created
 * once at config time but must see the CURRENT value on every request.
 * Registered by `WalletReadProviderSync` in lib/live.tsx.
 */
let walletProvider: EIP1193Provider | null = null;

/** Registers (or clears, with null) the wallet provider used for reads. */
export function setWalletReadProvider(provider: EIP1193Provider | null): void {
  walletProvider = provider;
}

/** True while reads are being served by the connected wallet. */
export function isReadingThroughWallet(): boolean {
  return walletProvider !== null;
}

/**
 * Builds the read transport: wallet-first (when registered and eligible),
 * falling back to the public HTTP endpoint(s).
 */
export function walletFirstTransport(urls: string[]): Transport {
  const httpLeg =
    urls.length > 1
      ? fallback(urls.map((url) => http(url, BATCH)))
      : http(urls[0], BATCH);

  return (config) => {
    const inner = httpLeg(config);
    // Typed as the plain EIP-1193 shape: viem's generic `request` signature is
    // invariant across transports, so route on the erased form and hand the
    // result back through the EIP1193RequestFn contract createTransport wants.
    const request = (async ({ method, params }: { method: string; params?: unknown }) => {
      const provider = walletProvider;
      if (provider && shouldUseWallet(method, true)) {
        try {
          return await provider.request({ method, params } as never);
        } catch (err) {
          if (!isRetryableWalletError(err)) throw err;
          // fall through to the public endpoint
        }
      }
      return (inner.request as (args: { method: string; params?: unknown }) => Promise<unknown>)({
        method,
        params,
      });
    }) as EIP1193RequestFn;

    return createTransport({
      key: "walletFirst",
      name: "Wallet-first (public RPC fallback)",
      type: "walletFirst",
      // The legs do their own retrying; no extra layer here.
      retryCount: 0,
      request,
    });
  };
}
