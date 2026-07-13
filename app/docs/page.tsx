import type { Metadata } from "next";
import Link from "next/link";
import React from "react";
import LaunchCurve from "@/components/LaunchCurve";
import TierBadge from "@/components/TierBadge";
import { TIERS } from "@/lib/tiers";

export const metadata: Metadata = { title: "Docs" };

/**
 * Plain-English but PRECISE documentation. Every number below is sourced from
 * the contracts (src/*.sol), the owner-approved launch model
 * (script/CurveModel.md, re-priced 2026-07-04), and the owner's 2026-07-04
 * tier re-pricing (stakes 500/1,500/3,000/5,000; maturations 12/24/36/48 hours;
 * 3-HOUR claim window — contracts updating in parallel). If the contracts and
 * this page ever disagree, the contracts win.
 *
 * Terminology: user-facing copy AND the on-chain API now both use
 * "forge/forging" (the contracts were renamed transform→forge; see DESIGN.md).
 */

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-4 mt-14 scroll-mt-24 font-script text-3xl text-ink first:mt-0">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 leading-relaxed text-muted">{children}</p>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

const TOC = [
  ["overview", "What is Forged Cards?"],
  ["minting", "How minting works"],
  ["launch-curve", "The launch curve"],
  ["fees", "The two fee streams"],
  ["staking", "Staking FORGE"],
  ["forging", "Forging cards"],
  ["card-yield", "Card yield"],
  ["tiers", "Tiers & materials"],
  ["art", "The art is fully on-chain"],
  ["trust", "What nobody can change"],
  ["faq", "Honest FAQ"],
];

