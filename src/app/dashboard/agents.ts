/** The agents the composer offers, shared with the settings panel so the two
    cannot drift apart. A page file cannot export this itself — Next.js only
    permits its own known exports there. */
export const AGENTS = [
  { id: "Q1", title: "Q1", subtitle: "Stable & thorough" },
  { id: "Q2", title: "Q2", subtitle: "Thorough & Relentless" },
  { id: "Prototype", title: "Prototype", subtitle: "Experimental Agent" },
  { id: "Mobile", title: "Mobile", subtitle: "Agent for mobile apps" },
];
