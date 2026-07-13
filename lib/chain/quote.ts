/**
 * Swap quoting = SIMULATION of a swap via `eth_call` (no separate quoter
 * contract exists in this deployment). Quotes run a `PoolSwapTest.swap` call
 * against the QUOTE-ONLY `quoteSim` deployment — that call is never signed and
 * moves no funds; it exists purely to learn the expected fill, with state
 * overrides standing in for balance/allowance so quotes work pre-approval and
 * in read-only (no wallet) mode.
 *
 * The REAL trade the user signs goes through the UniversalRouter
 * (lib/chain/swap.ts) protected by `amountOutMinimum`: the swap fills fully
 * within the slippage tolerance or reverts (`V4TooLittleReceived`). The quote's
 * job is therefore: expected output (display) → minimum output (protection).
 *
 * State-override slots are the OpenZeppelin v5 ERC-20 layout of CardsToken
 * (plain, non-upgradeable: _balances @ slot 0, _allowances @ slot 1) —
 * verified against the deployed token in scripts/verify-flows.mjs.
 */
import {
  encodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  keccak256,
  numberToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { poolSwapTestAbi, poolManagerAbi, mintHookAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";
import { buildQuoteBuyCall, buildQuoteSellCall, decodeBalanceDelta } from "./swap";
import { MIN_SQRT_PRICE, MAX_SQRT_PRICE, expectedSqrtPriceAfterBuy, priceImpactBps } from "./math";

/** Neutral, funded-by-override account used for read-only-mode quotes.
 *  All-lowercase on purpose: it is abi-encoded as the mint recipient in the
 *  quote calldata, and viem's strict address check rejects a MIXED-case value
 *  that isn't a valid EIP-55 checksum (all-lowercase is accepted). */
const QUOTE_ACCOUNT: Address = "0x00000000000000000000000000000000000c0c0a";

/** OZ ERC-20 `_balances[holder]` storage slot. */
export function erc20BalanceSlot(holder: Address): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 0n]),
  );
}

/** OZ ERC-20 `_allowances[owner][spender]` storage slot. */
export function erc20AllowanceSlot(owner: Address, spender: Address): Hex {
  const inner = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, 1n]),
  );
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, inner]),
  );
}

/** StateLibrary slot math: the pool's `State` struct base slot inside PoolManager. */
async function poolStateSlot(client: PublicClient): Promise<bigint> {
  const poolId = (await client.readContract({
    address: addressOf("mintHook"),
    abi: mintHookAbi,
    functionName: "poolId",
  })) as Hex;
  // StateLibrary: stateSlot = keccak256(abi.encodePacked(poolId, POOLS_SLOT=6))
  return BigInt(keccak256((poolId + numberToHex(6n, { size: 32 }).slice(2)) as Hex));
}

async function extsloadWord(client: PublicClient, slot: bigint): Promise<bigint> {
  const word = (await client.readContract({
    address: addressOf("poolManager"),
    abi: poolManagerAbi,
    functionName: "extsload",
    args: [numberToHex(slot, { size: 32 })],
  })) as Hex;
  return BigInt(word);
}

/** Current pool sqrtPriceX96 via `PoolManager.extsload` (StateLibrary slot math). */
export async function readSqrtPriceX96(client: PublicClient): Promise<bigint> {
  const slot = await poolStateSlot(client);
  // slot0 packs sqrtPriceX96 in the low 160 bits
  return (await extsloadWord(client, slot)) & ((1n << 160n) - 1n);
}

/** Current ACTIVE pool liquidity (StateLibrary LIQUIDITY_OFFSET = 3 into `State`).
 *  Our launch pool is one uniform position spanning every reachable price, so this
 *  is the exact constant L for `expectedSqrtPriceAfterBuy` (price-impact display). */
export async function readPoolLiquidity(client: PublicClient): Promise<bigint> {
  const slot = await poolStateSlot(client);
  return (await extsloadWord(client, slot + 3n)) & ((1n << 128n) - 1n);
}

/** Whole FORGE per 1 ETH at the current tick (display only). */
export function ocardsPerEthFromSqrtPrice(sqrtPriceX96: bigint): bigint {
  return (sqrtPriceX96 * sqrtPriceX96) >> 192n;
}

/** amount × (10000 − slippageBps) / 10000 — the on-chain minimum-received. */
export function minAfterSlippage(amount: bigint, slippageBps: bigint): bigint {
  return (amount * (10_000n - slippageBps)) / 10_000n;
}

