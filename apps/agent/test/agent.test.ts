import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeDetector } from '../src/opencode.js';
import { loadOrCreateConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Agent OpenCodeDetector & Config', () => {
  const testConfigFile = path.resolve(process.cwd(), '.test-agent-config.json');

  beforeEach(() => {
    process.env.AGENT_CONFIG_FILE = testConfigFile;
    if (fs.existsSync(testConfigFile)) {
      fs.unlinkSync(testConfigFile);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testConfigFile)) {
      fs.unlinkSync(testConfigFile);
    }
  });

  it('generates secure device config and persists it', () => {
    const config = loadOrCreateConfig();
    expect(config.deviceId).toMatch(/^dev_[a-f0-9]{32}$/);
    expect(config.deviceCredential.length).toBe(64); // 32 bytes hex
    expect(fs.existsSync(testConfigFile)).toBe(true);

    // Reload should retain the same credentials
    const reloaded = loadOrCreateConfig();
    expect(reloaded.deviceId).toBe(config.deviceId);
    expect(reloaded.deviceCredential).toBe(config.deviceCredential);
  });

  it('detects OpenCode status as unavailable when endpoint is unreachable', async () => {
    // Unused port
    const detector = new OpenCodeDetector('http://127.0.0.1:59999');
    const result = await detector.checkNow();
    expect(result.status).toBe('unavailable');
  });

  it('notifies status listeners on state transitions', async () => {
    const detector = new OpenCodeDetector('http://127.0.0.1:59999');
    const statusChanges: string[] = [];

    detector.onStatusChange((res) => {
      statusChanges.push(res.status);
    });

    await detector.checkNow();
    expect(statusChanges).toContain('unavailable');
  });
});
