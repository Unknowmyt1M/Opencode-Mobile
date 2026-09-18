Build: OpenCode Remote Control

0. ROLE

You are the lead architect and senior full-stack engineer responsible for designing and implementing a production-quality remote-control system for OpenCode.

The goal is to build an experience conceptually similar to Antigravity's Remote Control:

«Run OpenCode on a Windows PC, then control and monitor it remotely from an Android phone through an installable PWA.»

The phone is NOT the machine running OpenCode.

The Windows PC remains the execution host.

The architecture must use a secure outbound connection from the PC to a hosted relay so that the user does NOT need:

- port forwarding
- router configuration
- public exposure of OpenCode's local port
- manual IP configuration
- Cloudflare Tunnel for the final architecture

The final architecture should be:

                    ┌──────────────────────────────┐
                    │        Android Phone         │
                    │                              │
                    │   OpenCode Remote PWA        │
                    │   HTTPS + WebSocket          │
                    └──────────────┬───────────────┘
                                   │
                                   │ HTTPS / WSS
                                   ▼
                    ┌──────────────────────────────┐
                    │           Railway             │
                    │                              │
                    │   Remote Control Backend     │
                    │                              │
                    │   • Authentication            │
                    │   • Device registry           │
                    │   • Pairing                  │
                    │   • Connection routing       │
                    │   • Event relay              │
                    │   • Session management       │
                    └──────────────┬───────────────┘
                                   │
                                   │ Persistent WSS
                                   │ outbound from PC
                                   ▼
                    ┌──────────────────────────────┐
                    │        Windows PC             │
                    │                              │
                    │  OpenCode Remote Agent       │
                    │          │                   │
                    │          │ localhost         │
                    │          ▼                   │
                    │  OpenCode Server :4096       │
                    │                              │
                    │  TUI / Web / Agent           │
                    └──────────────────────────────┘

Vercel may optionally host the frontend/PWA, while Railway hosts the persistent relay/backend.

---

1. NON-NEGOTIABLE RULES

Rule 1 — Research before implementation

Before writing implementation code:

1. Inspect the existing repository.
2. Identify its framework, package manager, architecture and conventions.
3. Research the CURRENT OpenCode server/API architecture.
4. Inspect the OpenCode source/docs where possible.
5. Determine exactly which OpenCode APIs/events are available.
6. Do NOT invent OpenCode endpoints.
7. Do NOT assume undocumented protocols.
8. Do NOT copy Antigravity's internal implementation.
9. Use OpenCode's public server/API capabilities wherever possible.

Current OpenCode concepts to investigate include:

- "opencode serve"
- "opencode web"
- "opencode attach"
- OpenCode server API
- OpenAPI specification
- session APIs
- event/SSE mechanisms
- terminal functionality
- file APIs
- Git-related functionality
- permission/approval mechanisms
- server authentication
- server configuration

Official documentation should be treated as the first source of truth.

Relevant official documentation:

- OpenCode server documentation
- OpenCode web documentation
- OpenCode CLI documentation
- OpenCode GitHub repository/source

Do not hardcode assumptions from this prompt if the current OpenCode implementation differs.

---

2. PRODUCT OBJECTIVE

Build:

"OpenCode Remote"

A mobile-first remote-control application for OpenCode.

Primary use case:

User starts OpenCode on Windows PC
        ↓
Remote Agent starts
        ↓
Agent establishes secure outbound connection
        ↓
Phone opens OpenCode Remote PWA
        ↓
User pairs phone with PC
        ↓
User sees OpenCode sessions
        ↓
User opens a session
        ↓
User can monitor/control the coding agent

The system should feel like a dedicated remote-control product, not like a website awkwardly squeezed onto a phone.

---

3. IMPORTANT ARCHITECTURAL DECISION

Do NOT expose OpenCode directly to the Internet.

BAD:

Phone
  ↓
Internet
  ↓
PC:4096

Also avoid making Railway a generic HTTP proxy:

Phone
 ↓
Railway
 ↓
arbitrary HTTP forwarding
 ↓
