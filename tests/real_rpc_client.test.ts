import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRealRpcClient } from '../src/ingest/real_rpc_client.ts';

/**
 * Tests for the real RPC client. Build a fake PluginRuntime that exposes
 * just the four session helpers used by `createRealRpcClient`. The store
 * is a plain in-memory dict; transcript files land in a tmp dir.
 */

interface FakeStore {
  [sessionKey: string]: {
    sessionId: string;
    updatedAt: number;
    sessionFile?: string;
    [k: string]: unknown;
  };
}

function makeFakeApi(tmpDir: string) {
  const store: FakeStore = {};
  return {
    api: {
      runtime: {
        agent: {
          session: {
            resolveStorePath: (_p: unknown, _opts: { agentId: string }) =>
              path.join(tmpDir, 'sessions.json'),
            loadSessionStore: () => store,
            saveSessionStore: async () => { /* no-op in tests */ },
            resolveSessionFilePath: (sessionId: string) =>
              path.join(tmpDir, 'sessions', `${sessionId}.jsonl`),
          },
        },
      },
    },
    store,
  };
}

async function readTranscriptLines(file: string): Promise<unknown[]> {
  const text = await fs.readFile(file, 'utf-8');
  return text.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

test('real_rpc: creates new transcript file with header on first inject', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-rpc-'));
  try {
    const { api } = makeFakeApi(tmp);
    const rpc = createRealRpcClient({ api: api as never, agentId: 'main' });

    const r = await rpc.chatInject({
      sessionKey: 'agent:main:openclaw-weixin:chat:111@chatroom',
      message: '[微信] Alice: hello',
      label: 'kw:test',
    });
    assert.equal(r.ok, true);

    // Find the created transcript file
    const sessionsDir = path.join(tmp, 'sessions');
    const files = await fs.readdir(sessionsDir);
    assert.equal(files.length, 1);
    const lines = await readTranscriptLines(path.join(sessionsDir, files[0]));
    assert.equal(lines.length, 2, 'expected header + 1 message');
    assert.equal((lines[0] as { type: string }).type, 'session');
    assert.equal((lines[1] as { type: string }).type, 'message');
    const msg = lines[1] as {
      parentId: string | null;
      message: { role: string; content: { text: string }[] };
    };
    assert.equal(msg.parentId, null, 'first non-header message must have parentId=null');
    assert.equal(msg.message.role, 'assistant');
    assert.equal(msg.message.content[0].text, '[微信] Alice: hello');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('real_rpc: appends to existing transcript with parentId chained to previous id', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-rpc-'));
  try {
    const { api } = makeFakeApi(tmp);
    const rpc = createRealRpcClient({ api: api as never, agentId: 'main' });
    const sessionKey = 'agent:main:openclaw-weixin:chat:222@chatroom';

    const r1 = await rpc.chatInject({ sessionKey, message: 'first' });
    const r2 = await rpc.chatInject({ sessionKey, message: 'second' });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);

    const files = await fs.readdir(path.join(tmp, 'sessions'));
    assert.equal(files.length, 1, 'second inject must reuse the same sessionId');
    const lines = await readTranscriptLines(path.join(tmp, 'sessions', files[0]));
    assert.equal(lines.length, 3);
    const m1 = lines[1] as { id: string };
    const m2 = lines[2] as { parentId: string | null };
    assert.equal(m2.parentId, m1.id, 'second message parentId must match first message id');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('real_rpc: returns ok=false when runtime helper throws', async () => {
  const { api } = makeFakeApi('/tmp');
  // Force loadSessionStore to throw — covers the catch-all error path
  (api as unknown as { runtime: { agent: { session: { loadSessionStore: () => never } } } })
    .runtime.agent.session.loadSessionStore = () => { throw new Error('store disk locked'); };
  const rpc = createRealRpcClient({ api: api as never, agentId: 'main' });
  const r = await rpc.chatInject({
    sessionKey: 'agent:main:openclaw-weixin:chat:333@chatroom',
    message: 'should fail',
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /store disk locked/);
  }
});
