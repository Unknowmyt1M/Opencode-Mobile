import { z } from 'zod';
import { PROTOCOL_VERSION } from './types.js';

export const DeviceCapabilitiesSchema = z.object({
  sessions: z.boolean().optional(),
  streaming: z.boolean().optional(),
  permissions: z.boolean().optional(),
  terminal: z.boolean().optional(),
  files: z.boolean().optional(),
  git: z.boolean().optional(),
});

export const OpenCodeStatusSchema = z.enum(['connected', 'unavailable', 'checking']);

export const DeviceInfoSchema = z.object({
  deviceId: z.string().min(1).max(128),
  deviceName: z.string().min(1).max(128),
  online: z.boolean(),
  paired: z.boolean(),
  agentVersion: z.string().min(1).max(32),
  os: z.string().min(1).max(64),
  opencodeStatus: OpenCodeStatusSchema,
  opencodeVersion: z.string().max(64).optional(),
  lastSeen: z.number().int().positive(),
  capabilities: DeviceCapabilitiesSchema.optional(),
});

export const OpenCodeSessionSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().max(256),
  createdAt: z.number().int(),
  updatedAt: z.number().int().optional(),
});

export const ToolStateSchema = z.object({
  status: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});

export const MessagePartSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  text: z.string().optional(),
  duration: z.number().optional(),
  callID: z.string().optional(),
  tool: z.string().optional(),
  state: ToolStateSchema.optional(),
  path: z.string().optional(),
  mime: z.string().optional(),
  hash: z.string().optional(),
  files: z.array(z.string()).optional(),
  reason: z.string().optional(),
}).passthrough();

export const SessionMessageSchema = z.object({
  id: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  createdAt: z.number().int(),
  parts: z.array(MessagePartSchema).optional(),
});

export const SnapshotFileDiffSchema = z.object({
  file: z.string(),
  patch: z.string().optional(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  status: z.string().optional(),
});

export const ProjectContextSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  worktree: z.string().optional(),
  vcs: z.string().optional(),
});


// Phase 1 Messages
export const AgentHelloMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('AGENT_HELLO'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceName: z.string().min(1).max(128),
    agentVersion: z.string().min(1).max(32),
    os: z.string().min(1).max(64),
    protocolVersion: z.number().int(),
    capabilities: DeviceCapabilitiesSchema.optional(),
    agentCredential: z.string().max(256).optional(),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const AgentHelloAckMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('AGENT_HELLO_ACK'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    success: z.boolean(),
    connectionId: z.string().min(1).max(128),
    serverTime: z.number().int().positive(),
    paired: z.boolean(),
    pairingCode: z.string().max(32).optional(),
    pairingExpiresAt: z.number().int().optional(),
    message: z.string().max(512).optional(),
  }),
});

export const ClientHelloMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('CLIENT_HELLO'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    clientId: z.string().min(1).max(128),
    clientVersion: z.string().min(1).max(32),
    protocolVersion: z.number().int(),
    pairedDeviceTokens: z.record(z.string()).optional(),
  }),
});

export const ClientHelloAckMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('CLIENT_HELLO_ACK'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    success: z.boolean(),
    connectionId: z.string().min(1).max(128),
    serverTime: z.number().int().positive(),
  }),
});

export const DeviceStatusMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('DEVICE_STATUS'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceName: z.string().min(1).max(128),
    online: z.boolean(),
    paired: z.boolean(),
    agentVersion: z.string().min(1).max(32),
    os: z.string().min(1).max(64),
    opencodeStatus: OpenCodeStatusSchema,
    opencodeVersion: z.string().max(64).optional(),
    lastSeen: z.number().int().positive(),
  }),
});

export const DeviceStatusRequestMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('DEVICE_STATUS_REQUEST'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    targetDeviceId: z.string().max(128).optional(),
  }),
});

export const DeviceStatusResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('DEVICE_STATUS_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    devices: z.array(DeviceInfoSchema),
  }),
});

export const OpenCodeStatusMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('OPENCODE_STATUS'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    status: OpenCodeStatusSchema,
    version: z.string().max(64).optional(),
    message: z.string().max(512).optional(),
  }),
});

export const OpenCodeStatusRequestMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('OPENCODE_STATUS_REQUEST'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
  }),
});

export const OpenCodeStatusResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('OPENCODE_STATUS_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    status: OpenCodeStatusSchema,
    version: z.string().max(64).optional(),
    checkedAt: z.number().int().positive(),
  }),
});

// Phase 2: Pairing Schemas
export const PairingRequestMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PAIRING_REQUEST'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    code: z.string().min(1).max(32),
    clientName: z.string().max(64).optional(),
  }),
});

export const PairingRequestResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PAIRING_REQUEST_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    success: z.boolean(),
    pairingId: z.string().max(64).optional(),
    status: z.enum(['pending', 'approved', 'rejected', 'expired']),
    message: z.string().max(256).optional(),
  }),
});

export const PairingOfferMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PAIRING_OFFER'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    pairingId: z.string().min(1).max(64),
    code: z.string().min(1).max(32),
    clientName: z.string().min(1).max(64),
    expiresAt: z.number().int().positive(),
  }),
});

