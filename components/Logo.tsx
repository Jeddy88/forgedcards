import React from "react";

/**
 * Forged Cards logo.
 *
 * The mark is the woven F-C monogram lifted VERBATIM from the on-chain card art
 * (src/render/CardArt.sol — RING_FACE + F_FACE + SEG_FACE): a chain-ring C (open
 * link, mouth facing right) with a stroked F laced through it. The interlock is
 * drawn exactly like the card: ring + F strokes in the accent, then the two ring
 * segments redrawn with a background-colored "cut" stroke underneath so the
 * letters read as forged links.
 *
 * Variants:
 *  - "mark":     the monogram alone (nav, favicon, loading states)
 *  - "wordmark": cursive "Forged Cards" (matches the card-face wordmark)
 *  - "full":     mark + wordmark lockup
 *
 * Color: inherits `currentColor`; `cut` must match the surface behind the logo.
 */

const EMBLEM = (
  <>
    {/* Chain-ring C, mouth facing right — CardArt.RING_FACE, verbatim geometry */}
    <path d="M309.7 282.8A46 46 0 1 0 309.7 317.2" />
    {/* F (same size as C, beside it) — CardArt.F_FACE, verbatim geometry */}
    <path d="M147 254V346" />
    <path d="M147 254H207" />
    <path d="M147 300H207" />
  </>
);

export function LogoMark({
  size = 32,
  cut = "#07070a",
  className,
}: {
  size?: number;
  cut?: string;
  className?: string;
}) {
  // `cut` retained for API compatibility with existing callers; the interlocked
  // FC needs no background cut (the F is simply drawn over the ring).
  void cut;
  return (
    <svg
      viewBox="137 246 186 108"
      width={(size * 186) / 108}
      height={size}
      className={className}
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
    >
      <g stroke="currentColor" strokeWidth="11">
        {EMBLEM}
      </g>
    </svg>
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={`font-script leading-none text-brand ${className ?? ""}`}>Forged Cards</span>
  );
}

export default function Logo({
  variant = "full",
  size = 26,
  cut = "#07070a",
  className,
}: {
  variant?: "mark" | "wordmark" | "full";
  size?: number;
  cut?: string;
  className?: string;
}) {
  if (variant === "mark") return <LogoMark size={size} cut={cut} className={className} />;
  if (variant === "wordmark") return <LogoWordmark className={className} />;
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <LogoMark size={size} cut={cut} />
      <LogoWordmark className="text-[1.25em]" />
    </span>
  );
}
