import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DeviceCapabilities, QueuedMessage } from '@opencode-remote/protocol';

export interface PersistedDeviceRecord {
  deviceId: string;
  deviceName: string;
  agentCredentialHash?: string;
  phoneTokenHash?: string;
  tokenHash?: string; // Backward compatibility alias for phoneTokenHash
  paired: boolean;
  createdAt: number;
  lastSeen: number;
  pairedAt?: number;
  agentVersion?: string;
  os?: string;
  capabilities?: DeviceCapabilities;
}

// Backward compatibility type alias
export type PairedDeviceRecord = PersistedDeviceRecord;

export interface PersistedSessionQueueRecord {
  deviceId: string;
  sessionId: string;
  revision: number;
  messages: QueuedMessage[];
  updatedAt: number;
}

export interface PersistedProcessedMutation {
  mutationId: string;
  revision: number;
  timestamp: number;
}

export interface RelayStoreDataV2 {
  version: 2;
  devices: PersistedDeviceRecord[];
  sessionQueues?: PersistedSessionQueueRecord[];
  processedMutations?: PersistedProcessedMutation[];
}

export interface PairingSession {
  pairingId: string;
  code: string;
  deviceId: string;
  deviceName: string;
  clientName?: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  failedAttempts: number;
}

export class RelayStore {
  private filePath: string;
  private devices = new Map<string, PersistedDeviceRecord>(); // deviceId -> record
  private sessionQueues = new Map<string, PersistedSessionQueueRecord>(); // `${deviceId}:${sessionId}` -> record
  private processedMutations = new Map<string, PersistedProcessedMutation>(); // mutationId -> record
  private activePairings = new Map<string, PairingSession>(); // pairingId -> session
  private codeToPairingId = new Map<string, string>(); // code -> pairingId

  // Rate limiting for pairing attempts: clientId/IP -> { count, resetAt }
  private clientRateLimits = new Map<string, { count: number; resetAt: number }>();
  private persistenceHealthy: boolean = true;

  constructor(storagePath?: string) {
    if (storagePath) {
      this.filePath = storagePath;
    } else {
      const candidates = [
        path.resolve(process.cwd(), 'apps', 'relay', '.relay-store.json'),
        path.resolve(process.cwd(), '.relay-store.json'),
      ];
      const existing = candidates.find((c) => fs.existsSync(c));
      this.filePath = existing || candidates[0];
    }
    this.load();
  }

  getStoragePath(): string {
    return this.filePath;
  }

  isPersistenceHealthy(): boolean {
    return this.persistenceHealthy;
  }

