import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RelayStore } from '../apps/relay/src/store.js';

describe('RelayStore Lifecycle Cleanup & Scoped Mutation Idempotency', () => {
  const tempDir = path.join(os.tmpdir(), `test-relay-store-${Date.now()}`);
  const storePath = path.join(tempDir, '.relay-store.json');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('purges all in-memory structures on clear() including processedMutations', () => {
    const store = new RelayStore(storePath);

    // Populate store
    store.verifyAgentCredential('dev_1', 'long_secret_credential_123', { deviceName: 'Dev 1' });
    const pairing = store.createPairingCode('dev_1', 'Dev 1');
    store.saveSessionQueue({
      deviceId: 'dev_1',
      sessionId: 'ses_1',
      revision: 1,
      messages: [{ id: 'q1', sessionId: 'ses_1', content: 'test', createdAt: Date.now(), status: 'queued' }],
      updatedAt: Date.now(),
    });
    store.recordProcessedMutation('mut_1', 1, 'dev_1', 'ses_1');
    store.recordClientAttempt('client_ip_1');

    expect(store.hasProcessedMutation('mut_1', 'dev_1', 'ses_1')).toBeDefined();
    expect(store.getSessionQueue('dev_1', 'ses_1')).toBeDefined();
    expect(store.findPairingByCode(pairing.code)).toBeDefined();

    // Call clear()
    store.clear();

    expect(store.hasProcessedMutation('mut_1', 'dev_1', 'ses_1')).toBeUndefined();
    expect(store.getSessionQueue('dev_1', 'ses_1')).toBeUndefined();
    expect(store.getDeviceRecord('dev_1')).toBeUndefined();
    expect(store.findPairingByCode(pairing.code)).toBeUndefined();
    expect(store.isClientRateLimited('client_ip_1')).toBe(false);
  });

  it('scopes mutation idempotency to deviceId and sessionId without cross-collision', () => {
    const store = new RelayStore(storePath);

    // Device A, Session 1 processes mut_alpha
    store.recordProcessedMutation('mut_alpha', 1, 'dev_A', 'ses_1');
    expect(store.hasProcessedMutation('mut_alpha', 'dev_A', 'ses_1')).toBeDefined();
    expect(store.hasProcessedMutation('mut_alpha', 'dev_A', 'ses_1')!.revision).toBe(1);

    // Device B, Session 1 should NOT be blocked by Device A's mutation
    expect(store.hasProcessedMutation('mut_alpha', 'dev_B', 'ses_1')).toBeUndefined();

    // Device A, Session 2 should NOT be blocked by Session 1's mutation
    expect(store.hasProcessedMutation('mut_alpha', 'dev_A', 'ses_2')).toBeUndefined();

    // Device B records mut_alpha with revision 4
    store.recordProcessedMutation('mut_alpha', 4, 'dev_B', 'ses_1');
    expect(store.hasProcessedMutation('mut_alpha', 'dev_B', 'ses_1')!.revision).toBe(4);
    // Device A still retains its original revision 1
    expect(store.hasProcessedMutation('mut_alpha', 'dev_A', 'ses_1')!.revision).toBe(1);
  });

  it('cascades deleteDevice() cleanup to pairings, session queues, and mutations', () => {
    const store = new RelayStore(storePath);

    store.verifyAgentCredential('dev_target', 'secret_cred_456789', { deviceName: 'Target' });
    const pairing = store.createPairingCode('dev_target', 'Target');
    store.saveSessionQueue({
      deviceId: 'dev_target',
      sessionId: 'ses_x',
      revision: 2,
      messages: [],
      updatedAt: Date.now(),
    });
    store.recordProcessedMutation('mut_99', 2, 'dev_target', 'ses_x');

    // Delete device
    const deleted = store.deleteDevice('dev_target');
    expect(deleted).toBe(true);

    expect(store.getDeviceRecord('dev_target')).toBeUndefined();
    expect(store.getSessionQueue('dev_target', 'ses_x')).toBeUndefined();
    expect(store.hasProcessedMutation('mut_99', 'dev_target', 'ses_x')).toBeUndefined();
    expect(store.findPairingByCode(pairing.code)).toBeUndefined();
  });

  it('cleans session mutations when deleteSessionQueue() is invoked', () => {
    const store = new RelayStore(storePath);

    store.saveSessionQueue({
      deviceId: 'dev_1',
      sessionId: 'ses_to_delete',
      revision: 1,
      messages: [],
      updatedAt: Date.now(),
    });
    store.recordProcessedMutation('mut_ses', 1, 'dev_1', 'ses_to_delete');

    expect(store.hasProcessedMutation('mut_ses', 'dev_1', 'ses_to_delete')).toBeDefined();

    store.deleteSessionQueue('dev_1', 'ses_to_delete');
    expect(store.getSessionQueue('dev_1', 'ses_to_delete')).toBeUndefined();
    expect(store.hasProcessedMutation('mut_ses', 'dev_1', 'ses_to_delete')).toBeUndefined();
  });
});
