/**
 * Sandboxed serving route for the on-chain interactive card HTML
 * (tokenURI `animation_url`). See components/InteractiveCard.tsx for why this
 * is a route and not srcdoc/data: (CSP inheritance of local schemes).
 *
 * Defense in depth for the untrusted on-chain document:
 *  - `Content-Security-Policy: sandbox allow-scripts` — opaque origin at the
 *    HTTP level even if something ever embeds this URL without the iframe
 *    sandbox attribute.
 *  - `default-src 'none'` — the document can load NOTHING external: no
 *    network, no images, no fonts. `script-src/style-src 'unsafe-inline'`
 *    only, because the on-chain art is fully inline by construction.
 *  - `frame-ancestors 'self'` — only this app may frame it.
 *  - `nosniff`, no caching of errors, short private caching of art.
 *
 * This is per-TOKEN public data (art + owner short-address already public on
 * chain); no wallet state exists server-side.
 */
import { createPublicClient, fallback, http } from "viem";
import { RPC_URLS } from "@/lib/contracts/config";
import { chain } from "@/lib/wagmi";
import { animationHtmlOf, fetchTokenUri } from "@/lib/chain/tokenUri";

export const dynamic = "force-dynamic";

const EMBED_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // Art changes on forge (tier) and transfer (owner footer): keep caching short.
  "Cache-Control": "private, max-age=30",
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,7}$/.test(id)) {
    return new Response("invalid token id", { status: 400 });
  }
  try {
    const client = createPublicClient({
      chain,
      transport: fallback(RPC_URLS.map((u) => http(u))),
    });
    const parsed = await fetchTokenUri(client, BigInt(id));
    return new Response(animationHtmlOf(parsed), { status: 200, headers: EMBED_HEADERS });
  } catch {
    return new Response("card not found or RPC unavailable", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
