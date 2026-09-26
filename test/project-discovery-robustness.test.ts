import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DesktopProjectStorage } from '../apps/agent/src/desktopProjectStorage.js';
import { OpenCodeAdapter } from '../apps/agent/src/opencodeAdapter.js';

describe('DesktopProjectStorage & Project API Error Robustness', () => {
  const tempDir = path.join(os.tmpdir(), `test-opencode-storage-${Date.now()}`);
  const tempStorageFile = path.join(tempDir, 'opencode.global.dat');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  describe('DesktopProjectStorage', () => {
    it('returns empty array if file does not exist', () => {
      const storage = new DesktopProjectStorage({ customFilePath: path.join(tempDir, 'nonexistent.dat') });
      expect(storage.readProjects()).toEqual([]);
    });

    it('returns empty array if file is empty or corrupted json', () => {
      fs.writeFileSync(tempStorageFile, '   \n', 'utf8');
      const storage = new DesktopProjectStorage({ customFilePath: tempStorageFile });
      expect(storage.readProjects()).toEqual([]);

      fs.writeFileSync(tempStorageFile, '{ corrupted json: true', 'utf8');
      expect(storage.readProjects()).toEqual([]);
    });

    it('parses valid projects when server is an object', () => {
      const data = {
        server: {
          projects: {
            local: [
              { worktree: 'D:\\Projects\\Anilili', sandboxes: ['D:\\Sandbox1'] },
              { worktree: '/home/user/myproject' },
              { worktree: '' }, // empty, should be filtered
              null, // null, should be filtered
            ],
          },
        },
      };
      fs.writeFileSync(tempStorageFile, JSON.stringify(data), 'utf8');
      const storage = new DesktopProjectStorage({ customFilePath: tempStorageFile });
      const projects = storage.readProjects();
      expect(projects).toHaveLength(2);
      expect(projects[0]).toEqual({
        worktree: 'D:\\Projects\\Anilili',
        sandboxes: ['D:\\Sandbox1'],
      });
      expect(projects[1]).toEqual({
        worktree: '/home/user/myproject',
        sandboxes: undefined,
      });
    });

    it('parses valid projects when server is a stringified JSON string', () => {
      const data = {
        server: JSON.stringify({
          projects: {
            local: [
              { worktree: 'D:\\Projects\\Websites\\Anilili Web' },
            ],
          },
        }),
      };
      fs.writeFileSync(tempStorageFile, JSON.stringify(data), 'utf8');
      const storage = new DesktopProjectStorage({ customFilePath: tempStorageFile });
      const projects = storage.readProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].worktree).toBe('D:\\Projects\\Websites\\Anilili Web');
    });
  });

  describe('OpenCodeAdapter Project Error Classification', () => {
    it('throws explicit authorization error on HTTP 401 or 403', async () => {
      const adapter = new OpenCodeAdapter({ baseUrl: 'http://mock-opencode' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }));

      await expect(adapter.listProjects()).rejects.toThrow(/authentication failed/i);
    });

    it('falls back gracefully to desktop projects on HTTP 404 (endpoint unsupported)', async () => {
      const adapter = new OpenCodeAdapter({ baseUrl: 'http://mock-opencode' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }));

      // Stub desktopStorage to return mock projects
      (adapter as any).desktopStorage = {
        readProjects: () => [{ worktree: 'D:\\Projects\\FallbackProj' }],
      };

      const projects = await adapter.listProjects();
      expect(projects.some((p) => p.worktree === 'D:\\Projects\\FallbackProj')).toBe(true);
    });
  });

  describe('OpenCodeAdapter Cursor-based Session Pagination', () => {
    it('fetches multiple pages using cursor.next until exhausted', async () => {
      const adapter = new OpenCodeAdapter({ baseUrl: 'http://mock-opencode' });
      let callCount = 0;

      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (callCount === 1) {
          expect(url).toContain('limit=100');
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: [{ id: 's1', title: 'Session 1' }, { id: 's2', title: 'Session 2' }],
              cursor: { next: 'cur_page_2' },
            }),
          });
        } else if (callCount === 2) {
          expect(url).toContain('cursor=cur_page_2');
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: [{ id: 's3', title: 'Session 3' }],
              cursor: { next: undefined },
            }),
          });
        }
        return Promise.reject(new Error('Unexpected call'));
      }));

      const sessions = await adapter.listGlobalSessions(1000);
      expect(callCount).toBe(2);
      expect(sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    });
  });
});