export default function DocsPage() {
  return (
    <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
      {/* table of contents */}
      <nav className="top-24 hidden h-fit lg:sticky lg:block" aria-label="Docs sections">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-faint">
          Documentation
        </p>
        <ul className="space-y-1.5 border-l border-line pl-4 text-sm">
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-muted hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="max-w-3xl text-[15px]">
        <H2 id="overview">What is Forged Cards?</H2>
        <P>
          Forged Cards (FC) is a collection of <Strong>2,222 interactive collectible cards
          on Robinhood Chain</Strong>. Everything lives on-chain: the artwork, the animation,
          the interactive 3D card you can flip and spin — no servers, no IPFS, no links that
          can rot. The collection trades against its own token,{" "}
          <Strong>ForgeToken (FORGE)</Strong>, a fixed-supply ERC-20 of exactly{" "}
          <Strong>1,000,000 tokens</Strong> — none can ever be minted or burned.
        </P>
        <P>
          Three ideas power the system: buying FORGE tokens <Strong>mints cards</Strong>,
          staking FORGE tokens <Strong>forges cards</Strong> into rarer tiers, and trading
          fees pay <Strong>two reward streams</Strong> — one to token stakers, one to card
          holders.
        </P>

        <H2 id="minting">How minting works</H2>
        <P>
          There is exactly <Strong>one way to mint</Strong>: buy FORGE from the pool. For
          every whole <Strong>1,000 FORGE</Strong> you buy in a single swap, one card mints
          automatically — and <Strong>you keep all the tokens</Strong>. Buy 3,500 FORGE in
          one swap and you receive 3 cards plus your full 3,500 FORGE. Minting stops
          permanently at 2,222 cards; later buys simply deliver tokens.
        </P>
        <P>
          <Strong>Cards are delivered to the wallet you buy with.</Strong> Buying here on the
          official site and buying through any wallet&apos;s built-in swap feature (MetaMask,
          Rabby, hardware wallets, and other regular wallets) all deliver your cards
          correctly — you don&apos;t need a special tool or link.
        </P>
        <p className="mb-4 rounded-xl border border-line bg-raised/50 px-4 py-3 text-sm leading-relaxed text-muted">
          <Strong>One note for smart-contract wallets.</Strong> If you use a true
          smart-contract wallet — a Safe multisig, or some ERC-4337 &quot;smart accounts&quot;
          — and you buy through a third-party aggregator, buy via this official site instead:
          those setups can route the card to a helper address rather than your account. Buying
          here always attributes the card to your wallet.
        </p>
        <P>
          Every card mints at the <Strong>Common</Strong> tier with an immutable random seed
          that decides its material. There are no allowlists, no mint website, no other path
          — the pool is the mint.
        </P>

        <H2 id="launch-curve">The launch curve</H2>
        <P>
          All 1,000,000 FORGE start inside a single Uniswap v4 position shaped as an{" "}
          <Strong>ascending price curve</Strong>. Early buyers pay the least; every purchase
          walks the price up:
        </P>
        <div className="mb-6 rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <LaunchCurve />
        </div>
        <ul className="mb-4 list-disc space-y-2 pl-5 text-muted">
          <li>
            The <Strong>first card-sized buy</Strong> (1,000 FORGE) costs about{" "}
            <Strong>0.002 ETH</Strong>.
          </li>
          <li>
            The curve has <Strong>no price ceiling</Strong>: the pool itself keeps selling
            supply and collecting ETH at any price — 100×, 1,000× and beyond, exactly like a
            token paired with ETH across the full range. It never fully sells out; the last
            slices of supply only clear at ever-higher prices.
          </li>
          <li>
            The climb is steep: by <Strong>~80 ETH</Strong> of cumulative buying the price is
            about <Strong>1,600× the launch price</Strong> with ~97.5% of supply sold, and
            about <Strong>969 cards</Strong> minted on that walk — the rest mint through
            ongoing trading volume and the deep end of the curve.
          </li>
          <li>
            The liquidity position is <Strong>locked for 1 year</Strong> in a dedicated locker
            contract. The lock duration can be extended by the team. Because the curve has no
            ceiling, <Strong>all ETH ever paid into the curve accumulates inside this locked
            position</Strong> (there is no cap on that amount); while locked the team can only
            collect the 0.3% trading fees — after the lock expires it can withdraw the full
            position, ETH and unsold FORGE included.
          </li>
        </ul>
        <P>
          <Strong>Launch disclosure:</Strong> the deploy transaction includes the team&apos;s
          own first buy, hard-capped at <Strong>0.1 ETH</Strong> by the contract. At the full
          cap that buy nets about 46,985 FORGE (~4.7% of supply) and 46 cards (~2.1% of the
          2,222), paying the same 1% fee as everyone else. The cap is a ceiling written into
          the contract; the actual amount is public on-chain the moment trading opens.
        </P>

        <H2 id="fees">The two fee streams</H2>
        <P>Every swap in the pool pays a 1% fee on its ETH side, routed by direction:</P>
        <div className="mb-4 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.15em] text-faint">
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">1% of the ETH goes to…</th>
                <th className="px-4 py-3">Split by</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-line/60">
                <td className="px-4 py-3 font-semibold text-ink">Buys (ETH → FORGE)</td>
                <td className="px-4 py-3">Token stakers</td>
                <td className="px-4 py-3">pro-rata to staked FORGE</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold text-ink">Sells (FORGE → ETH)</td>
                <td className="px-4 py-3">Card holders</td>
                <td className="px-4 py-3">by tier weight (1 / 2 / 5 / 12 / 30)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <P>
          On top of that, the pool itself charges the standard <Strong>0.3% LP fee</Strong>,
          which accrues inside the locked liquidity position — it never touches the reward
          streams. All rewards are paid in ETH and sit in audited-pattern &quot;pull&quot;
          contracts: you settle, then withdraw; nothing is ever pushed to your wallet
          automatically.
        </P>

        <H2 id="staking">Staking FORGE</H2>
        <P>
          Stake any amount of FORGE in the StakingVault to earn the buy-fee stream,
          proportional to your share of everything staked. There&apos;s no lock-up on regular
          staking — unstake your free balance whenever you like. Staking is also the fuel for
          forging: starting a forge <Strong>locks</Strong> part of your staked balance, and{" "}
          <Strong>locked tokens keep earning rewards the entire time</Strong>. To be clear:
          you stake FORGE <em>tokens</em>, never the cards themselves — cards stay in your
          wallet throughout.
        </P>

        <H2 id="forging">Forging — the full lifecycle</H2>
        <P>
          Forging moves one of your cards straight to a rarer tier by staking FORGE tokens.
          It&apos;s <Strong>upward only</Strong>, goes{" "}
          <Strong>directly to the target tier</Strong> (a Common can jump straight to
          Legendary — no ladder), and each card can run{" "}
          <Strong>only one forge at a time</Strong>. (On-chain, the contracts call this
          &quot;forge&quot; too — the API function is <code>forge</code> /{" "}
          <code>stakeAndForge</code>.)
        </P>
        <ol className="mb-4 list-decimal space-y-3 pl-5 text-muted">
          <li>
            <Strong>Start.</Strong> Pick a card you own and a target tier. You must have the
            target tier&apos;s stake amount free in the vault (500 / 1,500 / 3,000 / 5,000
            FORGE for Uncommon / Rare / Epic / Legendary). That amount locks, and one of the
            target tier&apos;s limited forge slots is reserved for you <em>immediately</em> —
            first come, first served.
          </li>
          <li>
            <Strong>Mature.</Strong> Wait the maturation period — staggered by tier:{" "}
            <Strong>12 hours</Strong> to Uncommon, <Strong>24 hours</Strong> to Rare,{" "}
            <Strong>36 hours</Strong> to Epic, <Strong>48 hours</Strong> to Legendary. You can
            cancel at any time before claiming; cancelling returns the slot to the pool and
            unlocks your tokens instantly.
          </li>
          <li>
            <Strong>Claim — within 3 HOURS.</Strong> Once mature, you have exactly{" "}
            <Strong>3 hours</Strong> to claim — the window is deliberately tight, so know
            your maturation time and be ready (the app shows a live countdown). Claiming
            requires that you <em>still own the card</em>. The card moves to its new tier,
            re-rolls its material from the new tier&apos;s set (same immutable seed), its
            yield weight jumps, and your tokens unlock — still staked, still yours,
            withdrawable. <Strong>Tokens are never spent.</Strong>
          </li>
          <li>
            <Strong>Sweep — if you miss the window.</Strong> After the 3 hours lapse,{" "}
            <em>anyone</em> may sweep the lapsed forge. Sweeping returns the forge slot to
            the open pool and unlocks the staked tokens{" "}
            <Strong>back to you, the staker</Strong> — the sweeper gets nothing. The card is
            untouched. Sweeping just keeps slots from being squatted.
          </li>
        </ol>
        <P>
          <Strong>Slot recycling:</Strong> tier caps count cards at the tier <em>plus</em>{" "}
          active forges targeting it. When a card is later forged away from a tier, its old
          slot frees up; cancels and sweeps free the reserved slot too. So a
          &quot;full&quot; tier can reopen — watch the live counters on the{" "}
          <Link href="/forge" className="text-accent underline hover:text-ink">
            Forge
          </Link>{" "}
          screen.
        </P>
        <P>
          <Strong>Raiding — steal a tier.</Strong> Forging isn&apos;t the only way a card can
          change tier. A <em>lower</em>-tier card can <Strong>raid</Strong> a{" "}
          <em>higher</em>-tier card to try to swap places with it. You protect a non-Common
          card by keeping a protection stake at or above the <Strong>safe line — 25%</Strong>{" "}
          of that tier&apos;s forge stake; a card at or above the safe line{" "}
          <Strong>cannot be raided at all</Strong>. If a card sits below it, an attacker locks
          the full tier stake and opens a raid with a defense window equal to that tier&apos;s
          forge time. The defender repels it by topping protection up to <Strong>50%</Strong>{" "}
          before the window closes; if they don&apos;t, the two cards <Strong>swap tiers</Strong>{" "}
          — the attacker takes the victim&apos;s tier <em>and</em> material, and the victim
          drops to the attacker&apos;s old tier. Freshly bought or freshly changed cards get a
          short grace period before they can be targeted. Manage protection, attacks, and
          defenses from the{" "}
          <Link href="/raid" className="text-accent underline hover:text-ink">
            Raid board
          </Link>
          .
        </P>

        <H2 id="card-yield">Card yield — it travels with the card</H2>
        <P>
          The sell-fee stream accrues to each card by tier weight: with weights 1 / 2 / 5 /
          12 / 30, a Legendary earns 30× what a Common earns from the same sell. The crucial
          rule: <Strong>unclaimed yield belongs to the card, not the wallet</Strong>. Sell or
          transfer a card and every unclaimed wei goes with it — buying a card means buying
          its unclaimed earnings too (the amount is publicly visible on the card&apos;s page).
          Only the card&apos;s <em>current owner</em> can claim, one card at a time or all at
          once.
        </P>

        <H2 id="tiers">Tiers &amp; materials</H2>
        <P>
          Materials are assigned by real-world scarcity. A card&apos;s material within its
          tier comes from its immutable seed — forge a card and the same seed re-rolls it
          within the new tier&apos;s material set.
        </P>
        <div className="mb-4 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.15em] text-faint">
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Cap</th>
                <th className="px-4 py-3">Stake to reach</th>
                <th className="px-4 py-3">Maturation</th>
                <th className="px-4 py-3">Yield weight</th>
                <th className="px-4 py-3">Materials</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {TIERS.map((t) => (
                <tr key={t.tier} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3">
                    <TierBadge tier={t.tier} size="sm" />
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {t.tier === 0 ? "2,222 (reduces with forging)" : t.cap.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {t.tier === 0 ? "—" : `${(t.stake / 10n ** 18n).toLocaleString()} FORGE`}
                  </td>
                  <td className="px-4 py-3">{t.tier === 0 ? "—" : t.durationLabel}</td>
                  <td className="px-4 py-3 tabular-nums">{t.weight.toString()}×</td>
                  <td className="px-4 py-3">{t.materials.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Maturation is staggered by tier — <Strong>12 / 24 / 36 / 48 hours</Strong> — and
          after maturation every forge has the same <Strong>3-hour claim window</Strong>.
        </P>

        <H2 id="art">The art is fully on-chain</H2>
        <P>
          Each card&apos;s image and its interactive version are generated by a contract, on
          demand, from the card&apos;s seed and tier. The marketplace image is a still,
          upright SVG; the interactive version is a real 3D card that rests still until you
          touch it — <Strong>click to flip it, drag to spin it</Strong> — whose back glows in
          the same material palette as its face. The face shows the cursive{" "}
          <span className="font-script text-brand">Forged Cards</span> wordmark, the
          interlocked <Strong>FC monogram</Strong>, the material name, the tier, its number
          out of 2222, and a footer with the current owner and mint date. Marketplaces like
          OpenSea render all of it straight from the chain.
        </P>

        <H2 id="trust">What nobody can change</H2>
        <ul className="mb-4 list-disc space-y-2 pl-5 text-muted">
          <li>Token supply (1,000,000), card cap (2,222), and the 1-card-per-1,000 mint rule.</li>
          <li>Tier caps, stake amounts, maturation times, yield weights, and the 3-hour claim window — frozen at deploy, no admin can edit them.</li>
          <li>Fee sizes and destinations (1% buys → stakers, 1% sells → card holders).</li>
          <li>
            The core mechanics have <Strong>no admin</Strong> — nobody can pause trading,
            seize funds, redirect rewards, or change any tier / supply / fee rule. Two narrow,
            disclosed roles remain, and neither touches the above: the NFT contract keeps an{" "}
            <Strong>owner</Strong> purely so marketplaces (OpenSea) recognise a collection
            manager — it holds no on-chain power over the protocol, its funds, or your cards;
            and a scoped <Strong>royalty admin</Strong> can only adjust the secondary-sale
            royalty, hard-capped at 10% and freezable to zero. The deployer&apos;s one-time
            power is enabling trading.
          </li>
          <li>
            The token contract (FORGE) has <Strong>no owner at all</Strong> — a plain
            fixed-supply ERC-20 with no mint, burn, pause, or admin function of any kind.
          </li>
          <li>
            The launch liquidity is locked for 1 year; the lock owner can collect the
            position&apos;s trading fees but can only withdraw the liquidity <em>after</em> the
            year, and can never pull it early or shorten the lock.
          </li>
          <li>No burn path exists: no card and no token can ever be destroyed.</li>
        </ul>

        <H2 id="faq">Honest FAQ</H2>
        <div className="space-y-6">
          {[
            [
              "Which wallet do my cards go to?",
              "The wallet you buy with. Buying here on the official site and buying through any regular wallet's built-in swap (MetaMask, Rabby, hardware wallets, and the like) all deliver your cards to you correctly. The one exception: if you use a true smart-contract wallet (a Safe multisig, or some ERC-4337 smart accounts) and buy through a third-party aggregator, buy via this official site instead — those setups can otherwise route the card to a helper address.",
            ],
            [
              "What happens if I sell my card mid-forge?",
              "Your claim is blocked — claiming requires that you still own the card. Your staked tokens stay locked until YOU cancel (any time) or, after the window lapses, anyone sweeps. Either way the tokens return to you, the original staker — never to the card's buyer. The buyer gets the card at its current tier.",
            ],
            [
              "What if I miss the 3-hour claim window?",
              "The forge can no longer be claimed. You can still cancel it yourself, or anyone may sweep it; both return your tokens and reopen the forge slot. The card simply stays at its old tier — you lose the waiting time and the slot, not your tokens. The window is short on purpose (it keeps slots moving), so treat the claim countdown like an appointment.",
            ],
            [
              "Do sweepers get paid?",
              "No. Sweeping is a volunteer, gas-only public service that keeps forge slots from being squatted by abandoned forges.",
            ],
            [
              "Does buying a card include its unclaimed yield?",
              "Yes — unclaimed yield travels with the card, and only the current owner can claim it. Check a card's accrued amount on its detail page before buying or selling; it's part of the price you're really paying or receiving.",
            ],
            [
              "Can a card ever go DOWN a tier?",
              "No. Tier changes are strictly upward, and only through a claimed forge. Transfers and sales never change a card's tier, seed, or accrued yield.",
            ],
            [
              "The tier I want is full. Is that forever?",
              "Not necessarily. Caps count cards at the tier plus active forges targeting it. Slots reopen when a card is forged away from that tier, or when a pending forge is cancelled or swept. The Forge screen shows live availability.",
            ],
            [
              "Did the team pre-mine?",
              "No pre-mine, but a disclosed first buy: the launch transaction may include a deployer buy hard-capped at 0.1 ETH by the contract — worth about 46,985 FORGE (~4.7% of supply) and 46 cards at launch prices, paying the same fees as any buyer. The exact amount is permanently visible on-chain.",
            ],
            [
              "Where does the yield actually come from?",
              "Only from real trading: 1% of buy ETH and 1% of sell ETH. If nobody trades, nobody earns — there is no emissions schedule, no inflation, and no promised return. Both reward streams can be small or zero in quiet periods.",
            ],
            [
              "Is my stake ever at risk when forging?",
              "The tokens themselves are never spent or slashed — every path (claim, cancel, sweep) returns them to you in full. What you risk is time (the 12–48 hour maturation wait), the opportunity cost of locked tokens, and gas.",
            ],
          ].map(([q, a]) => (
            <div key={q as string}>
              <h3 className="mb-1.5 font-semibold text-ink">{q}</h3>
              <p className="leading-relaxed text-muted">{a}</p>
            </div>
          ))}
        </div>

        <p className="mt-14 border-t border-line pt-6 text-xs leading-relaxed text-faint">
          This page describes the deployed contracts in plain English; where wording and code
          could ever disagree, the code is the truth. Nothing here is financial advice —
          collectibles and tokens can lose value, and reward streams depend entirely on
          trading activity.
        </p>
      </article>
    </div>
  );
}
