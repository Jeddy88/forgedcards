# Deploy & update the frontend — per network (local / Sepolia / mainnet)

The end-to-end operator flow to deploy the Forged Cards contracts to a network
and point the frontend at them. For the LOCAL anvil loop see `dev-chain.md`;
this doc covers the live-chain (Sepolia, mainnet) flow and the shared
address/ABI regeneration step.

All commands run from the **repo root** unless noted. `forge` reads the root
`.env` automatically (via `foundry.toml`/dotenv); it holds `MAINNET_RPC_URL`,
`SEPOLIA_RPC_URL`, and `ETHERSCAN_API_KEY`. Never print or commit their values.

## Chain reference

| Network | Chain id | Uniswap V4 PoolManager | Source |
|---------|----------|------------------------|--------|
| local   | 31337    | deploy your own (see `dev-chain.md`) | — |
| sepolia | 11155111 | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | developers.uniswap.org/contracts/v4/deployments |
| mainnet | 1        | `0x000000000004444c5dc75cB358380D2e3dE08A90` | Deploy script default (verified) |

The Deploy script defaults `POOL_MANAGER` to the mainnet singleton, so for
**Sepolia you MUST pass `POOL_MANAGER` explicitly** (the Sepolia address above).
For mainnet the default is correct but passing it explicitly is fine too.

## 1. Set env for the target network

Pick the RPC var for the chain from the root `.env` (do not echo it):

```bash
# --- Sepolia ---
export RPC_URL="$SEPOLIA_RPC_URL"
export POOL_MANAGER=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
export DEPLOYER_FIRST_BUY_WEI=2000000000000000   # e.g. 0.002 ETH first buy (or 0)
export ENABLE_TRADING=true                        # true = launch atomically; false = gate stays closed

# --- Mainnet (go-live) ---
export RPC_URL="$MAINNET_RPC_URL"
# POOL_MANAGER defaults to the mainnet singleton — omit or set it explicitly:
export POOL_MANAGER=0x000000000004444c5dc75cB358380D2e3dE08A90
export DEPLOYER_FIRST_BUY_WEI=2000000000000000
export ENABLE_TRADING=true
```

Provide the deployer key the way your setup expects — e.g. `--private-key
$DEPLOYER_PK`, `--account <keystore>`, or a hardware wallet flag. Do NOT put the
key in a committed file.

`DEPLOYER_FIRST_BUY_WEI` is capped at `MAX_DEPLOYER_BUY = 0.1 ether` and only
applies when `ENABLE_TRADING=true`. Leave `ENABLE_TRADING=false` to deploy with
the gate closed (genesis invariants assertable) and launch later with a separate
`enableTrading` call.

## 2. Deploy + verify on Etherscan

```bash
forge script script/Deploy.s.sol --broadcast \
  --rpc-url "$RPC_URL" \
  --verify \
  -vv
# (append your key flag, e.g. --private-key $DEPLOYER_PK)
```

`--verify` uses `ETHERSCAN_API_KEY` from the root `.env`. The script runs its
own `DeployChecks` invariant sweep and logs every deployed address. Note the
`MintHook` address from the output.

The broadcast is written to `broadcast/Deploy.s.sol/<chainId>/run-latest.json`
(`11155111` for Sepolia, `1` for mainnet) — that's what step 3 reads.

## 3. Regenerate the frontend's address + ABI config

`RPC_URL` must still point at the network you just deployed to (gen-addresses
resolves the PoolManager from the deployed hook via `eth_call`).

```bash
cd frontend

# ABIs are chain-independent — regenerate once from out/ (run `forge build` first
# at the repo root if out/ is stale):
node scripts/extract-abis.mjs          # or: npm run abis

# Addresses for the network you deployed to:
RPC_URL="$RPC_URL" node scripts/gen-addresses.mjs sepolia    # npm run addresses:sepolia
# or
RPC_URL="$RPC_URL" node scripts/gen-addresses.mjs mainnet    # npm run addresses:mainnet
```

This writes `frontend/lib/contracts/addresses.<network>.json` with the
checksummed contract addresses, the resolved `poolManager`, and the earliest
`deploymentBlock` (the start block for all event scans). It **fails loudly** if
the broadcast file is missing or any expected contract is absent.

Until you run this, the `addresses.sepolia.json` / `addresses.mainnet.json`
files carry `UNSET` sentinels, and the config layer refuses to build that
environment (it will not ship a placeholder address).

## 4. Build the app for that network

Windows-friendly (works everywhere — the network is baked into the script):
```
cd frontend
npm run build:sepolia     # or: npm run build:mainnet
```
(For a custom public RPC in the built site, set `NEXT_PUBLIC_RPC_URLS` in `frontend/.env.local`;
the pinned chain comes from the `:sepolia` / `:mainnet` script.)

- `NEXT_PUBLIC_CHAIN` pins the environment (`local` [default] | `sepolia` |
  `mainnet`). It selects the address JSON, the chain id, and the wagmi chain.
- `NEXT_PUBLIC_RPC_URLS` (comma-separated) sets the public read RPCs and the CSP
  `connect-src` allowlist. Required for live chains (local defaults to anvil).
- Optional: `NEXT_PUBLIC_LOG_CHUNK` (default 9000 on live chains) sizes event-
  scan block ranges for range-capped RPCs.

`npm run dev`/`npm run start` with the same env vars run the app against the
chosen network. Reads work without a wallet; to transact, connect an injected
wallet on the matching chain id (the app warns and blocks writes on a mismatch).

## Quick reference — npm scripts

```
npm run abis                # extract-abis.mjs        (chain-independent)
npm run addresses:local     # gen-addresses.mjs local   (chain 31337)
npm run addresses:sepolia   # gen-addresses.mjs sepolia (chain 11155111, needs RPC_URL)
npm run addresses:mainnet   # gen-addresses.mjs mainnet (chain 1, needs RPC_URL)
```