PC

Instead use a typed remote protocol.

Correct:

Phone
 ↓
WSS
 ↓
Railway Relay
 ↓
authenticated persistent WSS
 ↓
Remote Agent
 ↓
OpenCode localhost API

The relay must understand the application's protocol.

It should NOT blindly proxy arbitrary requests.

---

4. MONOREPO ARCHITECTURE

Prefer a monorepo unless repository constraints indicate otherwise.

Suggested structure:

opencode-remote/
│
├── apps/
│   ├── web/
│   │   └── # Android/mobile-first PWA
│   │
│   ├── relay/
│   │   └── # Railway backend
│   │
│   └── agent/
│       └── # Windows remote agent
│
├── packages/
│   ├── protocol/
│   │   └── # Shared WebSocket protocol/types
│   │
│   ├── auth/
│   │   └── # Authentication utilities
│   │
│   ├── database/
│   │   └── # Database schema/client
│   │
│   ├── ui/
│   │   └── # Shared UI components
│   │
│   └── config/
│
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── security.md
│   ├── deployment.md
│   └── development.md
│
├── package.json
├── README.md
└── ...

Adjust this structure if the existing repository already has a better architecture.

Do not blindly restructure an existing project.

---

5. TECHNOLOGY RESEARCH

Before choosing technologies, compare reasonable options.

Potential stack:

Frontend

Prefer:

- React
- TypeScript
- Vite / Next.js depending on deployment architecture
- Tailwind CSS
- shadcn/ui or an equivalent accessible component system
- PWA support
- WebSocket client
- Web Push notifications

Backend

Potential:

- Node.js
- TypeScript
- Fastify / Hono / Express depending on project requirements

Relay

Must support:

- persistent WebSockets
- reconnection
- multiple devices
- multiple PCs
- authentication
- message routing
- heartbeat
- connection lifecycle

Database

Potential:

- PostgreSQL

Prefer a hosted PostgreSQL-compatible database if needed.

Do not add a database if the initial architecture can safely avoid persistent state.

However, persistent device/account/session metadata will likely require one.

Agent

Prefer:

- Node.js
- TypeScript

The agent should be lightweight enough to run continuously on an old Windows machine.

---

6. CORE COMPONENTS

There are three major components.

A. Remote PWA

Runs on Android/browser.

Responsibilities:

- authentication
- device selection
- pairing
- PC status
- session list
- session view
- sending prompts
- receiving agent events
- approvals
- notifications
- basic terminal/file/Git controls where supported

---

B. Railway Relay

Hosted backend.

Responsibilities:

- user authentication
- device registration
- PC registration
- pairing
- WebSocket management
- connection routing
- authorization
- message validation
- event fan-out
- connection state
- heartbeat
- reconnect handling
- rate limiting
- audit/security logging

The relay should NOT execute OpenCode.

The relay is only the secure control-plane/router.

---

C. Windows Remote Agent

Runs on the user's PC.

Responsibilities:

- connect outbound to Railway
- authenticate itself
- maintain persistent WSS
- reconnect automatically
- discover/connect to local OpenCode
- translate remote protocol → OpenCode API
- translate OpenCode events → remote protocol
- expose only explicitly supported operations
- maintain local state
- report health/status

The agent must NOT expose a public server port.

---

7. OPENCode INTEGRATION

The agent must integrate with the actual OpenCode server.

Research and implement against the current OpenCode API.

The agent should support, where officially available:

Session

- list sessions
- create session
- open session
- delete/archive session if supported
- retrieve session information

Messages

- send user prompt
- receive assistant responses
- stream response updates
- receive tool execution updates
- receive errors

Events

Subscribe to OpenCode's supported event mechanism.

Convert relevant events into the remote protocol.

Example conceptual event:

type RemoteEvent =
  | {
      type: "session.updated";
      sessionId: string;
      payload: unknown;
    }
  | {
      type: "message.delta";
      sessionId: string;
      payload: unknown;
    }
  | {
      type: "tool.started";
      sessionId: string;
      payload: unknown;
    }
  | {
      type: "tool.completed";
      sessionId: string;
      payload: unknown;
    }
  | {
      type: "permission.requested";
      sessionId: string;
      payload: unknown;
    }
  | {
      type: "error";
      payload: unknown;
    };

