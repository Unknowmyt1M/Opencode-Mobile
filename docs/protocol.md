# OpenCode Remote — Protocol Specification (v1)

## Base Message Envelope

All communications between the Web Client, Cloud Relay, and Windows Agent use a strongly typed envelope:

```typescript
interface RemoteMessage<TType extends string = string, TPayload = unknown> {
  id: string;        // Unique message identifier (e.g. msg_1710000000000_abc123)
  type: TType;       // Message Type from defined protocol union
  version: number;   // Protocol Version (currently 1)
  timestamp: number; // Unix epoch millisecond timestamp
  payload: TPayload; // Strongly typed payload conforming to Zod schema
}
```

---

## Connection Lifecycle State Machine

Both Agent and Web Client maintain explicit connection states:

```
[ DISCONNECTED ]
       │
       ▼
[ CONNECTING ] ──(on success)──► [ CONNECTED ]
       ▲                               │
       │                               ▼
[ RECONNECTING ] ◄──(on drop)──────────┘
```

---

## Phase 1 Message Types

### Agent Handshake
1. **`AGENT_HELLO`**
   - **Sender:** Windows Agent -> Relay
   - **Payload:**
     ```typescript
     {
       deviceId: string;
       deviceName: string;
       agentVersion: string;
       os: string;
       protocolVersion: number;
       capabilities?: {
         sessions?: boolean;
         streaming?: boolean;
         permissions?: boolean;
       };
       credential?: string;
     }
     ```
2. **`AGENT_HELLO_ACK`**
   - **Sender:** Relay -> Windows Agent
   - **Payload:**
     ```typescript
     {
       success: boolean;
       connectionId: string;
       serverTime: number;
       message?: string;
     }
     ```

### Client Handshake
3. **`CLIENT_HELLO`**
   - **Sender:** Web Client -> Relay
   - **Payload:**
     ```typescript
     {
       clientId: string;
       clientVersion: string;
       protocolVersion: number;
     }
     ```
4. **`CLIENT_HELLO_ACK`**
   - **Sender:** Relay -> Web Client
   - **Payload:**
     ```typescript
     {
       success: boolean;
       connectionId: string;
       serverTime: number;
     }
     ```

### Device & Host Status
5. **`DEVICE_STATUS`**
   - **Sender:** Relay -> Web Client (Broadcast on state change)
   - **Payload:**
     ```typescript
     {
       deviceId: string;
       deviceName: string;
       online: boolean;
       agentVersion: string;
       os: string;
       opencodeStatus: 'connected' | 'unavailable' | 'checking';
       opencodeVersion?: string;
       lastSeen: number;
     }
     ```
6. **`DEVICE_STATUS_REQUEST`**
   - **Sender:** Web Client -> Relay
   - **Payload:** `{ targetDeviceId?: string }`
7. **`DEVICE_STATUS_RESULT`**
   - **Sender:** Relay -> Web Client
   - **Payload:** `{ devices: DeviceInfo[] }`

### OpenCode Server Status
8. **`OPENCODE_STATUS`**
   - **Sender:** Agent -> Relay -> Web Client
   - **Payload:**
     ```typescript
     {
       deviceId: string;
       status: 'connected' | 'unavailable' | 'checking';
       version?: string;
       message?: string;
     }
     ```
9. **`OPENCODE_STATUS_REQUEST`**
   - **Sender:** Web Client -> Relay
   - **Payload:** `{ deviceId: string }`
10. **`OPENCODE_STATUS_RESULT`**
    - **Sender:** Relay -> Web Client
    - **Payload:**
      ```typescript
      {
        deviceId: string;
        status: 'connected' | 'unavailable' | 'checking';
        version?: string;
        checkedAt: number;
      }
      ```

### Heartbeat & Infrastructure
11. **`PING`**
    - **Payload:** `{ nonce: string }`
12. **`PONG`**
    - **Payload:** `{ nonce: string }`
13. **`ERROR`**
    - **Payload:**
      ```typescript
      {
        code: string;
        message: string;
        requestId?: string;
      }
      ```

