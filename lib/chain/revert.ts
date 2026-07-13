/**
 * Human-readable revert decoding (§14.2 "decoded revert reasons").
 *
 * Layers, tried in order:
 *  1. viem's own walk — ContractFunctionRevertedError with a named custom
 *     error from our ABIs (they all include error definitions).
 *  2. Uniswap v4 `WrappedError(address,bytes4,bytes,bytes)` — hook reverts
 *     bubble through the PoolManager wrapped; we unwrap and re-decode the
 *     inner reason against every known ABI.
 *  3. Plain Error(string) / raw signature fallback.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Abi,
  type Hex,
} from "viem";
import {
  cardsOnChainAbi,
  cardsTokenAbi,
  cardYieldAbi,
  mintHookAbi,
  poolManagerAbi,
  poolSwapTestAbi,
  stakingVaultAbi,
} from "@/lib/contracts/abis";

const KNOWN_ABIS: Abi[] = [
  mintHookAbi as unknown as Abi,
  stakingVaultAbi as unknown as Abi,
  cardsOnChainAbi as unknown as Abi,
  cardYieldAbi as unknown as Abi,
  cardsTokenAbi as unknown as Abi,
  poolManagerAbi as unknown as Abi,
  poolSwapTestAbi as unknown as Abi,
];

/** Friendly copy for the errors users actually hit. */
const FRIENDLY: Record<string, string> = {
  TradingNotEnabled: "Trading hasn't been enabled yet — the pool opens with the one-shot launch transaction.",
  NotForgeStaker: "Only the wallet that started this forge can do that.",
  NotCardOwner: "You no longer own this card, so the forge can't be upgraded.",
  NotMatured: "This forge hasn't matured yet.",
  NotSweepable: "This forge is still inside its sweep-protection window (or already settled).",
  TierCapReached: "That tier is full — every slot is taken by cards or active forges.",
  TierNotUpward: "Forging only goes upward — pick a tier above the card's current tier.",
  TargetTierNotAbove: "Forging only goes upward — pick a tier above the card's current tier.",
  InsufficientFreeStake: "Not enough free (unlocked) stake — stake more first, or use stake & forge.",
  ForgeActive: "This card is already being forged (one forge per card).",
  ForgeNotFound: "That forge no longer exists (already claimed, cancelled, or swept).",
  TargetInGrace: "This card is inside its 6-hour grace window — newly acquired or newly upgraded cards can't be raided yet.",
  TargetProtected: "This card is protected — its owner has staked at least the 25% safe line, so it can't be raided.",
  TargetNotRarer: "You can only raid a card at a HIGHER tier than the card you're attacking with.",
  TierNotProtectable: "Common cards have no rarity to protect — only Uncommon and above can be protected or raided.",
  NotProtector: "Only the wallet that posted this card's protection can withdraw it.",
  ExceedsProtection: "That's more than this card's protection stake.",
  CardForging: "This card is mid-forge — it can't be raided or protected until the forge finishes.",
  CardRaiding: "This card is committed to a live raid — wait for it to resolve.",
  NoRaidOnCard: "There's no live raid against this card.",
  DefenseWindowClosed: "The defense window has closed — this raid can only be resolved now.",
  RaidNotFound: "That raid no longer exists (already repelled, resolved, or cancelled).",
  RaidNotResolvable: "This raid's defense window hasn't closed yet.",
  RaidVoided: "This raid is dead — the attacker sold their raiding card. Clear it to free both cards and refund them.",
  RaidNotVoid: "This raid is still live — its attacker still holds the raiding card.",
  NotRaidAttacker: "Only the wallet that started this raid can cancel it.",
  SameCard: "A card can't raid itself.",
  ERC20InsufficientAllowance: "The contract's FORGE allowance is too small — approve the exact amount first.",
  ERC20InsufficientBalance: "Not enough FORGE in the wallet.",
  PriceLimitAlreadyExceeded: "Price moved past your slippage limit — refresh the quote and try again.",
};

function nameToMessage(errorName: string, args?: readonly unknown[]): string {
  const friendly = FRIENDLY[errorName];
  const raw = `${errorName}(${(args ?? []).map(String).join(", ")})`;
  return friendly ? `${friendly} [${raw}]` : raw;
}

function tryDecodeAgainstKnownAbis(data: Hex): string | null {
  for (const abi of KNOWN_ABIS) {
    try {
      const decoded = decodeErrorResult({ abi, data });
      if (decoded.errorName === "WrappedError") {
        // WrappedError(address target, bytes4 selector, bytes reason, bytes details)
        const inner = decoded.args?.[2] as Hex | undefined;
        if (inner && inner !== "0x") {
          const innerMsg = tryDecodeAgainstKnownAbis(inner);
          if (innerMsg) return innerMsg;
        }
        continue;
      }
      return nameToMessage(decoded.errorName, decoded.args);
    } catch {
      // try next abi
    }
  }
  return null;
}

/** Decode any thrown tx/simulation error into a one-line human explanation. */
export function decodeRevert(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | null;
    if (revert) {
      const name = revert.data?.errorName ?? revert.signature;
      if (name && name !== "Error") {
        if (name === "WrappedError" || revert.raw) {
          const unwrapped = revert.raw ? tryDecodeAgainstKnownAbis(revert.raw) : null;
          if (unwrapped) return unwrapped;
        }
        return nameToMessage(name, revert.data?.args);
      }
      if (revert.reason) return revert.reason;
      if (revert.raw) {
        const decoded = tryDecodeAgainstKnownAbis(revert.raw);
        if (decoded) return decoded;
      }
    }
    // User rejected in wallet, RPC failures, etc. — shortMessage is already terse.
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}
