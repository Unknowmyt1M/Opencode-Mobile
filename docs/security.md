# OpenCode Remote — Security Model

## Core Philosophy

OpenCode Remote controls a local machine execution environment capable of file modifications and terminal commands. Therefore, security is treated as a foundational architectural constraint, not an afterthought.

---

## 1. Zero Inbound Exposure
- **No port forwarding:** The Windows machine does not open ports to the router or WAN.
- **Outbound persistent connection:** The Windows Agent initiates an outbound TLS/WebSocket connection to the cloud Relay. Firewalls and NAT traversal work out of the box without special network rules.
- **No generic HTTP proxying:** The relay does not expose generic endpoints like `POST /proxy` or forward arbitrary requests to OpenCode's localhost port.

---

## 2. Strong Protocol Boundaries
- **Runtime Schema Validation:** Every message passing through the Relay or received by the Agent is strictly validated against Zod schemas (`parseProtocolMessage`).
- **Oversized Payload Rejection:** Maximum payload length is capped at 64KB for control messages to mitigate buffer exhaustion and DoS attacks.
- **Strict Typing:** Only registered protocol messages (`AGENT_HELLO`, `DEVICE_STATUS_REQUEST`, etc.) are recognized. Unknown types or modified envelopes are dropped immediately and return structured error codes (`INVALID_PROTOCOL_MESSAGE`).

---

## 3. Credential & Secret Hygiene
- **Never Log Secrets:** Agent logs never output raw tokens, passwords, or Authorization headers.
- **OpenCode Passwords:** If OpenCode runs with basic authentication (`OPENCODE_SERVER_PASSWORD`), that credential stays strictly local on the user's PC inside the Agent. It is **never** sent to the cloud Relay or to the mobile browser.
- **Cryptographic Random Generation:** Device identifiers and tokens are generated using `node:crypto` (`randomUUID()` and `randomBytes()`).

---

## 4. Phase 1 vs Planned Production Security

| Security Layer | Phase 1 (Foundation) | Phase 2+ (Production) |
|---|---|---|
| **Transport** | WSS / TLS encryption | WSS / TLS with Certificate Pinning |
| **Agent Auth** | Generated device token in local config | Cryptographic keypair & short-lived pairing tokens |
| **User Auth** | Single-user local test mode | JWT / OAuth (GitHub/Google) |
| **Pairing** | Automatic discovery via device ID | 6-digit one-time pairing code + QR code with expiration |
| **Command Execution** | None (read-only health check) | Structured capability-based permissions with explicit mobile approvals |
| **Filesystem Access** | None | Sandboxed workspace root boundaries with path traversal prevention |
