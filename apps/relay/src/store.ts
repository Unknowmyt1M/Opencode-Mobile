import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface PairedDeviceRecord {
  deviceId: string;
  deviceName: string;
  tokenHash: string;
  pairedAt: number;
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
  private pairedDevices = new Map<string, PairedDeviceRecord>(); // deviceId -> record
  private activePairings = new Map<string, PairingSession>(); // pairingId -> session
  private codeToPairingId = new Map<string, string>(); // code -> pairingId

  // Rate limiting for pairing attempts: clientId/IP -> { count, resetAt }
  private clientRateLimits = new Map<string, { count: number; resetAt: number }>();

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

  private load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        for (const dev of data.pairedDevices || []) {
          // Backward-compat: migrate plaintext token to hash if present
          let tokenHash = dev.tokenHash;
          if (!tokenHash && dev.deviceToken) {
            tokenHash = crypto.createHash('sha256').update(dev.deviceToken).digest('hex');
          }
          if (tokenHash) {
            this.pairedDevices.set(dev.deviceId, {
              deviceId: dev.deviceId,
              deviceName: dev.deviceName,
              tokenHash,
              pairedAt: dev.pairedAt || Date.now(),
            });
          }
        }
      } catch {
        // Fallback to empty store
      }
    }
  }

  private persist() {
    try {
      const data = {
        pairedDevices: Array.from(this.pairedDevices.values()).map((d) => ({
          deviceId: d.deviceId,
          deviceName: d.deviceName,
          tokenHash: d.tokenHash,
          pairedAt: d.pairedAt,
        })),
      };
      // Atomic write via temporary file + atomic rename
      const tempPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch {
      // Ignore transient write errors in ephemeral environments
    }
  }

  isDevicePaired(deviceId: string): boolean {
    return this.pairedDevices.has(deviceId);
  }

  verifyDeviceToken(deviceId: string, token?: string): boolean {
    if (!token || typeof token !== 'string' || token.length < 10) return false;
    const record = this.pairedDevices.get(deviceId);
    if (!record || !record.tokenHash) return false;

    const inputHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(inputHash, 'hex'),
        Buffer.from(record.tokenHash, 'hex')
      );
    } catch {
      return false;
    }
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

  approvePairing(pairingId: string): { deviceToken: string; record: PairedDeviceRecord } | undefined {
    const session = this.activePairings.get(pairingId);
    if (!session || session.status !== 'pending' || Date.now() > session.expiresAt) {
      return undefined;
    }

    session.status = 'approved';

    // Generate high-entropy 256-bit CSPRNG token (64 hex characters)
    const deviceToken = `tok_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');

    const record: PairedDeviceRecord = {
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      tokenHash,
      pairedAt: Date.now(),
    };

    this.pairedDevices.set(session.deviceId, record);

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
    const deleted = this.pairedDevices.delete(deviceId);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  clear() {
    this.pairedDevices.clear();
    this.activePairings.clear();
    this.codeToPairingId.clear();
    this.clientRateLimits.clear();
  }
}