These are examples only.

Map them to actual OpenCode events after inspecting the current API.

---

8. REMOTE PROTOCOL

Create a shared TypeScript protocol package.

Do NOT allow arbitrary RPC.

Every message must have:

{
  id: string;
  type: string;
  version: number;
  timestamp: number;
  payload: unknown;
}

Use explicit message types.

Example:

DEVICE_REGISTER
DEVICE_REGISTERED

PAIR_REQUEST
PAIR_APPROVED
PAIR_REJECTED

OPEN_CODE_STATUS
OPEN_CODE_STATUS_RESULT

SESSION_LIST
SESSION_LIST_RESULT

SESSION_CREATE
SESSION_CREATE_RESULT

SESSION_OPEN
SESSION_OPEN_RESULT

MESSAGE_SEND
MESSAGE_SEND_ACK

EVENT_SUBSCRIBE
EVENT

PERMISSION_REQUEST
PERMISSION_RESPONSE

TERMINAL_REQUEST
TERMINAL_RESULT

FILE_READ
FILE_READ_RESULT

FILE_WRITE
FILE_WRITE_RESULT

GIT_STATUS
GIT_STATUS_RESULT

PING
PONG

ERROR

Only implement operations that are actually possible and safe.

Use runtime schema validation.

Recommended:

Zod

or equivalent.

The relay MUST validate protocol messages before routing them.

---

9. MESSAGE ROUTING

Every connected PC agent should have:

userId
deviceId
connectionId
agentVersion
opencodeVersion
status
lastSeen

Every mobile connection should have:

userId
clientId
connectionId
device/session context

Routing:

phone client
    ↓
user identity
    ↓
selected PC/device
    ↓
device connection
    ↓
remote protocol message
    ↓
agent
    ↓
OpenCode

A user must never be able to send commands to another user's PC.

---

10. DEVICE MODEL

Support multiple PCs from day one architecturally.

Example:

My Machines

● Gaming PC
  Online
  OpenCode 1.x

● Laptop
  Offline
  Last seen 2h ago

● Server
  Online
  OpenCode 1.x

Each machine gets:

- friendly name
- device ID
- status
- OS
- agent version
- OpenCode version
- last seen
- capabilities

---

11. PAIRING SYSTEM

Create a secure pairing flow similar in UX to modern remote-control systems.

Preferred initial flow:

Desktop

Agent generates pairing information.

Example:

OpenCode Remote

Pair this computer

CODE:
ABCD-1234

or

Scan QR

Phone

User opens PWA.

Chooses:

Add Computer

Then:

Scan QR

or enters:

ABCD-1234

The backend verifies the pairing request.

After approval:

Phone ↔ User Account ↔ PC Agent

Do NOT put long-lived secrets inside QR codes if avoidable.

QR should contain a short-lived pairing token/deep link.

Pairing tokens must:

- expire
- be single-use
- be rate limited
- be cryptographically random

---

12. AUTHENTICATION

Design authentication separately from device authentication.

There are two identities:

User

The person using the PWA.

Agent

The Windows PC.

The PC should authenticate using a device credential/token.

Never expose:

OPENCODE_SERVER_PASSWORD

to the phone.

Never send OpenCode credentials through the browser.

The agent handles local OpenCode authentication.

---

13. SECURITY MODEL

Treat this as a remote code-execution control system.

Security is a first-class feature.

Threat model:

Attacker steals phone session
Attacker guesses pairing code
Attacker compromises relay
Attacker impersonates PC
Attacker sends malicious protocol message
Attacker attempts arbitrary HTTP proxying
Attacker attempts terminal command injection
Attacker accesses another user's PC
Attacker replays old messages
Attacker steals device token

Implement protections including:

