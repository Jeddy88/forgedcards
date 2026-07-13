import type { Metadata } from "next";
import React from "react";
import "./globals.css";
import Providers from "./providers";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: {
    default: "Forged Cards — 2,222 interactive cards, fully on-chain",
    template: "%s · Forged Cards",
  },
  description:
    "2,222 fully on-chain interactive collectible cards on Robinhood Chain. Buy FORGE to mint, stake FORGE tokens to forge cards into rarer tiers, and earn a share of trading fees.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <SiteHeader />
          <main className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
