import type { WebSocket } from 'ws';
import type {
  DeviceInfo,
  OpenCodeStatus,
  DeviceCapabilities,
  ProtocolMessage,
} from '@opencode-remote/protocol';

export interface RegisteredDevice {
  deviceId: string;
  deviceName: string;
  online: boolean;
  paired: boolean;
  agentVersion: string;
  os: string;
  opencodeStatus: OpenCodeStatus;
  opencodeVersion?: string;
  lastSeen: number;
  connectedAt: number;
  capabilities?: DeviceCapabilities;
  socket?: WebSocket;
}

export interface ConnectedClient {
  clientId: string;
  clientVersion: string;
  connectedAt: number;
  lastSeen: number;
  pairedDeviceTokens: Map<string, string>; // deviceId -> token
  socket: WebSocket;
}

export class DeviceRegistry {
  private devices = new Map<string, RegisteredDevice>();
  private clients = new Map<string, ConnectedClient>();

  registerAgent(
    deviceId: string,
    data: {
      deviceName: string;
      agentVersion: string;
      os: string;
      capabilities?: DeviceCapabilities;
      paired?: boolean;
    },
    socket: WebSocket
  ): RegisteredDevice {
    const now = Date.now();
    const existing = this.devices.get(deviceId);

    const updated: RegisteredDevice = {
      deviceId,
      deviceName: data.deviceName,
      online: true,
      paired: data.paired ?? existing?.paired ?? false,
      agentVersion: data.agentVersion,
      os: data.os,
      opencodeStatus: existing?.opencodeStatus ?? 'checking',
      opencodeVersion: existing?.opencodeVersion,
      lastSeen: now,
      connectedAt: now,
      capabilities: data.capabilities,
      socket,
    };

    this.devices.set(deviceId, updated);
    return updated;
  }

  setDevicePaired(deviceId: string, paired: boolean) {
    const device = this.devices.get(deviceId);
    if (device) {
      device.paired = paired;
    }
  }

  unregisterAgent(deviceId: string, socket?: WebSocket): RegisteredDevice | undefined {
    const device = this.devices.get(deviceId);
    if (!device) return undefined;

    if (!socket || device.socket === socket) {
      device.online = false;
      device.lastSeen = Date.now();
      device.socket = undefined;
    }
    return device;
  }

  updateOpenCodeStatus(
    deviceId: string,
    status: OpenCodeStatus,
    version?: string
  ): RegisteredDevice | undefined {
    const device = this.devices.get(deviceId);
    if (!device) return undefined;

    device.opencodeStatus = status;
    if (version) {
      device.opencodeVersion = version;
    }
    device.lastSeen = Date.now();
    return device;
  }

  getAllDevices(): DeviceInfo[] {
    return Array.from(this.devices.values()).map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      online: d.online,
      paired: d.paired,
      agentVersion: d.agentVersion,
      os: d.os,
      opencodeStatus: d.opencodeStatus,
      opencodeVersion: d.opencodeVersion,
      lastSeen: d.lastSeen,
      capabilities: d.capabilities,
    }));
  }

  getDevice(deviceId: string): DeviceInfo | undefined {
    const d = this.devices.get(deviceId);
    if (!d) return undefined;
    return {
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      online: d.online,
      paired: d.paired,
      agentVersion: d.agentVersion,
      os: d.os,
      opencodeStatus: d.opencodeStatus,
      opencodeVersion: d.opencodeVersion,
      lastSeen: d.lastSeen,
      capabilities: d.capabilities,
    };
  }

  getAgentSocket(deviceId: string): WebSocket | undefined {
    return this.devices.get(deviceId)?.socket;
  }

  findDeviceBySocket(socket: WebSocket): RegisteredDevice | undefined {
    for (const d of this.devices.values()) {
      if (d.socket === socket) return d;
    }
    return undefined;
  }

  registerClient(
    clientId: string,
    clientVersion: string,
    socket: WebSocket,
    tokens?: Record<string, string>
  ): ConnectedClient {
    const now = Date.now();
    const tokenMap = new Map<string, string>();
    if (tokens) {
      for (const [k, v] of Object.entries(tokens)) {
        tokenMap.set(k, v);
      }
    }

    const client: ConnectedClient = {
      clientId,
      clientVersion,
      connectedAt: now,
      lastSeen: now,
      pairedDeviceTokens: tokenMap,
      socket,
    };
    this.clients.set(clientId, client);
    return client;
  }

  addClientDeviceToken(clientId: string, deviceId: string, token: string) {
    const client = this.clients.get(clientId);
    if (client) {
      client.pairedDeviceTokens.set(deviceId, token);
    }
  }

  removeClientDeviceToken(deviceId: string) {
    for (const client of this.clients.values()) {
      client.pairedDeviceTokens.delete(deviceId);
    }
  }

  unregisterClient(clientId: string, socket?: WebSocket): void {
    const client = this.clients.get(clientId);
    if (client && (!socket || client.socket === socket)) {
      this.clients.delete(clientId);
    }
  }

  findClientBySocket(socket: WebSocket): ConnectedClient | undefined {
    for (const c of this.clients.values()) {
      if (c.socket === socket) return c;
    }
    return undefined;
  }

  broadcastToClients(message: ProtocolMessage): void {
    const payloadStr = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === 1) {
        try {
          client.socket.send(payloadStr);
        } catch {}
      }
    }
  }

  clear(): void {
    this.devices.clear();
    this.clients.clear();
  }
}
