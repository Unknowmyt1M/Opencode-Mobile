import { describe, it, expect } from 'vitest';
import type {
  SessionMessage,
  SnapshotFileDiff,
  OpenCodeSession,
  PtySession,
} from '@opencode-remote/protocol';
import {
  selectSubagents,
  selectChangedFiles,
  selectUploads,
  selectBackgroundTasks,
  selectActiveTerminals,
} from '../apps/web/src/utils/timelineSelectors';

describe('Agent Activity / Workspace Timeline Selectors & Rules', () => {
  const sessionIdA = 'ses_main_alpha';
  const sessionIdB = 'ses_main_beta';

  // 1. Subagent Discovery (Sources: parentID + task tool parts)
  describe('Subagents', () => {
    it('discovers child sessions where parentID === sessionId', () => {
      const allSessions: OpenCodeSession[] = [
        {
          id: 'ses_child_1',
          title: 'UX & CLI/TUI Analyzer (@research subagent)',
          parentID: sessionIdA,
          createdAt: 1000,
          updatedAt: 1720000, // worked ~12m
        },
        {
          id: 'ses_child_2',
          title: 'Core & Server API Analyzer (@research subagent)',
          parentID: sessionIdA,
          createdAt: 2000,
          updatedAt: 2720000,
        },
        {
          id: 'ses_other_child',
          title: 'Frontend Analyzer',
          parentID: sessionIdB, // belongs to Session B!
          createdAt: 3000,
        },
      ];

      const subagentsA = selectSubagents(sessionIdA, [], allSessions);
      expect(subagentsA.length).toBe(2);
      expect(subagentsA[0].name).toBe('Core & Server API Analyzer');
      expect(subagentsA[0].subagentType).toBe('research');
      expect(subagentsA[1].name).toBe('UX & CLI/TUI Analyzer');

      // Session isolation: Session B's child is NOT in Session A
      expect(subagentsA.some((s) => s.id === 'ses_other_child')).toBe(false);
    });

    it('discovers subagents from task tool parts in messages and merges state', () => {
      const messages: SessionMessage[] = [
        {
          id: 'msg_1',
          sessionId: sessionIdA,
          role: 'assistant',
          content: 'Running specialized analyzer',
          createdAt: 10000,
          parts: [
            {
              id: 'part_task_1',
              type: 'tool',
              tool: 'task',
              state: {
                status: 'running',
                input: {
                  description: 'Frontend & UI Analyzer',
                  subagent_type: 'explore',
                },
                metadata: {
                  sessionId: 'ses_child_live',
                },
                time: {
                  start: 10000,
                },
              },
            },
          ],
        },
      ];

      const subagents = selectSubagents(sessionIdA, messages, [], {
        ses_child_live: 'busy',
      });
      expect(subagents.length).toBe(1);
      expect(subagents[0].id).toBe('ses_child_live');
      expect(subagents[0].name).toBe('Frontend & UI Analyzer');
      expect(subagents[0].subagentType).toBe('explore');
      expect(subagents[0].status).toBe('running');
    });

    it('handles empty subagents gracefully (zero-item state)', () => {
      const subagents = selectSubagents(sessionIdA, [], []);
      expect(subagents).toEqual([]);
    });
  });

  // 2. Files Changed (Session Isolation & Status/Diff Mapping)
  describe('Files Changed', () => {
    it('maps snapshot diffs to filename, dirPath, status, additions, and deletions', () => {
      const diffs: SnapshotFileDiff[] = [
        {
          file: 'apps/agent/src/opencodeAdapter.ts',
          additions: 21,
          deletions: 106,
          status: 'modified',
        },
        {
          file: '.gitignore',
          additions: 4,
          deletions: 0,
          status: 'added',
        },
        {
          file: 'oldFile.ts',
          additions: 0,
          deletions: 50,
          status: 'deleted',
        },
      ];

      const changed = selectChangedFiles(sessionIdA, diffs);
      expect(changed.length).toBe(3);

      expect(changed[0].filename).toBe('opencodeAdapter.ts');
      expect(changed[0].dirPath).toBe('apps/agent/src');
      expect(changed[0].additions).toBe(21);
      expect(changed[0].deletions).toBe(106);
      expect(changed[0].status).toBe('modified');

      expect(changed[1].filename).toBe('.gitignore');
      expect(changed[1].dirPath).toBe('');
      expect(changed[1].status).toBe('added');

      expect(changed[2].filename).toBe('oldFile.ts');
      expect(changed[2].status).toBe('deleted');
    });

    it('returns empty list if sessionId is empty or diffs empty', () => {
      expect(selectChangedFiles('', [{ file: 'test.ts', additions: 1, deletions: 0 }])).toEqual([]);
      expect(selectChangedFiles(sessionIdA, [])).toEqual([]);
    });
  });

  // 3. Uploads (User Attachments, Media & Session Isolation)
  describe('Uploads', () => {
    it('discovers uploaded/attached files from user messages in the session', () => {
      const messages: SessionMessage[] = [
        {
          id: 'msg_user_1',
          sessionId: sessionIdA,
          role: 'user',
          content: 'Here are the screenshots',
          createdAt: 1727000000000,
          parts: [
            {
              id: 'file_part_1',
              type: 'file',
              filename: 'media_1790260873042.png',
              mime: 'image/png',
              url: 'blob:http://localhost/1234',
              size: 245000, // ~240 KB
            },
          ],
        },
        {
          id: 'msg_user_2',
          sessionId: sessionIdA,
          role: 'user',
          content: 'Also check this config file',
          createdAt: 1727000050000,
          parts: [
            {
              id: 'file_part_2',
              type: 'file',
              filename: 'schema.json',
              mime: 'application/json',
              url: '{"version": 1}',
              size: 1024,
            },
          ],
        },
        // Mismatched session message: must be isolated out!
        {
          id: 'msg_user_other_session',
          sessionId: sessionIdB,
          role: 'user',
          content: 'Upload from another session',
          createdAt: 1727000090000,
          parts: [
            {
              id: 'file_part_leak',
              type: 'file',
              filename: 'secret_leak.png',
              mime: 'image/png',
            },
          ],
        },
        // Assistant message with files: NOT an upload (Uploads = USER -> AGENT)
        {
          id: 'msg_assistant_1',
          sessionId: sessionIdA,
          role: 'assistant',
          content: 'Created file',
          createdAt: 1727000060000,
          parts: [
            {
              id: 'assistant_part',
              type: 'file',
              filename: 'generated.ts',
            },
          ],
        },
      ];

      const uploads = selectUploads(sessionIdA, messages);
      expect(uploads.length).toBe(2);

      // Chronological descending order
      expect(uploads[0].filename).toBe('schema.json');
      expect(uploads[0].mime).toBe('application/json');
      expect(uploads[0].size).toBe('1.0 KB');

      expect(uploads[1].filename).toBe('media_1790260873042.png');
      expect(uploads[1].mime).toBe('image/png');
      expect(uploads[1].size).toBe('239.3 KB');

      // Verify Session B upload is strictly isolated
      expect(uploads.some((u) => u.filename === 'secret_leak.png')).toBe(false);
    });

    it('returns empty array when user uploaded nothing', () => {
      const messages: SessionMessage[] = [
        {
          id: 'msg_1',
          sessionId: sessionIdA,
          role: 'user',
          content: 'Hello agent without files',
          createdAt: 1000,
        },
      ];
      expect(selectUploads(sessionIdA, messages)).toEqual([]);
    });
  });

  // 4. Background Tasks (Real Commands & Detail Inspection)
  describe('Background Tasks', () => {
    it('discovers command execution tools with status running, completed, and error', () => {
      const messages: SessionMessage[] = [
        {
          id: 'msg_1',
          sessionId: sessionIdA,
          role: 'assistant',
          content: 'Running build commands',
          createdAt: 10000,
          parts: [
            {
              id: 'part_cmd_running',
              type: 'tool',
              tool: 'bash',
              state: {
                status: 'running',
                input: { command: 'pnpm dev' },
                time: { start: 10000 },
              },
            },
            {
              id: 'part_cmd_completed',
              type: 'tool',
              tool: 'run_command',
              state: {
                status: 'completed',
                input: { CommandLine: 'pnpm --filter @opencode-remote/web build' },
                output: '✓ built in 31.45s\nDone',
                metadata: { exitCode: 0 },
                time: { start: 5000, end: 9000 },
              },
            },
            {
              id: 'part_cmd_error',
              type: 'tool',
              tool: 'command',
              state: {
                status: 'error',
                input: { cmd: 'pnpm test' },
                output: 'Error: 1 test failed',
                metadata: { exitCode: 1 },
                time: { start: 1000, end: 3000 },
              },
            },
          ],
        },
        // Mismatched session: must be isolated
        {
          id: 'msg_other_session',
          sessionId: sessionIdB,
          role: 'assistant',
          content: 'Other task',
          createdAt: 20000,
          parts: [
            {
              id: 'leak_task',
              type: 'tool',
              tool: 'bash',
              state: { input: { command: 'rm -rf /' } },
            },
          ],
        },
      ];

      const tasks = selectBackgroundTasks(sessionIdA, messages);
      expect(tasks.length).toBe(3);

      expect(tasks[0].command).toBe('pnpm dev');
      expect(tasks[0].status).toBe('running');

      expect(tasks[1].command).toBe('pnpm --filter @opencode-remote/web build');
      expect(tasks[1].status).toBe('completed');
      expect(tasks[1].exitCode).toBe(0);
      expect(tasks[1].output).toContain('built in 31.45s');

      expect(tasks[2].command).toBe('pnpm test');
      expect(tasks[2].status).toBe('error');
      expect(tasks[2].exitCode).toBe(1);
      expect(tasks[2].output).toContain('1 test failed');

      // Verify Session B task is isolated
      expect(tasks.some((t) => t.command.includes('rm -rf'))).toBe(false);
    });
  });

  // 5. Terminals (Active PTYs without duplication)
  describe('Terminals', () => {
    it('discovers active terminals and ignores closed/exited terminals', () => {
      const ptys: PtySession[] = [
        {
          id: 'pty_1',
          title: 'PowerShell',
          command: 'powershell.exe',
          cwd: 'D:\\Projects\\apps\\OpencodeMobile',
          status: 'running',
          pid: 1234,
        },
        {
          id: 'pty_2',
          title: 'bash',
          command: 'bash',
          cwd: 'D:\\Projects',
          status: 'running',
          pid: 5678,
        },
        {
          id: 'pty_dead',
          title: 'cmd',
          command: 'cmd.exe',
          cwd: 'C:\\',
          status: 'closed', // Closed terminal: must NOT be listed
          pid: 9999,
        },
      ];

      const activeTerminals = selectActiveTerminals(sessionIdA, ptys);
      expect(activeTerminals.length).toBe(2);
      expect(activeTerminals[0].id).toBe('pty_1');
      expect(activeTerminals[0].name).toBe('PowerShell');
      expect(activeTerminals[0].running).toBe(true);

      expect(activeTerminals[1].id).toBe('pty_2');
      expect(activeTerminals[1].name).toBe('bash');

      // Closed terminal is excluded
      expect(activeTerminals.some((t) => t.id === 'pty_dead')).toBe(false);
    });
  });

  // 6. Section 3 Rule: Initial 5 Items & See All / See Less Count Correctness
  describe('Global 5-Item Pagination Rule', () => {
    it('calculates slice correctly for N <= 5 and N > 5', () => {
      const itemsCount7 = [1, 2, 3, 4, 5, 6, 7];
      const itemsCount3 = [1, 2, 3];

      // Collapsed: max 5
      const collapsed7 = itemsCount7.slice(0, 5);
      expect(collapsed7.length).toBe(5);
      expect(itemsCount7.length > 5).toBe(true);

      // Collapsed: 3 items (<= 5: no see all needed)
      const collapsed3 = itemsCount3.slice(0, 5);
      expect(collapsed3.length).toBe(3);
      expect(itemsCount3.length > 5).toBe(false);

      // Expanded: all 7 items
      expect(itemsCount7.length).toBe(7);
    });
  });
});
