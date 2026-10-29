"use client";

import { useEffect } from "react";

import { MessageScreen, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./StatusScreen";

/* A page that threw. "Try again" re-renders it in place, which is what a
   dropped connection mid-load needs; the reference is the error's digest, the
   id it carries in the server logs, so a report can be traced. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <MessageScreen
      title="Something went wrong"
      body="This page didn't load properly. It's usually a dropped connection — try again, and your work is where you left it."
      detail={error.digest}
      actions={
        <>
          <button type="button" onClick={() => reset()} className={PRIMARY_BUTTON}>
            Try again
          </button>
          <a href="/dashboard" className={SECONDARY_BUTTON}>
            Go to dashboard
          </a>
        </>
      }
    />
  );
}
