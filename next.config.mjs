/**
 * Production hardening (§14.2): strict security headers, no image optimizer
 * (we never load remote images — card art is on-chain data URIs), and a CSP
 * with every directive documented below.
 */

/**
 * connect-src must cover the configured RPC endpoints (reads go straight from
 * the browser to the RPC). Wallet communication is via the injected provider
 * (no network origin). Built from the same env var + per-chain defaults the app
 * config uses, so the CSP always allows exactly the RPC the app will call.
 *
 * DEFAULT_RPC MUST stay in sync with lib/contracts/config.ts. The chain default
 * is `robinhood` (the Forged Cards relaunch network, owner decision 2026-07-09)
 * — a plain `next build` on a host that doesn't set NEXT_PUBLIC_CHAIN ships
 * Robinhood Chain, and the CSP allows the same public RPC origin the app reads
 * through so browser reads aren't blocked.
 */
const CHAIN = process.env.NEXT_PUBLIC_CHAIN ?? "robinhood";
const DEFAULT_RPC = {
  local: "http://127.0.0.1:8545",
  // Public keyless Sepolia endpoint — MUST match lib/contracts/config.ts.
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
  robinhood: "https://rpc.mainnet.chain.robinhood.com",
  mainnet: "https://ethereum-rpc.publicnode.com,https://eth.llamarpc.com",
};
const rpcOrigins = (process.env.NEXT_PUBLIC_RPC_URLS ?? DEFAULT_RPC[CHAIN] ?? "")
  .split(",")
  .map((s) => {
    try {
      return new URL(s.trim()).origin;
    } catch {
      return "";
    }
  })
  .filter(Boolean)
  .join(" ");

/**
 * App-wide CSP. Directive by directive:
 *  - default-src 'self': nothing loads from anywhere else by default.
 *  - script-src 'self' 'unsafe-inline': Next.js App Router hydrates through
 *    inline flight-data scripts; on statically prerendered pages a per-request
 *    nonce is impossible, so 'unsafe-inline' is required. NO external script
 *    origins and NO 'unsafe-eval' — remote-script injection and eval are dead.
 *    React escapes all rendered chain data, and the app never uses
 *    dangerouslySetInnerHTML, so inline-script injection would first require
 *    an HTML injection which the framework prevents. (Documented accepted gap;
 *    a nonce-based CSP via middleware + forced dynamic rendering is the
 *    stricter alternative if the launch checklist wants it.)
 *  - style-src 'self' 'unsafe-inline': Tailwind ships a static stylesheet
 *    ('self'); 'unsafe-inline' covers React style attributes (tier colors,
 *    progress widths). No external style origins.
 *  - img-src 'self' data:: card art arrives as on-chain SVG data URIs rendered
 *    exclusively through <img> (script-inert by spec).
 *  - connect-src 'self' + RPC origins: chain reads only; nothing else may be
 *    fetched.
 *  - frame-src 'self': ONLY our own sandboxed /embed/card/[id] route may be
 *    framed in (the interactive on-chain card). It carries its own stricter
 *    CSP + sandbox (see app/embed/card/[id]/route.ts).
 *  - frame-ancestors 'none': no site may frame the app (clickjacking).
 *    The /embed route overrides this with 'self' for its own responses.
 *  - object-src 'none', base-uri 'self', form-action 'self': classic
 *    injection-surface shutdowns.
 *  - upgrade-insecure-requests intentionally omitted: local dev runs on http.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src 'self' ${rpcOrigins}`,
  "font-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // We never use next/image (plain <img> + data URIs); disabling the
  // optimizer removes the Image Optimization API attack/DoS surface entirely.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        // Everything EXCEPT /embed/* (negative lookahead): the embed route
        // sets its own stricter CSP in the route handler, and two CSP headers
        // would enforce their intersection and break the sandboxed card.
        source: "/((?!embed/).*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        // The sandboxed on-chain-HTML route sets its OWN CSP in the route
        // handler (sandbox + default-src 'none' + frame-ancestors 'self');
        // only the non-CSP hardening headers apply here. X-Frame-Options is
        // intentionally absent (the app itself must frame this route;
        // frame-ancestors in the route's CSP covers the clickjacking case).
        source: "/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
