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
  synthetic?: boolean;
  [key: string]: unknown;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  parts?: MessagePart[];
  isCompaction?: boolean;
  summary?: boolean | Record<string, unknown>;
  tokens?: {
    input: number;
    output: number;
    reasoning?: number;
    cache?: {
      read?: number;
      write?: number;
    };
  };
  cost?: number;
  providerID?: string;
  modelID?: string;
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
  agentCredential?: string;
  deviceToken?: string;
  requestPairingCode?: boolean;
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
  statuses?: Record<string, string>;
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

export interface QuestionItem {
  id: string;
  sessionID?: string;
  questions?: unknown[];
  time?: number;
}

export interface SessionRuntimeSnapshot {
  status: 'idle' | 'busy' | 'error';
  isStreaming: boolean;
  agentInstanceId: string;
  snapshotSequence: number;
  activeTurnId?: string;
  activeMessageId?: string;
  streamingText?: string;
  parts?: MessagePart[];
  todos: TodoItem[];
  diffs: SnapshotFileDiff[];
  pendingPermissions: PermissionItem[];
  pendingQuestions: QuestionItem[];
  lastEventSequence?: number;
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
  isStreaming?: boolean;
  activeMessageId?: string;
  streamingText?: string;
  diffs?: SnapshotFileDiff[];
  todos?: TodoItem[];
  runtime?: SessionRuntimeSnapshot;
}

export interface QueueState {
  deviceId: string;
  sessionId: string;
  revision: number;
  messages: QueuedMessage[];
  updatedAt: number;
}

export interface SessionQueueGetPayload {
  deviceId: string;
  sessionId: string;
  deviceToken?: string;
}

export interface SessionQueueUpdatePayload {
  deviceId: string;
  sessionId: string;
  clientId?: string;
  mutationId?: string;
  baseRevision?: number;
  queue: QueuedMessage[];
  deviceToken?: string;
}

export interface SessionQueueUpdateResultPayload {
  accepted: boolean;
  deviceId: string;
  sessionId: string;
  revision: number;
  mutationId?: string;
}

export interface SessionQueueConflictPayload {
  deviceId: string;
  sessionId: string;
  currentRevision: number;
  authoritativeQueue: QueuedMessage[];
  rejectedMutationId?: string;
}

export interface SessionQueueSyncPayload {
  deviceId: string;
  sessionId: string;
  queue: QueuedMessage[];
  revision?: number;
  mutationId?: string;
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
  model?: {
    providerID: string;
    modelID: string;
  };
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
  sequence?: number;
  agentInstanceId?: string;
  scope?: 'session' | 'device' | 'global';
  eventId?: string;
}

export interface MessageDeltaPayload {
  deviceId: string;
  sessionId: string;
  messageId: string;
  delta: string;
  sequence: number;
  agentInstanceId?: string;
  scope?: 'session' | 'device' | 'global';
  eventId?: string;
}

export interface MessageCompletedPayload {
  deviceId: string;
  sessionId: string;
  messageId: string;
  totalText?: string;
  timestamp: number;
  sequence?: number;
  agentInstanceId?: string;
  scope?: 'session' | 'device' | 'global';
  eventId?: string;
}

export interface MessageErrorPayload {
  deviceId: string;
  sessionId: string;
  messageId?: string;
  error: string;
  sequence?: number;
  agentInstanceId?: string;
  scope?: 'session' | 'device' | 'global';
  eventId?: string;
}

