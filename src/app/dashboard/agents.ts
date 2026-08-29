/** The agents the composer offers, shared with the settings panel so the two
    cannot drift apart. A page file cannot export this itself — Next.js only
    permits its own known exports there. */
export type Agent = {
  id: string;
  title: string;
  subtitle: string;
  /** On the roadmap, not selectable yet. */
  soon?: boolean;
};

export const AGENTS: Agent[] = [
  { id: "Q1", title: "Q1", subtitle: "Stable & thorough" },
  { id: "Q2", title: "Q2", subtitle: "Thorough & Relentless" },
  { id: "Prototype", title: "Prototype", subtitle: "Experimental Agent" },
  /* Listed rather than hidden: it is the plan, and a list that quietly
     omits it reads as if it were never coming. `soon` is what stops it
     being selectable. */
  { id: "Mobile", title: "Mobile", subtitle: "Agent for mobile apps", soon: true },
];