- TLS/WSS
- secure authentication
- short-lived pairing tokens
- cryptographically random device credentials
- device authorization
- per-user authorization
- message schema validation
- replay protection where applicable
- rate limiting
- origin validation
- CSRF protection where applicable
- secure cookies where applicable
- secret hashing/storage
- token rotation
- device revocation
- session expiration
- audit logging
- heartbeat
- connection authentication
- authorization on EVERY sensitive operation

Never trust:

deviceId
userId
sessionId
file path
command

because they came from the client.

---

14. TERMINAL SECURITY

Terminal control is extremely powerful.

Do not implement:

POST /proxy
{
  "url": "http://localhost:4096/..."
}

Do not create arbitrary shell execution through the relay.

If terminal control is added:

1. Define explicit protocol.
2. Authenticate.
3. Authorize.
4. Validate session/device ownership.
5. Clearly show the user that a terminal command is being executed.
6. Handle streaming output safely.
7. Prevent accidental command injection through the protocol itself.
8. Never execute commands on the Railway server.
9. Never allow the relay to execute local commands.

Where OpenCode already provides terminal functionality, prefer using its supported mechanisms rather than implementing a second unsafe shell system.

---

15. FILE ACCESS

File access should be capability-based.

Potential operations:

GET_FILE
LIST_DIRECTORY
WRITE_FILE

But:

- never allow unrestricted filesystem access
- resolve and normalize paths
- prevent "../" traversal
- enforce workspace boundaries
- reject absolute paths outside allowed roots
- avoid exposing secrets
- enforce maximum file size
- stream large files
- validate encoding/content type

The agent should determine allowed OpenCode workspace roots.

---

16. GIT

If Git integration is implemented:

Expose safe, structured operations such as:

GIT_STATUS
GIT_DIFF
GIT_LOG

Avoid turning Git into arbitrary command execution.

Use OpenCode's existing capabilities where possible.

---

17. PWA

The web client must be a proper installable PWA.

Requirements:

- manifest
- service worker
- icons
- standalone mode
- responsive mobile UI
- offline shell
- reconnect handling
- push notification support

The experience on Android should feel like:

OpenCode Remote

rather than:

Chrome website

---

18. MOBILE UI

Design for Android first.

Primary navigation:

Machines
Sessions
Activity
Settings

Potential layout:

┌─────────────────────────┐
│ OpenCode Remote     ⚙️  │
├─────────────────────────┤
│                         │
│ ● My PC                 │
│   Online                 │
│   OpenCode running       │
│                         │
│   [Open]                 │
│                         │
├─────────────────────────┤
│ Recent Sessions          │
│                         │
│ Fix authentication bug   │
│ 12 min ago               │
│                         │
│ Build mobile UI          │
│ 1 hr ago                 │
│                         │
└─────────────────────────┘

Use modern mobile interaction patterns.

Avoid desktop IDE-style layouts on small screens.

---

19. SESSION SCREEN

The session screen is the most important screen.

It should show:

┌─────────────────────────┐
│ ← Fix authentication    │
│   ● Working              │
├─────────────────────────┤
│                         │
│ User                    │
│ Fix the OAuth callback  │
│                         │
│ Agent                   │
│ I'll inspect the route… │
│                         │
│ 🔧 Reading files         │
│                         │
│ ✓ auth.ts               │
│ ✓ callback.ts            │
│                         │
│ 🔨 Editing callback.ts   │
│                         │
├─────────────────────────┤
│ + Context               │
│                         │
│ Type a message...    ➤  │
└─────────────────────────┘

Support streaming.

Do not wait for an entire response before rendering if OpenCode provides streaming events.

---

20. APPROVALS

Remote approval is critical.

If OpenCode requests permission:

┌─────────────────────────┐
│ Permission Required     │
├─────────────────────────┤
│ Agent wants to:         │
│                         │
│ Run terminal command    │
│                         │
│ npm install             │
│                         │
│ [Deny]       [Allow]    │
└─────────────────────────┘

The user must clearly understand what is being approved.

Never auto-approve dangerous operations by default.

Support:

Allow
Deny

and whatever richer OpenCode permission model is actually available.