export interface OpenCodeEventPayload {
  deviceId: string;
  eventType: string;
  payload: unknown;
  sequence: number;
  agentInstanceId?: string;
  scope?: 'session' | 'device' | 'global';
  eventId?: string;
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

// ==========================================
// Phase 3 Redesign: Real PTY Terminal Payloads
// ==========================================
export interface PtySession {
  id: string;
  title: string;
  command: string;
  args?: string[];
  cwd?: string;
  status: string;
  pid?: number;
}

export interface PtyCreatePayload {
  deviceId: string;
  deviceToken?: string;
  title?: string;
  command?: string;
  args?: string[];
  cwd?: string;
}

export interface PtyCreateResultPayload {
  deviceId: string;
  pty: PtySession;
}

export interface PtyListPayload {
  deviceId: string;
  deviceToken?: string;
}

export interface PtyListResultPayload {
  deviceId: string;
  ptys: PtySession[];
}

export interface PtyInputPayload {
  deviceId: string;
  deviceToken?: string;
  ptyId: string;
  data: string;
}

export interface PtyOutputPayload {
  deviceId: string;
  ptyId: string;
  data: string;
}

export interface PtyResizePayload {
  deviceId: string;
  deviceToken?: string;
  ptyId: string;
  cols: number;
  rows: number;
}

export interface PtyClosePayload {
  deviceId: string;
  deviceToken?: string;
  ptyId: string;
}

export interface PtyClosedPayload {
  deviceId: string;
  ptyId: string;
}

// ==========================================
// Phase 3 Redesign: Session Abort Payloads
// ==========================================
export interface SessionAbortPayload {
  deviceId: string;
  deviceToken?: string;
  sessionId: string;
}

export interface SessionAbortResultPayload {
  deviceId: string;
  sessionId: string;
  success: boolean;
}

// ==========================================
// Phase 3 Redesign: Models & Providers Discovery Payloads
// ==========================================
export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  providerName?: string;
  contextLimit?: number;
}

// ==========================================
// Phase 1 Modernization: Session Revert & Fork
// ==========================================
export interface SessionForkPayload {
  deviceId: string;
  sessionId: string;
  messageId?: string;
  deviceToken?: string;
}

export interface SessionForkResultPayload {
  deviceId: string;
  session: OpenCodeSession;
}

export interface SessionRevertPayload {
  deviceId: string;
  sessionId: string;
  messageId?: string;
  deviceToken?: string;
}

export interface SessionRevertResultPayload {
  deviceId: string;
  sessionId: string;
  success: boolean;
  revertedPrompt?: string;
}

export interface QuestionReplyPayload {
  deviceId: string;
  sessionId: string;
  requestId: string;
  answers: string[][];
  deviceToken?: string;
}

export interface QuestionReplyResultPayload {
  deviceId: string;
  sessionId: string;
  requestId: string;
  success: boolean;
}

export interface ModelListPayload {
  deviceId: string;
  deviceToken?: string;
}

export interface ModelListResultPayload {
  deviceId: string;
  models: ModelInfo[];
  defaultModel?: {
    providerID: string;
    modelID: string;
  };
}

// ==========================================
// Phase 3 Redesign: Interactive Permissions & Questions
// ==========================================
export interface PermissionItem {
  id: string;
  title?: string;
  pattern?: string;
  command?: string;
  sessionID?: string;
  time?: number;
}

export interface PermissionListPayload {
  deviceId: string;
  deviceToken?: string;
}

export interface PermissionListResultPayload {
  deviceId: string;
  permissions: PermissionItem[];
}

export interface PermissionReplyPayload {
  deviceId: string;
  deviceToken?: string;
  requestId: string;
  reply: 'allow' | 'deny';
}

export interface PermissionReplyResultPayload {
  deviceId: string;
  requestId: string;
  success: boolean;
}

// ==========================================
// Phase 3 Redesign: Todo List & Real-Time Sync Payloads
// ==========================================
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

export interface TodoListRequestPayload {
  deviceId: string;
  sessionId: string;
  deviceToken?: string;
}

export interface TodoListResultPayload {
  deviceId: string;
  sessionId: string;
  todos: TodoItem[];
}

export interface TodoUpdatedPayload {
  deviceId: string;
  sessionId: string;
  todos: TodoItem[];
}

export interface SessionDiffUpdatedPayload {
  deviceId: string;
  sessionId: string;
  diff: SnapshotFileDiff[];
}

// ==========================================
// Phase 2 & 3: File System, Context Mentions & Modes
// ==========================================
export interface FsEntry {
  path: string;
  type: 'file' | 'directory';
}

export interface FsListPayload {
  deviceId: string;
  deviceToken?: string;
  path?: string;
}

export interface FsListResultPayload {
  deviceId: string;
  path?: string;
  entries: FsEntry[];
}

export interface FsFindPayload {
  deviceId: string;
  deviceToken?: string;
  query: string;
  limit?: number;
}

export interface FsFindResultPayload {
  deviceId: string;
  query: string;
  entries: FsEntry[];
}

export interface FsReadPayload {
  deviceId: string;
  deviceToken?: string;
  path: string;
}

export interface FsReadResultPayload {
  deviceId: string;
  path: string;
  content: string;
  mime?: string;
}

export interface ContextMention {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  isFolder?: boolean;
}

export type SessionInteractionMode = 'build' | 'plan';



