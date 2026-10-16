"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { useWorkspaceTabs } from "./WorkspaceTabsContext";

/* Forking a GitHub repository into a new project — see
   /api/integrations/github/fork. Shared by Home's Import from GitHub and the
   VS Code dialog inside a project, so the two cannot drift apart: the repo is
   forked into the person's own account (or used as is when it is theirs), its
   files become a new project, and that project opens on its own tab. */
export function useGitHubImport(onDone?: () => void) {
  const router = useRouter();
  const { open } = useWorkspaceTabs();
  const [repo, setRepo] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);

  const importRepo = useCallback(async () => {
    if (importing || !repo.trim()) return;
    setImporting(true);
    setError(null);
    setUpgrade(false);
    try {
      const response = await fetch("/api/integrations/github/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repo.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { projectId?: string; name?: string; error?: string; upgrade?: boolean };
      if (!response.ok || !body.projectId) {
        setUpgrade(Boolean(body.upgrade));
        setError(body.error ?? "That repository could not be imported.");
        return;
      }
      open({ id: body.projectId, name: body.name ?? "Project" });
      setRepo("");
      onDone?.();
      router.push(`/dashboard/project/${body.projectId}`);
    } catch {
      setError("GitHub couldn't be reached. Check your connection and try again.");
    } finally {
      setImporting(false);
    }
  }, [importing, repo, open, onDone, router]);

  return { repo, setRepo, importing, error, upgrade, importRepo };
}
