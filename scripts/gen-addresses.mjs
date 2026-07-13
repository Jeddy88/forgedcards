#!/usr/bin/env node
/**
 * gen-addresses.mjs — generates `frontend/lib/contracts/addresses.<network>.json`
 * from a Foundry broadcast of `script/Deploy.s.sol` for the given network.
 *
 *   node scripts/gen-addresses.mjs [local|sepolia|robinhood|mainnet]   (default: local)
 *
 * Reads ../../broadcast/Deploy.s.sol/<chainId>/run-latest.json, picks each
 * named CREATE/CREATE2, resolves the PoolManager from the hook's immutable via
 * eth_call (against RPC_URL), and records the earliest deployment block for
 * event scans. Fails loudly if the broadcast file is missing or any wanted
 * contract is absent from it.
 *
 * ABIs are chain-independent — regenerate them separately with
 * `node scripts/extract-abis.mjs` (no per-network variant needed).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Supported networks → their chain id + a sensible default RPC. */
const NETWORKS = {
  local: { chainId: 31337, defaultRpc: "http://127.0.0.1:8545" },
  sepolia: { chainId: 11155111, defaultRpc: undefined },
  robinhood: { chainId: 4663, defaultRpc: "https://rpc.mainnet.chain.robinhood.com" },
  mainnet: { chainId: 1, defaultRpc: undefined },
};

const network = (process.argv[2] ?? "local").toLowerCase();
const cfg = NETWORKS[network];
if (!cfg) {
  console.error(
    `Unknown network "${network}". Use one of: ${Object.keys(NETWORKS).join(", ")}.`,
  );
  process.exit(1);
}

const RPC = process.env.RPC_URL ?? cfg.defaultRpc;
if (!RPC) {
  console.error(
    `No RPC endpoint for "${network}". Set RPC_URL=<your ${network} RPC> ` +
      `(it's needed to resolve the PoolManager from the hook).`,
  );
  process.exit(1);
}

const broadcastPath = resolve(
  here,
  `../../broadcast/Deploy.s.sol/${cfg.chainId}/run-latest.json`,
);
if (!existsSync(broadcastPath)) {
  console.error(
    `Broadcast not found: ${broadcastPath}\n` +
      `Deploy to ${network} first:  forge script script/Deploy.s.sol --broadcast ` +
      `--rpc-url <${network} rpc>  (see scripts/deploy-and-update.md).`,
  );
  process.exit(1);
}

const run = JSON.parse(readFileSync(broadcastPath, "utf8"));

const WANT = {
  ForgeToken: "cardsToken",
  ForgedCards: "cardsOnChain",
  ForgedCardsTestnet: "cardsOnChain", // testnet build variant (short forge times) — same frontend key
  StakingVault: "stakingVault",
  StakingVaultTestnet: "stakingVault", // testnet build variant (15m raid grace) — same frontend key
  CardYield: "cardYield",
  CardArt: "cardArt",
  CardRenderer: "cardRenderer",
  // swapRouter is NOT read from the broadcast: it is resolved from the hook's immutable
  // `router()` below — the UniversalRouter user funds flow through (official deployment on
  // live networks, LocalUniversalRouter on local). The PoolSwapTest in the broadcast is
  // recorded as `quoteSim`: it is used EXCLUSIVELY inside eth_call quote simulations
  // (lib/chain/quote.ts) — never signed, never holds funds.
  PoolSwapTest: "quoteSim",
  PoolModifyLiquidityTest: "lpRouter",
  MintHook: "mintHook",
};

const addrs = {};
for (const tx of run.transactions ?? []) {
  const key = WANT[tx.contractName];
  if (key && (tx.transactionType === "CREATE" || tx.transactionType === "CREATE2")) {
    addrs[key] = tx.contractAddress;
  }
  // Split-launch step 1 deploys the (empty) LPLocker in the MAIN deploy so the footer
  // can publish its address before launch. OPTIONAL (absent on other paths) — not in
  // WANT, so its absence never fails the missing-deployments check below.
  if (tx.contractName === "LPLocker" && tx.transactionType === "CREATE") {
    addrs.lpLocker = tx.contractAddress;
  }
  // The CREATE2-factory path records the hook as a CALL to the factory with
  // additionalContracts carrying the actual deployment.
  for (const extra of tx.additionalContracts ?? []) {
    // The only CREATE2 in the deploy is the mined hook.
    if (extra.transactionType === "CREATE2" && !addrs.mintHook) addrs.mintHook = extra.address;
  }
}