export interface SwapQuote {
  /** ETH delta for the swapper (negative = pays). */
  amount0: bigint;
  /** FORGE delta for the swapper (positive = receives). */
  amount1: bigint;
  /** On-chain minimum-received (amountOutMinimum in the signed tx). */
  minAmountOut: bigint;
  /** Pool sqrt-price at quote time (for price-impact display). */
  startSqrtPriceX96: bigint;
  /** This swap's expected price impact, in basis points (walk along the curve). */
  priceImpactBps: bigint;
}

/**
 * Simulate an exact-in BUY of `ethInWei` (uncapped — the launch pool is a
 * bonding curve, so walking the price up is expected, not adverse slippage).
 * The returned `minAmountOut` = expected fill − `slippageBps` tolerance; the
 * signed UniversalRouter trade reverts rather than fill below it, so the buy
 * either lands within tolerance of THIS quote or costs nothing but gas.
 */
export async function quoteBuy(
  client: PublicClient,
  ethInWei: bigint,
  slippageBps: bigint,
  account?: Address,
): Promise<SwapQuote> {
  const from = account ?? QUOTE_ACCOUNT;
  const [sqrtP, liquidity] = await Promise.all([
    readSqrtPriceX96(client),
    readPoolLiquidity(client),
  ]);

  const call = buildQuoteBuyCall(ethInWei, from, MIN_SQRT_PRICE + 1n);
  const { data } = await client.call({
    account: from,
    to: call.address,
    data: encodeFunctionData({ abi: poolSwapTestAbi, functionName: "swap", args: call.args }),
    value: call.value,
    stateOverride: [{ address: from, balance: ethInWei + 10n ** 18n }],
  });
  if (!data) throw new Error("empty quote result");
  const word = decodeFunctionResult({ abi: poolSwapTestAbi, functionName: "swap", data }) as bigint;
  const filled = decodeBalanceDelta(word);

  // Real curve walk-up from the simulated fill against the pool's ACTIVE
  // liquidity (audit fix M-1 2026-07-13: a 0n liquidity placeholder here made
  // every buy display ~0.00% impact). `expectedEnd` degrades to 0n only if the
  // liquidity read is 0 — price pinned exactly AT the range's upper tick, a
  // transient corner where the stat is skipped for that one quote (the signed
  // trade's minAmountOut protection is unaffected either way).
  const expectedEnd = expectedSqrtPriceAfterBuy(sqrtP, filled.amount1, liquidity);
  return {
    ...filled,
    minAmountOut: minAfterSlippage(filled.amount1, slippageBps),
    startSqrtPriceX96: sqrtP,
    priceImpactBps: expectedEnd > 0n ? priceImpactBps(sqrtP, expectedEnd) : 0n,
  };
}

/** Simulate an exact-in SELL of `tokensInWei` (uncapped). Overrides token balance
 *  + quote-router allowance. `minAmountOut` = expected ETH out − slippage. */
export async function quoteSell(
  client: PublicClient,
  tokensInWei: bigint,
  slippageBps: bigint,
  account?: Address,
): Promise<SwapQuote> {
  const sqrtP = await readSqrtPriceX96(client);
  const from = account ?? QUOTE_ACCOUNT;
  const call = buildQuoteSellCall(tokensInWei, MAX_SQRT_PRICE - 1n);
  const amountHex = numberToHex(tokensInWei, { size: 32 });
  const { data } = await client.call({
    account: from,
    to: call.address,
    data: encodeFunctionData({ abi: poolSwapTestAbi, functionName: "swap", args: call.args }),
    stateOverride: [
      { address: from, balance: 10n ** 18n },
      {
        address: addressOf("cardsToken"),
        stateDiff: [
          { slot: erc20BalanceSlot(from), value: amountHex },
          { slot: erc20AllowanceSlot(from, addressOf("quoteSim")), value: amountHex },
        ],
      },
    ],
  });
  if (!data) throw new Error("empty quote result");
  const word = decodeFunctionResult({ abi: poolSwapTestAbi, functionName: "swap", data }) as bigint;
  const filled = decodeBalanceDelta(word);
  // Price-impact display is buy-only (the curve concern the owner reported).
  return {
    ...filled,
    minAmountOut: minAfterSlippage(filled.amount0, slippageBps),
    startSqrtPriceX96: sqrtP,
    priceImpactBps: 0n,
  };
}