---

## Phase 2 Message Types

### Device Pairing Flow
14. **`PAIRING_REQUEST`**
    - **Sender:** Web Client -> Relay
    - **Payload:** `{ code: string; clientName?: string }`
15. **`PAIRING_REQUEST_RESULT`**
    - **Sender:** Relay -> Web Client
    - **Payload:** `{ success: boolean; pairingId?: string; status: 'pending' | 'approved' | 'rejected' | 'expired'; message?: string }`
16. **`PAIRING_OFFER`**
    - **Sender:** Relay -> Windows Agent
    - **Payload:** `{ pairingId: string; code: string; clientName: string; expiresAt: number }`
17. **`PAIRING_APPROVE`**
    - **Sender:** Windows Agent -> Relay
    - **Payload:** `{ pairingId: string }`
18. **`PAIRING_APPROVE_RESULT`**
    - **Sender:** Relay -> Windows Agent
    - **Payload:** `{ success: boolean; pairingId: string; message?: string }`
19. **`PAIRING_REJECT`**
    - **Sender:** Windows Agent -> Relay
    - **Payload:** `{ pairingId: string }`
20. **`PAIRING_COMPLETE`**
    - **Sender:** Relay -> Web Client
    - **Payload:** `{ success: boolean; deviceId: string; deviceName: string; deviceToken: string }`
21. **`DEVICE_REVOKE`**
    - **Sender:** Web Client / Agent -> Relay
    - **Payload:** `{ deviceId: string; deviceToken: string }`
22. **`DEVICE_REVOKE_RESULT`**
    - **Sender:** Relay -> Web Client
    - **Payload:** `{ success: boolean; deviceId: string }`

### OpenCode Session Management
23. **`SESSION_LIST`**
    - **Sender:** Web Client -> Relay -> Windows Agent
    - **Payload:** `{ deviceId: string; deviceToken?: string }`
24. **`SESSION_LIST_RESULT`**
    - **Sender:** Windows Agent -> Relay -> Web Client
    - **Payload:** `{ deviceId: string; sessions: OpenCodeSession[] }`
25. **`SESSION_CREATE`**
    - **Sender:** Web Client -> Relay -> Windows Agent
    - **Payload:** `{ deviceId: string; title?: string; deviceToken?: string }`
26. **`SESSION_CREATE_RESULT`**
    - **Sender:** Windows Agent -> Relay -> Web Client
    - **Payload:** `{ deviceId: string; session: OpenCodeSession }`
27. **`SESSION_GET`**
    - **Sender:** Web Client -> Relay -> Windows Agent
    - **Payload:** `{ deviceId: string; sessionId: string; deviceToken?: string }`
28. **`SESSION_GET_RESULT`**
    - **Sender:** Windows Agent -> Relay -> Web Client
    - **Payload:** `{ deviceId: string; session: OpenCodeSession; messages: SessionMessage[] }`

### Message Dispatch & Streaming
29. **`MESSAGE_SEND`**
    - **Sender:** Web Client -> Relay -> Windows Agent
    - **Payload:** `{ deviceId: string; sessionId: string; content: string; deviceToken?: string }`
30. **`MESSAGE_SEND_RESULT`**
    - **Sender:** Windows Agent -> Relay -> Web Client
    - **Payload:** `{ deviceId: string; sessionId: string; messageId: string }`
31. **`MESSAGE_DELTA`**
    - **Sender:** Windows Agent -> Relay -> Web Client
    - **Payload:** `{ deviceId: string; sessionId: string; messageId: string; delta: string }`
32. **`MESSAGE_COMPLETED`**
    - **Sender:** Windows Agent -> Relay -> Web Client
    - **Payload:** `{ deviceId: string; sessionId: string; messageId: string; fullText?: string }`
33. **`OPENCODE_EVENT`**
    - **Sender:** Windows Agent -> Relay -> Web Client
    - **Payload:** `{ deviceId: string; eventType: string; data: unknown }`

