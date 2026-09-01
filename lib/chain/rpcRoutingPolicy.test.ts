/**
 * Unit tests for the wallet-first read-routing policy (owner decision
 * 2026-09-01: public RPC before connect, the visitor's own wallet RPC after).
 * Run: npm run test:unit
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { HTTP_ONLY_METHODS, isRetryableWalletError, shouldUseWallet } from "./rpcRoutingPolicy";

test("no wallet connected → every read goes to the public HTTP endpoint", () => {
  for (const m of ["eth_call", "eth_getBalance", "eth_blockNumber", "eth_getLogs"]) {
    assert.equal(shouldUseWallet(m, false), false, `${m} must not need a wallet`);
  }
});

test("wallet connected → normal reads route to the wallet's own RPC", () => {
  for (const m of ["eth_call", "eth_getBalance", "eth_blockNumber", "eth_chainId", "eth_estimateGas"]) {
    assert.equal(shouldUseWallet(m, true), true, `${m} should use the wallet`);
  }
});

test("eth_getLogs stays on the batched public endpoint even with a wallet", () => {
  // Bulk history scans: HTTP batches them; an EIP-1193 provider cannot, and
  // several wallets throttle or refuse the method outright.
  assert.equal(shouldUseWallet("eth_getLogs", true), false);
  assert.ok(HTTP_ONLY_METHODS.has("eth_getLogs"));
});

test("wallet transport failures fall back to public; real answers do not", () => {
  // Retryable: the endpoint could not answer.
  assert.equal(isRetryableWalletError(new Error("Failed to fetch")), true);
  assert.equal(isRetryableWalletError({ code: -32601, message: "method not supported" }), true);
  assert.equal(isRetryableWalletError({ code: -32005, message: "rate limit exceeded" }), true);
  assert.equal(isRetryableWalletError(undefined), true);

  // NOT retryable: the chain gave a real answer — retrying repeats the work.
  assert.equal(isRetryableWalletError({ code: 3, message: "execution reverted: cap" }), false);
  assert.equal(isRetryableWalletError({ code: -32602, message: "invalid params" }), false);
});
