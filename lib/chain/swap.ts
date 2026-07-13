/**
 * The ONE place swap calls are constructed (§14.2 transaction safety).
 *
 * REAL trades (the calls users sign) go through Uniswap's audited
 * **UniversalRouter** — `execute(commands, inputs, deadline)` with a single
 * V4_SWAP (0x10) command wrapping the v4-periphery actions encoding:
 * SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL. Slippage protection is
 * `amountOutMinimum` (and the TAKE_ALL minimum — same number, enforced twice):
 * the swap either fills fully within tolerance or reverts. No user funds ever
 * flow through a test-grade router.
 *
 * Robinhood Chain dialect — the Robinhood UniversalRouter is a CUSTOMIZED build
 * whose swap-params struct carries an extra `minHopPriceX36` field (verified
 * against its Blockscout-verified source, 2026-07-09). `urHopPricedParams`
 * (from config, per environment) selects that 6-field encoding; every other
 * network uses the standard 5-field Uniswap struct.
 *
 * hookData policy — a buy (ETH→FORGE) from THIS frontend ALWAYS carries
 * `hookData = abi.encode(recipient)`, the explicit buyer address, for exact
 * attribution. `buildBuySwap` hardcodes that encoding from the recipient
 * argument; nothing else in the app is allowed to assemble router execute
 * arguments. This is what protects smart-contract-wallet users on our site,
 * where `tx.origin` (the relayer/bundler) would NOT be the intended holder.
 *
 * QUOTE-ONLY simulation — `buildQuoteBuyCall`/`buildQuoteSellCall` still encode
 * a `PoolSwapTest.swap` call, used EXCLUSIVELY inside `eth_call` simulations
 * (lib/chain/quote.ts) to learn the expected fill. That call is never signed
 * and moves no funds; the PoolSwapTest deployment is a read-only quoting aid.
 */
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { addressOf, urHopPricedParams } from "@/lib/contracts/config";
import { encodeMintRecipient } from "./math";

export {
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
  decodeBalanceDelta,
  encodeMintRecipient,
  isqrt,
  sqrtPriceLimitFor,
} from "./math";

/** The canonical PoolKey tuple served by the hook (`MintHook.poolKey()`). */
export function canonicalPoolKey() {
  return {
    currency0: "0x0000000000000000000000000000000000000000" as Address, // native ETH
    currency1: addressOf("cardsToken"),
    fee: 3000, // MintHook.LP_FEE
    tickSpacing: 60, // MintHook.TICK_SPACING
    hooks: addressOf("mintHook"),
  } as const;
}

/* ------------------------------------------------- UniversalRouter encoding */

/** universal-router Commands.sol: the only command this app uses. */
export const COMMANDS_V4_SWAP: Hex = "0x10";

/** v4-periphery Actions.sol (identical values in the Robinhood build). */
export const ACTIONS = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SETTLE_ALL: 0x0c,
  TAKE_ALL: 0x0f,
} as const;

const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

/** Concatenated one-byte action codes. */
const actionsHex = (codes: readonly number[]): Hex =>
  ("0x" + codes.map((c) => c.toString(16).padStart(2, "0")).join("")) as Hex;

/** Default execute deadline: 20 minutes out (same policy as the Liquidity tab). */
export const executeDeadline = (): bigint => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

/**
 * abi.encode of the router's ExactInputSingleParams struct, in the dialect the
 * pinned environment's router speaks (standard 5-field vs Robinhood 6-field).
 */
function encodeExactInSingleParams(zeroForOne: boolean, amountIn: bigint, minOut: bigint, hookData: Hex): Hex {
  const key = canonicalPoolKey();
  if (urHopPricedParams) {
    return encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
            { name: "zeroForOne", type: "bool" },
            { name: "amountIn", type: "uint128" },
            { name: "amountOutMinimum", type: "uint128" },
            { name: "minHopPriceX36", type: "uint256" },
            { name: "hookData", type: "bytes" },
          ],
        },
      ],
      [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData }],
    );
  }
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, hookData }],
  );
}

