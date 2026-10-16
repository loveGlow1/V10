"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { NEW_PROJECT_NAME } from "./projectName";
import { useProjects } from "./ProjectsContext";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";

/* Starting a blank project, the way a browser's + opens a new page: the
   project is made, gets its own tab, and its empty workspace opens ready for
   the first message, which also names it. Shared by the tab strip's + and the
   phone's Quick Actions, so the two cannot drift apart. If the project cannot
   be made, Home's composer is the way to start one instead. */
export function useNewProject() {
  const router = useRouter();
  const { create } = useProjects();
  const { open } = useWorkspaceTabs();
  const [starting, setStarting] = useState(false);

  const startNew = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      const created = await create(NEW_PROJECT_NAME);
      if (!created) {
        router.push("/dashboard");
        return;
      }
      open({ id: created.id, name: created.name });
      router.push(`/dashboard/project/${created.id}`);
    } finally {
      setStarting(false);
    }
  }, [starting, create, open, router]);

  return { startNew, starting };
}
