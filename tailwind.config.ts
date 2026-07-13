import type { Config } from "tailwindcss";

/**
 * Cards OnChain design tokens (see DESIGN.md).
 * Dark gallery aesthetic: the cards are the heroes, the UI stays quiet.
 * Tier colors come from CardMaterials.tierColor() in src/render/CardMaterials.sol
 * and are used ONLY for tier badges, slot meters, and transformation timers.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#07070a", // page canvas (near-black, matches card scene backdrop)
        surface: "#0e0e14", // card back body tone (#0b0b10..#16161f family)
        raised: "#14141c",
        ink: "#e8e8f0", // card-back wordmark color
        muted: "#9aa0ac", // granite light tone
        faint: "#5e626b",
        line: "rgba(232,232,240,0.08)",
        accent: "#cbd2d8", // platinum light tone: primary interactive accent
        brand: "#CCFF00", // Forged Cards lime (matches the card background + Robinhood branding)
        // Tier palette — CardMaterials.tierColor(tier), frozen constants
        tier0: "#9aa0ac", // Common
        tier1: "#3ecf8e", // Uncommon
        tier2: "#5b8cff", // Rare
        tier3: "#b478ff", // Epic
        tier4: "#ffd44d", // Legendary
        danger: "#ff7088", // ruby light tone: errors / sweep-risk
        warn: "#ffd56b", // amber light tone: deadline warnings
      },
      fontFamily: {
        script: [
          "Segoe Script",
          "Brush Script MT",
          "Apple Chancery",
          "Lucida Handwriting",
          "cursive",
        ],
      },
      boxShadow: {
        card: "0 30px 70px rgba(0,0,0,.65)",
      },
    },
  },
  plugins: [],
};
export default config;
