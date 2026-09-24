# OpenCode 1.18.30 Global Project & Session API Research

This document records the exact, verified behavior of the OpenCode 1.18.30 HTTP/SSE server running on `localhost:4096`, cross-verified with:
1. The official OpenAPI 3.1.0 documentation at `/doc` (478KB specification)
2. The official OpenCode source code in `opencode-dev` (`packages/opencode`, `packages/server`, `packages/protocol`, `packages/core`)
3. Live HTTP and SSE tests executed against the running OpenCode process on `http://127.0.0.1:4096`

---

## 1. Project Discovery & Schema

### Verified Endpoint: `GET /project`
- **Route**: `GET /project`
- **Purpose**: Lists all known projects across the entire system.
- **Location Filter**: Does NOT require directory filter; returns all projects discovered by OpenCode across all drives (`C:\`, `D:\`, etc.).
- **Live Test Result**: Returned 16 distinct projects on the test system.

#### Response Schema (`Project[]`):
```json
[
  {
    "id": "cac157718985b9490003cf009cb773f1344b8ca7",
    "worktree": "D:\\Projects\\Websites\\MyDonghuaList",
    "vcs": "git",
    "icon": {
      "url": "data:image/svg+xml;base64,..."
    },
    "time": {
      "created": 1786873740255,
      "updated": 1790225096958
    },
    "sandboxes": []
  },
  {
    "id": "global",
    "worktree": "C:\\Users\\Aditya\\Documents\\Default Project",
    "vcs": "git",
    "time": {
      "created": 1786790159321,
      "updated": 1790225096357
    },
    "sandboxes": []
  }
]
```

#### Related Project Endpoints:
- `GET /project/current`: Returns the project for the current working directory. When `x-opencode-directory` header or `?directory=` query param is supplied, it dynamically returns the project associated with that directory!
- `GET /project/{projectID}/directories`: Returns all known directories/worktrees mapped to the project:
  ```json
  [
    { "directory": "D:\\Projects\\Websites\\MyDonghuaList" }
  ]
  ```

---

## 2. Session Discovery & Scoping

OpenCode 1.18.30 exposes two distinct generations of session discovery APIs:

### A. V2 Global Session Discovery: `GET /api/session`
- **Route**: `GET /api/session`
- **Query Parameters**:
  - `project` (string, optional): Filter sessions by project ID (e.g. `cac157718985b9490003cf009cb773f1344b8ca7`).
  - `directory` (string, optional): Filter sessions by absolute directory path.
  - `limit` (number, optional, default: 50): Number of sessions per page.
  - `cursor` (string, optional): Base64 opaque cursor for pagination.
  - `order` ("asc" | "desc", optional): Sort order.
  - `search` (string, optional): Text search query.
- **Global Behavior**: When called without `project` or `directory`, it returns sessions **globally across the entire PC**.
- **Live Test Result**: Confirmed 100 sessions across 6+ projects and 13+ distinct directories (`C:\`, `D:\`).

#### Response Schema (`{ data: SessionV2Info[], cursor?: string }`):
```json
{
  "data": [
    {
      "id": "ses_f2d3cfd67ffeNXGyME4xWNhZlk",
      "projectID": "global",
      "agent": "build",
      "model": {
        "id": "mimo-v2.6-flash-free",
        "providerID": "opencode",
        "variant": "default"
      },
      "cost": 0,
      "tokens": {
        "input": 39562,
        "output": 719,
        "reasoning": 412,
        "cache": { "read": 68288, "write": 0 }
      },
      "time": {
        "created": 1790242390681,
        "updated": 1790242528107
      },
      "title": "Kill opencode sessions except port 406",
      "location": {
        "directory": "C:\\Users\\Aditya\\Documents\\Default Project"
      }
    }
  ],
  "cursor": "eyJpZCI6InNlc18..."
}
```

### B. V1 Instance Session Discovery: `GET /session`
- **Route**: `GET /session`
- **Query Parameters**:
  - `directory` (string, optional): Target directory.
  - `roots` (boolean, optional): If true, returns root sessions.
  - `limit` (number, optional): Max count.
  - `search` (string, optional): Search query.
- **Header Scoping**: Accepts `x-opencode-directory: <path>`.
- **Live Test Verification**:
  - Calling `GET /session?directory=D:\Projects\Websites\MyDonghuaList` returned 13 sessions.
  - Calling `GET /session` with header `x-opencode-directory: D:\Projects\Websites\MyDonghuaList` returned the exact same 13 sessions.
  - Calling `GET /session` without parameters returned only the 18 sessions matching `process.cwd()` (`D:\Projects\apps\OpencodeMobile`).

---

## 3. Directory Context Mechanism for Session Operations

OpenCode's `LocationMiddleware` and `SessionLocationMiddleware` inspect incoming HTTP requests using:
1. HTTP Header: `x-opencode-directory: <absolute_path>`
2. Query Parameter: `?directory=<encoded_path>` (or `?location[directory]=<path>`)
3. Database Lookup: For routes with `:sessionID`, the server queries `SessionTable.where(id == sessionID).select({ directory })` to bind the session's native directory context automatically!

### Verified Operations Matrix:
| Operation | Endpoint | Directory Scoping Mechanism |
| :--- | :--- | :--- |
| **List Projects** | `GET /project` | None needed (Global) |
| **List All Sessions** | `GET /api/session` | None needed (Global) |
| **List Project Sessions** | `GET /api/session?project={id}` OR `GET /session?directory={dir}` | Query param / Header |
| **Create Session** | `POST /session?directory={dir}` OR Header `x-opencode-directory: {dir}` | Query param / Header |
| **Get Session Info** | `GET /session/{sessionID}` | Automatically resolves directory via sessionID |
| **Get Messages** | `GET /session/{sessionID}/message` | Automatically resolves directory via sessionID (Header supported) |
| **Send Message** | `POST /session/{sessionID}/message` | Automatically resolves directory via sessionID (Header supported) |
| **Get Diffs** | `GET /session/{sessionID}/diff` | Automatically resolves directory via sessionID (Header supported) |
| **Get Todos** | `GET /session/{sessionID}/todo` | Automatically resolves directory via sessionID (Header supported) |
| **Revert Turn** | `POST /session/{sessionID}/revert` | Automatically resolves directory via sessionID (Header supported) |
| **Fork Session** | `POST /session/{sessionID}/fork` | Automatically resolves directory via sessionID (Header supported) |

> **Best Practice for Remote Agent**:  
> Always supply the `x-opencode-directory: <directory>` header on all requests where the target session's directory is known, and supply `?directory=<dir>` when creating sessions or listing project-scoped sessions.

---

## 4. Real-time Event Streams: Global vs Directory-Scoped

### Legacy Stream: `GET /event`
- Found in `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`.
- **Filtering Logic**:
  ```ts
  Stream.filter(
    (event) =>
      event.location?.directory === instance.directory &&
      (event.location.workspaceID === undefined || event.location.workspaceID === workspaceID),
  )
  ```
- **Limitation**: When subscribed without a directory or with default cwd, it only receives events for that directory.

### Global Stream: `GET /api/event`
- Found in `packages/server/src/handlers/event.ts`.
- **Filtering Logic**:
  ```ts
  const live = yield* EventV2.allBounded(events, subscriberCapacity)
  ```
- **Advantage**: It streams ALL domain events globally across ALL projects and directories on the entire PC!
- **Event Shape**:
  ```json
  {
    "id": "evt_0d2cb3219001s7SjDN6Bk6nArp",
    "type": "server.connected",
    "data": {},
    "location": {
      "directory": "D:\\Projects\\Websites\\MyDonghuaList",
      "workspaceID": "wrk_..."
    }
  }
  ```
- **Live Test**: Successfully connected and received events from `GET /api/event`.

---

## 5. Summary of Assumptions vs Verified Facts

| Previous Assumption | Verified Fact |
| :--- | :--- |
| Need to scan filesystem for projects | ❌ False. `GET /project` returns all known projects directly from OpenCode. |
| Need direct SQLite access to `opencode.db` | ❌ False. `GET /api/session` and `GET /project` expose everything via HTTP. |
| Sessions only belong to current folder | ❌ False. Every session has `projectID` and `location.directory`. |
| Server only handles sessions in `process.cwd()` | ❌ False. Server handles multi-directory routing via `x-opencode-directory` header and `?directory=` query. |
| Creating sessions in other folders is impossible | ❌ False. `POST /session?directory={dir}` creates sessions in any directory. |

---

## 6. Compatibility Notes
- OpenCode Version: **1.18.30** (confirmed running on port 4096).
- All endpoints tested and verified live with zero synthetic mock data.
