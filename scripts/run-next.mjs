#!/usr/bin/env node
/**
 * run-next.mjs — cross-platform Next.js runner that pins NEXT_PUBLIC_CHAIN and,
 * for live networks, auto-wires the read-RPC from the repo-root .env so the app
 * can reach the chain without any manual env juggling (Windows-friendly).
 *
 *   node scripts/run-next.mjs <dev|build|start> <local|sepolia|robinhood|mainnet>
 *
 * For live networks it sets NEXT_PUBLIC_RPC_URLS from the root .env's
 * SEPOLIA_RPC_URL / ROBINHOOD_PUBLIC_RPC_URL (falling back to ROBINHOOD_RPC_URL) /
 * MAINNET_RPC_URL unless you already set NEXT_PUBLIC_RPC_URLS.
 *
 * 🔒 API-KEY PROTECTION (owner requirement 2026-07-13): NEXT_PUBLIC_* values are
 * EMBEDDED into the browser bundle — anyone can read them. Keyed/private RPC
 * endpoints (Alchemy, Infura, …) are therefore:
 *   - `dev`   → allowed: the bundle never leaves this machine, so the dev server
 *               uses the fast private endpoint from .env automatically;
 *   - `build` → STRUCTURALLY BLOCKED: an auto-wired keyed URL is dropped (the app
 *               falls back to the public keyless default baked into
 *               lib/contracts/config.ts), and an EXPLICIT keyed
 *               NEXT_PUBLIC_RPC_URLS fails the build loudly. A shipped bundle can
 *               never contain the key.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, network] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node scripts/run-next.mjs <dev|build|start> [local|sepolia|robinhood|mainnet]");
  process.exit(1);
}

const env = { ...process.env };
if (network) env.NEXT_PUBLIC_CHAIN = network;

/** Keyed/private endpoint fingerprints — these must NEVER reach a shipped bundle. */
const KEYED_RPC = /alchemy\.com|alchemyapi\.io|infura\.io|quiknode|quicknode|chainstack|\/v2\/|\/v3\/|api[-_]?key/i;
const isKeyed = (urls) => (urls ?? "").split(",").some((u) => KEYED_RPC.test(u));

// An EXPLICITLY provided keyed endpoint on a build is a hard error — never ship it.
if (cmd === "build" && env.NEXT_PUBLIC_RPC_URLS && isKeyed(env.NEXT_PUBLIC_RPC_URLS)) {
  console.error(
    `[run-next] ❌ NEXT_PUBLIC_RPC_URLS looks like a PRIVATE/keyed endpoint (Alchemy/Infura-style).\n` +
      `Anything in a built bundle is public — shipping it would expose the API key to every visitor.\n` +
      `Use the public keyless defaults (just unset NEXT_PUBLIC_RPC_URLS), or point it at a proxy\n` +
      `that holds the key server-side. Keyed endpoints remain available for local dev runs.`,
  );
  process.exit(1);
}

// Auto-wire the read-RPC from the repo-root .env — DEV ONLY (2026-07-13): builds
// use the production RPC policy baked into lib/contracts/config.ts DEFAULT_RPC
// (for Robinhood: the key-hiding Worker proxy + public fallback). Auto-wiring a
// .env endpoint into a BUILD would silently override that policy. For dev, the
// fast private endpoint is preferred (bundle never leaves this machine).
const RPC_ENV_FOR = {
  sepolia: ["SEPOLIA_RPC_URL"],
  robinhood: ["ROBINHOOD_PUBLIC_RPC_URL", "ROBINHOOD_RPC_URL"],
  mainnet: ["MAINNET_RPC_URL"],
};
let rpcEnvUsed;
if (cmd === "dev" && RPC_ENV_FOR[network] && !env.NEXT_PUBLIC_RPC_URLS) {
  const dotenv = resolve(here, "../../.env");
  if (existsSync(dotenv)) {
    const fromEnv = {};
    for (const line of readFileSync(dotenv, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !line.trim().startsWith("#")) fromEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    for (const key of RPC_ENV_FOR[network]) {
      if (fromEnv[key]) {
        env.NEXT_PUBLIC_RPC_URLS = fromEnv[key];
        rpcEnvUsed = key;
        break;
      }
    }
  }
  if (env.NEXT_PUBLIC_RPC_URLS && cmd === "build" && isKeyed(env.NEXT_PUBLIC_RPC_URLS)) {
    // Auto-wired PRIVATE endpoint on a build: drop it silently-safe — the app falls
    // back to the public keyless default in lib/contracts/config.ts (same origins
    // the CSP allows). The key stays on this machine.
    delete env.NEXT_PUBLIC_RPC_URLS;
    console.log(
      `[run-next] 🔒 ${rpcEnvUsed} is a private/keyed endpoint — NOT embedding it in the build.\n` +
        `[run-next]    The shipped site uses the public keyless RPC default for ${network} instead.\n` +
        `[run-next]    (Your keyed endpoint is still used automatically for local \`dev\` runs.)`,
    );
    rpcEnvUsed = undefined;
  }
  if (env.NEXT_PUBLIC_RPC_URLS) {
    console.log(
      `[run-next] read-RPC for ${network} wired from .env (${rpcEnvUsed})${
        cmd === "dev" && isKeyed(env.NEXT_PUBLIC_RPC_URLS) ? " — private endpoint, local dev only" : ""
      }.`,
    );
  } else if (!rpcEnvUsed) {
    console.log(
      `[run-next] read-RPC for ${network}: using the public keyless default from lib/contracts/config.ts.`,
    );
  }
}

const r = spawnSync("next", [cmd], {
  stdio: "inherit",
  shell: process.platform === "win32", // resolve next.cmd on Windows
  env,
});
process.exit(r.status ?? 0);
