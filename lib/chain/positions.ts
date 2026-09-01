/**
 * Uniswap v4 PositionManager integration for the Liquidity tab:
 *  - ADD:    encode MINT_POSITION + SETTLE_PAIR + SWEEP  → modifyLiquidities.
 *  - REMOVE: encode BURN_POSITION + TAKE_PAIR            → modifyLiquidities.
 *  - LIST:   enumerate the wallet's positions in OUR pool (event scan + reads).
 *
 * Action byte codes are transcribed verbatim from the installed
 * v4-periphery/src/libraries/Actions.sol (MINT_POSITION 0x02, DECREASE 0x01,
 * BURN 0x03, SETTLE_PAIR 0x0d, TAKE_PAIR 0x11, SWEEP 0x14). Amount math comes
 * from lib/chain/liquidity.ts (unit-tested against Uniswap's constants).
 *
 * Every write flows through the app's TxRunner, which SIMULATES before signing —
 * so a malformed encoding reverts safely rather than losing funds. FORGE is
 * pulled through Permit2 (two approvals), exactly like the launch seed did.
 */
import {
  encodeAbiParameters,
  parseAbiItem,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { cardsTokenAbi } from "@/lib/contracts/abis";
import {
  addressOf,
  positionManagerAddress,
  permit2Address,
  ENV,
  LOG_CHUNK,
} from "@/lib/contracts/config";
import type { TxStep } from "@/lib/tx";
import { canonicalPoolKey } from "./swap";
import { readSqrtPriceX96 } from "./quote";
import { getAmountsForLiquidity, getSqrtRatioAtTick } from "./liquidity";

const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as Address;
export const MAX_UINT160 = (1n << 160n) - 1n;
export const MAX_UINT48 = (1n << 48n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;

// Action codes (Actions.sol).
const MINT_POSITION = 0x02;
const BURN_POSITION = 0x03;
const SETTLE_PAIR = 0x0d;
const TAKE_PAIR = 0x11;
const SWEEP = 0x14;

const POOL_KEY_PARAM = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

/** Minimal PositionManager ABI (only what we call/read). */
export const positionManagerAbi = [
  {
    type: "function",
    name: "modifyLiquidities",
    stateMutability: "payable",
    inputs: [
      { name: "unlockData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getPositionLiquidity",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "getPoolAndPositionInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [POOL_KEY_PARAM, { name: "info", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

/** Minimal Permit2 ABI. */
export const permit2Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

const actionsHex = (codes: number[]): Hex =>
  ("0x" + codes.map((c) => c.toString(16).padStart(2, "0")).join("")) as Hex;

type PoolKey = ReturnType<typeof canonicalPoolKey>;

/** unlockData for MINT_POSITION + SETTLE_PAIR + SWEEP (SWEEP refunds spare ETH). */
export function encodeAddLiquidity(
  poolKey: PoolKey,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  amount0Max: bigint,
  amount1Max: bigint,
  recipient: Address,
): Hex {
  const mint = encodeAbiParameters(
    [
      POOL_KEY_PARAM,
      { type: "int24" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "address" },
      { type: "bytes" },
    ],
    [poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, recipient, "0x"],
  );
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [poolKey.currency0, poolKey.currency1],
  );
  const sweep = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [poolKey.currency0, recipient],
  );
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actionsHex([MINT_POSITION, SETTLE_PAIR, SWEEP]), [mint, settle, sweep]],
  );
}

/** unlockData for BURN_POSITION + TAKE_PAIR (removes ALL liquidity + fees). */
export function encodeRemoveLiquidity(
  poolKey: PoolKey,
  tokenId: bigint,
  amount0Min: bigint,
  amount1Min: bigint,
  recipient: Address,
): Hex {
  const burn = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
    [tokenId, amount0Min, amount1Min, "0x"],
  );
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [poolKey.currency0, poolKey.currency1, recipient],
  );
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actionsHex([BURN_POSITION, TAKE_PAIR]), [burn, take]],
  );
}

const deadline = (): bigint => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

/**
 * Steps to ADD liquidity: up to two FORGE approvals (ERC20→Permit2, Permit2→
 * PositionManager) when the current allowances fall short, then the mint. `value`
 * carries the ETH (amount0Max); SWEEP refunds any spare.
 */
export function buildAddLiquiditySteps(args: {
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint; // ETH cap
  amount1Max: bigint; // FORGE cap
  recipient: Address;
  erc20ToPermit2Allowance: bigint;
  permit2ToPosmAllowance: bigint;
}): TxStep[] {
  const steps: TxStep[] = [];
  const token = addressOf("cardsToken");
  const needsOcards = args.amount1Max > 0n;

  if (needsOcards && args.erc20ToPermit2Allowance < args.amount1Max) {
    steps.push({
      label: `Approve FORGE to Permit2`,
      call: {
        contract: "cardsToken",
        abi: cardsTokenAbi,
        functionName: "approve",
        args: [permit2Address, MAX_UINT160],
      },
    });
  }
  if (needsOcards && args.permit2ToPosmAllowance < args.amount1Max) {
    steps.push({
      label: `Permit2: allow PositionManager to use FORGE`,
      call: {
        address: permit2Address,
        abi: permit2Abi,
        functionName: "approve",
        args: [token, positionManagerAddress, MAX_UINT160, MAX_UINT48],
      },
    });
  }
  steps.push({
    label: `Add liquidity (mint position)`,
    call: {
      address: positionManagerAddress,
      abi: positionManagerAbi,
      functionName: "modifyLiquidities",
      args: [
        encodeAddLiquidity(
          args.poolKey,
          args.tickLower,
          args.tickUpper,
          args.liquidity,
          args.amount0Max,
          args.amount1Max,
          args.recipient,
        ),
        deadline(),
      ],
      value: args.amount0Max,
    },
  });
  return steps;
}

