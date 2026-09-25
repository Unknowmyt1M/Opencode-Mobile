import { describe, it, expect } from 'vitest';
import {
  parseProtocolMessage,
  createMessage,
  PROTOCOL_VERSION,
  MessageSchema,
} from '../src/index.js';

describe('Protocol Message Validation', () => {
  it('creates and parses a valid AGENT_HELLO message', () => {
    const msg = createMessage('AGENT_HELLO', {
      deviceId: 'device-123',
      deviceName: 'Darko-Desktop',
      agentVersion: '0.1.0',
      os: 'win32',
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        sessions: true,
        streaming: true,
        permissions: true,
      },
    });

    expect(msg.type).toBe('AGENT_HELLO');
    expect(msg.version).toBe(1);
    expect(msg.payload.deviceId).toBe('device-123');

    const parsed = parseProtocolMessage(JSON.stringify(msg));
    expect(parsed.id).toBe(msg.id);
    expect(parsed.type).toBe('AGENT_HELLO');
  });

  it('creates and parses CLIENT_HELLO and DEVICE_STATUS_REQUEST', () => {
    const clientHello = createMessage('CLIENT_HELLO', {
      clientId: 'client-abc',
      clientVersion: '0.1.0',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(clientHello.type).toBe('CLIENT_HELLO');

    const statusReq = createMessage('DEVICE_STATUS_REQUEST', {});
    const parsedReq = parseProtocolMessage(statusReq);
    expect(parsedReq.type).toBe('DEVICE_STATUS_REQUEST');
  });

  it('rejects an invalid protocol version', () => {
    const invalidMsg = {
      id: 'msg-999',
      type: 'PING',
      version: 99, // unsupported
      timestamp: Date.now(),
      payload: { nonce: '123' },
    };

    expect(() => parseProtocolMessage(invalidMsg)).toThrow();
  });

  it('rejects an unknown message type', () => {
    const invalidMsg = {
      id: 'msg-999',
      type: 'UNKNOWN_ACTION',
      version: PROTOCOL_VERSION,
      timestamp: Date.now(),
      payload: {},
    };

    expect(() => parseProtocolMessage(invalidMsg)).toThrow();
  });

  it('rejects malformed payload', () => {
    const invalidMsg = {
      id: 'msg-123',
      type: 'OPENCODE_STATUS',
      version: PROTOCOL_VERSION,
      timestamp: Date.now(),
      payload: {
        deviceId: 'dev-1',
        status: 'invalid-status-enum',
      },
    };

    expect(() => parseProtocolMessage(invalidMsg)).toThrow();
  });

  it('rejects oversized payload (>50MB)', () => {
    const hugeString = 'A'.repeat(53000000);
    expect(() => parseProtocolMessage(hugeString)).toThrow('Message payload exceeds maximum limit of 50MB');
  });

  it('handles PING and PONG envelopes correctly', () => {
    const ping = createMessage('PING', { nonce: 'test-nonce-1' });
    const pong = createMessage('PONG', { nonce: 'test-nonce-1' });

    expect(ping.payload.nonce).toBe('test-nonce-1');
    expect(pong.payload.nonce).toBe('test-nonce-1');
  });
});
