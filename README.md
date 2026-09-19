# OpenCode Remote (Mobile)

> Control and monitor OpenCode running on your Windows PC directly from your Android phone through a mobile-first installable PWA. Conceptualized like Google Antigravity Remote Control.

---

## Architecture Overview

```
[ Android Phone / WebAPK ]
           │
           │ HTTPS / WSS
           ▼
    [ Railway Relay ]
           │
           │ Persistent Outbound WSS
           ▼
 [ Windows Remote Agent ]
           │
           │ localhost:4096 (HTTP)
           ▼
   [ OpenCode Server ]
```

- **Zero Inbound Port Exposure:** No port forwarding or public IP exposure. The PC initiates outbound persistent TLS WebSockets to the cloud relay.
- **Typed Remote Protocol:** Shared TypeScript + Zod message envelopes (`packages/protocol`). No arbitrary HTTP proxies.
- **Ultra Lightweight:** Node.js agent with low memory/CPU overhead, designed to stay running quietly in the background on Windows.
- **Mobile-First Android PWA:** Designed to be installed directly via Google Chrome as a WebAPK with offline support.

---

## Monorepo Layout

```
OpencodeMobile/
├── apps/
│   ├── web/          # React + Vite + Tailwind mobile PWA
│   ├── relay/        # Fastify + WebSocket cloud relay (Railway target)
│   └── agent/        # Windows host background daemon
│
├── packages/
│   └── protocol/     # Shared Zod message envelopes and types (v1)
│
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── security.md
│   └── development.md
│
├── test/
│   └── e2e.test.ts   # End-to-end integration test suite
│
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## Quick Start (Local Development)

### 1. Install & Build

```bash
pnpm install
pnpm build
pnpm test
```

### 2. Run Services

```bash
# Terminal 1: Start OpenCode server on Windows
opencode serve --port 4096

# Terminal 2: Start Cloud Relay
pnpm dev:relay

# Terminal 3: Start Windows Agent
pnpm dev:agent

# Terminal 4: Start Mobile PWA
pnpm dev:web
```

Or run all remote services concurrently:
```bash
pnpm dev
```

---

## Phase 1 Deliverables
- [x] Shared TypeScript Protocol package with strict Zod schema validation
- [x] Fastify WebSocket Cloud Relay with in-memory device registry & health endpoints
- [x] Windows Remote Agent with cryptographically secure device identity & auto-reconnect backoff
- [x] Live detection of local OpenCode server (`http://127.0.0.1:4096/global/health`)
- [x] Mobile-first React PWA with live host & OpenCode status dashboard
- [x] Full automated test suite (Unit + E2E integration tests)
- [x] Architecture, Protocol, Security, and Development documentation

## Phase 2 Deliverables
- [x] Secure phone ↔ PC device pairing with one-time 6-digit codes & explicit host approval
- [x] Token-based device authorization with persistent storage across relay restart
- [x] Zero-trust immediate device revocation on active WebSockets
- [x] Real OpenCode session management (create, list, get history)
- [x] Live SSE event streaming with non-blocking async execution
- [x] 100% verified E2E test against live OpenCode 1.18.30 (`test/live-opencode-e2e.ts`)

## Phase 3 Deliverables (Antigravity Remote Control Surface)
- [x] **Remote Dashboard**: Multi-machine selector, pairing/revocation modals, OpenCode status badge, workspace summary, recent conversations.
- [x] **Conversation Surface**: Context header, status badges, smart auto-scroll with "Jump to latest ↓", auto-growing composer.
- [x] **Collapsible Reasoning View**: `▸ Thinking · X.Xs` disclosure triangles displaying OpenCode internal thoughts.
- [x] **Changed Files View**: Visual breakdown of modified/added/deleted files with `+A -D` line stats and direct diff links.
- [x] **Diff Viewer**: Mobile-friendly syntax-highlighted unified diff viewer for session changes.
- [x] **Audited Terminal View**: Capability-scoped execution stream showing `$ <command>`, stdout/stderr, and exit status (no arbitrary bash proxy).
- [x] **Agent Activity View**: Real-time lifecycle timeline (Thinking, Reading, Editing, Command, Complete).
- [x] **Workspace & Project Context**: Automatic inspection of project worktree, name, and VCS branch from OpenCode.