/**
 * Fixture types — shaped EXACTLY like the contract view functions the dApp agent
 * will wire (viem-style: bigint for uint256/uint64, number for uint8, `0x…`
 * strings for addresses/bytes32). Source of truth per field is annotated with the
 * Solidity view it mirrors. See DESIGN.md for the full fixture -> view mapping.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** StakingVault.ForgeView — returned by StakingVault.getForge(id). */
export interface ForgeView {
  staker: Address; //            .staker
  tokenId: bigint; //            .tokenId
  targetTier: number; //         .targetTier (uint8, 1-4)
  amount: bigint; //             .amount (FORGE wei locked = tierStake(targetTier))
  maturesAt: bigint; //          .maturesAt (unix seconds)
  claimDeadline: bigint; //      .claimDeadline = maturesAt + CLAIM_WINDOW (3 HOURS)
  isMature: boolean; //          .isMature   = now >= maturesAt
  isSweepable: boolean; //       .isSweepable = now > claimDeadline
}

/** One owned card, assembled from per-token views on CardsOnChain + CardYield. */
export interface CardFixture {
  tokenId: bigint; //            the ERC-721 id (1-based; N/2222 on the card face)
  owner: Address; //             CardsOnChain.ownerOf(tokenId)
  tier: number; //               CardsOnChain.tierOf(tokenId) (uint8 0-4)
  /** CardsOnChain.artSeedOf(tokenId) — the seed the ARTWORK derives from. Equals the
   *  immutable mint seed (`seedOf`) unless the card swapped appearances with another by
   *  winning or losing a raid. Always derive material from THIS, never from `seedOf`. */
  seed: Hex;
  mintedAt: bigint; //           CardsOnChain.mintedAt(tokenId) (uint64 seconds)
  material: string; //           derived: CardMaterials.materialOf(artSeed, tier)
  accrued: bigint; //            CardYield.accruedOf(tokenId) (ETH wei, travels with card)
  weight: bigint; //             CardYield.weightOf(tokenId) (= tierWeight(tier))
  activeForgeId: bigint; //      StakingVault.activeForge(tokenId) (0 = none)
  protection: bigint; //         StakingVault.protectionOf(tokenId) (FORGE locked defending it)
  protector: Address; //         StakingVault.protectorOf(tokenId) (who posted the protection)
  activeRaidId: bigint; //       StakingVault.activeRaidOf(tokenId) (0 = none; attacker OR victim)
  /** StakingVault.raidStatusOf(tokenId): 0 Not raidable (Common) · 1 Grace period ·
   *  2 Protected (owner's OWN stake at/above the 25% line) · 3 Vulnerable ·
   *  4 Under attack · 5 Raiding. A previous owner's protection never counts as 2. */
  raidStatus: number;
}

/** Full protocol + user snapshot behind every screen. */
export interface Snapshot {
  now: bigint; // reference timestamp the countdowns tick against

  cardsOnChain: {
    totalSupply: bigint; //        CardsOnChain.totalSupply() (== totalEverMinted, no burns)
    totalEverMinted: bigint; //    CardsOnChain.totalEverMinted() — ids are 1..this
    maxSupply: bigint; //          CardsOnChain.maxSupply() = 2222
    remainingMintable: bigint; //  CardsOnChain.remainingMintable()
    /** CardsOnChain.tierCount(tier) for tier 0..4. For tiers 1-4 this INCLUDES
     *  live forges targeting the tier (the capped quantity, INV-T1). */
    tierCount: [bigint, bigint, bigint, bigint, bigint];
    /** CardsOnChain.tierDuration(tier) for tier 0..4 — forge maturation seconds,
     *  read from chain (mainnet 12/24/36/48h; Sepolia testnet 15m/30m/45m/1h).
     *  Source these, NOT the tiers.ts constants, for any timing on-chain. */
    tierDurations: [bigint, bigint, bigint, bigint, bigint];
  };

  cardsToken: {
    totalSupply: bigint; //        CardsToken.totalSupply() = 1,000,000e18 (fixed)
    balanceOf: bigint; //          CardsToken.balanceOf(connectedWallet)
  };

  mintHook: {
    tradingEnabled: boolean; //    MintHook.tradingEnabled()
    tradingEnabledAt: bigint; //   MintHook.tradingEnabledAt() (0 until enabled)
    deployerBoughtTokens: bigint; // MintHook.deployerBoughtTokens() (D16 disclosure)
  };

  stakingVault: {
    totalStaked: bigint; //        StakingVault.totalStaked()
    stakedOf: bigint; //           StakingVault.stakedOf(wallet) (locked included)
    lockedOf: bigint; //           StakingVault.lockedOf(wallet)
    freeStakeOf: bigint; //        StakingVault.freeStakeOf(wallet) = stakedOf - lockedOf
    pendingRewards: bigint; //     StakingVault.pendingRewards(wallet) (ETH wei)
    claimable: bigint; //          StakingVault.claimable(wallet) (settled, withdrawable)
    /** StakingVault.tierSlotsRemaining(tier) = tierCap - tierCount, tiers 1-4.
     *  Index 0 unused (Common uncapped). */
    tierSlotsRemaining: [bigint, bigint, bigint, bigint, bigint];
    /** StakingVault.RAID_GRACE() — seconds a card is un-raidable after it last changed
     *  hands / changed tier. Mainnet 6h; the Sepolia StakingVaultTestnet returns 15m.
     *  Read from chain, NEVER hardcoded — the two networks differ. */
    raidGrace: bigint;
    forgesOf: bigint[]; //          StakingVault.forgesOf(wallet)
    /** StakingVault.getForge(id) for every id the app knows about
     *  (the user's + the sweep board's). */
    forges: Record<string, ForgeView>;
  };

  cardYield: {
    totalWeight: bigint; //        CardYield.totalWeight()
    claimable: bigint; //          CardYield.claimable(wallet)
  };

  /** Derived from events, NOT views — the dApp agent sources these from an
   *  indexer or log scan (sum of RewardsDeposited event amounts per contract). */
  /** Design-time price fixture. NOT a contract view: the dApp agent replaces
   *  this with a V4 Quoter simulation against MintHook.poolKey(). The launch
   *  numbers come from script/CurveModel.md (start ~499,491 FORGE/ETH). */
  curve: {
    ocardsPerEth: bigint; // whole FORGE per 1 ETH at the current tick (approx)
  };

  /** Wallet's cards: enumerate Minted/Transfer events or an indexer, then the
   *  per-token views listed on CardFixture. */
  myCards: CardFixture[];

  /** Sweep board: live forge ids with isSweepable == true, discovered
   *  via ForgeStarted events minus Claimed/Cancelled/Swept. */
  sweepableIds: bigint[];
}
