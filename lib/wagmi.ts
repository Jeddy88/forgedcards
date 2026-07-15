/**
 * wagmi/viem client configuration. One chain only — the pinned environment
 * from lib/contracts/config (local anvil 31337, Sepolia 11155111, Robinhood
 * Chain 4663, or Ethereum mainnet 1).
 *
 * - Connector: injected (MetaMask & friends). No WalletConnect (no external
 *   scripts/relays, keeps CSP tight); add one deliberately if the owner asks.
 * - Transport: `fallback()` over the configured RPC list, then the chain's
 *   default public RPC (live chains) — resilient reads with automatic ranking.
 * - Reads work with NO wallet (public client); the wallet is only for writes.
 * - Private keys are never touched: signing stays inside the injected wallet.
 */
import { createConfig, fallback, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";
import { CHAIN_ENV, PINNED_CHAIN_ID, RPC_URLS } from "@/lib/contracts/config";

const anvil = defineChain({
  id: 31337,
  name: "Anvil (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URLS[0] ?? "http://127.0.0.1:8545"] } },
  testnet: true,
});

/**
 * Robinhood Chain mainnet (Arbitrum Orbit L2). Not shipped in wagmi/chains yet,
 * so defined here from the official docs (docs.robinhood.com/chain, 2026-07-09):
 * chain id 4663, gas in ETH, Blockscout as the canonical explorer. The default
 * public RPC doubles as the transport fallback behind any configured RPCs.
 */
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: {
    // Canonical Multicall3 — verified deployed on Robinhood Chain (2026-07-13,
    // eth_getCode 3,808 bytes). With this present wagmi/viem AGGREGATES batched
    // reads into a single eth_call — the per-poll read burst (cards, yields,
    // raid statuses…) collapses from dozens of requests to ~one, which is what
    // keeps the RPC-proxy Worker inside its free request quota.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 1 },
  },
});

// Exactly ONE chain per build — pinned by the environment. Split the branches
// so each createConfig call has a single-chain literal type (the transports
// Record must key precisely that chain id).
//
// JSON-RPC BATCHING (2026-07-13, request-quota fix): concurrent calls within a
// tick are folded into ONE HTTP request (the RPC-proxy Worker accepts batches up
// to 100 — see proxy/rpc-worker.js MAX_BATCH). Together with Multicall3 this
// collapses the connected-wallet polling burst from dozens of HTTP requests per
// cycle to ~one, keeping the Worker inside its free daily request quota.
const BATCH = { batch: { batchSize: 50 } } as const;
const rpcTransports = RPC_URLS.map((url) => http(url, BATCH));

export const wagmiConfig =
  CHAIN_ENV === "mainnet"
    ? createConfig({
        chains: [mainnet],
        connectors: [injected()],
        transports: {
          // fallback ranks the configured RPCs, then the chain's public RPC.
          [mainnet.id]: fallback([...rpcTransports, http(undefined, BATCH)]),
        },
        ssr: true,
      })
    : CHAIN_ENV === "robinhood"
      ? createConfig({
          chains: [robinhood],
          connectors: [injected()],
          transports: {
            // fallback ranks the configured RPCs, then the chain's public RPC.
            [robinhood.id]: fallback([...rpcTransports, http(undefined, BATCH)]),
          },
          ssr: true,
        })
      : CHAIN_ENV === "sepolia"
        ? createConfig({
            chains: [sepolia],
            connectors: [injected()],
            transports: {
              [sepolia.id]: fallback([...rpcTransports, http(undefined, BATCH)]),
            },
            ssr: true,
          })
        : createConfig({
            chains: [anvil],
            connectors: [injected()],
            transports: {
              [anvil.id]: fallback(rpcTransports.length > 0 ? rpcTransports : [http()]),
            },
            ssr: true, // render disconnected on the server; no per-wallet state in SSR output
          });

/** The single chain this build targets. */
export const chain =
  CHAIN_ENV === "mainnet"
    ? mainnet
    : CHAIN_ENV === "robinhood"
      ? robinhood
      : CHAIN_ENV === "sepolia"
        ? sepolia
        : anvil;

if (chain.id !== PINNED_CHAIN_ID) {
  throw new Error(`chain id mismatch: config pins ${PINNED_CHAIN_ID}, chain is ${chain.id}`);
}
