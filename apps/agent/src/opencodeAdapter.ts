import * as fs from 'fs';
import * as path from 'path';
import type {
  OpenCodeSession,
  OpenCodeProject,
  SessionMessage,
  SnapshotFileDiff,
  ProjectContext,
  PtySession,
  ModelInfo,
  PermissionItem,
  TodoItem,
  FsEntry,
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
  private shouldListenEvents = false;
  private eventReconnectTimer: NodeJS.Timeout | null = null;
  private savedOnEvent: ((event: any) => void) | null = null;

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

  getHeaders(directory?: string): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.authHeader) {
      h['Authorization'] = this.authHeader;
    }
    if (directory) {
      h['x-opencode-directory'] = directory;
    }
    return h;
  }

  async listProjects(): Promise<OpenCodeProject[]> {
    const res = await fetch(`${this.baseUrl}/project`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to list projects: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any[];
    return (data || []).map((p) => {
      const parts = (p.worktree || '').split(/[\\/]/).filter(Boolean);
      const inferredName = parts.length > 0 ? parts[parts.length - 1] : undefined;
      return {
        id: p.id,
        worktree: p.worktree,
        name: p.name || inferredName,
        vcs: p.vcs,
        time: p.time,
        icon: p.icon,
        sandboxes: p.sandboxes,
      };
    });
  }

  async listGlobalSessions(limit = 100): Promise<OpenCodeSession[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/session?limit=${limit}`, {
        headers: this.getHeaders(),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const list = json?.data || [];
        return list.map((s: any) => ({
          id: s.id,
          title: s.title || 'Untitled Session',
          createdAt: s.time?.created || Date.now(),
          updatedAt: s.time?.updated,
          projectId: s.projectID || s.projectId,
          directory: s.location?.directory,
          parentID: s.parentID,
        }));
      }
    } catch (e: any) {
      console.warn(`[opencodeAdapter] /api/session fallback: ${e.message}`);
    }

    return this.listSessions();
  }

  async listProjectSessions(directory: string): Promise<OpenCodeSession[]> {
    const encoded = encodeURIComponent(directory);
    const res = await fetch(`${this.baseUrl}/session?directory=${encoded}`, {
      headers: this.getHeaders(directory),
    });
    if (!res.ok) {
      throw new Error(`Failed to list sessions for directory ${directory}: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any[];
    return (data || []).map((s) => ({
      id: s.id,
      title: s.title || 'Untitled Session',
      createdAt: s.createdAt || Date.now(),
      updatedAt: s.updatedAt,
      projectId: s.projectID || s.projectId,
      directory: s.directory || directory,
      parentID: s.parentID,
    }));
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
      projectId: s.projectID || s.projectId,
      directory: s.directory,
      parentID: s.parentID,
    }));
  }

  async getSessionStatuses(): Promise<Record<string, { type: 'busy' | 'idle' }>> {
    try {
      const res = await fetch(`${this.baseUrl}/session/status`, {
        headers: this.getHeaders(),
      });
      if (res.ok) {
        return (await res.json()) as Record<string, { type: 'busy' | 'idle' }>;
      }
    } catch {}

    try {
      const res = await fetch(`${this.baseUrl}/api/session/active`, {
        headers: this.getHeaders(),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const activeMap: Record<string, { type: 'busy' | 'idle' }> = {};
        const entries = json?.data || json || {};
        for (const sId of Object.keys(entries)) {
          activeMap[sId] = { type: 'busy' };
        }
        return activeMap;
      }
    } catch {}

    return {};
  }

  async createSession(directory?: string, title?: string): Promise<OpenCodeSession> {
    const body: Record<string, any> = {};
    if (title) body.title = title;
    if (this.defaultModel) {
      body.model = {
        id: this.defaultModel.modelID,
        providerID: this.defaultModel.providerID,
      };
    }

    const url = directory
      ? `${this.baseUrl}/session?directory=${encodeURIComponent(directory)}`
      : `${this.baseUrl}/session`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(directory),
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
      projectId: data.projectID || data.projectId,
      directory: data.directory || directory,
      parentID: data.parentID,
    };
  }

  async getSession(sessionId: string, directory?: string): Promise<{ session: OpenCodeSession; messages: SessionMessage[] }> {
    // 1. Fetch session info
    const sessionRes = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      headers: this.getHeaders(directory),
    });
    if (!sessionRes.ok) {
      throw new Error(`Session ${sessionId} not found: HTTP ${sessionRes.status}`);
    }
    const sessionData = (await sessionRes.json()) as any;
    const resolvedDir = sessionData.directory || directory;

    // 2. Fetch session messages
    const messagesRes = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      headers: this.getHeaders(resolvedDir),
    });

    const messages: SessionMessage[] = [];
    if (messagesRes.ok) {
      const rawMessages = (await messagesRes.json()) as any[];
      for (const m of rawMessages || []) {
        const info = m.info || {};
        // Defensive check: Drop mismatched cross-session message if sessionID doesn't match requested sessionId
        if (info.sessionID && info.sessionID !== sessionId) {
          console.warn(
            `[opencodeAdapter] Discarded mismatched message ${info.id} (message sessionID: ${info.sessionID}, requested session: ${sessionId})`
          );
          continue;
        }

        const parts = m.parts || [];
        const nonSyntheticParts = parts.filter((p: any) => !p.synthetic);
        const textContent = nonSyntheticParts
          .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
          .map((p: any) => p.text)
          .join('\n');

        const hasCompactionPart = parts.some((p: any) => p.type === 'compaction');
        const isCompaction =
          info.mode === 'compaction' ||
          info.agent === 'compaction' ||
          info.summary === true ||
          hasCompactionPart;

        const tokens = info.tokens
          ? {
              input: typeof info.tokens.input === 'number' ? info.tokens.input : 0,
              output: typeof info.tokens.output === 'number' ? info.tokens.output : 0,
              reasoning: typeof info.tokens.reasoning === 'number' ? info.tokens.reasoning : undefined,
              cache: info.tokens.cache
                ? {
                    read: typeof info.tokens.cache.read === 'number' ? info.tokens.cache.read : undefined,
                    write: typeof info.tokens.cache.write === 'number' ? info.tokens.cache.write : undefined,
                  }
                : undefined,
            }
          : undefined;

        messages.push({
          id: info.id || `msg_${Date.now()}`,
          sessionId: info.sessionID || sessionId,
          role: info.role === 'user' ? 'user' : info.role === 'system' ? 'system' : 'assistant',
          content: textContent || (nonSyntheticParts.find((p: any) => p.type === 'text')?.text ?? (parts[0]?.text ?? '')),
          createdAt: info.createdAt || Date.now(),
          isCompaction: Boolean(isCompaction),
          summary: info.summary === true ? true : undefined,
          tokens,
          cost: typeof info.cost === 'number' ? info.cost : undefined,
          providerID: typeof info.providerID === 'string' ? info.providerID : undefined,
          modelID: typeof info.modelID === 'string' ? info.modelID : undefined,
          parts: parts.map((p: any) => ({
            id: p.id,
            type: p.type,
            text: p.text,
            synthetic: Boolean(p.synthetic),
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
        projectId: sessionData.projectID || sessionData.projectId,
        directory: resolvedDir,
        parentID: sessionData.parentID,
      },
      messages,
    };
  }

  async getSessionDiff(sessionId: string, directory?: string): Promise<SnapshotFileDiff[]> {
    let diffs: SnapshotFileDiff[] = [];

    // 1. Try native OpenCode diff endpoint
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/diff`, {
        headers: this.getHeaders(directory),
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
    let worktree = directory || process.cwd();
    try {
      const project = await this.getProjectContext(directory);
      if (project.worktree) {
        worktree = project.worktree;
      }
    } catch {
      // ignore
    }

    // 3. Fallback/Augment: scan session messages for touched files (write/edit/patch tools and patch parts)
    try {
      const messagesRes = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
        headers: this.getHeaders(directory),
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

  async getProjectContext(directory?: string): Promise<ProjectContext> {
    try {
      const res = await fetch(`${this.baseUrl}/project/current`, {
        headers: this.getHeaders(directory),
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
    model?: { providerID: string; modelID: string },
    directory?: string
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
        headers: this.getHeaders(directory),
        body: JSON.stringify(payload),
      });

      if (res.status === 204 || res.ok) {
        return clientMessageId;
      }
      // If server returned status other than 404, do NOT fallback to /message.
      // This prevents duplicate prompt execution if the request was accepted or failed validation.
      if (res.status !== 404) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Failed to send message via prompt_async: HTTP ${res.status} ${errText}`);
      }
    } catch (err: any) {
      if (err.message && err.message.startsWith('Failed to send message via prompt_async: HTTP')) {
        throw err;
      }
      // If network/fetch error occurred, rethrow instead of blindly duplicating to /message
      console.warn(`[opencodeAdapter] prompt_async failed: ${err.message}. Not falling back to /message to prevent duplicate execution.`);
      throw err;
    }

    // Fallback to /message only if OpenCode returned 404 (unsupported endpoint)

    // Fallback to /message
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: this.getHeaders(directory),
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
    this.savedOnEvent = onEvent;
    this.shouldListenEvents = true;

    if (this.eventReconnectTimer) {
      clearTimeout(this.eventReconnectTimer);
      this.eventReconnectTimer = null;
    }

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

      let res = await fetch(`${this.baseUrl}/api/event`, {
        headers,
        signal: this.eventAbortController.signal,
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetch(`${this.baseUrl}/event`, {
          headers,
          signal: this.eventAbortController.signal,
        });
      }

      if (!res.ok || !res.body) {
        this.isListeningEvents = false;
        this.scheduleEventReconnect();
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
                const eventObj = {
                  id: parsed.id,
                  type: parsed.type,
                  properties: parsed.properties || parsed.data || {},
                  location: parsed.location,
                  directory: parsed.location?.directory,
                };
                onEvent(eventObj);
              } catch {
                // Ignore SSE heartbeat/keep-alive lines
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('[opencodeAdapter] Event stream disconnected:', err.message);
      }
    } finally {
      this.isListeningEvents = false;
      if (this.shouldListenEvents) {
        this.scheduleEventReconnect();
      }
    }
  }

  private scheduleEventReconnect() {
    if (!this.shouldListenEvents || this.eventReconnectTimer) return;
    this.eventReconnectTimer = setTimeout(() => {
      this.eventReconnectTimer = null;
      if (this.shouldListenEvents && this.savedOnEvent) {
        this.startEventStream(this.savedOnEvent).catch(() => {});
      }
    }, 2000);
  }

  stopEventStream() {
    this.shouldListenEvents = false;
    if (this.eventReconnectTimer) {
      clearTimeout(this.eventReconnectTimer);
      this.eventReconnectTimer = null;
    }
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
  async abortSession(sessionId: string, directory?: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
      headers: this.getHeaders(directory),
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
          contextLimit: typeof m.limit?.context === 'number' ? m.limit.context : undefined,
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
  async getTodos(sessionId: string, directory?: string): Promise<TodoItem[]> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/todo`, {
        headers: this.getHeaders(directory),
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

  // ==========================================
  // Phase 1 Modernization: Session Fork, Revert, Compaction & Question
  // ==========================================
  async revertSession(sessionId: string, messageId?: string): Promise<{ success: boolean; revertedPrompt?: string }> {
    let revertedPrompt: string | undefined = undefined;
    try {
      const { messages } = await this.getSession(sessionId);
      const userMsgs = messages.filter((m) => m.role === 'user');
      if (userMsgs.length > 0) {
        const target = messageId ? userMsgs.find((m) => m.id === messageId) : userMsgs[userMsgs.length - 1];
        if (target) {
          revertedPrompt = target.content;
        }
      }
    } catch {
      // ignore
    }

    const payload: Record<string, any> = {};
    if (messageId) payload.messageID = messageId;

    const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/revert`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    return {
      success: res.ok,
      revertedPrompt,
    };
  }

  async forkSession(sessionId: string, messageId?: string): Promise<OpenCodeSession> {
    const payload: Record<string, any> = {};
    if (messageId) payload.messageID = messageId;

    const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/fork`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Failed to fork session: HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    return {
      id: data.id,
      title: data.title || 'Forked Session',
      createdAt: data.createdAt || Date.now(),
      updatedAt: data.updatedAt,
    };
  }

  async compactSession(sessionId: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(sessionId)}/summarize`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({}),
    });
    return res.ok;
  }

  async replyQuestion(requestId: string, answers: string[][]): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/question/${encodeURIComponent(requestId)}/reply`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ answers }),
    });
    return res.ok;
  }

  async listFs(pathQuery?: string): Promise<FsEntry[]> {
    const url = new URL(`${this.baseUrl}/api/fs/list`);
    if (pathQuery) url.searchParams.set('path', pathQuery);
    const res = await fetch(url.toString(), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to list filesystem: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    const rawList = Array.isArray(data) ? data : data?.data || [];
    return rawList.map((item: any) => ({
      path: item.path?.replace(/[/\\]$/, ''),
      type: item.type === 'directory' ? 'directory' : 'file',
    }));
  }

  async findFs(query: string, limit?: number): Promise<FsEntry[]> {
    const url = new URL(`${this.baseUrl}/api/fs/find`);
    url.searchParams.set('query', query);
    if (limit) url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to find files: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    const rawList = Array.isArray(data) ? data : data?.data || [];
    return rawList.map((item: any) => ({
      path: item.path?.replace(/[/\\]$/, ''),
      type: item.type === 'directory' ? 'directory' : 'file',
    }));
  }

  async readFs(filePath: string): Promise<{ content: string; mime?: string }> {
    const cleanPath = filePath.replace(/^[/\\]+/, '');
    const res = await fetch(`${this.baseUrl}/api/fs/read/${encodeURI(cleanPath)}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to read file: HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || 'text/plain';
    const content = await res.text();
    return {
      content,
      mime: contentType,
    };
  }
}
