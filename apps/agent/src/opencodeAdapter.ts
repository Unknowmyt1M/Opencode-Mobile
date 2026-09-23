import * as fs from 'fs';
import * as path from 'path';
import type {
  OpenCodeSession,
  SessionMessage,
  SnapshotFileDiff,
  ProjectContext,
  PtySession,
  ModelInfo,
  PermissionItem,
  TodoItem,
} from '@opencode-remote/protocol';

export interface OpenCodeAdapterOptions {
  baseUrl?: string;
  password?: string;
  username?: string;
  defaultModel?: {
    providerID: string;
    modelID: string;
  };
}

export class OpenCodeAdapter {
  private baseUrl: string;
  private authHeader?: string;
  private defaultModel?: { providerID: string; modelID: string };
  private eventAbortController: AbortController | null = null;
  private isListeningEvents = false;

  constructor(options?: OpenCodeAdapterOptions) {
    const rawUrl = options?.baseUrl || process.env.OPENCODE_URL || 'http://127.0.0.1:4096';
    this.baseUrl = rawUrl.replace(/\/$/, '');
    if (options?.password) {
      const u = options.username || 'opencode';
      const encoded = Buffer.from(`${u}:${options.password}`).toString('base64');
      this.authHeader = `Basic ${encoded}`;
    }

    if (options?.defaultModel) {
      this.defaultModel = options.defaultModel;
    } else if (process.env.OPENCODE_PROVIDER_ID && process.env.OPENCODE_MODEL_ID) {
      this.defaultModel = {
        providerID: process.env.OPENCODE_PROVIDER_ID,
        modelID: process.env.OPENCODE_MODEL_ID,
      };
    } else {
      this.defaultModel = {
        providerID: 'opencode-zen-acc_1',
        modelID: 'mimo-v2.5-free',
      };
    }
  }

