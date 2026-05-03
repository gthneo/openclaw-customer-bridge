import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { OpenClawRpcClient } from "./endpoint.js";

/**
 * Real ingest RPC client. Replaces the v1 stub.
 *
 * Why direct file write instead of `appendAssistantMessageToSessionTranscript`:
 *   The helper IS typed in plugin-sdk d.ts (config/sessions/transcript.runtime.d.ts)
 *   but is NOT mapped through openclaw/package.json `exports`, so a plugin
 *   cannot import it. PluginRuntime exposes loadSessionStore /
 *   saveSessionStore / resolveStorePath / resolveSessionFilePath but no
 *   transcript-append. We use those for the SessionEntry index and append
 *   the transcript JSONL line ourselves following the format observed at
 *   ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl (audited
 *   2026-04-30 against openclaw v2026.4.10).
 *
 * Phase 1 limitation: emitSessionTranscriptUpdate is in-process and not
 * publicly callable, so direct file writes do not fire live streaming
 * events. chat.history still reads from disk and surfaces the message;
 * GeniusClaw BFF picks it up on next history poll. Live streaming will
 * follow when openclaw exposes an emit hook (or when we register as a
 * proper channel plugin via registerChannel).
 */

interface SessionEntryLike {
  sessionId: string;
  updatedAt: number;
  sessionFile?: string;
  [k: string]: unknown;
}

export interface CreateRealRpcClientOpts {
  api: OpenClawPluginApi;
  agentId: string;
}

export function createRealRpcClient(opts: CreateRealRpcClientOpts): OpenClawRpcClient {
  const { api, agentId } = opts;
  const session = api.runtime.agent.session;

  return {
    async chatInject(args) {
      try {
        const storePath = session.resolveStorePath(undefined, { agentId });
        const store = session.loadSessionStore(storePath) as Record<string, SessionEntryLike>;
        const now = Date.now();

        let entry = store[args.sessionKey];
        if (!entry) {
          entry = {
            sessionId: crypto.randomUUID(),
            updatedAt: now,
          };
          store[args.sessionKey] = entry;
        } else {
          entry.updatedAt = now;
        }

        // Populate the inventory metadata gateway sessions.list filters by.
        // Idempotent: backfills missing fields on entries created by older
        // versions of this code (which only wrote sessionId + updatedAt).
        if (args.meta) {
          const m = args.meta;
          if (!entry.channel) entry.channel = m.channel;
          if (!entry.chatType) entry.chatType = m.chatType;
          if (!entry.displayName) {
            entry.displayName = m.chatName || `${m.channel}:${m.chatId}`;
          }
          if (!entry.origin) {
            entry.origin = {
              label: m.chatName || m.chatId,
              provider: m.channel,
              surface: m.channel,
              chatType: m.chatType,
              from: m.chatId,
              to: m.chatId,
              accountId: agentId,
            };
          }
          if (!entry.lastChannel) entry.lastChannel = m.channel;
          if (!entry.lastTo) entry.lastTo = m.chatId;
          if (!entry.lastAccountId) entry.lastAccountId = agentId;
        }

        const sessionFile = session.resolveSessionFilePath(entry.sessionId, entry, { agentId });
        await ensureTranscriptHeader(sessionFile, entry.sessionId);

        const messageId = randomHex8();
        const parentId = await readLastEntryId(sessionFile);
        const line = JSON.stringify({
          type: "message",
          id: messageId,
          parentId,
          timestamp: new Date(now).toISOString(),
          message: {
            role: "assistant",
            content: [{ type: "text", text: args.message }],
            timestamp: now,
          },
        }) + "\n";
        await fs.appendFile(sessionFile, line, "utf-8");

        if (!entry.sessionFile) entry.sessionFile = sessionFile;
        await session.saveSessionStore(storePath, store as never);

        return { ok: true as const, messageId };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

function randomHex8(): string {
  return crypto.randomBytes(4).toString("hex");
}

async function readLastEntryId(file: string): Promise<string | null> {
  // Walk lines bottom-up. Skip the session header (`type:"session"`) — its
  // id is the sessionId UUID, not a chain link. Real chat.inject sets
  // parentId=null for the first non-header entry; mirror that semantic.
  try {
    const text = await fs.readFile(file, "utf-8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      const o = JSON.parse(lines[i]) as { id?: string; type?: string };
      if (o.type === "session") continue;
      return o.id ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureTranscriptHeader(file: string, sessionId: string): Promise<void> {
  try {
    await fs.access(file);
    return;
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const header = JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    }) + "\n";
    await fs.writeFile(file, header, "utf-8");
  }
}
