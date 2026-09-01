/**
 * Read-routing POLICY for the wallet-first transport (lib/chain/walletTransport.ts).
 *
 * Kept in its own dependency-free module so the rules that decide *where a read
 * goes* are unit-testable without spinning up viem, a wallet, or a network
 * (see rpcRoutingPolicy.test.ts). The transport holds the plumbing; this holds
 * the decisions.
 */

/**
 * Methods that always go to the batched public HTTP endpoint, even with a
 * wallet connected.
 *
 * `eth_getLogs` is the one bulk workload: a first-load history scan issues many
 * ranged requests, which the HTTP transport folds into a few batched
 * round-trips. An EIP-1193 wallet provider takes them strictly one at a time,
 * and several wallets throttle or refuse the method outright — routing it to
 * the wallet is what would make a freshly connected session crawl.
 */
export const HTTP_ONLY_METHODS: ReadonlySet<string> = new Set(["eth_getLogs"]);

/** True when `method` should be served by the connected wallet's RPC. */
export function shouldUseWallet(method: string, hasWallet: boolean): boolean {
  return hasWallet && !HTTP_ONLY_METHODS.has(method);
}

/**
 * True when a wallet-side failure means "this endpoint could not answer"
 * (retry on the public endpoint) rather than "the chain answered: no".
 *
 * Execution reverts and invalid-params are REAL answers — retrying them
 * elsewhere just doubles the work for the same outcome. Everything else
 * (offline, unsupported method, rate limit, timeout, wallet internal error)
 * is worth a second try on public infrastructure.
 */
export function isRetryableWalletError(err: unknown): boolean {
  const code = (err as { code?: number } | null)?.code;
  if (code === -32602) return false; // invalid params — a real rejection
  const message = String((err as { message?: string } | null)?.message ?? "").toLowerCase();
  if (message.includes("revert")) return false; // execution reverted — a real answer
  return true;
}
