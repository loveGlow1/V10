"use client";

import "./globals.css";

import { MessageScreen, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./StatusScreen";

/* When the root layout itself fails, error.tsx has nothing to render inside,
   so this one brings its own document — dark from the first frame, like the
   rest of the site. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" style={{ colorScheme: "dark", background: "#050505" }}>
      <body className="bg-brandBg text-ink antialiased">
        <MessageScreen
          title="Something went wrong"
          body="QuickStark couldn't load just now. Check your connection and try again."
          detail={error.digest}
          actions={
            <>
              <button type="button" onClick={() => reset()} className={PRIMARY_BUTTON}>
                Try again
              </button>
              <a href="/" className={SECONDARY_BUTTON}>
                Go home
              </a>
            </>
          }
        />
      </body>
    </html>
  );
}
