import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import * as fs from 'fs';
import { buildRelayServer } from '../apps/relay/src/server.js';
import {
  createMessage,
  parseProtocolMessage,
  PROTOCOL_VERSION,
  type ProtocolMessage,
  type OpenCodeProject,
  type OpenCodeSession,
} from '../packages/protocol/src/index.js';

describe('Global PC-Wide Projects and Sessions E2E', () => {
  const port = 4599;
  const storePath = '.test-global-projects-store.json';
  const relayWsUrl = `ws://127.0.0.1:${port}/ws`;
  let relayApp: any;

  const TEST_DEVICE_ID = 'dev_pc_global_test';
  const TEST_DEVICE_NAME = 'Darko-Global-PC';

  let agentWs: WebSocket;
  let clientWs: WebSocket;
  let clientToken: string = '';

  const mockProjects: OpenCodeProject[] = [
    {
      id: 'proj_donghua',
      worktree: 'D:/Projects/web/MyDonghuaList',
      name: 'MyDonghuaList',
      vcs: 'git',
      time: { created: Date.now() - 100000 },
    },
    {
      id: 'proj_anilili',
      worktree: 'D:/Projects/web/Anilili',
      name: 'Anilili',
      vcs: 'git',
      time: { created: Date.now() - 200000 },
    },
    {
      id: 'proj_remote',
      worktree: 'D:/Projects/apps/OpencodeMobile',
      name: 'OpencodeMobile',
      vcs: 'git',
      time: { created: Date.now() - 50000 },
    },
  ];

  const mockSessions: OpenCodeSession[] = [
    {
      id: 'ses_donghua_1',
      title: 'Fix episode scraping',
      createdAt: Date.now() - 50000,
      projectId: 'proj_donghua',
      directory: 'D:/Projects/web/MyDonghuaList',
    },
    {
      id: 'ses_anilili_1',
      title: 'Update video player controls',
      createdAt: Date.now() - 40000,
      projectId: 'proj_anilili',
      directory: 'D:/Projects/web/Anilili',
    },
    {
      id: 'ses_remote_1',
      title: 'Global PC-wide sessions support',
      createdAt: Date.now() - 10000,
      projectId: 'proj_remote',
      directory: 'D:/Projects/apps/OpencodeMobile',
    },
  ];

  function openWs(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function waitForMessage<T extends ProtocolMessage>(
    ws: WebSocket,
    predicate: (msg: ProtocolMessage) => boolean,
    tag = 'msg',
    timeoutMs = 5000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout;
      function handler(data: WebSocket.Data) {
        try {
          const msg = parseProtocolMessage(data.toString());
          if (predicate(msg)) {
            clearTimeout(timer);
            if (ws && typeof ws.off === 'function') {
              ws.off('message', handler);
            }
            resolve(msg as T);
          }
        } catch {
          // ignore
        }
      }

      timer = setTimeout(() => {
        if (ws && typeof ws.off === 'function') {
          ws.off('message', handler);
        }
        reject(new Error(`waitForMessage timed out after ${timeoutMs}ms waiting for condition: [${tag}]`));
      }, timeoutMs);

      ws.on('message', handler);
    });
  }

  beforeAll(async () => {
    if (fs.existsSync(storePath)) {
      try { fs.unlinkSync(storePath); } catch {}
    }

    const server = buildRelayServer({ port, storePath });
    relayApp = server.app;
    await relayApp.listen({ port, host: '127.0.0.1' });

    // Connect Agent
    agentWs = await openWs(relayWsUrl);
    const hello = createMessage('AGENT_HELLO', {
      deviceId: TEST_DEVICE_ID,
      deviceName: TEST_DEVICE_NAME,
      agentVersion: '0.1.0',
      os: 'win32',
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { sessions: true, streaming: true, permissions: true },
      requestPairingCode: true,
    });
    agentWs.send(JSON.stringify(hello));

    const ack = await waitForMessage<any>(agentWs, (m) => m.type === 'AGENT_HELLO_ACK', 'agent-ack');
    const pairingCode = ack.payload.pairingCode;
    expect(pairingCode).toBeTruthy();

    // Setup Agent responder for Project RPCs
    agentWs.on('message', (data) => {
      try {
        const msg = parseProtocolMessage(data.toString());
        if (msg.type === 'PAIRING_OFFER') {
          agentWs.send(
            JSON.stringify(createMessage('PAIRING_APPROVE', { pairingId: msg.payload.pairingId }))
          );
        } else if (msg.type === 'PROJECT_LIST') {
          agentWs.send(
            JSON.stringify(
              createMessage(
                'PROJECT_LIST_RESULT',
                { deviceId: TEST_DEVICE_ID, projects: mockProjects },
                msg.id
              )
            )
          );
        } else if (msg.type === 'SESSION_LIST_GLOBAL') {
          agentWs.send(
            JSON.stringify(
              createMessage(
                'SESSION_LIST_GLOBAL_RESULT',
                {
                  deviceId: TEST_DEVICE_ID,
                  sessions: mockSessions,
                  statuses: { ses_remote_1: 'busy', ses_donghua_1: 'idle' },
                },
                msg.id
              )
            )
          );
        } else if (msg.type === 'SESSION_LIST_PROJECT') {
          const filtered = mockSessions.filter(
            (s) =>
              (msg.payload.directory && s.directory === msg.payload.directory) ||
              (msg.payload.projectId && s.projectId === msg.payload.projectId)
          );
          agentWs.send(
            JSON.stringify(
              createMessage(
                'SESSION_LIST_PROJECT_RESULT',
                {
                  deviceId: TEST_DEVICE_ID,
                  projectId: msg.payload.projectId,
                  directory: msg.payload.directory,
                  sessions: filtered,
                  statuses: { ses_donghua_1: 'idle' },
                },
                msg.id
              )
            )
          );
        } else if (msg.type === 'SESSION_CREATE') {
          const newSess: OpenCodeSession = {
            id: `ses_${Date.now()}`,
            title: msg.payload.title || 'New Session',
            createdAt: Date.now(),
            directory: msg.payload.directory,
            projectId: msg.payload.projectId,
          };
          agentWs.send(
            JSON.stringify(
              createMessage(
                'SESSION_CREATE_RESULT',
                { deviceId: TEST_DEVICE_ID, session: newSess },
                msg.id
              )
            )
          );
        } else if (msg.type === 'SESSION_GET') {
          const matched = mockSessions.find((s) => s.id === msg.payload.sessionId);
          agentWs.send(
            JSON.stringify(
              createMessage(
                'SESSION_GET_RESULT',
                {
                  deviceId: TEST_DEVICE_ID,
                  requestId: msg.id,
                  session: matched || {
                    id: msg.payload.sessionId,
                    title: 'External Session',
                    createdAt: Date.now(),
                    directory: msg.payload.directory,
                  },
                  messages: [
                    {
                      id: 'msg_ext_1',
                      sessionId: msg.payload.sessionId,
                      role: 'user',
                      content: 'Hello external project',
                      createdAt: Date.now() - 5000,
                    },
                    {
                      id: 'msg_ext_2',
                      sessionId: msg.payload.sessionId,
                      role: 'assistant',
                      content: 'External project chat loaded successfully!',
                      createdAt: Date.now() - 1000,
                    },
                  ],
                },
                msg.id
              )
            )
          );
        }
      } catch {}
    });

    // Connect Client & Pair
    clientWs = await openWs(relayWsUrl);
    clientWs.send(
      JSON.stringify(
        createMessage('CLIENT_HELLO', {
          clientId: 'client_phone_123',
          clientName: 'Darko Phone Client',
          clientPlatform: 'android',
          clientVersion: '0.1.0',
          protocolVersion: PROTOCOL_VERSION,
        })
      )
    );
    await waitForMessage(clientWs, (m) => m.type === 'CLIENT_HELLO_ACK', 'client-ack');

    // Send pairing request
    clientWs.send(
      JSON.stringify(
        createMessage('PAIRING_REQUEST', {
          code: pairingCode,
          clientName: 'Darko Phone Client',
        })
      )
    );

    const pairedMsg = await waitForMessage<any>(
      clientWs,
      (m) => m.type === 'PAIRING_COMPLETE',
      'client-paired'
    );
    expect(pairedMsg.payload.success).toBe(true);
    clientToken = pairedMsg.payload.deviceToken;
    expect(clientToken).toBeTruthy();
  });

  afterAll(async () => {
    try { clientWs?.close(); } catch {}
    try { agentWs?.close(); } catch {}
    try { await relayApp?.close(); } catch {}
    if (fs.existsSync(storePath)) {
      try { fs.unlinkSync(storePath); } catch {}
    }
  });

  it('1. Fetches PC-wide projects list via PROJECT_LIST RPC', async () => {
    const req = createMessage('PROJECT_LIST', {
      deviceId: TEST_DEVICE_ID,
      deviceToken: clientToken,
    });
    clientWs.send(JSON.stringify(req));

    const res = await waitForMessage<any>(
      clientWs,
      (m) => m.type === 'PROJECT_LIST_RESULT' && m.payload.deviceId === TEST_DEVICE_ID,
      'project-list-res'
    );

    expect(res.payload.projects).toHaveLength(3);
    expect(res.payload.projects.map((p: any) => p.name)).toEqual([
      'MyDonghuaList',
      'Anilili',
      'OpencodeMobile',
    ]);
    expect(res.payload.projects[0].worktree).toBe('D:/Projects/web/MyDonghuaList');
  });

  it('2. Fetches PC-wide global sessions via SESSION_LIST_GLOBAL RPC', async () => {
    const req = createMessage('SESSION_LIST_GLOBAL', {
      deviceId: TEST_DEVICE_ID,
      deviceToken: clientToken,
    });
    clientWs.send(JSON.stringify(req));

    const res = await waitForMessage<any>(
      clientWs,
      (m) => m.type === 'SESSION_LIST_GLOBAL_RESULT' && m.payload.deviceId === TEST_DEVICE_ID,
      'global-sessions-res'
    );

    expect(res.payload.sessions).toHaveLength(3);
    // Verified sessions across all directories are present
    const dirs = res.payload.sessions.map((s: any) => s.directory);
    expect(dirs).toContain('D:/Projects/web/MyDonghuaList');
    expect(dirs).toContain('D:/Projects/web/Anilili');
    expect(dirs).toContain('D:/Projects/apps/OpencodeMobile');

    expect(res.payload.statuses).toEqual({
      ses_remote_1: 'busy',
      ses_donghua_1: 'idle',
    });
  });

  it('3. Fetches project-scoped sessions via SESSION_LIST_PROJECT RPC', async () => {
    const req = createMessage('SESSION_LIST_PROJECT', {
      deviceId: TEST_DEVICE_ID,
      deviceToken: clientToken,
      directory: 'D:/Projects/web/MyDonghuaList',
      projectId: 'proj_donghua',
    });
    clientWs.send(JSON.stringify(req));

    const res = await waitForMessage<any>(
      clientWs,
      (m) => m.type === 'SESSION_LIST_PROJECT_RESULT' && m.payload.deviceId === TEST_DEVICE_ID,
      'project-sessions-res'
    );

    expect(res.payload.sessions).toHaveLength(1);
    expect(res.payload.sessions[0].title).toBe('Fix episode scraping');
    expect(res.payload.sessions[0].directory).toBe('D:/Projects/web/MyDonghuaList');
  });

  it('4. Creates session scoped to specified project directory', async () => {
    const req = createMessage('SESSION_CREATE', {
      deviceId: TEST_DEVICE_ID,
      deviceToken: clientToken,
      title: 'New Anilili feature',
      directory: 'D:/Projects/web/Anilili',
      projectId: 'proj_anilili',
    });
    clientWs.send(JSON.stringify(req));

    const res = await waitForMessage<any>(
      clientWs,
      (m) => m.type === 'SESSION_CREATE_RESULT' && m.payload.deviceId === TEST_DEVICE_ID,
      'session-create-res'
    );

    expect(res.payload.session.directory).toBe('D:/Projects/web/Anilili');
    expect(res.payload.session.projectId).toBe('proj_anilili');
    expect(res.payload.session.title).toBe('New Anilili feature');
  });

  it('5. Loads external project session (e.g. MyDonghuaList / Dailio) via SESSION_GET with correct directory and messages', async () => {
    const req = createMessage('SESSION_GET', {
      deviceId: TEST_DEVICE_ID,
      deviceToken: clientToken,
      sessionId: 'ses_donghua_1',
      directory: 'D:/Projects/web/MyDonghuaList',
    });
    clientWs.send(JSON.stringify(req));

    const res = await waitForMessage<any>(
      clientWs,
      (m) => m.type === 'SESSION_GET_RESULT' && m.payload.deviceId === TEST_DEVICE_ID,
      'session-get-res'
    );

    expect(res.payload.session.id).toBe('ses_donghua_1');
    expect(res.payload.session.directory).toBe('D:/Projects/web/MyDonghuaList');
    expect(res.payload.requestId).toBe(req.id);
    expect(res.payload.messages).toHaveLength(2);
    expect(res.payload.messages[1].content).toBe('External project chat loaded successfully!');
  });
});
