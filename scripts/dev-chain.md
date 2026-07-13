# Local dev chain — boot the full Forged Cards stack

One local environment: `anvil` (Foundry local chain) + the real contracts from
`script/Deploy.s.sol`, then the Next.js app reading live data. Everything below
is run from the **repo root** unless noted. Verified end-to-end on 2026-07-04
(anvil/forge 1.7.1, node 24).

## 0. Prerequisites

- Foundry (`anvil`, `forge`, `cast`) on PATH.
- `forge build` succeeds at the repo root (produces `out/` — the ABI source).
- Frontend deps installed: `cd frontend && npm install`.

## 1. Start anvil (terminal A)

```bash
anvil --port 8545 --chain-id 31337
```

Leave it running. Default funded accounts (mnemonic `test test … junk`):

| # | address | role in the harness |
|---|---------|---------------------|
| 0 | `0xf39F…2266` | deployer / owner (key `0xac09…ff80`) |
| 1 | `0x7099…79C8` | test user (key `0x59c6…690d`) |
| 2 | `0x3C44…93BC` | sweeper/keeper (key `0x5de4…365a`) |

> Note: the anvil private key 0 is `0xac0974…cbed5efcae784d7bf4f2ff80` (the
> real one — not the frequently-misquoted `…cbfa5c404f5654cbbd0adc39`).

## 2. Deploy PoolManager + the full stack (terminal B)

`script/Deploy.s.sol` needs a Uniswap V4 `PoolManager` to point at. On mainnet
it defaults to the canonical singleton; locally we deploy a fresh one and pass
its address via `POOL_MANAGER`.

```bash
# 2a. Deploy a local PoolManager (owner = anvil acct 0).
POOL_MANAGER=$(forge create "lib/v4-core/src/PoolManager.sol:PoolManager" \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast --json \
  --constructor-args 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).deployedTo))")

# 2b. Deploy + wire the whole Forged Cards system (token, NFT, vault,
#     CardYield, art/renderer, routers, mined hook, pool init + seeded curve).
#     Env the script reads:
#       POOL_MANAGER          - required locally (address from 2a)
#       ENABLE_TRADING        - false here; we launch separately in step 3
#       DEPLOYER_FIRST_BUY_WEI - only used when ENABLE_TRADING=true
POOL_MANAGER=$POOL_MANAGER ENABLE_TRADING=false \
forge script script/Deploy.s.sol --broadcast \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  -vv
```

The script runs its own `DeployChecks` invariant sweep and prints
`DeployChecks: ALL PASS`. It leaves trading DISABLED so genesis invariants hold.

## 3. Launch trading with a first buy (terminal B)

`enableTrading` is a one-shot payable call that flips the gate and does the
deployer's atomic first buy (bounded by `MAX_DEPLOYER_BUY = 0.1 ether`). The
buy routes through the router and pays the fee + mints cards like any other.

The local PoolManager needs an ETH float to pay out the fee `take` (a mainnet
manager already holds ETH). Fund it, then launch:

```bash
HOOK=<MintHook address from step 2 output>
POOL_MANAGER=<address from 2a>

# Give the local PoolManager a working ETH float.
cast rpc anvil_setBalance $POOL_MANAGER 0x3635C9ADC5DEA00000 --rpc-url http://127.0.0.1:8545

# Enable trading + first buy (mints ~24 cards at 0.05 ETH on the launch curve).
cast send $HOOK "enableTrading()" --value 0.05ether \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Alternatively do steps 2b+3 in one shot with
`ENABLE_TRADING=true DEPLOYER_FIRST_BUY_WEI=50000000000000000` on the
`forge script` call (fund the PoolManager first).

## 4. Generate the frontend's address + ABI config

```bash
cd frontend
node scripts/extract-abis.mjs    # out/ → lib/contracts/abis.ts  (typed `as const`)
node scripts/gen-addresses.mjs   # broadcast → lib/contracts/addresses.local.json
```

`gen-addresses.mjs` reads `broadcast/Deploy.s.sol/31337/run-latest.json`, so
re-run it after every fresh deploy. Both are also wired as npm scripts:
`npm run abis`, `npm run addresses`.

## 5. Run the app

```bash
cd frontend
npm run dev        # http://localhost:3000, reads live anvil state
```

The app pins chain id 31337 (local). Connect an injected wallet pointed at
`http://127.0.0.1:8545` (chain id 31337) to transact; without a wallet it stays
fully readable.

## 6. Warping time for forge maturity / claim / sweep

Forges mature after 12–48 h and have a 3-hour claim window. Fast-forward anvil:

```bash
# advance 12h + 1min (past Uncommon maturation, inside the claim window)
cast rpc evm_increaseTime 0xa8e0 --rpc-url http://127.0.0.1:8545   # 43260 seconds
cast rpc evm_mine --rpc-url http://127.0.0.1:8545

# to make a forge SWEEPABLE, advance past maturation + the 3h window, e.g. Rare:
cast rpc evm_increaseTime 0x1a568 --rpc-url http://127.0.0.1:8545  # 24h+3h+1min
cast rpc evm_mine --rpc-url http://127.0.0.1:8545
```

`evm_increaseTime` takes a hex seconds value; `evm_mine` bakes it into a block
so views (`isMature`, `isSweepable`) update. The UI countdowns read wall-clock
time, so also refresh the browser after a warp.

## 7. Verify every flow end-to-end

```bash
cd frontend
node scripts/verify-flows.mjs        # or: npm run verify:flows
```

Drives viem against anvil through the SAME call paths the UI signs: buy (with
hookData) → mints to the specified recipient, buy without hookData → mints to
tx.origin (the signer, contract fallback), sell → CardYield, stake/unstake,
forge → warp → claim, forge → lapse → sweep, card-yield claim + withdraw,
staking-rewards settle + withdraw. Prints `N passed, 0 failed` and exits
non-zero on any failure. Requires trading enabled (step 3).
```
```