  private load() {
    if (!fs.existsSync(this.filePath)) {
      this.persistenceHealthy = true;
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);

      if (data && data.version === 2 && Array.isArray(data.devices)) {
        // Schema V2: load all device records directly
        for (const dev of data.devices) {
          if (dev && dev.deviceId) {
            const tokenHash = dev.phoneTokenHash || dev.tokenHash;
            this.devices.set(dev.deviceId, {
              ...dev,
              phoneTokenHash: tokenHash,
              tokenHash, // Keep alias populated
              paired: Boolean(dev.paired && tokenHash),
              createdAt: dev.createdAt || Date.now(),
              lastSeen: dev.lastSeen || Date.now(),
            });
          }
        }
        if (Array.isArray(data.sessionQueues)) {
          for (const sq of data.sessionQueues) {
            if (sq && sq.deviceId && sq.sessionId && Array.isArray(sq.messages)) {
              this.sessionQueues.set(`${sq.deviceId}:${sq.sessionId}`, {
                deviceId: sq.deviceId,
                sessionId: sq.sessionId,
                revision: typeof sq.revision === 'number' ? sq.revision : 0,
                messages: sq.messages,
                updatedAt: sq.updatedAt || Date.now(),
              });
            }
          }
        }
        if (Array.isArray(data.processedMutations)) {
          for (const pm of data.processedMutations) {
            if (pm && pm.mutationId) {
              this.processedMutations.set(pm.mutationId, pm);
            }
          }
        }
      } else if (data && (Array.isArray(data.pairedDevices) || Array.isArray(data.devices))) {
        // Legacy Schema V1: migrate to V2
        const legacyList = data.pairedDevices || data.devices || [];
        for (const dev of legacyList) {
          if (!dev || !dev.deviceId) continue;
          let tokenHash = dev.phoneTokenHash || dev.tokenHash;
          if (!tokenHash && dev.deviceToken) {
            tokenHash = crypto.createHash('sha256').update(dev.deviceToken).digest('hex');
          }

          const record: PersistedDeviceRecord = {
            deviceId: dev.deviceId,
            deviceName: dev.deviceName || 'Remote Device',
            agentCredentialHash: dev.agentCredentialHash,
            phoneTokenHash: tokenHash,
            tokenHash,
            paired: Boolean(tokenHash),
            createdAt: dev.pairedAt || Date.now(),
            lastSeen: dev.pairedAt || Date.now(),
            pairedAt: dev.pairedAt || Date.now(),
            agentVersion: dev.agentVersion,
            os: dev.os,
            capabilities: dev.capabilities,
          };
          this.devices.set(dev.deviceId, record);
        }
        // Save migrated V2 store atomically
        this.persist();
      }
      this.persistenceHealthy = true;
    } catch (err: any) {
      // Fail closed: do NOT erase any records already in memory!
      this.persistenceHealthy = false;
      console.error(`[relay-store] Failed to load store from ${this.filePath} (failing closed):`, err?.message || err);
    }
  }

  private persist() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: RelayStoreDataV2 = {
        version: 2,
        devices: Array.from(this.devices.values()).map((d) => ({
          deviceId: d.deviceId,
          deviceName: d.deviceName,
          agentCredentialHash: d.agentCredentialHash,
          phoneTokenHash: d.phoneTokenHash,
          tokenHash: d.phoneTokenHash,
          paired: d.paired,
          createdAt: d.createdAt,
          lastSeen: d.lastSeen,
          pairedAt: d.pairedAt,
          agentVersion: d.agentVersion,
          os: d.os,
          capabilities: d.capabilities,
        })),
        sessionQueues: Array.from(this.sessionQueues.values()),
        processedMutations: Array.from(this.processedMutations.values()).slice(-2000),
      };

      // Atomic write via temporary file + atomic rename
      const tempPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
      this.persistenceHealthy = true;
    } catch (err: any) {
      this.persistenceHealthy = false;
      console.error(`[relay-store] Failed to write store to ${this.filePath}:`, err?.message || err);
    }
  }

  isDevicePaired(deviceId: string): boolean {
    const record = this.devices.get(deviceId);
    return Boolean(record && record.paired && record.phoneTokenHash);
  }

  verifyAgentCredential(
    deviceId: string,
    credential?: string,
    meta?: {
      deviceName?: string;
      agentVersion?: string;
      os?: string;
      capabilities?: DeviceCapabilities;
    }
  ): boolean {
    const existing = this.devices.get(deviceId);

    // Case 1: Credential is provided by agent
    if (credential && typeof credential === 'string' && credential.length >= 10) {
      const inputHash = crypto.createHash('sha256').update(credential).digest('hex');

      if (existing) {
        if (existing.agentCredentialHash) {
          // Enforce timing-safe equality to prevent timing attacks & device impersonation
          try {
            const matches = crypto.timingSafeEqual(
              Buffer.from(inputHash, 'hex'),
              Buffer.from(existing.agentCredentialHash, 'hex')
            );
            if (!matches) {
              return false;
            }
          } catch {
            return false;
          }
        } else {
          // Legacy migrated record: register and lock agent credential on first connect
          existing.agentCredentialHash = inputHash;
        }

        // Update metadata & lastSeen
        if (meta?.deviceName) existing.deviceName = meta.deviceName;
        if (meta?.agentVersion) existing.agentVersion = meta.agentVersion;
        if (meta?.os) existing.os = meta.os;
        if (meta?.capabilities) existing.capabilities = meta.capabilities;
        existing.lastSeen = Date.now();
        this.persist();
        return true;
      }

      // New device: enroll credential and create persistent device record
      const now = Date.now();
      const newRecord: PersistedDeviceRecord = {
        deviceId,
        deviceName: meta?.deviceName || 'Remote Device',
        agentCredentialHash: inputHash,
        phoneTokenHash: undefined,
        tokenHash: undefined,
        paired: false,
        createdAt: now,
        lastSeen: now,
        agentVersion: meta?.agentVersion,
        os: meta?.os,
        capabilities: meta?.capabilities,
      };
      this.devices.set(deviceId, newRecord);
      this.persist();
      return true;
    }

    // Case 2: No credential provided
    if (existing) {
      // If device already enrolled an agent credential, unauthenticated agents cannot hijack it!
      if (existing.agentCredentialHash) {
        return false;
      }
      if (meta?.deviceName) existing.deviceName = meta.deviceName;
      if (meta?.agentVersion) existing.agentVersion = meta.agentVersion;
      if (meta?.os) existing.os = meta.os;
      if (meta?.capabilities) existing.capabilities = meta.capabilities;
      existing.lastSeen = Date.now();
      this.persist();
      return true;
    }

    // New device without credential
    const now = Date.now();
    const newRecord: PersistedDeviceRecord = {
      deviceId,
      deviceName: meta?.deviceName || 'Remote Device',
      agentCredentialHash: undefined,
      phoneTokenHash: undefined,
      tokenHash: undefined,
      paired: false,
      createdAt: now,
      lastSeen: now,
      agentVersion: meta?.agentVersion,
      os: meta?.os,
      capabilities: meta?.capabilities,
    };
    this.devices.set(deviceId, newRecord);
    this.persist();
    return true;
  }

  verifyDeviceToken(deviceId: string, token?: string): boolean {
    if (!token || typeof token !== 'string' || token.length < 10) return false;
    const record = this.devices.get(deviceId);
    if (!record || !record.paired || !record.phoneTokenHash) return false;

    const inputHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(inputHash, 'hex'),
        Buffer.from(record.phoneTokenHash, 'hex')
      );
    } catch {
      return false;
    }
  }

  getDeviceRecord(deviceId: string): PersistedDeviceRecord | undefined {
    return this.devices.get(deviceId);
  }

  getAllPersistedDevices(): PersistedDeviceRecord[] {
    return Array.from(this.devices.values());
  }

  isClientRateLimited(clientIdentifier: string): boolean {
    const now = Date.now();
    const entry = this.clientRateLimits.get(clientIdentifier);
    if (!entry) return false;
    if (now > entry.resetAt) {
      this.clientRateLimits.delete(clientIdentifier);
      return false;
    }
    return entry.count >= 10; // Max 10 pairing attempts per minute
  }

  recordClientAttempt(clientIdentifier: string): boolean {
    const now = Date.now();
    const entry = this.clientRateLimits.get(clientIdentifier);
    if (!entry || now > entry.resetAt) {
      this.clientRateLimits.set(clientIdentifier, { count: 1, resetAt: now + 60000 });
      return false;
    }
    entry.count++;
    return entry.count > 10;
  }

  createPairingCode(deviceId: string, deviceName: string): PairingSession {
    // Generate 6-digit code e.g. "734-291" using CSPRNG
    const part1 = crypto.randomInt(100, 1000);
    const part2 = crypto.randomInt(100, 1000);
    const code = `${part1}-${part2}`;

    const pairingId = `pair_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000; // 5 minutes

    const session: PairingSession = {
      pairingId,
      code,
      deviceId,
      deviceName,
      createdAt: now,
      expiresAt,
      status: 'pending',
      failedAttempts: 0,
    };

    this.activePairings.set(pairingId, session);
    this.codeToPairingId.set(code, pairingId);
    this.codeToPairingId.set(code.replace(/-/g, ''), pairingId);

    return session;
  }

  findPairingByCode(code: string): PairingSession | undefined {
    const cleanCode = code.trim().toUpperCase();
    const normalized = cleanCode.replace(/[-\s]/g, '');
    const id = this.codeToPairingId.get(cleanCode) || this.codeToPairingId.get(normalized);
    if (!id) return undefined;
    const session = this.activePairings.get(id);
    if (!session) return undefined;

    if (Date.now() > session.expiresAt) {
      session.status = 'expired';
      this.codeToPairingId.delete(cleanCode);
      this.codeToPairingId.delete(normalized);
      this.codeToPairingId.delete(session.code);
      return undefined;
    }
    return session;
  }

  recordFailedPairingAttempt(code: string): { locked: boolean } {
    const cleanCode = code.trim().toUpperCase();
    const normalized = cleanCode.replace(/[-\s]/g, '');
    const id = this.codeToPairingId.get(cleanCode) || this.codeToPairingId.get(normalized);
    if (!id) return { locked: false };
    const session = this.activePairings.get(id);
    if (!session) return { locked: false };

    session.failedAttempts++;
    if (session.failedAttempts >= 5) {
      // Brute-force lockout: invalidate pairing session immediately
      session.status = 'expired';
      this.codeToPairingId.delete(cleanCode);
      this.codeToPairingId.delete(normalized);
      this.codeToPairingId.delete(session.code);
      return { locked: true };
    }
    return { locked: false };
  }

  getPairing(pairingId: string): PairingSession | undefined {
    const session = this.activePairings.get(pairingId);
    if (session && Date.now() > session.expiresAt) {
      session.status = 'expired';
    }
    return session;
  }

  getActivePairingForDevice(deviceId: string): PairingSession | undefined {
    for (const session of this.activePairings.values()) {
      if (session.deviceId === deviceId && session.status === 'pending' && Date.now() <= session.expiresAt) {
        return session;
      }
    }
    return undefined;
  }

  approvePairing(pairingId: string): { deviceToken: string; record: PersistedDeviceRecord } | undefined {
    const session = this.activePairings.get(pairingId);
    if (!session || session.status !== 'pending' || Date.now() > session.expiresAt) {
      return undefined;
    }

    session.status = 'approved';

    // Generate high-entropy 256-bit CSPRNG token (64 hex characters)
    const deviceToken = `tok_${crypto.randomBytes(32).toString('hex')}`;
    const phoneTokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');

    const now = Date.now();
    let record = this.devices.get(session.deviceId);

    if (record) {
      record.phoneTokenHash = phoneTokenHash;
      record.tokenHash = phoneTokenHash;
      record.paired = true;
      record.pairedAt = now;
      record.lastSeen = now;
      if (session.deviceName) record.deviceName = session.deviceName;
    } else {
      record = {
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        phoneTokenHash,
        tokenHash: phoneTokenHash,
        paired: true,
        createdAt: now,
        lastSeen: now,
        pairedAt: now,
      };
      this.devices.set(session.deviceId, record);
    }

    // Single-use: immediately delete code so it cannot be reused
    this.codeToPairingId.delete(session.code);
    this.codeToPairingId.delete(session.code.replace(/-/g, ''));
    this.persist();

    return { deviceToken, record };
  }

  rejectPairing(pairingId: string): boolean {
    const session = this.activePairings.get(pairingId);
    if (!session) return false;
    session.status = 'rejected';
    this.codeToPairingId.delete(session.code);
    this.codeToPairingId.delete(session.code.replace(/-/g, ''));
    return true;
  }

  revokeDevice(deviceId: string): boolean {
    const record = this.devices.get(deviceId);
    if (record) {
      record.phoneTokenHash = undefined;
      record.tokenHash = undefined;
      record.paired = false;
      record.pairedAt = undefined;
      this.persist();
      return true;
    }
    return false;
  }

  getSessionQueue(deviceId: string, sessionId: string): PersistedSessionQueueRecord | undefined {
    return this.sessionQueues.get(`${deviceId}:${sessionId}`);
  }

  saveSessionQueue(record: PersistedSessionQueueRecord): void {
    this.sessionQueues.set(`${record.deviceId}:${record.sessionId}`, record);
    this.persist();
  }

  hasProcessedMutation(mutationId: string): PersistedProcessedMutation | undefined {
    return this.processedMutations.get(mutationId);
  }

  recordProcessedMutation(mutationId: string, revision: number): void {
    this.processedMutations.set(mutationId, {
      mutationId,
      revision,
      timestamp: Date.now(),
    });
    if (this.processedMutations.size > 2000) {
      const expiry = Date.now() - 86400000;
      for (const [id, m] of this.processedMutations.entries()) {
        if (m.timestamp < expiry) this.processedMutations.delete(id);
      }
    }
    this.persist();
  }

  deleteSessionQueue(deviceId: string, sessionId: string): boolean {
    const deleted = this.sessionQueues.delete(`${deviceId}:${sessionId}`);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  deleteDeviceSessionQueues(deviceId: string): void {
    let changed = false;
    const prefix = `${deviceId}:`;
    for (const key of Array.from(this.sessionQueues.keys())) {
      if (key.startsWith(prefix)) {
        this.sessionQueues.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.persist();
    }
  }

  deleteDevice(deviceId: string): boolean {
    this.deleteDeviceSessionQueues(deviceId);
    const deleted = this.devices.delete(deviceId);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  clear() {
    this.devices.clear();
    this.sessionQueues.clear();
    this.activePairings.clear();
    this.codeToPairingId.clear();
    this.clientRateLimits.clear();
  }
}
