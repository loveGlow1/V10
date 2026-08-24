import Link from 'next/link';

import { SignOutButton } from './sign-out-button';

const links = [
  { href: '/dashboard', label: 'Projects' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export function SidebarNav() {
  return (
    <div className="flex h-full flex-col gap-8 px-6 py-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Workspace</p>
        <h1 className="text-2xl font-semibold text-white">Emergent V10</h1>
      </div>
      <nav className="space-y-2">
        {links.map((link) => (
          <Link key={link.href} className="block rounded-2xl px-4 py-3 text-slate-300 transition hover:bg-white/5 hover:text-white" href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto space-y-3">
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
          TODO: insert workspace switcher and usage snapshot.
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}
