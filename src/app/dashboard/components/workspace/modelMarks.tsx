import React from "react";

import { BrandMark } from "../brandMarks";
import type { Provider } from "../../models";

type MarkProps = { className?: string };

/* Auto is the router, not a model, so it gets a target rather than a mark of a
   maker: a ring with the arms that point into it. */
export function AutoMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="7.2" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2" />
    </svg>
  );
}

/* Each maker's mark and the colour it is drawn in, so the picker and the chip
   cannot disagree about either. */
const MARKS: Record<Exclude<Provider, "auto">, { brand: "claude" | "openai" | "gemini"; tint: string }> = {
  claude: { brand: "claude", tint: "text-[#D97757]" },
  openai: { brand: "openai", tint: "text-[#10A37F]" },
  google: { brand: "gemini", tint: "text-[#8E75B2]" },
};

export function ProviderMark({
  provider,
  className = "h-4 w-4",
}: {
  provider: Provider;
  className?: string;
}) {
  if (provider === "auto") return <AutoMark className={`${className} text-ink`} />;

  const { brand, tint } = MARKS[provider];
  return <BrandMark brand={brand} className={`${className} ${tint}`} />;
}