  private getHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.authHeader) {
      h['Authorization'] = this.authHeader;
    }
    return h;
  }

  async listSessions(): Promise<OpenCodeSession[]> {
    const res = await fetch(`${this.baseUrl}/session`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to list sessions: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any[];
    return (data || []).map((s) => ({
      id: s.id,
      title: s.title || 'Untitled Session',
      createdAt: s.createdAt || Date.now(),
      updatedAt: s.updatedAt,
    }));
  }

  async createSession(title?: string): Promise<OpenCodeSession> {
    const body: Record<string, any> = {};
    if (title) body.title = title;
    if (this.defaultModel) {
      body.model = {
        id: this.defaultModel.modelID,
        providerID: this.defaultModel.providerID,
      };
    }

    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Failed to create session: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    return {
      id: data.id,
      title: data.title || title || 'New Session',
      createdAt: data.createdAt || Date.now(),
      updatedAt: data.updatedAt,
    };
  }

  async getSession(sessionId: string): Promise<{ session: OpenCodeSession; messages: SessionMessage[] }> {
    // 1. Fetch session info
    const sessionRes = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      headers: this.getHeaders(),
    });
    if (!sessionRes.ok) {
      throw new Error(`Session ${sessionId} not found: HTTP ${sessionRes.status}`);
    }
    const sessionData = (await sessionRes.json()) as any;

    // 2. Fetch session messages
    const messagesRes = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      headers: this.getHeaders(),
    });

    const messages: SessionMessage[] = [];
    if (messagesRes.ok) {
      const rawMessages = (await messagesRes.json()) as any[];
      for (const m of rawMessages || []) {
        const info = m.info || {};
        const parts = m.parts || [];
        const textContent = parts
          .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
          .map((p: any) => p.text)
          .join('\n');

        const isCompaction =
          info.mode === 'compaction' ||
          info.agent === 'compaction' ||
          Boolean(info.summary) ||
          parts.some((p: any) => p.type === 'compaction');

        messages.push({
          id: info.id || `msg_${Date.now()}`,
          sessionId: info.sessionID || sessionId,
          role: info.role === 'user' ? 'user' : info.role === 'system' ? 'system' : 'assistant',
          content: textContent || (parts[0]?.text ?? ''),
          createdAt: info.createdAt || Date.now(),
          isCompaction: Boolean(isCompaction),
          summary: typeof info.summary === 'boolean' || (typeof info.summary === 'object' && info.summary !== null) ? info.summary : undefined,
          parts: parts.map((p: any) => ({
            id: p.id,
            type: p.type,
            text: p.text,
            duration: p.duration,
            callID: p.callID,
            tool: p.tool,
            state: p.state,
            path: p.path,
            mime: p.mime,
            hash: p.hash,
            files: p.files,
            reason: p.reason,
          })),
        });
      }
    }

    return {
      session: {
        id: sessionData.id,
        title: sessionData.title || 'Untitled Session',
        createdAt: sessionData.createdAt || Date.now(),
        updatedAt: sessionData.updatedAt,
      },
      messages,
    };
  }

  async getSessionDiff(sessionId: string): Promise<SnapshotFileDiff[]> {
    let diffs: SnapshotFileDiff[] = [];

    // 1. Try native OpenCode diff endpoint
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/diff`, {
        headers: this.getHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as any[];
        diffs = (data || []).map((d: any) => ({
          file: (d.file || '').replace(/\\/g, '/'),
          patch: d.patch,
          additions: typeof d.additions === 'number' ? d.additions : 0,
          deletions: typeof d.deletions === 'number' ? d.deletions : 0,
          status: d.status,
        }));
      }
    } catch {
      // Continue to fallback
    }

    // 2. Discover worktree
    let worktree = process.cwd();
    try {
      const project = await this.getProjectContext();
      if (project.worktree) {
        worktree = project.worktree;
      }
    } catch {
      // ignore
    }

    // 3. Fallback/Augment: scan session messages for touched files (write/edit/patch tools and patch parts)
    try {
      const messagesRes = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
        headers: this.getHeaders(),
      });
      if (messagesRes.ok) {
        const rawMessages = (await messagesRes.json()) as any[];
        const fileMap = new Map<string, { status: string; content?: string; fullPath?: string }>();

        for (const m of rawMessages || []) {
          for (const p of m.parts || []) {
            if (p.type === 'patch' && Array.isArray(p.files)) {
              for (const f of p.files) {
                if (typeof f === 'string') {
                  const norm = path.relative(worktree, f).replace(/\\/g, '/');
                  if (!fileMap.has(norm)) {
                    fileMap.set(norm, { status: 'modified' });
                  }
                }
              }
            }
            if (
              p.type === 'tool' &&
              ['write', 'edit', 'patch', 'create', 'new_file', 'apply_patch'].includes(p.tool)
            ) {
              const raw =
                p.state?.input?.filePath ||
                p.state?.input?.path ||
                p.state?.title ||
                p.state?.metadata?.filepath ||
                p.path;
              if (typeof raw === 'string') {
                const full = path.isAbsolute(raw) ? raw : path.resolve(worktree, raw);
                const norm = path.relative(worktree, full).replace(/\\/g, '/');
                const isAdded = p.tool === 'write' || p.state?.metadata?.exists === false;
                fileMap.set(norm, {
                  status: isAdded ? 'added' : 'modified',
                  content: typeof p.state?.input?.content === 'string' ? p.state.input.content : undefined,
                  fullPath: full,
                });
              }
            }
          }
        }

        // Merge any discovered files into diffs
        for (const [relPath, meta] of fileMap.entries()) {
          const existingIdx = diffs.findIndex((d) => d.file === relPath);
          const targetPath = meta.fullPath || path.resolve(worktree, relPath);

          if (existingIdx >= 0) {
            if (!diffs[existingIdx].patch && fs.existsSync(targetPath)) {
              try {
                const content = meta.content ?? fs.readFileSync(targetPath, 'utf-8');
                const lines = content.split('\n');
                diffs[existingIdx].additions = lines.length;
                diffs[existingIdx].deletions = 0;
                diffs[existingIdx].patch = `--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;
              } catch {
                // ignore
              }
            }
          } else {
            if (fs.existsSync(targetPath)) {
              try {
                const content = meta.content ?? fs.readFileSync(targetPath, 'utf-8');
                const lines = content.split('\n');
                const patch = `--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;
                diffs.push({
                  file: relPath,
                  patch,
                  additions: lines.length,
                  deletions: 0,
                  status: meta.status || 'added',
                });
              } catch {
                diffs.push({
                  file: relPath,
                  additions: 0,
                  deletions: 0,
                  status: meta.status || 'added',
                });
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return diffs;
  }

  async getProjectContext(): Promise<ProjectContext> {
    try {
      const res = await fetch(`${this.baseUrl}/project/current`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) {
        return {};
      }
      const data = (await res.json()) as any;
      return {
        id: data.id,
        name: data.name,
        worktree: data.worktree,
        vcs: data.vcs,
      };
    } catch {
      return {};
    }
  }

  async sendMessage(
    sessionId: string,
    content: string,
    model?: { providerID: string; modelID: string }
  ): Promise<string> {
    const clientMessageId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const payload: Record<string, any> = {
      messageID: clientMessageId,
      parts: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
    if (model && model.providerID && model.modelID) {
      payload.model = model;
    } else if (this.defaultModel) {
      payload.model = this.defaultModel;
    }

    // Prefer prompt_async for non-blocking asynchronous execution and SSE streaming
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (res.status === 204 || res.ok) {
        return clientMessageId;
      }
    } catch {
      // If prompt_async fails or is unsupported, fallback to /message below
    }

    // Fallback to /message
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Failed to send message: HTTP ${res.status} ${errText}`);
    }

    const data = (await res.json()) as any;
    const messageId = data?.info?.id || data?.id || data?.messageID || clientMessageId;
    return messageId;
  }

  /**
   * Subscribes to the single global OpenCode SSE stream (/event)
   */
  async startEventStream(onEvent: (event: any) => void) {
    if (this.isListeningEvents) return;
    this.isListeningEvents = true;

    this.eventAbortController = new AbortController();

    try {
      const headers: Record<string, string> = {
        'Accept': 'text/event-stream',
      };
      if (this.authHeader) {
        headers['Authorization'] = this.authHeader;
      }

      const res = await fetch(`${this.baseUrl}/event`, {
        headers,
        signal: this.eventAbortController.signal,
      });

      if (!res.ok || !res.body) {
        this.isListeningEvents = false;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (this.isListeningEvents) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr) {
              try {
                const parsed = JSON.parse(dataStr);
                onEvent(parsed);
              } catch {
                // Ignore SSE heartbeat/keep-alive lines
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // SSE disconnected, will retry later when agent checks
      }
    } finally {
      this.isListeningEvents = false;
    }
  }

  stopEventStream() {
    this.isListeningEvents = false;
    if (this.eventAbortController) {
      this.eventAbortController.abort();
      this.eventAbortController = null;
    }
  }

  // ==========================================
  // PTY Operations
  // ==========================================
  async createPty(title?: string, command?: string, cwd?: string): Promise<PtySession> {
    const res = await fetch(`${this.baseUrl}/pty`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ title, command, cwd }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create PTY: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    return {
      id: data.id,
      title: data.title || title || 'Terminal',
      command: data.command || command || 'powershell.exe',
      cwd: data.cwd || cwd,
      status: data.status || 'running',
      pid: data.pid,
    };
  }

  async listPtys(): Promise<PtySession[]> {
    const res = await fetch(`${this.baseUrl}/pty`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to list PTYs: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any[];
    return (data || []).map((p) => ({
      id: p.id,
      title: p.title || 'Terminal',
      command: p.command || 'powershell.exe',
      cwd: p.cwd,
      status: p.status || 'running',
      pid: p.pid,
    }));
  }

  async resizePty(ptyId: string, rows: number, cols: number): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/pty/${encodeURIComponent(ptyId)}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ size: { rows, cols } }),
    });
    return res.ok;
  }

  async closePty(ptyId: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/pty/${encodeURIComponent(ptyId)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.ok;
  }

  getPtyWsUrl(ptyId: string): string {
    const wsBase = this.baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${wsBase}/pty/${encodeURIComponent(ptyId)}/connect`;
  }

  // ==========================================
  // Session Abort
  // ==========================================
  async abortSession(sessionId: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({}),
    });
    return res.ok;
  }

  // ==========================================
  // Providers & Models
  // ==========================================
  async getProvidersAndModels(): Promise<{ models: ModelInfo[]; defaultModel?: { providerID: string; modelID: string } }> {
    const res = await fetch(`${this.baseUrl}/provider`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to get providers: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    const allProviders: any[] = data.all || data.providers || [];
    const connectedList: string[] = Array.isArray(data.connected) ? data.connected : [];
    const targetProviders =
      connectedList.length > 0
        ? allProviders.filter((p: any) => connectedList.includes(p.id))
        : allProviders;

    let defaultModel: { providerID: string; modelID: string } | undefined = undefined;
    if (data.default && typeof data.default === 'object') {
      if (typeof data.default.providerID === 'string' && typeof data.default.modelID === 'string') {
        defaultModel = { providerID: data.default.providerID, modelID: data.default.modelID };
      } else {
        const firstConnected = connectedList.find((c: string) => data.default[c]);
        if (firstConnected) {
          defaultModel = { providerID: firstConnected, modelID: data.default[firstConnected] };
        } else {
          const firstKey = Object.keys(data.default)[0];
          if (firstKey && typeof data.default[firstKey] === 'string') {
            defaultModel = { providerID: firstKey, modelID: data.default[firstKey] };
          }
        }
      }
    }
    if (!defaultModel && this.defaultModel) {
      defaultModel = this.defaultModel;
    }
    if (defaultModel) {
      this.defaultModel = defaultModel;
    }

    const models: ModelInfo[] = [];
    for (const p of targetProviders) {
      const pModels: any[] = p.models ? Object.values(p.models) : [];
      for (const m of pModels) {
        models.push({
          id: m.id,
          name: m.name || m.id,
          providerId: p.id,
          providerName: p.name || p.id,
        });
      }
    }

    return {
      models,
      defaultModel,
    };
  }

  // ==========================================
  // Todos
  // ==========================================
  async getTodos(sessionId: string): Promise<TodoItem[]> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/todo`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) {
        return [];
      }
      const data = (await res.json()) as any[];
      return (data || []).map((t: any) => ({
        content: t.content || '',
        status: t.status || 'pending',
        priority: t.priority || 'medium',
      }));
    } catch {
      return [];
    }
  }

  // ==========================================
  // Permissions
  // ==========================================
  async listPermissions(): Promise<PermissionItem[]> {
    const res = await fetch(`${this.baseUrl}/permission`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as any[];
    return (data || []).map((p: any) => ({
      id: p.id,
      title: p.title || p.description || 'Permission requested',
      pattern: p.pattern,
      command: p.command,
      sessionID: p.sessionID,
      time: p.time || p.createdAt,
    }));
  }

  async replyPermission(requestId: string, reply: 'allow' | 'deny'): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/permission/${encodeURIComponent(requestId)}/reply`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ reply }),
    });
    return res.ok;
  }
}
