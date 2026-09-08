import React from "react";

/* Text drawn the way a stadium board draws it: one dot per lit cell of a 5×7
   grid, nothing lit where the letter is not.

   A font would be the obvious way, and the wrong one — a display face for one
   line of one section is a download every visitor pays for, and the dots would
   still be whatever the face decided. This is the alphabet itself, seven rows of
   five, which is small enough to read here and exact about where every dot sits.

   The result is an SVG with a viewBox and no fixed size, so the line scales with
   the column it is given rather than needing a size per breakpoint. */
const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10011", "10101", "10101", "10101", "11001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

const COLS = 5;
const ROWS = 7;
/** Unlit columns between one letter and the next. A word gap is this plus the
    five blank columns a space is made of, which is what spaces the words. */
const GAP = 2;

export default function DotMatrixText({
  text,
  className = "",
  /** How much of each cell the dot fills. Below ~0.9 the line reads as dots; at
      1 they touch and it reads as a solid stroke. */
  fill = 0.78,
  highlight,
  highlightColor,
}: {
  text: string;
  className?: string;
  fill?: number;
  /* A run of characters lit in a second colour — ".Ai" in the middle of the
     name. A board where one word is a different colour is how a real display
     picks out the part that matters, and it is the whole reason this takes a
     substring rather than a colour for the line. Matched case-insensitively
     against the same characters that get drawn, so a character the alphabet
     does not carry cannot shift the run out of place. */
  highlight?: string;
  /** What that run is lit in. Anything else is lit in currentColor. */
  highlightColor?: string;
}) {
  const characters = [...text.toUpperCase()].filter((character) => character in GLYPHS);
  const width = characters.length * (COLS + GAP) - GAP;

  /* Where the highlighted run starts, or -1. */
  const wanted = [...(highlight ?? "").toUpperCase()].filter((c) => c in GLYPHS);
  const start =
    wanted.length === 0
      ? -1
      : characters.findIndex((_, index) =>
          wanted.every((character, offset) => characters[index + offset] === character),
        );

  const dots: { x: number; y: number; lit: boolean }[] = [];
  characters.forEach((character, index) => {
    const glyph = GLYPHS[character];
    const left = index * (COLS + GAP);
    const lit = start !== -1 && index >= start && index < start + wanted.length;
    glyph.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === "1") dots.push({ x: left + x, y, lit });
      });
    });
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${ROWS}`}
      // The line is text; the picture of it is not what a screen reader wants.
      role="img"
      aria-label={text}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      {dots.map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x + 0.5}
          cy={dot.y + 0.5}
          r={fill / 2}
          fill={dot.lit && highlightColor ? highlightColor : "currentColor"}
        />
      ))}
    </svg>
  );
}
