"use client";

import React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "./ThemeProvider";
import type { ThemeChoice } from "../../theme";

const OPTIONS: { id: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "system", label: "Match system", Icon: Monitor },
  { id: "dark", label: "Dark", Icon: Moon },
];

/* Three segments in one track, the shape the reference uses and the shape every
   OS uses for the same choice. Sits beside Logout because it is the other thing
   that belongs to you rather than to the app.

   Labelled by title and aria-label rather than visible text: at 268px of drawer
   the words do not fit beside Logout, and these three icons are the most
   over-learned in software. */
export default function ThemeSwitch() {
  const { choice, setChoice } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-full border border-line/[0.07] bg-layer/[0.03] p-0.5"
    >
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = choice === id;
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setChoice(id)}
            className={`flex h-7 w-8 items-center justify-center rounded-full transition-colors ${
              active
                ? "bg-layer/[0.1] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                : "text-muted hover:text-ink"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
