# OpenCode Remote — Local Development Guide

## Prerequisites
- **Node.js**: v20+ (tested on Node v26)
- **pnpm**: v9+ (tested on pnpm v11)
- **OpenCode CLI**: Installed and working on Windows (`opencode --version`)

---

## 1. Installation

Clone the repository and install dependencies:

```bash
pnpm install
```

Build all packages and typecheck:

```bash
pnpm build
pnpm typecheck
```

Run test suite:

```bash
pnpm test
```

---

## 2. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Defaults:
- `RELAY_PORT`: `4000`
- `OPENCODE_URL`: `http://127.0.0.1:4096`
- `AGENT_RELAY_URL`: `ws://localhost:4000/ws`

---

## 3. Running Services Locally

You can run each service independently in separate terminals:

### Terminal 1 — OpenCode Server
Start OpenCode's headless server:
```bash
opencode serve --port 4096
```

### Terminal 2 — Cloud Relay
Start the Fastify relay server:
```bash
pnpm dev:relay
```
*Health check available at:* `http://localhost:4000/health`
*WebSocket available at:* `ws://localhost:4000/ws`

### Terminal 3 — Windows Agent
Start the background agent daemon:
```bash
pnpm dev:agent
```
*The agent will immediately connect to the relay and detect the OpenCode server.*

### Terminal 4 — Mobile PWA
Start the Vite development web server:
```bash
pnpm dev:web
```
*Open:* `http://localhost:3000` (or your PC's local IP on your phone, e.g. `http://192.168.1.X:3000`).

---

## 4. One-Command Dev Launcher

To run Relay, Agent, and Web simultaneously:
```bash
pnpm dev
```
