# OpenCode 1.18.30 Integration & Capabilities Audit

This document records the exact capabilities, OpenAPI endpoints, and event structures verified against a running **OpenCode 1.18.30** daemon on Windows (`http://127.0.0.1:4096`).

---

## 1. Capability Matrix

| Capability | OpenCode 1.18.30 Support | Endpoint / SSE Event | Status in OpenCode Remote |
| :--- | :--- | :--- | :--- |
| **Health & Version** | ✅ Yes | `GET /global/health` | **Implemented & Verified** |
| **Session Management** | ✅ Yes | `GET /session`, `POST /session`, `GET /session/{id}` | **Implemented & Verified** |
| **Session Summary** | ✅ Yes | `GET /session` returns `{ summary: { additions, deletions, files }, tokens, cost }` | **Implemented** |
| **Project Context** | ✅ Yes | `GET /project/current` (returns `id`, `name`, `worktree`, `vcs`) | **Implemented (Phase 3)** |
| **Message History** | ✅ Yes | `GET /session/{id}/message` (returns typed parts array) | **Implemented & Verified** |
| **Message Sending** | ✅ Yes | `POST /session/{id}/prompt_async` | **Implemented & Verified** |
| **Token Streaming** | ✅ Yes | `GET /global/event` (`session.next.text.delta`, `message.part.delta`) | **Implemented & Verified** |
| **Reasoning / Thinking** | ✅ Yes | Part `type: "reasoning"`, events `session.next.text.delta` | **Implemented (Phase 3)** |
| **Tool Activity** | ✅ Yes | Part `type: "tool"` (`ToolPart` with `ToolStatePending`, `Running`, `Completed`, `Error`) | **Implemented (Phase 3)** |
| **Session Changed Files** | ✅ Yes | `GET /session/{id}/diff` returns `SnapshotFileDiff[]` (`file`, `status`, `additions`, `deletions`) | **Implemented (Phase 3)** |
| **Session Diff Viewer** | ✅ Yes | `GET /session/{id}/diff` includes unified `patch` strings per file | **Implemented (Phase 3)** |
| **Agent Terminal Output**| ✅ Yes | `ToolPart` with `tool: "bash"` or `tool: "command"` (structured input, output, exit code) | **Implemented (Phase 3)** |
| **Interactive PTY / Shell**| ⚠️ Partial / Unsafe for Remote | `GET /api/pty` & `POST /pty/{id}/connect-token` | **Scoped to Tool Terminal only (No arbitrary shell proxy for security)** |
| **Working Tree VCS Status**| ⚠️ Hangs on large untracked trees | `GET /vcs/status`, `GET /vcs/diff` | **Session diff preferred; VCS status supported with fallback** |

---

## 2. Verified OpenAPI Schemas

### A. Session File Diffs (`GET /session/{sessionID}/diff`)
Returns array of `SnapshotFileDiff`:
```json
{
  "file": "string (relative path)",
  "patch": "string (unified git diff)",
  "additions": 14,
  "deletions": 2,
  "status": "added | deleted | modified"
}
```

### B. Project Context (`GET /project/current`)
```json
{
  "id": "7f734febb4bccde25306828dc7a37e265eafde7f",
  "worktree": "D:\\Projects\\apps\\OpencodeMobile",
  "vcs": "git",
  "name": "OpencodeMobile",
  "time": { "created": 1789745145234, "updated": 1789748756221 }
}
```

### C. Message Parts (`Part` in `/session/{sessionID}/message`)
OpenCode messages contain an array of polymorphic `Part` objects:
- `TextPart`: `{ id, sessionID, messageID, type: "text", text: string }`
- `ReasoningPart`: `{ id, sessionID, messageID, type: "reasoning", text: string, time: { start, end } }`
- `ToolPart`: `{ id, sessionID, messageID, type: "tool", callID, tool: string, state: ToolState }`
  - `ToolState`: `status: "pending" | "running" | "completed" | "error"`, `input: any`, `output: any`
- `PatchPart`: `{ id, type: "patch", file, patch }`
- `StepStartPart` / `StepFinishPart`: `{ cost, tokens: { input, output, reasoning, cache } }`

---

## 3. Remote Architecture Decision

1. **Changed Files & Diff**:
   - `SESSION_DIFF_GET` RPC is added to the protocol to query `GET /session/{sessionID}/diff`.
   - Returns real changed files with additions, deletions, status (`added`, `modified`, `deleted`), and unified diff patch text.
   - If no changes were made in the session, renders clean empty state.
2. **Terminal & Agent Activity**:
   - Extracted directly from OpenCode's real `ToolPart` items in the session history and live SSE events.
   - When the agent runs bash/commands, tool inputs, outputs, and exit statuses are rendered in the Terminal / Activity drawer.
   - Arbitrary interactive PTY is strictly omitted to preserve the Phase 2 security boundary (no remote root shell proxy).
3. **Workspace & Project Context**:
   - `WORKSPACE_GET` RPC is added to query `GET /project/current` and session summary stats.
   - Exposes project worktree, current git status, and session counts to the dashboard.