// The LPLocker deploys in the LOCK step (script/LockLP.s.sol), not the main deploy,
// so it is OPTIONAL here: recorded when that broadcast exists (post-lock re-sync),
// absent before the lock. The footer shows it only once present.
// STALENESS GUARD: a leftover lock broadcast from an OLDER deployment on the same
// chain must never leak its locker into a fresh deployment's address file — only
// accept a lock run mined at/after this deploy's earliest block.
const deployEarliestBlock = Math.min(
  ...((run.receipts ?? []).map((r) => Number(r.blockNumber)).filter(Number.isFinite)),
);
const lockPath = resolve(here, `../../broadcast/LockLP.s.sol/${cfg.chainId}/run-latest.json`);
if (existsSync(lockPath)) {
  const lockRun = JSON.parse(readFileSync(lockPath, "utf8"));
  const lockEarliestBlock = Math.min(
    ...((lockRun.receipts ?? []).map((r) => Number(r.blockNumber)).filter(Number.isFinite)),
  );
  if (Number.isFinite(lockEarliestBlock) && lockEarliestBlock >= deployEarliestBlock) {
    for (const tx of lockRun.transactions ?? []) {
      if (tx.contractName === "LPLocker" && tx.transactionType === "CREATE") {
        addrs.lpLocker = tx.contractAddress;
      }
    }
  } else {
    console.log(
      `note: ignoring stale LockLP broadcast (block ${lockEarliestBlock} predates this deploy's block ${deployEarliestBlock}).`,
    );
  }
}

const missing = Object.entries(WANT)
  .filter(([, key]) => !addrs[key])
  .map(([contract]) => contract);
if (missing.length) {
  console.error(
    `Broadcast ${broadcastPath} is missing deployments for: ${missing.join(", ")}.\n` +
      `The run may be partial or from an older Deploy script — redeploy and retry.`,
  );
  process.exit(1);
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} from RPC`);
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

// router() selector on the hook — the UniversalRouter the product uses (immutable, so the
// hook itself is the single source of truth; no per-network address table to drift).
let routerWord;
try {
  routerWord = await rpc("eth_call", [{ to: addrs.mintHook, data: "0xf887ea40" }, "latest"]);
} catch (e) {
  console.error(`Failed to resolve the hook's router() via ${RPC}: ${e.cause?.code ?? e.message}.`);
  process.exit(1);
}
if (!routerWord || routerWord === "0x" || routerWord.length < 66) {
  console.error(`router() returned empty from ${addrs.mintHook} via ${RPC} — wrong RPC or hook.`);
  process.exit(1);
}
addrs.swapRouter = "0x" + routerWord.slice(26);

// poolManager() selector on the hook (BaseHook immutable getter).
let pmWord;
try {
  pmWord = await rpc("eth_call", [{ to: addrs.mintHook, data: "0xdc4c90d3" }, "latest"]);
} catch (e) {
  console.error(
    `Failed to reach the ${network} RPC at ${RPC} to resolve the PoolManager: ` +
      `${e.cause?.code ?? e.message}.\n` +
      `Set RPC_URL to a working ${network} endpoint (chain ${cfg.chainId}) and retry.`,
  );
  process.exit(1);
}
if (!pmWord || pmWord === "0x" || pmWord.length < 66) {
  console.error(
    `poolManager() returned empty from ${addrs.mintHook} via ${RPC} — ` +
      `wrong RPC for ${network}, or the hook isn't deployed there.`,
  );
  process.exit(1);
}
addrs.poolManager = "0x" + pmWord.slice(26);

// WIRING PROOF (added after the 2026-07-13 Sepolia nonce-scramble incident): the
// recorded addresses are only trusted once the LIVE chain confirms the NFT is wired
// to the recorded hook — `cards.minter()` (selector 0x07546172) must equal mintHook.
// A scrambled/partial broadcast fails HERE, loudly, before the frontend ever gets
// a broken address file.
let minterWord;
try {
  minterWord = await rpc("eth_call", [{ to: addrs.cardsOnChain, data: "0x07546172" }, "latest"]);
} catch (e) {
  console.error(`Failed to read cards.minter() via ${RPC}: ${e.cause?.code ?? e.message}.`);
  process.exit(1);
}
const minterAddr = minterWord && minterWord.length >= 66 ? "0x" + minterWord.slice(26) : "";
if (minterAddr.toLowerCase() !== addrs.mintHook.toLowerCase()) {
  console.error(
    `WIRING MISMATCH on ${network}: cards.minter() is "${minterAddr || "(no code / empty)"}" but the broadcast ` +
      `records mintHook ${addrs.mintHook}.\n` +
      `The deployment is partial or its transactions mined out of order (RPC nonce scramble) — ` +
      `do NOT use these addresses. Redeploy (the drivers now broadcast with --slow) and re-sync.`,
  );
  process.exit(1);
}
console.log(`wiring proof: cards.minter() == mintHook (${addrs.mintHook}) ✓`);

// Earliest deployment block (start of all event scans).
let deploymentBlock = Number.MAX_SAFE_INTEGER;
for (const r of run.receipts ?? []) {
  deploymentBlock = Math.min(deploymentBlock, Number(r.blockNumber));
}
if (!Number.isFinite(deploymentBlock) || deploymentBlock === Number.MAX_SAFE_INTEGER) {
  deploymentBlock = 0;
}

const out = {
  chainId: cfg.chainId,
  deploymentBlock,
  contracts: addrs,
};
const dest = resolve(here, `../lib/contracts/addresses.${network}.json`);
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${dest}`);
console.log(out);
