"use client";

/**
 * Claim-deadline notifications (SAFETY-CRITICAL UX, DESIGN.md §3 / §14.2).
 *
 * The claim window is only 3 HOURS after maturation. This component offers a
 * browser Notification opt-in and, while any page of the app is open, fires:
 *   1. at each forge's maturation ("claim window open — 3 hours"),
 *   2. 30 minutes before the claim deadline lapses,
 * plus re-arms on every snapshot refresh (so newly started forges are covered).
 *
 * HONEST LIMITATION (stated in the UI): these are plain page-scheduled
 * notifications — they only fire while a tab of this app is open. There is no
 * push server (that would need a backend the protocol deliberately doesn't
 * have), so closing every tab means no alarms. Users are told to set an
 * external reminder for high-value forges.
 */
import React, { useEffect, useState } from "react";
import type { ForgeView } from "@/lib/fixtures/types";

const OPT_IN_KEY = "coc:forge-alarms";
/** Fire the "closing soon" alarm this many seconds before the deadline. */
const CLOSING_SOON_S = 30 * 60;

function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function notify(title: string, body: string) {
  if (!canNotify() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: `coc-${title}`, requireInteraction: true });
  } catch {
    // Some platforms only allow notifications from service workers; nothing to do.
  }
}

export function useForgeAlarmsEnabled(): [boolean, (v: boolean) => Promise<void>] {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(
      canNotify() &&
        Notification.permission === "granted" &&
        localStorage.getItem(OPT_IN_KEY) === "1",
    );
  }, []);
  const update = async (v: boolean) => {
    if (!canNotify()) return;
    if (v) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
      localStorage.setItem(OPT_IN_KEY, "1");
      setEnabled(true);
    } else {
      localStorage.setItem(OPT_IN_KEY, "0");
      setEnabled(false);
    }
  };
  return [enabled, update];
}

export default function ForgeAlarms({
  forges,
}: {
  /** The connected wallet's LIVE forges (id -> view). */
  forges: { id: bigint; t: ForgeView }[];
}) {
  const [enabled, setEnabled] = useForgeAlarmsEnabled();

  useEffect(() => {
    if (!enabled) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const nowS = Math.floor(Date.now() / 1000);
    for (const { id, t } of forges) {
      const matureIn = Number(t.maturesAt) - nowS;
      const closingIn = Number(t.claimDeadline) - CLOSING_SOON_S - nowS;
      if (matureIn > 0) {
        timers.push(
          setTimeout(
            () =>
              notify(
                `Card #${t.tokenId} forge matured`,
                `Your 3-HOUR claim window is open. Claim forge #${id} before it lapses — after that anyone can sweep it.`,
              ),
            matureIn * 1000,
          ),
        );
      }
      if (closingIn > 0 && Number(t.claimDeadline) > nowS) {
        timers.push(
          setTimeout(
            () =>
              notify(
                `Card #${t.tokenId} — 30 minutes left to claim`,
                `Forge #${id}'s claim window closes in ~30 minutes. Claim now or the forge can be swept.`,
              ),
            closingIn * 1000,
          ),
        );
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [enabled, forges]);

  if (!canNotify()) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void setEnabled(e.target.checked)}
          className="accent-current"
        />
        <span className="font-semibold text-ink/90">
          Browser alerts at maturity &amp; 30&nbsp;min before each claim window closes
        </span>
      </label>
      <span className="text-[11px] leading-snug text-faint">
        Works only while a tab of this app is open — there&apos;s no server watching for
        you. For a high-stakes forge, set a separate alarm too.
      </span>
    </div>
  );
}
