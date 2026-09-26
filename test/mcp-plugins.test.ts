import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMessage,
  parseProtocolMessage,
  type McpListResultPayload,
  type McpToggleResultPayload,
  type PluginListResultPayload,
  type LspListResultPayload,
} from '../packages/protocol/src/index.js';
import { OpenCodeAdapter } from '../apps/agent/src/opencodeAdapter.js';

describe('MCP, Plugins and LSP Discovery & Toggling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('validates protocol messages for MCP, Plugins and LSP', () => {
    const listMsg = createMessage('MCP_LIST', {
      deviceId: 'dev_test_1',
      deviceToken: 'tok_1',
    });
    expect(listMsg.type).toBe('MCP_LIST');
    expect(parseProtocolMessage(JSON.stringify(listMsg))).toEqual(listMsg);

    const listResult = createMessage('MCP_LIST_RESULT', {
      deviceId: 'dev_test_1',
      mcps: {
        'chrome-devtools': { status: 'connected' },
        notion: { status: 'failed', error: 'MCP error -32000: Connection closed' },
        github: { status: 'disabled' },
      },
    });
    expect(listResult.type).toBe('MCP_LIST_RESULT');
    expect(parseProtocolMessage(JSON.stringify(listResult))).toEqual(listResult);

    const toggleMsg = createMessage('MCP_TOGGLE', {
      deviceId: 'dev_test_1',
      name: 'notion',
      deviceToken: 'tok_1',
    });
    expect(toggleMsg.type).toBe('MCP_TOGGLE');
    expect(parseProtocolMessage(JSON.stringify(toggleMsg))).toEqual(toggleMsg);

    const toggleResult = createMessage('MCP_TOGGLE_RESULT', {
      deviceId: 'dev_test_1',
      name: 'notion',
      success: true,
      status: 'connected',
      mcps: {
        notion: { status: 'connected' },
      },
    });
    expect(toggleResult.type).toBe('MCP_TOGGLE_RESULT');
    expect(parseProtocolMessage(JSON.stringify(toggleResult))).toEqual(toggleResult);

    const pluginResult = createMessage('PLUGIN_LIST_RESULT', {
      deviceId: 'dev_test_1',
      plugins: ['opencode-agent-skills', 'opencode-supermemory', 'open-conclave'],
    });
    expect(pluginResult.type).toBe('PLUGIN_LIST_RESULT');
    expect(parseProtocolMessage(JSON.stringify(pluginResult))).toEqual(pluginResult);

    const lspResult = createMessage('LSP_LIST_RESULT', {
      deviceId: 'dev_test_1',
      lsps: [{ id: 'typescript', name: 'TypeScript LS', status: 'connected' }],
    });
    expect(lspResult.type).toBe('LSP_LIST_RESULT');
    expect(parseProtocolMessage(JSON.stringify(lspResult))).toEqual(lspResult);
  });

  it('fetches MCP status from OpenCode server via adapter', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/mcp')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              'chrome-devtools': { status: 'connected' },
              notion: { status: 'failed', error: 'MCP error -32000: Connection closed' },
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as any;

    const adapter = new OpenCodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const mcps = await adapter.getMcpStatus();

    expect(mcps['chrome-devtools']?.status).toBe('connected');
    expect(mcps['notion']?.status).toBe('failed');
    expect(mcps['notion']?.error).toBe('MCP error -32000: Connection closed');
  });

  it('handles MCP toggle: disconnects connected server', async () => {
    let disconnected = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.endsWith('/mcp/chrome-devtools/disconnect') && init?.method === 'POST') {
        disconnected = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (url.endsWith('/mcp')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              'chrome-devtools': { status: disconnected ? 'disabled' : 'connected' },
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as any;

    const adapter = new OpenCodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const result = await adapter.toggleMcp('chrome-devtools');

    expect(disconnected).toBe(true);
    expect(result.success).toBe(true);
    expect(result.status).toBe('disabled');
  });

  it('handles MCP toggle: connects disabled/failed server', async () => {
    let connected = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.endsWith('/mcp/notion/connect') && init?.method === 'POST') {
        connected = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (url.endsWith('/mcp')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              notion: { status: connected ? 'connected' : 'failed', error: connected ? undefined : 'error' },
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as any;

    const adapter = new OpenCodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const result = await adapter.toggleMcp('notion');

    expect(connected).toBe(true);
    expect(result.success).toBe(true);
    expect(result.status).toBe('connected');
  });

  it('fetches plugins list from OpenCode server /config', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/config')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              plugin: [
                'opencode-agent-skills',
                '@ramarivera/opencode-model-announcer',
                ['opencode-supermemory', { apiKey: 'xyz' }],
              ],
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as any;

    const adapter = new OpenCodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const plugins = await adapter.getPlugins();

    expect(plugins).toEqual([
      'opencode-agent-skills',
      '@ramarivera/opencode-model-announcer',
      'opencode-supermemory',
    ]);
  });

  it('fetches LSP status list from OpenCode server /lsp', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/lsp')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 'typescript', name: 'TypeScript', status: 'connected' },
              { id: 'python', name: 'Pyright', status: 'error' },
            ]),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as any;

    const adapter = new OpenCodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
    const lsps = await adapter.getLspStatus();

    expect(lsps).toHaveLength(2);
    expect(lsps[0].id).toBe('typescript');
    expect(lsps[1].status).toBe('error');
  });
});
