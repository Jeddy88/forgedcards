#!/usr/bin/env node
/**
 * extract-abis.mjs — regenerates `frontend/lib/contracts/abis.ts` from the
 * Foundry build output (`../out`). Run `forge build` at the repo root first.
 *
 *   node scripts/extract-abis.mjs
 *
 * The ABIs are emitted `as const` so viem/wagmi infer full call/return types,
 * and they include every custom error so revert reasons decode in the UI.
 * out/ is the single source of truth — never hand-edit abis.ts.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../out");

/** exportName -> artifact path under out/ */
const ARTIFACTS = {
  // export names keep the frontend-stable `cardsTokenAbi`/`cardsOnChainAbi` keys;
  // only the Solidity artifact PATHS moved with the contract rename (ForgeToken /
  // ForgedCards — the on-chain contract names, owner decision 2026-07-09).
  cardsTokenAbi: "ForgeToken.sol/ForgeToken.json",
  cardsOnChainAbi: "ForgedCards.sol/ForgedCards.json",
  stakingVaultAbi: "StakingVault.sol/StakingVault.json",
  cardYieldAbi: "CardYield.sol/CardYield.json",
  mintHookAbi: "MintHook.sol/MintHook.json",
  cardRendererAbi: "CardRenderer.sol/CardRenderer.json",
  poolSwapTestAbi: "PoolSwapTest.sol/PoolSwapTest.json",
  poolManagerAbi: "PoolManager.sol/PoolManager.json",
  universalRouterAbi: "IUniversalRouter.sol/IUniversalRouter.json",
};

let ts = `/**
 * GENERATED FILE — do not edit by hand.
 * Source: Foundry artifacts in ../../out (run \`forge build\` at the repo root,
 * then \`node scripts/extract-abis.mjs\` from frontend/).
 */\n\n`;

for (const [name, rel] of Object.entries(ARTIFACTS)) {
  const artifact = JSON.parse(readFileSync(join(outDir, rel), "utf8"));
  if (!Array.isArray(artifact.abi)) throw new Error(`no abi in ${rel}`);
  ts += `export const ${name} = ${JSON.stringify(artifact.abi)} as const;\n\n`;
}

const dest = resolve(here, "../lib/contracts/abis.ts");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, ts);
console.log(`wrote ${dest} (${Object.keys(ARTIFACTS).length} ABIs)`);