/** One V4_SWAP input: abi.encode(actions, params) for exact-in + settle + take. */
function encodeV4SwapInput(zeroForOne: boolean, amountIn: bigint, minOut: bigint, hookData: Hex): Hex {
  const key = canonicalPoolKey();
  const [currencyIn, currencyOut] = zeroForOne
    ? [key.currency0, key.currency1]
    : [key.currency1, key.currency0];
  const params: Hex[] = [
    encodeExactInSingleParams(zeroForOne, amountIn, minOut, hookData),
    // SETTLE_ALL(currencyIn, max): pay at most the exact input.
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyIn, amountIn]),
    // TAKE_ALL(currencyOut, min): receive at least minOut (second enforcement).
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyOut, minOut]),
  ];
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actionsHex([ACTIONS.SWAP_EXACT_IN_SINGLE, ACTIONS.SETTLE_ALL, ACTIONS.TAKE_ALL]), params],
  );
}

export interface RouterExecuteCall {
  address: Address;
  functionName: "execute";
  args: readonly [Hex, readonly Hex[], bigint];
  value: bigint;
}

/**
 * Exact-in BUY: spend `ethInWei`, receive ≥ `minOutTokens` FORGE, mint cards to
 * `recipient`. hookData is derived from `recipient` here and ONLY here — we
 * always pass the explicit buyer address so the mint recipient never depends on
 * `tx.origin` (the relayer on a smart-contract-wallet swap would be the wrong
 * holder). Reverts on-chain if the fill lands under `minOutTokens`.
 */
export function buildBuySwap(ethInWei: bigint, recipient: Address, minOutTokens: bigint): RouterExecuteCall {
  if (ethInWei <= 0n) throw new Error("ethInWei must be positive");
  return {
    address: addressOf("swapRouter"), // = the UniversalRouter (resolved from hook.router())
    functionName: "execute",
    args: [COMMANDS_V4_SWAP, [encodeV4SwapInput(true, ethInWei, minOutTokens, encodeMintRecipient(recipient))], executeDeadline()],
    value: ethInWei,
  };
}

/** Exact-in SELL: spend `tokensInWei` FORGE for ≥ `minEthOut`. (No mint; hookData empty.) */
export function buildSellSwap(tokensInWei: bigint, minEthOut: bigint): RouterExecuteCall {
  if (tokensInWei <= 0n) throw new Error("tokensInWei must be positive");
  return {
    address: addressOf("swapRouter"),
    functionName: "execute",
    args: [COMMANDS_V4_SWAP, [encodeV4SwapInput(false, tokensInWei, minEthOut, "0x")], executeDeadline()],
    value: 0n,
  };
}

/* --------------------------------------------- quote-only PoolSwapTest calls */

/** PoolSwapTest.TestSettings — always plain ERC-20/ETH settlement. */
export const TEST_SETTINGS = { takeClaims: false, settleUsingBurn: false } as const;

export interface QuoteSimCall {
  address: Address;
  functionName: "swap";
  args: readonly [
    ReturnType<typeof canonicalPoolKey>,
    { zeroForOne: boolean; amountSpecified: bigint; sqrtPriceLimitX96: bigint },
    typeof TEST_SETTINGS,
    `0x${string}`,
  ];
  value: bigint;
}

/** QUOTE-ONLY (eth_call, never signed): exact-in buy against PoolSwapTest. */
export function buildQuoteBuyCall(ethInWei: bigint, recipient: Address, sqrtPriceLimitX96: bigint): QuoteSimCall {
  if (ethInWei <= 0n) throw new Error("ethInWei must be positive");
  return {
    address: addressOf("quoteSim"),
    functionName: "swap",
    args: [
      canonicalPoolKey(),
      { zeroForOne: true, amountSpecified: -ethInWei, sqrtPriceLimitX96 },
      TEST_SETTINGS,
      encodeMintRecipient(recipient),
    ],
    value: ethInWei,
  };
}

/** QUOTE-ONLY (eth_call, never signed): exact-in sell against PoolSwapTest. */
export function buildQuoteSellCall(tokensInWei: bigint, sqrtPriceLimitX96: bigint): QuoteSimCall {
  if (tokensInWei <= 0n) throw new Error("tokensInWei must be positive");
  return {
    address: addressOf("quoteSim"),
    functionName: "swap",
    args: [
      canonicalPoolKey(),
      { zeroForOne: false, amountSpecified: -tokensInWei, sqrtPriceLimitX96 },
      TEST_SETTINGS,
      "0x",
    ],
    value: 0n,
  };
}