export const PairingApproveMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PAIRING_APPROVE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    pairingId: z.string().min(1).max(64),
  }),
});

export const PairingApproveResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PAIRING_APPROVE_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    success: z.boolean(),
    pairingId: z.string().min(1).max(64),
    message: z.string().max(256).optional(),
  }),
});

export const PairingRejectMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PAIRING_REJECT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    pairingId: z.string().min(1).max(64),
  }),
});

export const PairingRejectResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PAIRING_REJECT_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    success: z.boolean(),
    pairingId: z.string().min(1).max(64),
  }),
});

export const PairingCompleteMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PAIRING_COMPLETE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    success: z.boolean(),
    deviceId: z.string().min(1).max(128),
    deviceName: z.string().min(1).max(128),
    deviceToken: z.string().min(1).max(256),
  }),
});

export const DeviceRevokeMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('DEVICE_REVOKE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().min(1).max(256),
  }),
});

export const DeviceRevokeResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('DEVICE_REVOKE_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    success: z.boolean(),
    deviceId: z.string().min(1).max(128),
  }),
});

// Phase 2: Session Schemas
export const SessionListMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_LIST'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const SessionListResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_LIST_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessions: z.array(OpenCodeSessionSchema),
  }),
});

export const SessionCreateMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_CREATE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    title: z.string().max(256).optional(),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const SessionCreateResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_CREATE_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    session: OpenCodeSessionSchema,
  }),
});

export const SessionGetMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_GET'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const SessionGetResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_GET_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    session: OpenCodeSessionSchema,
    messages: z.array(SessionMessageSchema),
  }),
});

export const SessionSubscribeMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_SUBSCRIBE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const SessionSubscribeResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_SUBSCRIBE_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    success: z.boolean(),
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
  }),
});

// Phase 2: Messaging & Streaming Schemas
export const MessageSendMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MESSAGE_SEND'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    content: z.string().min(1).max(65536),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const MessageSendAckMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MESSAGE_SEND_ACK'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(128),
    status: z.enum(['accepted', 'rejected']),
  }),
});

export const MessageStartedMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MESSAGE_STARTED'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(128),
    timestamp: z.number().int().positive(),
  }),
});

export const MessageDeltaMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MESSAGE_DELTA'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(128),
    delta: z.string(),
    sequence: z.number().int().nonnegative(),
  }),
});

export const MessageCompletedMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MESSAGE_COMPLETED'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    messageId: z.string().min(1).max(128),
    totalText: z.string().optional(),
    timestamp: z.number().int().positive(),
  }),
});

export const MessageErrorMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MESSAGE_ERROR'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    messageId: z.string().max(128).optional(),
    error: z.string().max(1024),
  }),
});

export const OpenCodeEventMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('OPENCODE_EVENT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    eventType: z.string().min(1).max(128),
    payload: z.unknown(),
    sequence: z.number().int().nonnegative(),
  }),
});

export const PermissionRequestMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PERMISSION_REQUEST'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    description: z.string().max(1024),
    command: z.string().max(1024).optional(),
  }),
});

export const PermissionResponseMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PERMISSION_RESPONSE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    approved: z.boolean(),
    deviceToken: z.string().max(256).optional(),
  }),
});

// Phase 3: Workspace & Diff Schemas
export const SessionDiffGetMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_DIFF_GET'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const SessionDiffGetResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_DIFF_GET_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    diffs: z.array(SnapshotFileDiffSchema),
  }),
});

export const WorkspaceGetMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('WORKSPACE_GET'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const WorkspaceGetResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('WORKSPACE_GET_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    project: ProjectContextSchema.optional(),
  }),
});

// ==========================================
// Phase 3 Redesign: Real PTY Terminal Schemas
// ==========================================
export const PtySessionSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().max(128),
  command: z.string(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  status: z.string(),
  pid: z.number().int().optional(),
});

export const PtyCreateMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_CREATE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
    title: z.string().max(128).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
  }),
});

export const PtyCreateResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_CREATE_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    pty: PtySessionSchema,
  }),
});

export const PtyListMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_LIST'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const PtyListResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_LIST_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    ptys: z.array(PtySessionSchema),
  }),
});

export const PtyInputMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_INPUT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
    ptyId: z.string().min(1).max(128),
    data: z.string(),
  }),
});

export const PtyOutputMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_OUTPUT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    ptyId: z.string().min(1).max(128),
    data: z.string(),
  }),
});

export const PtyResizeMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_RESIZE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
    ptyId: z.string().min(1).max(128),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
});

export const PtyCloseMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_CLOSE'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
    ptyId: z.string().min(1).max(128),
  }),
});

export const PtyClosedMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PTY_CLOSED'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    ptyId: z.string().min(1).max(128),
  }),
});

// ==========================================
// Phase 3 Redesign: Session Abort Schemas
// ==========================================
export const SessionAbortMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_ABORT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
    sessionId: z.string().min(1).max(128),
  }),
});

export const SessionAbortResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('SESSION_ABORT_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    success: z.boolean(),
  }),
});

