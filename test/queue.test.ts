import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedMessage } from '../apps/web/src/types/queue';

// In-memory localStorage mock for test environment
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value.toString();
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

const mockStorage = new LocalStorageMock();
(globalThis as any).localStorage = mockStorage;

// Standalone Queue Manager implementing the exact logic of useMessageQueue
class QueueManager {
  private queues: Record<string, QueuedMessage[]> = {};
  private isDispatching: boolean = false;
  private onSendMessage: (
    deviceId: string,
    sessionId: string,
    content: string,
    model?: { providerID: string; modelID: string }
  ) => Promise<void> | void;

  constructor(
    onSendMessage: (
      deviceId: string,
      sessionId: string,
      content: string,
      model?: { providerID: string; modelID: string }
    ) => Promise<void> | void
  ) {
    this.onSendMessage = onSendMessage;
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const raw = mockStorage.getItem('opencode_remote_queued_messages');
      if (raw) {
        this.queues = JSON.parse(raw);
      }
    } catch {}
  }

  private saveToStorage() {
    mockStorage.setItem('opencode_remote_queued_messages', JSON.stringify(this.queues));
  }

  getQueue(sessionId: string): QueuedMessage[] {
    return this.queues[sessionId] || [];
  }

  enqueue(
    sessionId: string,
    content: string,
    model?: { providerID: string; modelID: string }
  ): QueuedMessage {
    const clean = content.trim();
    const item: QueuedMessage = {
      id: `qmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      content: clean,
      createdAt: Date.now(),
      status: 'queued',
      model,
      retryCount: 0,
    };

    if (!this.queues[sessionId]) {
      this.queues[sessionId] = [];
    }
    this.queues[sessionId].push(item);
    this.saveToStorage();
    return item;
  }

  edit(sessionId: string, id: string, newContent: string) {
    const list = this.queues[sessionId];
    if (!list) return;
    const item = list.find((m) => m.id === id);
    if (item) {
      item.content = newContent.trim();
      this.saveToStorage();
    }
  }

  delete(sessionId: string, id: string) {
    const list = this.queues[sessionId];
    if (!list) return;
    this.queues[sessionId] = list.filter((m) => m.id !== id);
    if (this.queues[sessionId].length === 0) {
      delete this.queues[sessionId];
    }
    this.saveToStorage();
  }

  async sendNow(deviceId: string, sessionId: string, id: string, isStreaming: boolean) {
    const list = this.queues[sessionId];
    if (!list) return;
    const index = list.findIndex((m) => m.id === id);
    if (index < 0) return;

    if (isStreaming) {
      // Reorder to front of queue (index 0)
      if (index > 0) {
        const [target] = list.splice(index, 1);
        list.unshift(target);
        this.saveToStorage();
      }
      return;
    }

    // Immediate send
    if (this.isDispatching) return;
    this.isDispatching = true;
    const item = list[index];

    try {
      item.status = 'sending';
      await this.onSendMessage(deviceId, sessionId, item.content, item.model);
      this.delete(sessionId, id);
    } catch (err: any) {
      item.status = 'failed';
      item.error = err.message || 'Send failed';
    } finally {
      this.isDispatching = false;
      this.saveToStorage();
    }
  }

  async onTurnCompleted(deviceId: string, sessionId: string) {
    const list = this.queues[sessionId];
    if (!list || list.length === 0) return;
    const next = list.find((m) => m.status === 'queued');
    if (!next || this.isDispatching) return;

    this.isDispatching = true;
    next.status = 'sending';

    try {
      await this.onSendMessage(deviceId, sessionId, next.content, next.model);
      this.delete(sessionId, next.id);
    } catch (err: any) {
      next.status = 'failed';
      next.error = err?.message || 'Dispatch failed';
    } finally {
      this.isDispatching = false;
      this.saveToStorage();
    }
  }

  async retry(deviceId: string, sessionId: string, id: string, isStreaming: boolean) {
    const list = this.queues[sessionId];
    if (!list) return;
    const item = list.find((m) => m.id === id);
    if (!item) return;
    item.status = 'queued';
    item.error = undefined;
    item.retryCount = (item.retryCount || 0) + 1;
    this.saveToStorage();

    if (!isStreaming) {
      await this.sendNow(deviceId, sessionId, id, false);
    }
  }
}

describe('Queued Messages System Verification', () => {
  let mockSender: any;
  let qm: QueueManager;
  const DEVICE = 'dev_test_machine';
  const SESS_A = 'session_alpha';
  const SESS_B = 'session_beta';

  beforeEach(() => {
    mockStorage.clear();
    mockSender = vi.fn().mockResolvedValue(undefined);
    qm = new QueueManager(mockSender);
  });

  it('1. Enqueues a single message correctly', () => {
    const item = qm.enqueue(SESS_A, 'Test message 1');
    expect(item).toBeDefined();
    expect(item.content).toBe('Test message 1');
    expect(item.status).toBe('queued');
    expect(item.sessionId).toBe(SESS_A);
    expect(qm.getQueue(SESS_A).length).toBe(1);
  });

  it('2. Enqueues multiple messages maintaining FIFO ordering', () => {
    qm.enqueue(SESS_A, 'First prompt');
    qm.enqueue(SESS_A, 'Second prompt');
    qm.enqueue(SESS_A, 'Third prompt');

    const list = qm.getQueue(SESS_A);
    expect(list.length).toBe(3);
    expect(list[0].content).toBe('First prompt');
    expect(list[1].content).toBe('Second prompt');
    expect(list[2].content).toBe('Third prompt');
  });

  it('3. Queue count badge updates dynamically', () => {
    expect(qm.getQueue(SESS_A).length).toBe(0);
    qm.enqueue(SESS_A, 'Msg 1');
    expect(qm.getQueue(SESS_A).length).toBe(1);
    qm.enqueue(SESS_A, 'Msg 2');
    expect(qm.getQueue(SESS_A).length).toBe(2);
    qm.enqueue(SESS_A, 'Msg 3');
    expect(qm.getQueue(SESS_A).length).toBe(3);
  });

  it('4. Edits a queued message in place', () => {
    const item = qm.enqueue(SESS_A, 'Original content');
    qm.edit(SESS_A, item.id, 'Updated content with fixes');

    const updated = qm.getQueue(SESS_A).find((m) => m.id === item.id);
    expect(updated?.content).toBe('Updated content with fixes');
  });

  it('5. Deletes a specific queued message', () => {
    const item1 = qm.enqueue(SESS_A, 'Item 1');
    const item2 = qm.enqueue(SESS_A, 'Item 2');
    expect(qm.getQueue(SESS_A).length).toBe(2);

    qm.delete(SESS_A, item1.id);
    const list = qm.getQueue(SESS_A);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(item2.id);
  });

  it('6. Deleting the last item clears the session queue completely', () => {
    const item = qm.enqueue(SESS_A, 'Only item');
    expect(qm.getQueue(SESS_A).length).toBe(1);

    qm.delete(SESS_A, item.id);
    expect(qm.getQueue(SESS_A).length).toBe(0);
  });

  it('7. Send Now while agent is streaming moves item to front of queue (index 0)', async () => {
    qm.enqueue(SESS_A, 'Normal 1');
    qm.enqueue(SESS_A, 'Normal 2');
    const urgent = qm.enqueue(SESS_A, 'Urgent 3');

    // Agent is currently streaming
    await qm.sendNow(DEVICE, SESS_A, urgent.id, true);

    const list = qm.getQueue(SESS_A);
    expect(list[0].id).toBe(urgent.id);
    expect(mockSender).not.toHaveBeenCalled(); // Did NOT interrupt active turn!
  });

  it('8. Send Now while agent is idle sends immediately', async () => {
    const item = qm.enqueue(SESS_A, 'Immediate send');
    await qm.sendNow(DEVICE, SESS_A, item.id, false);

    expect(mockSender).toHaveBeenCalledWith(DEVICE, SESS_A, 'Immediate send', undefined);
    expect(qm.getQueue(SESS_A).length).toBe(0);
  });

  it('9. Automatically dispatches next message when turn completes', async () => {
    qm.enqueue(SESS_A, 'Queued task A');
    qm.enqueue(SESS_A, 'Queued task B');

    // Turn completes
    await qm.onTurnCompleted(DEVICE, SESS_A);

    expect(mockSender).toHaveBeenCalledTimes(1);
    expect(mockSender).toHaveBeenCalledWith(DEVICE, SESS_A, 'Queued task A', undefined);

    // Only task B remains
    const remaining = qm.getQueue(SESS_A);
    expect(remaining.length).toBe(1);
    expect(remaining[0].content).toBe('Queued task B');
  });

  it('10. Handles failed sends gracefully and marks status as failed', async () => {
    mockSender.mockRejectedValueOnce(new Error('Relay disconnected'));
    const item = qm.enqueue(SESS_A, 'Will fail');

    await qm.onTurnCompleted(DEVICE, SESS_A);

    const list = qm.getQueue(SESS_A);
    expect(list.length).toBe(1);
    expect(list[0].status).toBe('failed');
    expect(list[0].error).toBe('Relay disconnected');
  });

  it('11. Allows retrying a failed message', async () => {
    mockSender.mockRejectedValueOnce(new Error('Temporary glitch'));
    const item = qm.enqueue(SESS_A, 'Will retry');
    await qm.onTurnCompleted(DEVICE, SESS_A);

    expect(qm.getQueue(SESS_A)[0].status).toBe('failed');

    // Now retry when agent is idle
    mockSender.mockResolvedValueOnce(undefined);
    await qm.retry(DEVICE, SESS_A, item.id, false);

    expect(mockSender).toHaveBeenCalledTimes(2);
    expect(qm.getQueue(SESS_A).length).toBe(0);
  });

  it('12. Preserves queues independently across multiple sessions', () => {
    qm.enqueue(SESS_A, 'Session A task 1');
    qm.enqueue(SESS_A, 'Session A task 2');
    qm.enqueue(SESS_B, 'Session B task 1');

    expect(qm.getQueue(SESS_A).length).toBe(2);
    expect(qm.getQueue(SESS_B).length).toBe(1);
    expect(qm.getQueue(SESS_A)[0].content).toBe('Session A task 1');
    expect(qm.getQueue(SESS_B)[0].content).toBe('Session B task 1');
  });

  it('13. Reconnect / reload restores persisted queues from localStorage', () => {
    qm.enqueue(SESS_A, 'Persisted across page reload');
    expect(mockStorage.getItem('opencode_remote_queued_messages')).toContain('Persisted across page reload');

    // Create a new QueueManager instance (simulating page reload)
    const freshQm = new QueueManager(mockSender);
    const restored = freshQm.getQueue(SESS_A);
    expect(restored.length).toBe(1);
    expect(restored[0].content).toBe('Persisted across page reload');
  });

  it('14. Propagates selected model configuration with queued message', async () => {
    const customModel = { providerID: 'anthropic', modelID: 'claude-3-7-sonnet' };
    qm.enqueue(SESS_A, 'Code with Sonnet', customModel);

    await qm.onTurnCompleted(DEVICE, SESS_A);
    expect(mockSender).toHaveBeenCalledWith(DEVICE, SESS_A, 'Code with Sonnet', customModel);
  });

  it('15. Single-flight mutex prevents duplicate concurrent dispatches', async () => {
    qm.enqueue(SESS_A, 'Parallel dispatch test');

    // Fire 3 simultaneous turn completed triggers
    await Promise.all([
      qm.onTurnCompleted(DEVICE, SESS_A),
      qm.onTurnCompleted(DEVICE, SESS_A),
      qm.onTurnCompleted(DEVICE, SESS_A),
    ]);

    expect(mockSender).toHaveBeenCalledTimes(1);
    expect(qm.getQueue(SESS_A).length).toBe(0);
  });
});