/** Step to REMOVE a whole position (burn + take principal + fees). */
export function buildRemoveLiquiditySteps(args: {
  poolKey: PoolKey;
  tokenId: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: Address;
}): TxStep[] {
  return [
    {
      label: `Remove liquidity (position #${args.tokenId})`,
      call: {
        address: positionManagerAddress,
        abi: positionManagerAbi,
        functionName: "modifyLiquidities",
        args: [
          encodeRemoveLiquidity(
            args.poolKey,
            args.tokenId,
            args.amount0Min,
            args.amount1Min,
            args.recipient,
          ),
          deadline(),
        ],
        value: 0n,
      },
    },
  ];
}

// --------------------------------------------------------------------------
// Enumerate the wallet's positions in OUR pool.
// --------------------------------------------------------------------------

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

/** int24 unpacked from a PositionInfo packed word (bits [8..31] lower, [32..55] upper). */
function unpackTick(info: bigint, shift: bigint): number {
  const raw = Number((info >> shift) & 0xffffffn);
  return raw >= 0x800000 ? raw - 0x1000000 : raw; // sign-extend int24
}

export interface PoolPosition {
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  /** Token amounts the position currently holds (at the live price). */
  amount0: bigint; // ETH
  amount1: bigint; // FORGE
}

/**
 * The wallet's LIVE positions in our ETH/FORGE pool. Scans the PositionManager's
 * Transfer(to=user) logs from our deployment block (positions in our pool can't
 * predate it), then keeps only tokenIds still owned by the user, in our pool, with
 * non-zero liquidity. Reads are batched via multicall.
 */
export async function fetchUserPoolPositions(
  client: PublicClient,
  user: Address,
): Promise<PoolPosition[]> {
  if (positionManagerAddress === NATIVE_ETH) return []; // not configured (local)
  const poolKey = canonicalPoolKey();
  const ocards = getAddress(poolKey.currency1);
  const hooks = getAddress(poolKey.hooks);

  // 1. Candidate tokenIds: everything ever transferred TO the user.
  const latest = await client.getBlockNumber();
  const from = ENV.deploymentBlock;
  const ids = new Set<bigint>();

  // ONE request over the whole range (2026-09-01). This query is filtered by an
  // INDEXED recipient topic, so the node answers it from its index cheaply —
  // measured at ~0.6s over the full history on the public Robinhood RPC. The
  // old LOG_CHUNK slicing issued ~4,775 requests here and grew by ~96 more per
  // day on a ~10-blocks-per-second chain, which rate-limited the endpoint (and
  // rate-limit replies carry no CORS headers, so browsers reported them as CORS
  // failures). Chunking is kept ONLY as a fallback for nodes that refuse wide
  // ranges.
  const collect = (logs: { args: { tokenId?: bigint } }[]) => {
    for (const l of logs) if (l.args.tokenId !== undefined) ids.add(l.args.tokenId);
  };
  const query = (fromBlock: bigint, toBlock: bigint) =>
    client.getLogs({
      address: positionManagerAddress,
      event: TRANSFER_EVENT,
      args: { to: user },
      fromBlock,
      toBlock,
    });

  try {
    collect(await query(from, latest));
  } catch {
    const step = LOG_CHUNK > 0n ? LOG_CHUNK : latest - from + 1n;
    for (let start = from; start <= latest; start += step) {
      const end = start + step - 1n > latest ? latest : start + step - 1n;
      collect(await query(start, end));
    }
  }
  if (ids.size === 0) return [];

  // 2. Batch-read owner + pool/info + liquidity for each candidate.
  const list = [...ids];
  const reads = list.flatMap((tokenId) => [
    { address: positionManagerAddress, abi: positionManagerAbi, functionName: "ownerOf", args: [tokenId] },
    { address: positionManagerAddress, abi: positionManagerAbi, functionName: "getPoolAndPositionInfo", args: [tokenId] },
    { address: positionManagerAddress, abi: positionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] },
  ]);
  const res = await client.multicall({ contracts: reads, allowFailure: true });

  const sqrtP = await readSqrtPriceX96(client);
  const out: PoolPosition[] = [];
  for (let i = 0; i < list.length; i++) {
    const owner = res[i * 3];
    const poolInfo = res[i * 3 + 1];
    const liq = res[i * 3 + 2];
    if (owner.status !== "success" || poolInfo.status !== "success" || liq.status !== "success") continue;
    if (getAddress(owner.result as Address) !== user) continue; // transferred away

    const [pk, info] = poolInfo.result as [
      { currency1: Address; hooks: Address },
      bigint,
    ];
    if (getAddress(pk.currency1) !== ocards || getAddress(pk.hooks) !== hooks) continue; // not our pool
    const liquidity = liq.result as bigint;
    if (liquidity === 0n) continue;

    const tickLower = unpackTick(info, 8n);
    const tickUpper = unpackTick(info, 32n);
    const { amount0, amount1 } = getAmountsForLiquidity(
      sqrtP,
      getSqrtRatioAtTick(tickLower),
      getSqrtRatioAtTick(tickUpper),
      liquidity,
    );
    out.push({ tokenId: list[i], tickLower, tickUpper, liquidity, amount0, amount1 });
  }
  out.sort((a, b) => (a.tokenId < b.tokenId ? -1 : 1));
  return out;
}

export { MAX_UINT128 };
