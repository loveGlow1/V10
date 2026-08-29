import Link from 'next/link';

export function Navbar() {
  return (
    <header className="flex items-center justify-between rounded-full border border-line/10 bg-slate-950/60 px-5 py-3 backdrop-blur">
      <Link className="text-lg font-semibold text-ink" href="/">
        Emergent V10
      </Link>
      <nav className="flex items-center gap-4 text-sm text-slate-300">
        <Link href="/pricing">Pricing</Link>
        <Link href="/">Login</Link>
        <Link className="rounded-full bg-sky-400 px-4 py-2 font-medium text-slate-950" href="/register">
          Start building
        </Link>
      </nav>
    </header>
  );
}
