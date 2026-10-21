"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { useWorkspaceTabs } from "./WorkspaceTabsContext";

/* A GitHub repository as a new project — see /api/integrations/github/fork.
   Shared by Home's Import from GitHub and the VS Code dialog inside a project,
   so the two cannot drift apart. Two ways in:
     import  saved straight from the repository, nothing made on GitHub; it
             stays in the workspace until published or pushed back.
     fork    forked into the person's own account first (or used as is when it
             is theirs), and linked to that fork.
   Either way its files become a new project that opens on its own tab. */
export type GitHubImportMode = "import" | "fork";

export function useGitHubImport(onDone?: () => void) {
  const router = useRouter();
  const { open } = useWorkspaceTabs();
  const [repo, setRepo] = useState("");
  /* Which of the two is under way, if either. */
  const [busy, setBusy] = useState<GitHubImportMode | null>(null);
  const importing = busy !== null;
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);

  const importRepo = useCallback(async (mode: GitHubImportMode = "import") => {
    if (importing || !repo.trim()) return;
    setBusy(mode);
    setError(null);
    setUpgrade(false);
    try {
      const response = await fetch("/api/integrations/github/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repo.trim(), mode }),
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
      setBusy(null);
    }
  }, [importing, repo, open, onDone, router]);

  return { repo, setRepo, importing, busy, error, upgrade, importRepo };
}
