# OpenCode Remote — Architecture

## Overview

OpenCode Remote provides a production-quality, mobile-first remote control experience for [OpenCode](https://github.com/opencode-ai), conceptually similar to Google Antigravity's Remote Control.

The architecture ensures that:
1. **The Windows PC remains the execution host** running OpenCode and project tools.
2. **The phone operates strictly as a remote control client** through an installable mobile PWA.
3. **The PC establishes a persistent outbound WebSocket connection** to a cloud-hosted relay (Railway).
4. **No local ports are exposed to the public Internet** — no port forwarding, no router adjustments, and no generic proxying.

---

## High-Level Topology

```
┌───────────────────────────────────────┐
│             Android Phone             │
│                                       │
│   OpenCode Remote PWA                 │
│   (Vite + React + Tailwind PWA)       │
└──────────────────┬────────────────────┘
                   │
                   │ HTTPS / WSS
                   ▼
┌───────────────────────────────────────┐
│             Railway Relay             │
│                                       │
│   • Device Registry (in-memory Phase 1)│
│   • WebSocket Connection Router       │
│   • Typed Protocol Message Validation │
│   • Health & Readiness Endpoints      │
└──────────────────┬────────────────────┘
                   │
                   │ Persistent Outbound WSS
                   ▼
┌───────────────────────────────────────┐
│              Windows PC               │
│                                       │
│   OpenCode Remote Agent               │
│   (Lightweight Node.js Daemon)        │
│          │                            │
│          │ HTTP (localhost:4096)      │
│          ▼                            │
│   OpenCode Server                     │
│   (opencode serve / opencode web)     │
└───────────────────────────────────────┘
```

---

## Component Roles & Responsibilities

### 1. `apps/web` (Mobile PWA)
- **Role:** Mobile-first control panel.
- **Technology:** React 19, TypeScript, Vite, Tailwind CSS, `vite-plugin-pwa`.
- **Installability:** Fully installable as an Android WebAPK directly through Google Chrome (mirroring how `Antigravity_1.apk` operates).
- **Communication:** Outbound WSS to the Relay.
- **Features in Phase 1:**
  - Real-time connection status (Connected, Reconnecting, Disconnected).
  - Connected PC status card (Online/Offline, OS, Agent version, Last seen).
  - OpenCode Server status detection (Connected with live version badge, Unavailable, Checking).
  - Automatic reconnection with exponential backoff.

### 2. `apps/relay` (Cloud Control Plane)
- **Role:** Central connection broker and message router.
- **Technology:** Node.js, Fastify, `@fastify/websocket`, TypeScript.
- **Hosting Target:** Railway / VPS (listening on `0.0.0.0:${PORT}`).
- **Features in Phase 1:**
  - Fastify HTTP endpoints: `GET /health`, `GET /ready`, `GET /api/devices`.
  - WebSocket gateway (`/ws`):
    - Registers Agents via `AGENT_HELLO`.
    - Registers Web Clients via `CLIENT_HELLO`.
    - Routes status messages (`DEVICE_STATUS_REQUEST`, `DEVICE_STATUS_RESULT`).
    - Broadcasts live status changes (`OPENCODE_STATUS`, `DEVICE_STATUS`).
    - Strict protocol envelope validation via Zod schemas.
    - Zero generic proxying (`POST /proxy` is strictly prohibited).

### 3. `apps/agent` (Windows PC Agent)
- **Role:** Background service running on the user's Windows machine.
- **Technology:** Node.js, TypeScript, `ws`.
- **Resource Footprint:** Negligible idle CPU, minimal memory, no Electron/heavy Chromium runtime.
- **Features in Phase 1:**
  - Cryptographically secure device identity (`dev_<hex>`, 32-byte credential) persisted locally in `.agent-config.json`.
  - Outbound WSS connection to Relay with exponential backoff and jitter.
  - Heartbeat `PING`/`PONG` lifecycle.
  - OpenCode auto-detector:
    - Periodically queries `http://127.0.0.1:4096/global/health`.
    - Senses when OpenCode starts, stops, or crashes.
    - Notifies the Relay of live status transitions.

### 4. `packages/protocol` (Shared Protocol Layer)
- **Role:** Single source of truth for message contracts between all packages.
- **Technology:** TypeScript, Zod.
- **Protocol Version:** `1`.
- **Validation:** Every inbound and outbound message must pass Zod schema parsing.