---

21. CONNECTION STATES

The UI must clearly represent:

Connecting
Connected
Reconnecting
Offline
OpenCode unavailable
Agent unavailable
Authentication required

Example:

● PC Online
● OpenCode Connected

versus:

● PC Online
○ OpenCode Offline

Do not confuse relay connectivity with OpenCode connectivity.

---

22. RECONNECTION

Implement robust reconnection.

PC agent:

connect
 ↓
heartbeat
 ↓
connection lost
 ↓
exponential backoff
 ↓
reconnect
 ↓
authenticate
 ↓
restore subscriptions

Browser:

connection lost
 ↓
show "Reconnecting..."
 ↓
retry
 ↓
restore device/session state
 ↓
resume events

Use:

exponential backoff + jitter

Do not create reconnect storms.

---

23. BACKGROUND OPERATION

Important behavior:

If the phone disconnects:

Phone OFFLINE
       ↓
PC remains connected
       ↓
OpenCode continues working
       ↓
Phone reconnects
       ↓
Remote UI synchronizes current state

The remote system must NOT terminate OpenCode work merely because the mobile client disconnected.

The PC agent remains independently connected to the relay.

---

24. EVENT SYNCHRONIZATION

The system needs state synchronization.

Do not rely entirely on transient WebSocket messages.

When the phone reconnects:

1. authenticate
2. select device
3. fetch current state
4. fetch session state
5. restore event subscription
6. render current state

If the protocol supports sequence numbers:

sequence: number

Use them.

Potentially:

lastReceivedSequence

to detect missed events.

---

25. NOTIFICATIONS

Implement optional push notifications.

Examples:

OpenCode needs your approval
OpenCode finished the task
OpenCode encountered an error
Agent completed a long-running task

Do not spam notifications for every token/event.

Use meaningful notification aggregation.

Example:

BAD:

Agent generated token
Agent generated token
Agent generated token
...

GOOD:

OpenCode finished "Fix OAuth callback"

---

26. DESKTOP AGENT UX

The Windows agent should be easy to install and run.

Target experience:

OpenCode Remote Agent

✓ Connected to Remote
✓ OpenCode detected
✓ Device paired

Computer:
DESKTOP-XXXX

Status:
Online

The agent should have:

- tray mode if practical
- start/stop
- connection status
- pairing
- logs
- diagnostics
- OpenCode detection
- configuration
- logout/unpair
- update support eventually

Do not make the user manually configure complicated networking.

---

27. AUTO-DETECT OPENCode

The agent should attempt to detect a running OpenCode server.

Possible workflow:

Agent starts
 ↓
Check configured OpenCode endpoint
 ↓
Check localhost defaults
 ↓
Detect OpenCode
 ↓
Authenticate if required
 ↓
Subscribe to events

Allow manual configuration as fallback.

Do not hardcode one port without checking current OpenCode behavior.

---

28. LOCAL CONFIGURATION

Use a safe local configuration file.

Example conceptual structure:

{
  "relayUrl": "...",
  "deviceId": "...",
  "deviceName": "...",
  "opencode": {
    "url": "http://127.0.0.1:4096"
  }
}

Secrets must NOT be stored in plain-text logs.

Use the OS credential store where practical.

---

29. DATABASE

Design the data model before implementation.

Potential entities:

User
Device
DeviceCredential
PairingRequest
BrowserSession
RemoteSession
Connection
PushSubscription
AuditEvent

Potential relationships:

User
 ├── Devices
 ├── Browser Sessions
 ├── Pairing Requests
 └── Push Subscriptions

Device
 └── Connections

Do not duplicate OpenCode's entire database unnecessarily.

The relay should store control-plane state, not coding-project state.

---

30. API DESIGN

Create an API specification before implementing.

Document:

Authentication
Device registration
Pairing
Device listing
Device status
WebSocket connection
Push subscriptions
Health

The remote protocol should be separately documented.

Use OpenAPI for HTTP APIs.

Use a machine-readable schema for WebSocket messages.

---

31. OBSERVABILITY

Implement:

