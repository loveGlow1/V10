import { Brain, Database, FlaskConical, NotebookPen, type LucideIcon } from "lucide-react";

export type McpServer = {
  id: string;
  name: string;
  description: string;
  /** Servers that talk to a third party need that party's key before they work. */
  needsKey: boolean;
  Icon: LucideIcon;
  tint: string;
  color: string;
};

/* The servers offered out of the box. A connection saved here is stored against
   the account; nothing runs the server yet, which the pane says plainly. */
export const MCP_SERVERS: McpServer[] = [
  {
    id: "stitch",
    name: "Stitch MCP",
    description: "Connect your agent to Google Stitch for UI designs",
    needsKey: true,
    Icon: FlaskConical,
    tint: "bg-[#A855F7]/[0.14]",
    color: "text-[#C084FC]",
  },
  {
    id: "memory",
    name: "Memory MCP",
    description: "Enable memory for your agent",
    needsKey: false,
    Icon: Brain,
    tint: "bg-white/[0.06]",
    color: "text-[#C7CAD0]",
  },
  {
    id: "supabase",
    name: "Supabase MCP",
    description: "Connect your agent to Supabase using MCP",
    needsKey: true,
    Icon: Database,
    tint: "bg-[#3ECF8E]/[0.14]",
    color: "text-[#3ECF8E]",
  },
  {
    id: "notion",
    name: "Notion MCP",
    description: "Connect your agent to Notion",
    needsKey: true,
    Icon: NotebookPen,
    tint: "bg-white/[0.06]",
    color: "text-white",
  },
];
