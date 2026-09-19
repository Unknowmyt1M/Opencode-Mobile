# OpenCode Remote — Secure Device Pairing Specification

## 1. Overview

The OpenCode Remote pairing model establishes a cryptographic trust relationship between a mobile PWA client and a Windows Host PC running the Remote Agent.

Inspired by Android WebAPK/Antigravity and smart-device pairing (Apple TV, Google Cast), pairing requires physical access or screen visibility of the host PC.

---

## 2. Pairing Architecture & Flow

```
Mobile PWA                   Cloud Relay                     Windows Agent
    │                             │                                │
    │                             │◄─────── AGENT_HELLO ───────────┤
    │                             ├────── AGENT_HELLO_ACK ────────►│ (Displays 6-digit code)
    │                             │  (e.g. code: "791-654")        │
    │                             │                                │
    │ ─── CLIENT_HELLO ──────────►│                                │
    │ ◄── CLIENT_HELLO_ACK ───────┤                                │
    │                             │                                │
    │ ─── PAIRING_REQUEST ───────►│                                │
    │    (code: "791-654")        ├─────── PAIRING_OFFER ─────────►│
    │                             │       ("Pixel 9 Pro")          │
    │ ◄── PAIRING_REQUEST_RESULT ─┤                                │ (Host prompts/approves)
    │     (status: "pending")     │◄────── PAIRING_APPROVE ────────┤
    │                             ├────── PAIRING_APPROVE_RESULT ─►│
    │                             │                                │
    │ ◄── PAIRING_COMPLETE ───────┤                                │
    │    (deviceToken: "tok_...") │                                │
    │                             │                                │
```

---

## 3. Security Properties

1. **Short-Lived Pairing Code:**
   - 6-character format: `XXX-YYY` (numeric digits).
   - Valid for exactly 5 minutes (`300,000 ms`).
   - Automatically purged on expiry or after successful redemption.

2. **Terminal / Screen Display Only:**
   - The pairing code is returned exclusively to the Windows Agent over its secure outbound WebSocket and printed to the host console.
   - The Relay never exposes pending pairing codes in public device status broadcasts (`DEVICE_STATUS` or `DEVICE_STATUS_RESULT`).

3. **High-Entropy Device Tokens:**
   - Once approved, the Relay issues a 192-bit CSPRNG token (`tok_` prefix + 48 hex characters).
   - Persisted encrypted/hashed in the Relay store and client localStorage.
   - Required in the payload of all subsequent RPC requests (`SESSION_LIST`, `SESSION_CREATE`, `SESSION_GET`, `MESSAGE_SEND`).

4. **Zero Generic Proxies:**
   - No generic HTTP proxy endpoints exist (`POST /proxy` is strictly prohibited).
   - RPC routes strictly mapped to OpenCode adapter functions.

5. **Device Revocation:**
   - Either the mobile user or the PC agent can initiate `DEVICE_REVOKE`.
   - The Relay immediately deletes the token and terminates access. Subsequent requests return `DEVICE_NOT_PAIRED` errors.
