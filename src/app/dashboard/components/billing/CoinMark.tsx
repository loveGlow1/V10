"use client";

import React from "react";

import { CRYPTO_CURRENCIES, type CryptoCurrencyId } from "@/lib/crypto-payments";

/* A coin's mark: its own colour, its own currency sign.
 *
 * Drawn from the character rather than from artwork. Every coin here has a real
 * currency sign in Unicode — ₿, Ξ, Ł, ₮ — so a glyph is the accurate mark
 * rather than an approximation of one, and nine logos' worth of path data is
 * nine things to keep licensed and in step with rebrands.
 *
 * The inset hairline is not decoration. XRP's brand colour is very nearly
 * black, which on this app's dark ground is a coin that appears to have no mark
 * at all; the ring gives every mark an edge on either theme. */
export default function CoinMark({
  currency,
  className = "h-8 w-8 text-[15px]",
}: {
  currency: CryptoCurrencyId;
  className?: string;
}) {
  const { tint, glyph, name } = CRYPTO_CURRENCIES[currency];

  return (
    <span
      role="img"
      aria-label={name}
      style={{
        backgroundColor: tint,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)",
      }}
      className={`grid shrink-0 place-items-center rounded-full font-bold leading-none text-white ${className}`}
    >
      {glyph}
    </span>
  );
}