- structured logging
- request IDs
- connection IDs
- device IDs
- user IDs
- error classification
- connection metrics
- heartbeat metrics

Never log:

- passwords
- access tokens
- device secrets
- file contents
- arbitrary terminal output unless explicitly configured

Provide:

GET /health
GET /ready

or equivalent.

---

32. RAILWAY DEPLOYMENT

Railway should host the persistent relay service.

Requirements:

- listen on "0.0.0.0"
- respect Railway's "PORT"
- HTTPS
- WSS
- environment variables
- PostgreSQL if required
- production logging
- health endpoint

Expected architecture:

Railway
│
├── remote-relay
│
└── PostgreSQL

Do not deploy the Windows agent to Railway.

The agent runs on the user's PC.

---

33. VERCEL DEPLOYMENT

If Vercel is used:

Vercel
└── PWA frontend

The frontend communicates with:

https://relay.example.com
wss://relay.example.com

Do not depend on Vercel serverless functions for long-lived PC agent connections if Railway is already providing the persistent relay.

The frontend and relay must have clean environment configuration.

---

34. LOCAL DEVELOPMENT

Development should work without cloud deployment.

Example:

localhost:3000
    ↓
localhost:4000 relay
    ↓
local agent
    ↓
localhost:4096 OpenCode

Provide:

pnpm dev

or equivalent one-command startup.

Include:

pnpm dev:web
pnpm dev:relay
pnpm dev:agent
pnpm test
pnpm lint
pnpm typecheck

if appropriate for the chosen stack.

---

35. TESTING

Testing is mandatory.

Unit tests

Test:

- protocol validation
- authentication
- authorization
- pairing
- token expiration
- message routing
- reconnect logic
- state synchronization
- path validation
- rate limiting

Integration tests

Test:

PWA
 ↓
Relay
 ↓
Agent
 ↓
Mock OpenCode

End-to-end test

Simulate:

Create user
 ↓
Register PC
 ↓
Pair phone
 ↓
Connect phone
 ↓
List devices
 ↓
Open session
 ↓
Send prompt
 ↓
Receive streaming event
 ↓
Approval request
 ↓
Approve
 ↓
Agent completes
 ↓
Phone receives completion

Failure tests

Test:

- relay restart
- agent restart
- phone disconnect
- Wi-Fi loss
- OpenCode restart
- expired pairing
- invalid token
- unauthorized device
- duplicate messages
- delayed messages
- missed events
- malformed protocol payloads

---

36. PERFORMANCE

The Windows PC may be low-powered.

Therefore:

- keep agent lightweight
- avoid Electron unless genuinely necessary
- avoid excessive CPU polling
- use event-driven architecture
- avoid repeatedly scanning the filesystem
- avoid storing large session histories in memory
- stream data
- compress only where beneficial
- minimize background CPU/RAM

The mobile UI should also be fast on mid-range Android devices.

---

37. UX QUALITY

The product should feel polished.

Requirements:

- smooth transitions
- skeleton states
- meaningful loading states
- optimistic UI where safe
- error recovery
- dark mode
- mobile-first layout
- touch-friendly controls
- readable terminal output
- accessible contrast
- keyboard support
- responsive desktop layout

Do NOT over-design it into a giant IDE.

The product is a:

«Remote Control»

not:

«Complete replacement for OpenCode's desktop interface.»

---

38. MVP SCOPE

Implement the MVP in this order.

Phase 1 — Foundation

- monorepo
- protocol package
- relay
- agent
- PWA
- authentication
- WebSocket connection
- health monitoring

Phase 2 — Pairing

- device registration
- QR pairing
- pairing code
- device list
- device status
- revoke device

Phase 3 — OpenCode

- detect OpenCode
- OpenCode connection
- session listing
- session opening
- prompt sending
- streaming events

Phase 4 — Remote Control

- permission requests
- approval/deny
- reconnect
- state synchronization
- notifications

Phase 5 — Advanced

- terminal
- files
- Git
- multiple machines
- activity history

---

39. DO NOT BUILD YET

