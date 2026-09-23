import dotenv from 'dotenv';
import readline from 'node:readline';
import { loadOrCreateConfig } from './config.js';
import { RemoteAgent } from './agent.js';

dotenv.config();

console.log('==============================================');
console.log('   OpenCode Remote Agent (Windows Host)       ');
console.log('==============================================');

const config = loadOrCreateConfig();
console.log(`[agent] Device Name:   ${config.deviceName}`);
console.log(`[agent] Device ID:     ${config.deviceId}`);
console.log(`[agent] Relay URL:     ${config.relayUrl}`);
console.log(`[agent] OpenCode URL:  ${config.opencodeUrl}`);

config.onPairingOffer = async (offer) => {
  if (process.env.REQUIRE_MANUAL_PAIRING_APPROVAL === 'true' && process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(
        `\n[SECURITY] Incoming pairing request from "${offer.clientName}" (Code: ${offer.code}).\nAuthorize this phone? (Y/n): `,
        (answer) => {
          rl.close();
          const approved = answer.trim().toLowerCase() !== 'n';
          if (approved) {
            console.log('[agent] Device authorized!');
          } else {
            console.log('[agent] Pairing rejected.');
          }
          resolve(approved);
        }
      );
    });
  }

  console.log(`[agent] ✓ Authorized pairing request for "${offer.clientName}" (Code: ${offer.code})`);
  return true;
};

const agent = new RemoteAgent(config);
agent.start();

const shutdown = () => {
  console.log('\n[agent] Shutting down gracefully...');
  agent.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

