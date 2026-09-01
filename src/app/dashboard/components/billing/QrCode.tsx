"use client";

import React, { useMemo } from "react";
import qrcode from "qrcode-generator";

/* The payment, as a thing a phone camera can read.
 *
 * Two decisions worth stating, because both look like styling and are not:
 *
 *   It is always dark modules on a white plate, on either theme. A QR code is
 *   read by a camera measuring contrast, and an inverted one — light modules on
 *   a dark ground — is unreadable to a good share of scanners. Nobody should
 *   have to switch their theme to pay.
 *
 *   The quiet zone is real. The four-module border around the symbol is part of
 *   the symbol; a code cropped tight to its modules scans badly, and the
 *   failure is intermittent, which is the worst way for a payment screen to
 *   fail.
 *
 * Rendered as one SVG path rather than a few hundred <rect> elements: same
 * picture, a fraction of the DOM, and it scales to whatever box it is given.
 */

/* Error correction M. L would fit more into a smaller symbol; M is what
   survives a phone camera at an angle in bad light, which is the condition this
   is actually scanned in. */
const ERROR_CORRECTION = "M" as const;
const QUIET_ZONE = 4;

export default function QrCode({
  value,
  className = "h-44 w-44",
  label,
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const symbol = useMemo(() => {
    try {
      /* Type number 0: the smallest symbol the data fits into, chosen by the
         encoder rather than guessed at here. */
      const qr = qrcode(0, ERROR_CORRECTION);
      qr.addData(value);
      qr.make();

      const count = qr.getModuleCount();
      const parts: string[] = [];

      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) {
            parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
          }
        }
      }

      return { size: count + QUIET_ZONE * 2, path: parts.join("") };
    } catch {
      /* Only reachable if the payload outgrew the largest symbol, which a
         payment URI cannot. Handled anyway: the address is on screen beside
         this, so a missing code is an inconvenience rather than a dead end. */
      return null;
    }
  }, [value]);

  if (!symbol) return null;

  return (
    <svg
      viewBox={`0 0 ${symbol.size} ${symbol.size}`}
      role="img"
      aria-label={label ?? "Payment QR code"}
      shapeRendering="crispEdges"
      className={`rounded-xl bg-white ${className}`}
    >
      <path d={symbol.path} fill="#000000" />
    </svg>
  );
}