// ==========================================
// Phase 3 Redesign: Models & Providers Schemas
// ==========================================
export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerId: z.string(),
  providerName: z.string().optional(),
});

export const ModelListMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MODEL_LIST'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const ModelListResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('MODEL_LIST_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    models: z.array(ModelInfoSchema),
    defaultModel: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
  }),
});

// ==========================================
// Phase 3 Redesign: Permissions Schemas
// ==========================================
export const PermissionItemSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  pattern: z.string().optional(),
  command: z.string().optional(),
  sessionID: z.string().optional(),
  time: z.number().optional(),
});

export const PermissionListMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PERMISSION_LIST'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
  }),
});

export const PermissionListResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PERMISSION_LIST_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    permissions: z.array(PermissionItemSchema),
  }),
});

export const PermissionReplyMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PERMISSION_REPLY'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    deviceToken: z.string().max(256).optional(),
    requestId: z.string().min(1).max(128),
    reply: z.enum(['allow', 'deny']),
  }),
});

export const PermissionReplyResultMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PERMISSION_REPLY_RESULT'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    deviceId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    success: z.boolean(),
  }),
});

// Generic Infra
export const PingMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PING'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    nonce: z.string().min(1).max(64),
  }),
});

export const PongMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('PONG'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    nonce: z.string().min(1).max(64),
  }),
});

export const ErrorMessageSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('ERROR'),
  version: z.literal(PROTOCOL_VERSION),
  timestamp: z.number().int().positive(),
  payload: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(1024),
    requestId: z.string().max(64).optional(),
  }),
});

// Full Discriminated Union
export const MessageSchema = z.discriminatedUnion('type', [
  AgentHelloMessageSchema,
  AgentHelloAckMessageSchema,
  ClientHelloMessageSchema,
  ClientHelloAckMessageSchema,
  DeviceStatusMessageSchema,
  DeviceStatusRequestMessageSchema,
  DeviceStatusResultMessageSchema,
  OpenCodeStatusMessageSchema,
  OpenCodeStatusRequestMessageSchema,
  OpenCodeStatusResultMessageSchema,
  // Phase 2
  PairingRequestMessageSchema,
  PairingRequestResultMessageSchema,
  PairingOfferMessageSchema,
  PairingApproveMessageSchema,
  PairingApproveResultMessageSchema,
  PairingRejectMessageSchema,
  PairingRejectResultMessageSchema,
  PairingCompleteMessageSchema,
  DeviceRevokeMessageSchema,
  DeviceRevokeResultMessageSchema,
  SessionListMessageSchema,
  SessionListResultMessageSchema,
  SessionCreateMessageSchema,
  SessionCreateResultMessageSchema,
  SessionGetMessageSchema,
  SessionGetResultMessageSchema,
  SessionSubscribeMessageSchema,
  SessionSubscribeResultMessageSchema,
  MessageSendMessageSchema,
  MessageSendAckMessageSchema,
  MessageStartedMessageSchema,
  MessageDeltaMessageSchema,
  MessageCompletedMessageSchema,
  MessageErrorMessageSchema,
  OpenCodeEventMessageSchema,
  PermissionRequestMessageSchema,
  PermissionResponseMessageSchema,
  // Phase 3
  SessionDiffGetMessageSchema,
  SessionDiffGetResultMessageSchema,
  WorkspaceGetMessageSchema,
  WorkspaceGetResultMessageSchema,
  // Phase 3 Extensions: PTY, Abort, Models, Permissions
  PtyCreateMessageSchema,
  PtyCreateResultMessageSchema,
  PtyListMessageSchema,
  PtyListResultMessageSchema,
  PtyInputMessageSchema,
  PtyOutputMessageSchema,
  PtyResizeMessageSchema,
  PtyCloseMessageSchema,
  PtyClosedMessageSchema,
  SessionAbortMessageSchema,
  SessionAbortResultMessageSchema,
  ModelListMessageSchema,
  ModelListResultMessageSchema,
  PermissionListMessageSchema,
  PermissionListResultMessageSchema,
  PermissionReplyMessageSchema,
  PermissionReplyResultMessageSchema,
  // Infra
  PingMessageSchema,
  PongMessageSchema,
  ErrorMessageSchema,
]);

export type ProtocolMessage = z.infer<typeof MessageSchema>;

export function parseProtocolMessage(raw: unknown): ProtocolMessage {
  let parsedJson = raw;
  if (typeof raw === 'string') {
    if (raw.length > 1048576) { // 1MB max limit for diffs and terminal buffers
      throw new Error('Message payload exceeds maximum limit of 1MB');
    }
    parsedJson = JSON.parse(raw);
  }
  return MessageSchema.parse(parsedJson);
}

export function createMessage<TType extends ProtocolMessage['type']>(
  type: TType,
  payload: Extract<ProtocolMessage, { type: TType }>['payload'],
  customId?: string
): Extract<ProtocolMessage, { type: TType }> {
  const msg = {
    id: customId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    version: PROTOCOL_VERSION,
    timestamp: Date.now(),
    payload,
  };
  return MessageSchema.parse(msg) as Extract<ProtocolMessage, { type: TType }>;
}
