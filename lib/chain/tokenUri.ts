/**
 * tokenURI parsing. The renderer returns `data:application/json;base64,<...>`
 * whose JSON carries `image` (data:image/svg+xml;base64) and `animation_url`
 * (data:text/html;base64). ALL of it is treated as untrusted at the render
 * layer (§14.2): the image is only ever given to an <img src>, and the
 * interactive HTML is only ever served through the sandboxed /embed route —
 * never injected into the app's DOM.
 */
import type { PublicClient } from "viem";
import { cardsOnChainAbi } from "@/lib/contracts/abis";
import { addressOf } from "@/lib/contracts/config";

export interface ParsedTokenUri {
  name: string;
  image: string; // data:image/svg+xml;base64,...
  animationUrl: string; // data:text/html;base64,...
  attributes: { trait_type: string; value: string | number }[];
}

const JSON_PREFIX = "data:application/json;base64,";
const IMG_PREFIX = "data:image/svg+xml;base64,";
const HTML_PREFIX = "data:text/html;base64,";

/** Base64 → UTF-8 string, isomorphic (browser atob / node Buffer). */
export function b64ToUtf8(b64: string): string {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

/** Strict parse of the renderer's tokenURI output; throws on anything off-shape. */
export function parseTokenUri(uri: string): ParsedTokenUri {
  if (!uri.startsWith(JSON_PREFIX)) throw new Error("tokenURI: not base64 JSON data URI");
  const json = JSON.parse(b64ToUtf8(uri.slice(JSON_PREFIX.length)));
  const { name, image, animation_url: animationUrl, attributes } = json;
  if (typeof image !== "string" || !image.startsWith(IMG_PREFIX)) {
    throw new Error("tokenURI: image is not an SVG data URI");
  }
  if (typeof animationUrl !== "string" || !animationUrl.startsWith(HTML_PREFIX)) {
    throw new Error("tokenURI: animation_url is not an HTML data URI");
  }
  return {
    name: String(name ?? ""),
    image,
    animationUrl,
    attributes: Array.isArray(attributes) ? attributes : [],
  };
}

/** Read + parse a card's tokenURI. */
export async function fetchTokenUri(client: PublicClient, tokenId: bigint): Promise<ParsedTokenUri> {
  const uri = (await client.readContract({
    address: addressOf("cardsOnChain"),
    abi: cardsOnChainAbi,
    functionName: "tokenURI",
    args: [tokenId],
  })) as string;
  return parseTokenUri(uri);
}

/** The interactive card HTML (decoded), for the sandboxed embed route ONLY. */
export function animationHtmlOf(parsed: ParsedTokenUri): string {
  return b64ToUtf8(parsed.animationUrl.slice(HTML_PREFIX.length));
}
