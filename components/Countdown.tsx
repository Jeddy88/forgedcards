"use client";

import React, { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";
import { useMounted } from "@/lib/live";

/**
 * Live countdown to a unix timestamp (seconds). Renders — until mounted to
 * avoid SSR/client hydration drift, then ticks every second.
 *
 * `tone` drives the timer color language:
 *  - neutral: maturing (informational)
 *  - warn:    claim window open, deadline approaching (amber)
 *  - danger:  lapsed / sweepable (ruby)
 */
export default function Countdown({
  to,
  prefix,
  tone = "neutral",
  className = "",
}: {
  to: bigint;
  prefix?: string;
  tone?: "neutral" | "warn" | "danger";
  className?: string;
}) {
  const mounted = useMounted();
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = Number(to) - nowSec;
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink/90";

  return (
    <span className={`tabular-nums font-semibold ${toneClass} ${className}`} suppressHydrationWarning>
      {prefix && <span className="font-normal text-muted">{prefix} </span>}
      {!mounted ? "—" : remaining <= 0 ? "0s" : formatDuration(remaining)}
    </span>
  );
}