Unless the architecture requires them, do NOT initially build:

- native Android app
- native iOS app
- complete IDE
- built-in code editor
- AI model provider
- custom LLM routing
- cloud OpenCode execution
- arbitrary shell execution
- arbitrary HTTP proxy
- file synchronization service
- remote desktop streaming
- video streaming
- screen sharing

Keep the product focused.

---

40. OPTIONAL FUTURE FEATURES

Design the architecture so these can eventually be added:

Multiple PCs
Multiple OpenCode instances
Remote terminal
Remote file browser
Git diff
Git commits
Agent activity timeline
Push notifications
Task history
Session search
Workspace selector
Device groups
Team sharing
Temporary guest access
Biometric re-authentication
Native Android wrapper
Desktop tray application
Auto updates

But do not let future features complicate MVP unnecessarily.

---

41. DOCUMENTATION

Create:

README.md

docs/
├── architecture.md
├── threat-model.md
├── protocol.md
├── api.md
├── pairing.md
├── deployment.md
├── local-development.md
├── troubleshooting.md
└── roadmap.md

README must explain:

1. What this project does.
2. Architecture.
3. How to run locally.
4. How to pair a PC.
5. How to run the agent.
6. How to deploy relay to Railway.
7. How to deploy PWA to Vercel.
8. Security model.
9. Troubleshooting.

---

42. ENVIRONMENT VARIABLES

Create ".env.example".

Separate:

WEB_*
RELAY_*
DATABASE_*
AUTH_*
PUSH_*
AGENT_*
OPENCODE_*

Never commit secrets.

Validate environment variables at startup.

Fail clearly when required variables are missing.

---

43. ERROR HANDLING

Errors must be structured.

Example:

{
  code: "DEVICE_OFFLINE",
  message: "The selected computer is currently offline.",
  requestId: "..."
}

Create stable error codes.

Do not expose internal stack traces to the browser.

Log detailed errors server-side.

---

44. PROTOCOL VERSIONING

The remote protocol must support versioning.

Example:

protocolVersion: 1

Future agents should be able to negotiate versions.

Do not assume the web client and Windows agent are updated simultaneously.

Support:

unsupported version
capability negotiation
agent version
server version

---

45. CAPABILITY SYSTEM

The agent should report capabilities.

Example:

{
  "sessions": true,
  "streaming": true,
  "permissions": true,
  "terminal": false,
  "files": false,
  "git": false
}

The PWA should adapt its UI based on capabilities.

Do not display controls that the connected agent/OpenCode version cannot support.

---

46. SECURITY REVIEW BEFORE RELEASE

Before declaring the project complete, perform a security audit.

Specifically test:

Authentication

- Can an unauthenticated browser connect?
- Can one user access another user's device?
- Can revoked devices reconnect?

Pairing

- Can pairing codes be brute-forced?
- Are they short-lived?
- Are they single-use?

WebSocket

- Is every connection authenticated?
- Is every message authorized?
- Are malformed messages rejected?

Files

- Can "../" escape the workspace?
- Can absolute paths escape?
- Can sensitive files be read?

Terminal

- Can arbitrary commands reach Railway?
- Can an attacker inject commands?
- Is authorization enforced?

Relay

- Can Railway be used as a generic proxy?
- Can one device impersonate another?
- Can connections be hijacked?

Secrets

- Are credentials in logs?
- Are tokens stored securely?
- Are environment variables exposed to clients?

Fix all critical/high-severity findings before release.

---

47. IMPLEMENTATION METHOD

Follow this exact workflow.

Step 1 — Inspect

Inspect the entire repository.

Report:

Current stack
Current architecture
Existing reusable components
Potential conflicts
Missing infrastructure

Step 2 — Research

Research current:

- OpenCode server API
- OpenCode events
- OpenCode authentication
- Railway WebSocket support
- PWA capabilities
- Web Push
- relevant browser limitations

Use official documentation and source code where possible.

Step 3 — Architecture

Create:

docs/architecture.md
docs/protocol.md
docs/security.md

Step 4 — Data model

