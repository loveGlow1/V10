/* The dev container a project carries to GitHub, so opening it in a Codespace
 * runs it: dependencies installed when the Codespace is made, the app started
 * every time it is opened, and its preview opened beside the code.
 *
 * Added on the way out (the push) and only when the project has none of its
 * own — one somebody wrote or changed in the Codespace comes back with Sync
 * and is pushed as they left it. */

import type { FileTree } from "@/lib/builder/tree";

export const DEVCONTAINER_PATH = ".devcontainer/devcontainer.json";

const PORT = 3000;

/* How the app is started: its own dev script when it has one, its start
   script otherwise, and a static server for a page with no package.json. */
function startCommand(tree: FileTree): { install: string | null; start: string; open: string } {
  const pkg = tree.find((file) => file.path === "package.json");
  if (!pkg) {
    const page = tree.find((file) => file.path === "index.html") ? "index.html" : tree[0]?.path ?? "index.html";
    return { install: null, start: `npx --yes serve -l ${PORT} .`, open: page };
  }
  let scripts: Record<string, unknown> = {};
  try {
    scripts = (JSON.parse(pkg.content) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    /* An unreadable package.json still installs; the dev script is the guess. */
  }
  const start = typeof scripts.dev === "string" ? "npm run dev" : typeof scripts.start === "string" ? "npm start" : "npm run dev";
  const open =
    ["app/page.tsx", "src/app/page.tsx", "app/page.jsx", "pages/index.tsx", "src/App.tsx", "index.html"].find((path) =>
      tree.some((file) => file.path === path),
    ) ?? "package.json";
  return { install: "npm install", start, open };
}

export function devcontainerFor(tree: FileTree): string {
  const { install, start, open } = startCommand(tree);
  const config: Record<string, unknown> = {
    name: "QuickStark app",
    image: "mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm",
    ...(install ? { postCreateCommand: install } : {}),
    postAttachCommand: { app: start },
    forwardPorts: [PORT],
    portsAttributes: { [String(PORT)]: { label: "App", onAutoForward: "openPreview" } },
    customizations: {
      codespaces: { openFiles: [open] },
      vscode: { extensions: ["bradlc.vscode-tailwindcss", "dbaeumer.vscode-eslint", "esbenp.prettier-vscode"] },
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** The tree with a dev container added, unless it already has one. */
export function withDevcontainer(tree: FileTree): FileTree {
  if (tree.some((file) => file.path.startsWith(".devcontainer/") || file.path === ".devcontainer.json")) return tree;
  return [...tree, { path: DEVCONTAINER_PATH, content: devcontainerFor(tree) }];
}
