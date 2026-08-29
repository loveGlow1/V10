import React from "react";

/* The phone backdrop: a deep blue field off the top of the screen, two
   diagonal bands of light blurred into it, then a black floor and a
   vignette that closes the edges. It is fixed, so the page scrolls
   through the light rather than dragging it along.

   Home and a project workspace both stand on it, which is why it lives here
   rather than in either of them: two copies would drift, and a phone moving
   between the two screens would see the light change. */
export default function PhoneField() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden md:hidden">
      {/* The floor the field sits on — the reference's lower half is this flat,
          with no vignette closing it. */}
      <div className="absolute inset-0 bg-[#020206]" />
      {/* The field: sampled down the reference's own centre, bright blue under
          the status bar and gone by a third of the way down the screen. */}
      <div className="absolute inset-x-0 top-0 h-[45%] bg-[linear-gradient(180deg,#073e80_0%,#073c7a_3%,#072c58_14%,#082243_26%,#071b30_37%,#04111f_49%,#03080e_63%,#020206_78%,transparent_100%)]" />
      {/* The streaks: 45 degrees on a 118px pitch, the pitch the reference
          carries, at a little under its contrast. They fade with the field
          rather than crossing into the black. */}
      <div className="absolute inset-x-0 top-0 h-[45%] bg-[repeating-linear-gradient(135deg,rgba(128,192,255,0.17)_0px,rgba(128,192,255,0)_59px,rgba(128,192,255,0.17)_118px)] [-webkit-mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_68%)] [mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_68%)]" />
    </div>
  );
}