Design the database schema.

Step 5 — API

Define HTTP + WebSocket contracts.

Step 6 — MVP implementation

Implement:

Relay
Agent
PWA
Pairing
OpenCode connection
Session list
Session view
Prompt sending
Streaming
Reconnect

Step 7 — Tests

Run all tests.

Step 8 — Security audit

Perform the threat-model review.

Step 9 — Deployment

Deploy:

Relay → Railway
PWA → Vercel
Agent → Windows

Step 10 — Real-world test

Test the actual workflow:

Windows PC
 ↓
OpenCode
 ↓
Remote Agent
 ↓
Railway
 ↓
Android Galaxy phone

Do not mark the project complete based only on mocked tests.

---

48. IMPORTANT IMPLEMENTATION BEHAVIOR

If you encounter an OpenCode API limitation:

DO NOT immediately invent a workaround.

Instead:

1. Verify the current OpenCode implementation.
2. Check official docs/source.
3. Determine whether another supported endpoint/event exists.
4. Document the limitation.
5. Implement the safest supported alternative.

If a feature is impossible with the current OpenCode API:

mark capability unavailable

instead of faking it.

---

49. NO DUMMY IMPLEMENTATION

This is a real product.

Do NOT use:

fake sessions
fake messages
fake terminal output
fake connection states
fake OpenCode API
mock data in production
hardcoded device IDs
hardcoded tokens

Mocks are acceptable ONLY inside automated tests.

Every production flow must connect to the real components.

---

50. ACCEPTANCE CRITERIA

The project is successful when:

PC

OpenCode running
+
Remote Agent running

Cloud

Railway relay running

Phone

PWA installed

Pairing

Phone successfully pairs with PC

Device

PC shows Online

Session

Phone can see OpenCode sessions

Interaction

Phone sends prompt
 ↓
OpenCode receives prompt
 ↓
Agent works
 ↓
Phone receives streaming response

Approval

OpenCode asks for permission
 ↓
Phone displays approval
 ↓
User approves
 ↓
OpenCode continues

Disconnect

Phone disconnects
 ↓
OpenCode continues
 ↓
Phone reconnects
 ↓
State synchronizes

Security

Another user cannot access the PC.

---

51. FINAL DELIVERABLE

At the end provide:

1. Architecture summary
2. Repository structure
3. Technology decisions
4. Database schema
5. API specification
6. WebSocket protocol
7. Security model
8. Local setup instructions
9. Railway deployment instructions
10. Vercel deployment instructions
11. Windows agent setup
12. Android PWA installation instructions
13. Testing results
14. Security audit results
15. Known limitations
16. Future roadmap

Also provide exact commands for:

install
development
test
lint
typecheck
build
deployment
agent startup
agent pairing

---

52. MOST IMPORTANT DESIGN PRINCIPLE

Think of this as:

«"Antigravity Remote Control, but for OpenCode."»

Not:

«"Put OpenCode's localhost port on the Internet."»

The correct architecture is a secure control plane + outbound PC agent + OpenCode local server + mobile PWA.

The PC is the execution environment.

Railway is the relay/control plane.

The phone is the remote control.

Vercel is optional frontend hosting.

OpenCode remains the actual coding agent.

Build the system around these boundaries.

---

53. START NOW

Do NOT start coding immediately.

First:

1. Inspect the repository.
2. Research the current OpenCode API/source.
3. Research the current deployment constraints.
4. Produce a concise architecture assessment.
5. Identify any assumptions in this specification that are incompatible with the actual OpenCode implementation.
6. Produce the implementation plan.
7. Then begin implementation.

Do not ask for permission between every small step.

Make reasonable engineering decisions autonomously.

Only stop and ask when a decision genuinely requires user-specific information or would cause destructive/unrecoverable changes.

Use real implementations.

No placeholders.

No fake production functionality.

No unnecessary rewrites.

No unnecessary dependencies.

Prioritize:

Security
Reliability
Correct OpenCode integration
Low resource usage
Mobile UX
Reconnectability
Maintainability

over flashy features.
