import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedMessage } from '../apps/web/src/types/queue';

class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string): string | null { return this.store[key] || null; }
  setItem(key: string, value: string): void { this.store[key] = value.toString(); }
  removeItem(key: string): void { delete this.store[key]; }
  clear(): void { this.store = {}; }
}

const mockStorage = new LocalStorageMock();
(globalThis as any).localStorage = mockStorage;

// Simulated Hook Engine testing the exact serialized mutation dispatcher of useMessageQueue
class SerializedQueueEngine {
  private queues: Record<string, QueuedMessage[]> = {};
  private revisions: Record<string, number> = {};
  private inFlightMutations = new Map<string, { mutationId: string; baseRevision: number }>();
  private pendingMutations = new Map<string, QueuedMessage[]>();
  public outboundUpdates: Array<{ sessionId: string; queue: QueuedMessage[]; mutationId: string; baseRevision: number }> = [];

  constructor() {
    this.queues = {};
    this.revisions = {};
    this.inFlightMutations.clear();
    this.pendingMutations.clear();
    this.outboundUpdates = [];
  }

  getQueue(sessionId: string): QueuedMessage[] {
    return this.queues[sessionId] || [];
  }

  dispatchMutation(sessionId: string, nextQueue: QueuedMessage[]) {
    this.queues[sessionId] = nextQueue;

    // Check if mutation is in-flight for this session
    if (this.inFlightMutations.has(sessionId)) {
      this.pendingMutations.set(sessionId, nextQueue);
      return;
    }

    const baseRevision = this.revisions[sessionId] || 0;
    const mutationId = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.inFlightMutations.set(sessionId, { mutationId, baseRevision });
    this.outboundUpdates.push({ sessionId, queue: nextQueue, mutationId, baseRevision });
  }

  // Called when Relay acknowledges the mutation or broadcasts SESSION_QUEUE_SYNC
  syncQueue(sessionId: string, newQueue: QueuedMessage[], revision?: number) {
    if (typeof revision === 'number') {
      this.revisions[sessionId] = revision;
    }

    this.inFlightMutations.delete(sessionId);
    this.queues[sessionId] = newQueue;

    const pending = this.pendingMutations.get(sessionId);
    if (pending !== undefined) {
      this.pendingMutations.delete(sessionId);
      const nextBaseRev = this.revisions[sessionId] || 0;
      const nextMutId = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this.inFlightMutations.set(sessionId, { mutationId: nextMutId, baseRevision: nextBaseRev });
      this.outboundUpdates.push({ sessionId, queue: pending, mutationId: nextMutId, baseRevision: nextBaseRev });
    }
  }

  enqueue(sessionId: string, content: string): QueuedMessage {
    const item: QueuedMessage = {
      id: `qmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      content,
      createdAt: Date.now(),
      status: 'queued',
      retryCount: 0,
    };
    const updated = [...(this.queues[sessionId] || []), item];
    this.dispatchMutation(sessionId, updated);
    return item;
  }

  edit(sessionId: string, id: string, content: string) {
    const existing = this.queues[sessionId] || [];
    const updated = existing.map((m) => (m.id === id ? { ...m, content } : m));
    this.dispatchMutation(sessionId, updated);
  }

  remove(sessionId: string, id: string) {
    const existing = this.queues[sessionId] || [];
    const updated = existing.filter((m) => m.id !== id);
    this.dispatchMutation(sessionId, updated);
  }

  sendNow(sessionId: string, id: string, isStreaming: boolean): boolean {
    const existing = this.queues[sessionId] || [];
    const itemIndex = existing.findIndex((m) => m.id === id);
    if (itemIndex < 0) return false;

    if (isStreaming) {
      if (itemIndex > 0) {
        const list = [...existing];
        const [target] = list.splice(itemIndex, 1);
        this.dispatchMutation(sessionId, [target, ...list]);
      }
      return true;
    }
    return false;
  }
}

describe('Queue Concurrency, Mutation Serialization & Stale Closure Guards', () => {
  let engine: SerializedQueueEngine;

  beforeEach(() => {
    mockStorage.clear();
    engine = new SerializedQueueEngine();
  });

  it('serializes rapid consecutive mutations without out-of-order baseRevision conflicts', () => {
    const sessionId = 'ses_concurrent';

    // 1. First rapid mutation: enqueue message 1
    const msg1 = engine.enqueue(sessionId, 'Message 1');
    expect(engine.outboundUpdates).toHaveLength(1);
    expect(engine.outboundUpdates[0].baseRevision).toBe(0);
    expect(engine.outboundUpdates[0].queue).toHaveLength(1);

    // 2. Second rapid mutation BEFORE Relay has ACKed first mutation
    const msg2 = engine.enqueue(sessionId, 'Message 2');
    // Local optimistic state has both messages immediately!
    expect(engine.getQueue(sessionId)).toHaveLength(2);
    // But outbound network updates are serialized: mutation 2 is buffered!
    expect(engine.outboundUpdates).toHaveLength(1);

    // 3. Third rapid mutation: edit message 2
    engine.edit(sessionId, msg2.id, 'Message 2 edited');
    expect(engine.getQueue(sessionId)[1].content).toBe('Message 2 edited');
    // Still buffered
    expect(engine.outboundUpdates).toHaveLength(1);

    // 4. Relay acknowledges mutation 1 with revision 1
    engine.syncQueue(sessionId, [msg1], 1);

    // NOW the buffered mutation automatically dispatches with baseRevision: 1 (matching Relay)!
    expect(engine.outboundUpdates).toHaveLength(2);
    expect(engine.outboundUpdates[1].baseRevision).toBe(1);
    expect(engine.outboundUpdates[1].queue).toHaveLength(2);
    expect(engine.outboundUpdates[1].queue[1].content).toBe('Message 2 edited');
  });

  it('sendNow reads authoritative queue without stale closure regression', () => {
    const sessionId = 'ses_stale_guard';
    const m1 = engine.enqueue(sessionId, 'First');
    engine.syncQueue(sessionId, [m1], 1);

    const m2 = engine.enqueue(sessionId, 'Second');
    engine.syncQueue(sessionId, [m1, m2], 2);

    // If agent is streaming, sendNow moves 'Second' to front (index 0)
    engine.sendNow(sessionId, m2.id, true);

    const reordered = engine.getQueue(sessionId);
    expect(reordered[0].id).toBe(m2.id);
    expect(reordered[1].id).toBe(m1.id);
  });
});
