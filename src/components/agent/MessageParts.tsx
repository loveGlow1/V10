"use client";

import React from "react";
import type { UIMessage } from "ai";

import ActionRow, { type ActionState } from "./ActionRow";
import type { Artifact } from "./ArtifactSheet";
import LiveCodeCard from "./LiveCodeCard";
import ReasoningPart from "./ReasoningPart";
import SnapshotPart from "./SnapshotPart";
import StepGroup, { summarise } from "./StepGroup";
import SubagentPart from "./SubagentPart";
import TextPart from "./TextPart";

/* One message's parts, each to its renderer — and runs of tool calls folded.
 *
 * The rule for folding: two or more tool calls in a row become one StepGroup
 * line. Two kinds always stand on their own and break a run, because they are
 * what a person is watching for: a file still being written (its code is
 * streaming into a card) and a screenshot (its thumbnail). Step boundaries are
 * not drawn at all. */

type AnyPart = { type: string; [key: string]: unknown };
type ToolPart = AnyPart & {
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const isTool = (part: AnyPart): part is ToolPart => part.type.startsWith("tool-");
const toolName = (part: ToolPart) => part.type.slice(5);
const actionState = (part: ToolPart): ActionState =>
  part.state === "output-available" ? "done" : part.state === "output-error" ? "error" : "running";

/* Standing alone: a code card still filling, and every screenshot. */
const standsAlone = (part: ToolPart, live: boolean) =>
  toolName(part) === "take_snapshot" ||
  ((toolName(part) === "write_file" || toolName(part) === "edit_file") && live && actionState(part) === "running");

function outputText(part: ToolPart): string | undefined {
  if (part.state === "output-error") return part.errorText;
  const output = part.output as Record<string, unknown> | undefined;
  if (!output) return undefined;
  if (toolName(part) === "run_command") {
    const out = [output.stdout, output.stderr].filter((text) => typeof text === "string" && text).join("\n");
    return `${out || "(no output)"}\n\nexit code ${String(output.exitCode ?? "?")}`;
  }
  if (toolName(part) === "read_file") {
    if (Array.isArray(output.files)) return (output.files as string[]).join("\n");
    return typeof output.content === "string" ? output.content : undefined;
  }
  return undefined;
}

function Tool({ part: given, live, onOpen }: { part: ToolPart; live: boolean; onOpen: (artifact: Artifact) => void }) {
  /* A call still in flight when its message stopped arriving (Stop, a dropped
     connection) will never finish: drawn as stopped, not as spinning forever —
     the same way the server stores it. */
  const part: ToolPart =
    !live && (given.state === "input-streaming" || given.state === "input-available")
      ? { ...given, state: "output-error", errorText: "Stopped before it finished." }
      : given;
  const name = toolName(part);
  const input = (part.input ?? {}) as Record<string, unknown>;
  const output = (part.output ?? {}) as Record<string, unknown>;
  const state = actionState(part);

  if (name === "write_file" || name === "edit_file") {
    const path = String(output.path ?? input.path ?? "");
    return (
      <LiveCodeCard
        name={name}
        state={part.state === "input-streaming" ? "input-streaming" : state === "running" ? "running" : state}
        input={input as { path?: string; content?: string; find?: string; replace?: string }}
        output={output as { path?: string; lines?: number; created?: boolean; added?: number; removed?: number }}
        error={part.errorText}
        onOpen={() =>
          onOpen(
            name === "write_file"
              ? { kind: "file", path, content: String(input.content ?? "") }
              : { kind: "diff", path, find: String(input.find ?? ""), replace: String(input.replace ?? "") },
          )
        }
      />
    );
  }

  if (name === "take_snapshot") {
    return (
      <SnapshotPart
        state={state}
        url={typeof output.url === "string" ? output.url : undefined}
        before={typeof output.before === "string" ? output.before : undefined}
        label={typeof output.label === "string" ? output.label : undefined}
        error={part.errorText}
      />
    );
  }

  if (name === "read_file") {
    const path = String(input.path ?? "");
    const listing = path === "." || path === "/";
    return (
      <ActionRow
        kind="read"
        verb={listing ? (state === "running" ? "Listing files" : "Listed the files") : state === "running" ? "Reading" : "Read"}
        target={listing ? undefined : path}
        state={state}
        detail={state === "error" ? part.errorText : undefined}
        onOpen={
          !listing && state === "done" && typeof output.content === "string"
            ? () => onOpen({ kind: "file", path, content: String(output.content) })
            : undefined
        }
      />
    );
  }

  if (name === "run_command") {
    return (
      <ActionRow
        kind="run"
        verb={state === "running" ? "Running" : "Ran"}
        target={String(input.cmd ?? "")}
        state={state === "done" && typeof output.exitCode === "number" && output.exitCode !== 0 ? "error" : state}
        detail={outputText(part)}
      />
    );
  }

  return <ActionRow kind="read" verb={name} state={state} detail={outputText(part)} />;
}

export default function MessageParts({
  message,
  streaming,
  onOpen,
}: {
  message: UIMessage;
  /** This message is the one still arriving. */
  streaming: boolean;
  onOpen: (artifact: Artifact) => void;
}) {
  const parts = (message.parts as AnyPart[]).filter((part) => part.type !== "step-start");
  const out: React.ReactNode[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (isTool(part) && !standsAlone(part, streaming)) {
      /* Gather the run of tool calls that can fold together. */
      const run: ToolPart[] = [part];
      while (index + 1 < parts.length && isTool(parts[index + 1]) && !standsAlone(parts[index + 1] as ToolPart, streaming)) {
        run.push(parts[++index] as ToolPart);
      }
      if (run.length === 1) {
        out.push(<Tool key={part.toolCallId} part={part} live={streaming} onOpen={onOpen} />);
      } else {
        out.push(
          <StepGroup
            key={`group-${run[0].toolCallId}`}
            summary={summarise(run.map(toolName))}
            running={streaming && run.some((one) => actionState(one) === "running")}
            failed={run.some((one) => actionState(one) === "error" || (!streaming && actionState(one) === "running"))}
          >
            {run.map((one) => (
              <Tool key={one.toolCallId} part={one} live={streaming} onOpen={onOpen} />
            ))}
          </StepGroup>,
        );
      }
      continue;
    }

    if (isTool(part)) {
      out.push(<Tool key={part.toolCallId} part={part} live={streaming} onOpen={onOpen} />);
      continue;
    }

    switch (part.type) {
      case "text":
        if (typeof part.text === "string" && part.text.trim()) out.push(<TextPart key={`text-${index}`} text={part.text} />);
        break;
      case "reasoning": {
        const meta = part.providerMetadata as { qs?: { ms?: number } } | undefined;
        out.push(
          <ReasoningPart
            key={`reasoning-${index}`}
            text={String(part.text ?? "")}
            streaming={streaming && part.state === "streaming"}
            storedMs={meta?.qs?.ms}
          />,
        );
        break;
      }
      case "data-subagent": {
        const data = (part.data ?? {}) as { name?: string; summary?: string; childSessionId?: string };
        out.push(
          <SubagentPart
            key={`subagent-${index}`}
            name={data.name ?? "Agent"}
            summary={data.summary ?? ""}
            onOpen={() =>
              onOpen({ kind: "subagent", name: data.name ?? "Agent", summary: data.summary ?? "", childSessionId: data.childSessionId ?? "" })
            }
          />,
        );
        break;
      }
      default:
        /* data-preview is the header chip's, not the thread's: no toast over
           the conversation. Anything else unknown is not drawn. */
        break;
    }
  }

  return <div className="flex min-w-0 flex-col gap-1">{out}</div>;
}
