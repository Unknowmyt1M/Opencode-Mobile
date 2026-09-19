import type { OpenCodeStatus } from '@opencode-remote/protocol';

export interface OpenCodeCheckResult {
  status: OpenCodeStatus;
  version?: string;
  error?: string;
}

export class OpenCodeDetector {
  private url: string;
  private currentStatus: OpenCodeStatus = 'checking';
  private currentVersion?: string;
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(result: OpenCodeCheckResult) => void> = [];

  constructor(url: string = 'http://127.0.0.1:4096') {
    this.url = url.replace(/\/$/, '');
  }

  onStatusChange(listener: (result: OpenCodeCheckResult) => void) {
    this.listeners.push(listener);
  }

  getStatus(): OpenCodeStatus {
    return this.currentStatus;
  }

  getVersion(): string | undefined {
    return this.currentVersion;
  }

  private consecutiveFailures = 0;

  async checkNow(): Promise<OpenCodeCheckResult> {
    const healthUrl = `${this.url}/global/health`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (process.env.OPENCODE_PASSWORD) {
      const username = process.env.OPENCODE_USERNAME || 'opencode';
      const auth = Buffer.from(`${username}:${process.env.OPENCODE_PASSWORD}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(healthUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as { healthy?: boolean; version?: string };
        const newStatus: OpenCodeStatus = data.healthy ? 'connected' : 'unavailable';
        const newVersion = data.version;

        this.consecutiveFailures = 0;
        this.updateState(newStatus, newVersion);
        return { status: newStatus, version: newVersion };
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 2 || this.currentStatus === 'checking') {
          this.updateState('unavailable');
        }
        return { status: 'unavailable', error: `HTTP ${res.status}` };
      }
    } catch (err: any) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 2 || this.currentStatus === 'checking') {
        this.updateState('unavailable', undefined, err.message);
      }
      return { status: 'unavailable', error: err.message };
    }
  }

  private updateState(newStatus: OpenCodeStatus, newVersion?: string, errorMsg?: string) {
    const changed = this.currentStatus !== newStatus || this.currentVersion !== newVersion;
    this.currentStatus = newStatus;
    if (newVersion) this.currentVersion = newVersion;

    if (changed) {
      const result: OpenCodeCheckResult = {
        status: newStatus,
        version: this.currentVersion,
        error: errorMsg,
      };
      for (const listener of this.listeners) {
        listener(result);
      }
    }
  }

  startPolling(intervalMs: number = 4000) {
    if (this.timer) clearInterval(this.timer);
    // Initial check
    this.checkNow();
    this.timer = setInterval(() => {
      this.checkNow();
    }, intervalMs);
  }

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
