import React from "react";

import type { Provider } from "../../models";

type MarkProps = { className?: string };

/* The burst that stands for a Claude model — eight tapered arms on a common
   centre, drawn rather than imported so it inherits currentColor and needs no
   asset. The same is true of the three below it. */
export function ClaudeMark({ className }: MarkProps) {
  const arms = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      {arms.map((angle) => (
        <path
          key={angle}
          d="M12 2.2 L13.05 9.6 L12 12 L10.95 9.6 Z"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </svg>
  );
}

/* Six lobes on a ring for ChatGPT: the shape reads at 16px, which a faithful
   trace of the interlocked knot does not. */
export function OpenAiMark({ className }: MarkProps) {
  const lobes = [0, 60, 120, 180, 240, 300];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="8" />
      {lobes.map((angle) => (
        <path key={angle} d="M12 4.2 L12 9.4" transform={`rotate(${angle} 12 12)`} />
      ))}
    </svg>
  );
}

/* The four-pointed spark for Gemini, with concave sides so it reads as a star
   rather than a diamond. */
export function GeminiMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 2 C12.6 7.2 16.8 11.4 22 12 C16.8 12.6 12.6 16.8 12 22 C11.4 16.8 7.2 12.6 2 12 C7.2 11.4 11.4 7.2 12 2 Z" />
    </svg>
  );
}

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
const MARKS: Record<Provider, { Mark: (props: MarkProps) => React.JSX.Element; tint: string }> = {
  auto: { Mark: AutoMark, tint: "text-white" },
  claude: { Mark: ClaudeMark, tint: "text-[#D97757]" },
  openai: { Mark: OpenAiMark, tint: "text-[#10A37F]" },
  google: { Mark: GeminiMark, tint: "text-[#6C8BFF]" },
};

export function ProviderMark({
  provider,
  className = "h-4 w-4",
}: {
  provider: Provider;
  className?: string;
}) {
  const { Mark, tint } = MARKS[provider];
  return <Mark className={`${className} ${tint}`} />;
}
