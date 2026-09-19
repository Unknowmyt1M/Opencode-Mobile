export const PROTOCOL_VERSION = 1;

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING';

export type OpenCodeStatus = 'connected' | 'unavailable' | 'checking';

export interface DeviceCapabilities {
  sessions?: boolean;
  streaming?: boolean;
  permissions?: boolean;
  terminal?: boolean;
  files?: boolean;
  git?: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  online: boolean;
  paired: boolean;
  agentVersion: string;
  os: string;
  opencodeStatus: OpenCodeStatus;
  opencodeVersion?: string;
  lastSeen: number;
  capabilities?: DeviceCapabilities;
}

export interface OpenCodeSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
}

export interface ToolState {
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface MessagePart {
  id?: string;
  type: string;
  text?: string;
  duration?: number;
  callID?: string;
  tool?: string;
  state?: ToolState;
  path?: string;
  mime?: string;
  hash?: string;
  files?: string[];
  reason?: string;
  [key: string]: unknown;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  parts?: MessagePart[];
}

export interface SnapshotFileDiff {
  file: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: string;
}

export interface ProjectContext {
  id?: string;
  name?: string;
  worktree?: string;
  vcs?: string;
}

export interface RemoteMessage<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  version: number;
  timestamp: number;
  payload: TPayload;
}

// ==========================================
// Phase 1 Payloads
// ==========================================
export interface AgentHelloPayload {
  deviceId: string;
  deviceName: string;
  agentVersion: string;
  os: string;
  protocolVersion: number;
  capabilities?: DeviceCapabilities;
  deviceToken?: string;
}

export interface AgentHelloAckPayload {
  success: boolean;
  connectionId: string;
  serverTime: number;
  paired: boolean;
  pairingCode?: string;
  pairingExpiresAt?: number;
  message?: string;
}

export interface ClientHelloPayload {
  clientId: string;
  clientVersion: string;
  protocolVersion: number;
  pairedDeviceTokens?: Record<string, string>; // deviceId -> token
}

export interface ClientHelloAckPayload {
  success: boolean;
  connectionId: string;
  serverTime: number;
}

export interface DeviceStatusPayload {
  deviceId: string;
  deviceName: string;
  online: boolean;
  paired: boolean;
  agentVersion: string;
  os: string;
  opencodeStatus: OpenCodeStatus;
  opencodeVersion?: string;
  lastSeen: number;
}

export interface DeviceStatusRequestPayload {
  targetDeviceId?: string;
}

export interface DeviceStatusResultPayload {
  devices: DeviceInfo[];
}

export interface OpenCodeStatusPayload {
  deviceId: string;
  status: OpenCodeStatus;
  version?: string;
  message?: string;
}

export interface OpenCodeStatusRequestPayload {
  deviceId: string;
}

export interface OpenCodeStatusResultPayload {
  deviceId: string;
  status: OpenCodeStatus;
  version?: string;
  checkedAt: number;
}

export interface PingPayload {
  nonce: string;
}

export interface PongPayload {
  nonce: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  requestId?: string;
}

// ==========================================
// Phase 2: Pairing Payloads
// ==========================================
export interface PairingRequestPayload {
  code: string;
  clientName?: string;
}

export interface PairingRequestResultPayload {
  success: boolean;
  pairingId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  message?: string;
}

export interface PairingOfferPayload {
  pairingId: string;
  code: string;
  clientName: string;
  expiresAt: number;
}

export interface PairingApprovePayload {
  pairingId: string;
}

export interface PairingApproveResultPayload {
  success: boolean;
  pairingId: string;
  message?: string;
}

export interface PairingRejectPayload {
  pairingId: string;
}

export interface PairingRejectResultPayload {
  success: boolean;
  pairingId: string;
}

export interface PairingCompletePayload {
  success: boolean;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
}

export interface DeviceRevokePayload {
  deviceId: string;
  deviceToken: string;
}

export interface DeviceRevokeResultPayload {
  success: boolean;
  deviceId: string;
}

// ==========================================
// Phase 2: Session Payloads
// ==========================================
export interface SessionListPayload {
  deviceId: string;
  deviceToken?: string;
}

export interface SessionListResultPayload {
  deviceId: string;
  sessions: OpenCodeSession[];
}

export interface SessionCreatePayload {
  deviceId: string;
  title?: string;
  deviceToken?: string;
}

export interface SessionCreateResultPayload {
  deviceId: string;
  session: OpenCodeSession;
}

export interface SessionGetPayload {
  deviceId: string;
  sessionId: string;
  deviceToken?: string;
}

export interface SessionGetResultPayload {
  deviceId: string;
  session: OpenCodeSession;
  messages: SessionMessage[];
}

export interface SessionSubscribePayload {
  deviceId: string;
  sessionId: string;
  deviceToken?: string;
}

export interface SessionSubscribeResultPayload {
  success: boolean;
  deviceId: string;
  sessionId: string;
}

// ==========================================
// Phase 2: Messaging & Streaming Payloads
// ==========================================
export interface MessageSendPayload {
  deviceId: string;
  sessionId: string;
  content: string;
  deviceToken?: string;
}

export interface MessageSendAckPayload {
  deviceId: string;
  sessionId: string;
  messageId: string;
  status: 'accepted' | 'rejected';
}

export interface MessageStartedPayload {
  deviceId: string;
  sessionId: string;
  messageId: string;
  timestamp: number;
}

export interface MessageDeltaPayload {
  deviceId: string;
  sessionId: string;
  messageId: string;
  delta: string;
  sequence: number;
}

export interface MessageCompletedPayload {
  deviceId: string;
  sessionId: string;
  messageId: string;
  totalText?: string;
  timestamp: number;
}

export interface MessageErrorPayload {
  deviceId: string;
  sessionId: string;
  messageId?: string;
  error: string;
}

export interface OpenCodeEventPayload {
  deviceId: string;
  eventType: string;
  payload: unknown;
  sequence: number;
}

export interface PermissionRequestPayload {
  deviceId: string;
  sessionId: string;
  requestId: string;
  description: string;
  command?: string;
}

export interface PermissionResponsePayload {
  deviceId: string;
  sessionId: string;
  requestId: string;
  approved: boolean;
  deviceToken?: string;
}

// ==========================================
// Phase 3: Workspace & Diff Payloads
// ==========================================
export interface SessionDiffGetPayload {
  deviceId: string;
  sessionId: string;
  deviceToken?: string;
}

export interface SessionDiffGetResultPayload {
  deviceId: string;
  sessionId: string;
  diffs: SnapshotFileDiff[];
}

export interface WorkspaceGetPayload {
  deviceId: string;
  deviceToken?: string;
}

export interface WorkspaceGetResultPayload {
  deviceId: string;
  project?: ProjectContext;
}

