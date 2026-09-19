import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

export interface AgentConfig {
  deviceId: string;
  deviceName: string;
  deviceCredential: string;
  relayUrl: string;
  opencodeUrl: string;
  /**
   * For automated testing only. In production, this defaults to false and host approval is required.
   */
  autoApprovePairing?: boolean;
  /**
   * Explicit hook for host to approve or reject a pairing offer.
   */
  onPairingOffer?: (offer: { pairingId: string; clientName: string; code: string }) => Promise<boolean> | boolean;
}

export function loadOrCreateConfig(): AgentConfig {
  const configPath = process.env.AGENT_CONFIG_FILE || path.resolve(process.cwd(), '.agent-config.json');

  let config: Partial<AgentConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(content);
    } catch {
      // If corrupted, re-generate
    }
  }

  const deviceId = config.deviceId || `dev_${crypto.randomUUID().replace(/-/g, '')}`;
  const deviceName =
    process.env.AGENT_DEVICE_NAME ||
    config.deviceName ||
    os.hostname() ||
    'Darko-PC';
  const deviceCredential = config.deviceCredential || crypto.randomBytes(32).toString('hex');
  const relayUrl = process.env.AGENT_RELAY_URL || config.relayUrl || 'ws://127.0.0.1:4000/ws';
  const opencodeUrl = process.env.OPENCODE_URL || config.opencodeUrl || 'http://127.0.0.1:4096';

  const finalConfig: AgentConfig = {
    deviceId,
    deviceName,
    deviceCredential,
    relayUrl,
    opencodeUrl,
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2), 'utf8');
  } catch (err: any) {
    console.warn(`[agent] Warning: could not persist config to ${configPath}: ${err.message}`);
  }

  return finalConfig;
}
