import Link from "next/link";

import { MessageScreen, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./StatusScreen";

export default function NotFound() {
  return (
    <MessageScreen
      title="Page not found"
      body="This page doesn't exist or has moved."
      actions={
        <>
          <Link href="/dashboard" className={PRIMARY_BUTTON}>
            Go to dashboard
          </Link>
          <Link href="/" className={SECONDARY_BUTTON}>
            Home
          </Link>
        </>
      }
    />
  );
}
