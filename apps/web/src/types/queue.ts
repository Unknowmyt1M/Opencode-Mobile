export type QueuedMessageStatus = 'queued' | 'sending' | 'failed';

export interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  status: QueuedMessageStatus;
  model?: { providerID: string; modelID: string };
  retryCount?: number;
  error?: string;
}

export type QueueHeaderStatus =
  | 'Sends after agent finishes work'
  | 'Sending next message…'
  | "Couldn't send queued message";
