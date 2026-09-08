import React from "react";

/* The phone backdrop: a violet field off the top of the screen, two diagonal
   bands of light blurred into it, then a black floor. It is fixed, so the page
   scrolls through the light rather than dragging it along.

   It was blue, sampled from a reference, and it was the largest colour in the
   product — a full screen of it behind every mobile view, competing with the
   one accent everything else uses. Same composition, same falloff, the accent's
   own family, and pitched lower: an ambient effect belongs behind an interface
   rather than in front of it.

   Home and a project workspace both stand on it, which is why it lives here
   rather than in either of them: two copies would drift, and a phone moving
   between the two screens would see the light change. */
export default function PhoneField() {
  return (
    <div
      aria-hidden
      /* Dark only, for the same reason the dashboard's wash is: this is a
         violet field over a black floor, and there is no lighter key it stays
         itself in. The light theme's ground is the ground. */
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden md:hidden [html[data-theme=light]_&]:hidden"
    >
      {/* The floor the field sits on — the reference's lower half is this flat,
          with no vignette closing it. */}
      <div className="absolute inset-0 bg-canvas" />
      {/* The field: sampled down the reference's own centre, bright blue under
          the status bar and gone by a third of the way down the screen. */}
      <div className="absolute inset-x-0 top-0 h-[45%] bg-[linear-gradient(180deg,#2b2154_0%,#291f4f_3%,#231a43_14%,#1c1636_26%,#161129_37%,#0f0c1c_49%,#0a0812_63%,#08090a_78%,transparent_100%)]" />
      {/* The streaks: 45 degrees on a 118px pitch, the pitch the reference
          carries, at a little under its contrast. They fade with the field
          rather than crossing into the black. */}
      <div className="absolute inset-x-0 top-0 h-[45%] bg-[repeating-linear-gradient(135deg,rgba(184,160,255,0.12)_0px,rgba(184,160,255,0)_59px,rgba(184,160,255,0.12)_118px)] [-webkit-mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_68%)] [mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_68%)]" />
    </div>
  );
}
