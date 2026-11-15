import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/* One header for every dashboard page: a round back button, the title, and
   whatever actions the page has on the right. The same on a phone as on a
   desktop, so moving between Projects, Fliers, Videos and Keys never changes
   where "back" is or how big the title is. */
export default function PageHeader({
  title,
  back = "/dashboard",
  backLabel = "Back to Home",
  icon,
  children,
}: {
  title: ReactNode;
  back?: string;
  backLabel?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link href={back} aria-label={backLabel} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line/[0.08] bg-layer/[0.03] text-soft hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <h1 className="flex min-w-0 flex-1 items-center gap-2 truncate text-[20px] font-semibold text-ink">
        {icon}
        {title}
      </h1>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}
