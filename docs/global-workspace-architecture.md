# Global PC-Wide Workspace & Multi-Project Mirror Architecture

## Overview

OpenCode Remote provides a centralized mobile and web controller for an entire PC running OpenCode 1.18.30+. Rather than being restricted to a single project directory, OpenCode Remote mirrors and manages all repositories, workspaces, and sessions across all drives on the host PC (`C:\`, `D:\`, etc.).

---

## Architecture Hierarchy

```text
Machine (Host PC)
  ├── 🌐 All Projects (Global PC-Wide View)
  │     └── All sessions across all drives & repositories
  │
  ├── Project A (e.g. D:/Projects/web/MyDonghuaList)
  │     ├── Scoped Sessions
  │     ├── Directory-scoped File Tree / Diffs
  │     └── PTY Terminal in project root
  │
  └── Project B (e.g. D:/Projects/web/Anilili)
        └── Scoped Sessions
```

---

## Core Protocol Additions

### 1. Project Discovery
- **RPC `PROJECT_LIST`**: Fetches all projects known to the host OpenCode instance via `GET /project`.
- **Payload**:
  ```ts
  export interface OpenCodeProject {
    id: string;
    worktree: string;
    name?: string;
    vcs?: string;
    time?: { created?: number; updated?: number };
    icon?: { type: string; value: string };
    sandboxes?: string[];
  }
  ```

### 2. Global vs Project-Scoped Sessions
- **`SESSION_LIST_GLOBAL`**: Calls `GET /api/session?limit=N` to retrieve sessions across all directories.
- **`SESSION_LIST_PROJECT`**: Calls `GET /session?directory=<encoded>` with header `x-opencode-directory: <path>` to retrieve sessions scoped strictly to that project worktree.
- **`SESSION_CREATE`**: Accepts optional `directory` and `projectId` parameters to create sessions in any project folder without changing the OpenCode process working directory.
- **`SESSION_GET`**: Passes `directory` and maintains `sessionDirectories` mapping on the agent.
- **`MESSAGE_SEND`**: Carries session directory context to guarantee OpenCode routes turns to the proper worktree.

---

## Source of Truth & Zero-Leakage Guarantee

1. **Authoritative OpenCode Persistence**:
   - No direct SQLite file reading of `opencode.db`.
   - No ad-hoc filesystem scanning.
   - All state is fetched via official OpenCode 1.18.30 endpoints (`/project`, `/session`, `/api/session`, `/api/event`).

2. **Session Directory Isolation**:
   - The agent maintains an in-memory `sessionDirectories` mapping (`sessionId` -> `directory`).
   - Every session snapshot, diff request, todo request, and prompt dispatch routes through the session's recorded worktree.

3. **No Unintended Switching**:
   - UI selection priority: Explicit user selection > Saved session (`localStorage`) > Fallback.
   - Background turns streaming in other sessions will not hijack or disrupt the active workspace view.
