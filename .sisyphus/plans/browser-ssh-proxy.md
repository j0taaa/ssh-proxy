# Browser SSH Proxy

## TL;DR
> **Summary**: Build a greenfield TypeScript browser SSH proxy with a Next.js terminal UI and a separate long-lived Node SSH gateway. The first version supports username/password SSH to arbitrary user-entered targets, WSS primary transport, SSE+POST HTTP fallback, localStorage password remembering, production Docker files, and full automated QA.
> **Deliverables**:
> - Next.js app with xterm.js browser terminal and connection form
> - Node TypeScript SSH gateway using `ssh2`
> - Shared framed protocol used by WSS and SSE+POST transports
> - Full TypeScript/lint/test/Playwright/CI setup
> - Docker production artifacts and smoke validation
> - README/runbook with explicit warnings for no app auth, localStorage passwords, and auto-accepted host keys
> **Effort**: Large
> **Parallel**: YES - 5 waves
> **Critical Path**: Task 1 → Task 2 → Tasks 3-5 → Tasks 6-8 → Tasks 9-12 → Final Verification

## Context

### Original Request
- Project is intended to work on restrictive networks that block direct SSH, large requests, unsafe connections, and some socket types.
- User wants a TypeScript proxy server allowing SSH from the browser.
- User suggested Next.js with xterm.js.
- Must support SSH login + password authentication.

### Interview Summary
- Architecture: Next.js UI/API plus a separate long-lived Node SSH gateway.
- Transport: WebSocket over HTTPS/WSS primary, plus SSE downlink + small POST uplink HTTP fallback in the initial version.
- SSH target: arbitrary host/port/username entered in the frontend.
- Credential handling: server keeps SSH passwords in memory for active sessions; browser may remember passwords in `localStorage`.
- Host keys: auto-accept, explicitly marked insecure/MITM-vulnerable.
- App access: no built-in auth; deployment must be localhost/private/reverse-proxy protected.
- Testing: full QA setup from scratch.
- Deployment: create production Docker files; development/testing uses normal dev server commands.

### Metis Review (gaps addressed)
- Added concrete runtime topology: Next.js dev server on `3000`, gateway on `3001`, Docker Compose binds both to `127.0.0.1` by default.
- Added concrete session lifecycle: create on connect submit, cleanup on disconnect/tab close/idle, `15m` idle timeout, `8h` max session duration, `15s` SSH connect timeout.
- Added concrete transport negotiation: try WSS first, fallback to SSE+POST after failed connection or explicit `forceHttp=true` mode.
- Added protocol contract: JSON frames, base64 terminal payloads, max `4096` raw bytes per data frame, heartbeats every `25s`.
- Added security warning placement: README, UI warning banner, gateway startup log.
- Added target validation while still allowing arbitrary/private/localhost targets.

## Work Objectives

### Core Objective
Create a working, tested browser SSH terminal that bridges browser terminal I/O to server-side password-authenticated SSH sessions over restrictive-network-friendly HTTPS transports.

### Deliverables
- Greenfield TypeScript project scaffold.
- Next.js browser UI using `@xterm/xterm` and `@xterm/addon-fit`.
- Node gateway using `ssh2` with password auth, PTY shell, keepalives, and cleanup.
- Shared protocol package for connect/input/resize/output/error/close/heartbeat frames.
- WSS transport and SSE+POST fallback transport.
- Mock SSH server test harness.
- Playwright browser tests.
- Dockerfile(s), Docker Compose production file, healthchecks, and smoke script.
- CI workflow running install, typecheck, lint, unit/integration tests, Playwright, and Docker smoke.
- README with run, test, Docker, and security warning sections.

### Definition of Done (verifiable conditions with commands)
- `npm install` succeeds from repo root.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm test` passes.
- `npm run test:e2e` passes using a mocked SSH server.
- `npm run docker:smoke` builds and smoke-tests production Docker artifacts.
- Browser E2E verifies WSS terminal flow and forced SSE+POST fallback flow.
- README documents the exact unsafe decisions: no app auth, localStorage password storage, auto-accepted host keys, arbitrary targets.

### Must Have
- Password SSH auth only: `host`, `port`, `username`, `password`.
- Arbitrary frontend-defined SSH targets, including private IPs and localhost from the gateway host.
- Validation for malformed host, invalid port, empty username, empty password, frame size, and unsupported frame type.
- WSS first, automatic SSE+POST fallback, and manual force-fallback toggle/query support.
- `localStorage` remembering only when user explicitly checks “Remember password on this browser”.
- UI warnings visible before connecting.
- Server-side password redaction in all logs/errors.
- Terminal resize support.
- Unicode and multiline paste support.
- Heartbeats for reverse proxy idle timeouts.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Do not implement SSH key auth.
- Do not implement SFTP/file transfer.
- Do not implement SSH port forwarding.
- Do not implement terminal recording.
- Do not implement multi-user accounts, RBAC, admin allowlists, or database persistence.
- Do not attempt WebSocket upgrades inside Next.js App Router route handlers.
- Do not use Edge runtime for SSH or gateway code.
- Do not log passwords, terminal input, raw terminal output, or full SSH error payloads containing secrets.
- Do not silently pretend unsafe decisions are safe; warn in UI, README, and gateway startup logs.

## Protocol Contract

### Runtime Topology
- Development:
  - Next.js app: `http://localhost:3000`
  - Gateway: `http://localhost:3001`
  - Browser gateway base URL: `NEXT_PUBLIC_GATEWAY_URL=http://localhost:3001`
- Production Docker:
  - `web` service listens on container port `3000`, host binding `127.0.0.1:3000:3000` by default.
  - `gateway` service listens on container port `3001`, host binding `127.0.0.1:3001:3001` by default.
  - External HTTPS/443 reverse proxy is deployment responsibility and must proxy WSS/SSE/POST to the gateway.

### Transport URLs
- WSS primary: `GET /ws/terminal` with WebSocket upgrade.
- SSE downlink fallback: `GET /sse/terminal/:sessionId/events`.
- POST uplink fallback: `POST /sse/terminal/:sessionId/input`.
- Session create for HTTP fallback: `POST /sessions`.
- Health: `GET /healthz` returns `200` JSON `{ "ok": true }`.

### Frame Schema
- All frames are JSON objects with `type`, `sessionId`, `seq`, and optional payload fields.
- `connect`: `{ type: "connect", host, port, username, password, cols, rows }`.
- `input`: `{ type: "input", dataBase64 }` where decoded bytes are max `4096`.
- `resize`: `{ type: "resize", cols, rows }`, valid cols `20-300`, rows `5-120`.
- `output`: `{ type: "output", dataBase64 }`, decoded chunk max `4096`.
- `error`: `{ type: "error", code, message }`, message must be sanitized.
- `close`: `{ type: "close", reason }`.
- `ping` / `pong`: heartbeat frames every `25s`.

### Timeouts and Limits
- SSH connect timeout: `15s`.
- Idle timeout: `15m` since last input/output/heartbeat.
- Max session duration: `8h`.
- Max concurrent sessions in this single-user build: `5`.
- Max POST body: `8KiB`.
- WSS fallback delay: if WSS cannot open within `3s` or closes before `connect_ack`, try SSE+POST automatically.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: Full QA setup with TypeScript, ESLint, Vitest, Playwright, mocked SSH server, CI, and Docker smoke.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 scaffold, Task 2 protocol contract, Task 12 docs skeleton.
Wave 2: Task 3 gateway SSH core, Task 4 WSS transport, Task 5 SSE+POST fallback.
Wave 3: Task 6 connection UI, Task 7 xterm terminal, Task 8 frontend transport integration.
Wave 4: Task 9 integration tests, Task 10 Playwright E2E, Task 11 Docker/CI.
Wave 5: Final verification wave F1-F4.

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 2-12.
- Task 2 blocks Tasks 3-10.
- Task 3 blocks Tasks 4, 5, 9, 10, 11.
- Task 4 blocks Tasks 8, 9, 10.
- Task 5 blocks Tasks 8, 9, 10.
- Task 6 blocks Tasks 8, 10.
- Task 7 blocks Tasks 8, 10.
- Task 8 blocks Tasks 10, 11.
- Task 9 blocks Task 11 and Final Verification.
- Task 10 blocks Final Verification.
- Task 11 blocks Final Verification.
- Task 12 blocks Final Verification.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → unspecified-high, deep, writing.
- Wave 2 → 3 tasks → deep, unspecified-high.
- Wave 3 → 3 tasks → visual-engineering, unspecified-high.
- Wave 4 → 3 tasks → unspecified-high, visual-engineering.
- Wave 5 → 4 review tasks → oracle, unspecified-high, deep.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Scaffold TypeScript Next.js + Gateway Monorepo

  **What to do**: Create the greenfield project structure with npm workspaces: `apps/web` for Next.js, `apps/gateway` for the Node gateway, and `packages/protocol` for shared frames/validation. Add root `package.json`, `tsconfig.base.json`, workspace scripts, ESLint, Prettier config if needed by lint, Vitest, Playwright config, and `.github/workflows/ci.yml`. Scripts must include `dev`, `dev:web`, `dev:gateway`, `typecheck`, `lint`, `test`, `test:e2e`, `docker:smoke`.
  **Must NOT do**: Do not implement SSH behavior, terminal UI, transports, auth systems, database persistence, or Docker production files in this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Greenfield repo setup touches package structure, scripts, and CI.
  - Skills: `[]` - No specialized skill required.
  - Omitted: [`visual-engineering`] - No UI implementation in this task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Tasks 2-12 | Blocked By: none

  **References**:
  - Repo baseline: `README.md:1` - currently only `# ssh-proxy`; treat as blank repo.
  - Requirement source: `.sisyphus/drafts/browser-ssh-proxy.md:23` - no package/source/test infra exists.
  - External: `https://nextjs.org/docs` - Next.js project conventions.
  - External: `https://playwright.dev/docs/intro` - Playwright setup.

  **Acceptance Criteria**:
  - [ ] `npm install` succeeds.
  - [ ] `npm run typecheck` succeeds on empty scaffold.
  - [ ] `npm run lint` succeeds on empty scaffold.
  - [ ] `npm test` succeeds with at least one placeholder protocol/scaffold test.
  - [ ] `npm run test:e2e` is wired and can run a placeholder browser test without SSH.

  **QA Scenarios**:
  ```
  Scenario: Scaffold commands work
    Tool: Bash
    Steps: Run `npm install`, `npm run typecheck`, `npm run lint`, `npm test`.
    Expected: All commands exit 0.
    Evidence: .sisyphus/evidence/task-1-scaffold-commands.txt

  Scenario: Missing implementation does not pretend to work
    Tool: Bash
    Steps: Run `npm run dev:gateway` only after scaffold; request `GET http://localhost:3001/healthz` if gateway placeholder exists.
    Expected: Either documented placeholder health returns 200 or command clearly states gateway implementation is pending; no fake SSH success path exists.
    Evidence: .sisyphus/evidence/task-1-scaffold-placeholder.txt
  ```

  **Commit**: YES | Message: `chore(scaffold): initialize TypeScript workspace` | Files: `package.json`, `package-lock.json`, `apps/**`, `packages/**`, config files, `.github/workflows/ci.yml`

- [x] 2. Implement Shared Framed Protocol and Validation

  **What to do**: In `packages/protocol`, define TypeScript types, runtime validators, constants, and tests for all frame types: `connect`, `connect_ack`, `input`, `resize`, `output`, `error`, `close`, `ping`, `pong`. Use JSON frames with base64 terminal data. Enforce max decoded data frame `4096` bytes, max POST body assumption `8KiB`, resize bounds cols `20-300`, rows `5-120`, port `1-65535`, nonempty host/username/password. Include sanitized error-code enum: `VALIDATION_ERROR`, `SSH_AUTH_FAILED`, `SSH_CONNECT_FAILED`, `SSH_TIMEOUT`, `SESSION_CLOSED`, `FRAME_TOO_LARGE`, `INTERNAL_ERROR`.
  **Must NOT do**: Do not add networking code, SSH code, UI code, or schema fields not listed in the Protocol Contract.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: This is the contract every transport and test depends on.
  - Skills: `[]` - No specialized skill required.
  - Omitted: [`visual-engineering`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Tasks 3-10 | Blocked By: Task 1

  **References**:
  - Protocol Contract: `.sisyphus/plans/browser-ssh-proxy.md` - use exact schema and limits above.
  - Research: `.sisyphus/drafts/browser-ssh-proxy.md:25` - restrictive networks require HTTPS/443 and small framed messages.

  **Acceptance Criteria**:
  - [ ] `npm test --workspace packages/protocol` covers valid and invalid frames.
  - [ ] Invalid host, port, empty username, empty password, invalid resize, unknown frame type, and too-large data frame are rejected.
  - [ ] Base64 encode/decode helpers round-trip Unicode and multiline pasted input.

  **QA Scenarios**:
  ```
  Scenario: Valid connect and input frames pass
    Tool: Bash
    Steps: Run `npm test --workspace packages/protocol -- --run`.
    Expected: Tests for valid `connect`, `input`, and `resize` frames pass.
    Evidence: .sisyphus/evidence/task-2-protocol-valid.txt

  Scenario: Oversized frame fails
    Tool: Bash
    Steps: Run protocol test that validates a base64 payload decoding to 4097 bytes.
    Expected: Validator returns `FRAME_TOO_LARGE` and does not produce a valid frame.
    Evidence: .sisyphus/evidence/task-2-protocol-oversize.txt
  ```

  **Commit**: YES | Message: `feat(protocol): define terminal frame contract` | Files: `packages/protocol/**`

- [x] 3. Build Node SSH Gateway Session Core

  **What to do**: In `apps/gateway`, implement an HTTP server process with `/healthz`, session manager, `ssh2.Client` password auth, PTY shell creation, keepalive settings, timeout cleanup, redacted logging, and sanitized errors. SSH sessions are created from validated `connect` frames. Allocate PTY using initial `cols`/`rows`; resize active channel on `resize`. Keep password only in memory during active connection and delete session state on close. Auto-accept host keys and log a startup warning that this is insecure.
  **Must NOT do**: Do not add app auth, host allowlists, SSH key auth, file transfer, port forwarding, terminal recording, or database/session persistence.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Long-lived SSH session handling, cleanup, and security-sensitive logging.
  - Skills: `[]` - No specialized skill required.
  - Omitted: [`visual-engineering`] - No frontend.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Tasks 4, 5, 9, 10, 11 | Blocked By: Tasks 1, 2

  **References**:
  - External: `https://github.com/mscdex/ssh2` - `ssh2.Client`, password auth, `shell`, keepalive, host verification behavior.
  - Decision: `.sisyphus/drafts/browser-ssh-proxy.md:15` - arbitrary frontend-defined targets.
  - Decision: `.sisyphus/drafts/browser-ssh-proxy.md:16` - auto-accept host keys with warnings.

  **Acceptance Criteria**:
  - [ ] `npm run dev:gateway` starts on port `3001` by default.
  - [ ] `GET /healthz` returns `200` and `{ "ok": true }`.
  - [ ] Integration test with mocked SSH server authenticates `testuser`/`testpass`, opens PTY shell, sends input, receives known output.
  - [ ] Bad password returns sanitized `SSH_AUTH_FAILED` without logging the password.
  - [ ] Session cleanup occurs on explicit close, SSH close, and idle timeout.

  **QA Scenarios**:
  ```
  Scenario: Mock SSH shell works
    Tool: Bash
    Steps: Start gateway test harness with mock SSH server on localhost; run gateway integration test using host `127.0.0.1`, mock port, username `testuser`, password `testpass`, command input `echo ok\n`.
    Expected: Test receives terminal output containing `ok` and gateway closes cleanly.
    Evidence: .sisyphus/evidence/task-3-gateway-happy.txt

  Scenario: Bad credentials are sanitized
    Tool: Bash
    Steps: Run integration test using password `wrongpass`; capture gateway logs.
    Expected: Client receives `SSH_AUTH_FAILED`; logs do not contain `wrongpass` or `testpass`.
    Evidence: .sisyphus/evidence/task-3-gateway-auth-error.txt
  ```

  **Commit**: YES | Message: `feat(gateway): add password SSH session core` | Files: `apps/gateway/**`

- [ ] 4. Implement WSS Terminal Transport

  **What to do**: Add WebSocket endpoint `GET /ws/terminal` to the gateway using Node runtime. Authenticate nothing by design. Accept validated frames only. On `connect`, create SSH session; on `input`, write decoded bytes to SSH channel; on `resize`, resize PTY; on SSH data, emit `output`; send `ping`/`pong` heartbeats every `25s`; close and cleanup on errors. Return `connect_ack` only after SSH shell is ready.
  **Must NOT do**: Do not implement fallback logic in this task beyond shared transport interface hooks; do not use Next.js App Router WebSocket upgrades.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Networking and stream lifecycle implementation.
  - Skills: `[]` - No specialized skill required.
  - Omitted: [`visual-engineering`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Tasks 8, 9, 10 | Blocked By: Tasks 1, 2, 3

  **References**:
  - External: `https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API` - WebSocket behavior.
  - Research: `.sisyphus/drafts/browser-ssh-proxy.md:28` - separate Node gateway instead of Next App Router upgrade.

  **Acceptance Criteria**:
  - [ ] WSS integration test connects, receives `connect_ack`, sends input, receives output.
  - [ ] Resize frame invokes gateway/session resize without crashing before/after shell readiness.
  - [ ] Invalid frame closes or errors with sanitized `VALIDATION_ERROR`.
  - [ ] Heartbeat prevents idle close during active socket test.

  **QA Scenarios**:
  ```
  Scenario: WSS interactive round trip
    Tool: Bash
    Steps: Run WSS integration test against mock SSH server; send `printf wss-ok\n` via `input` frame.
    Expected: WebSocket receives `output` frame containing `wss-ok` before close.
    Evidence: .sisyphus/evidence/task-4-wss-roundtrip.txt

  Scenario: Invalid WSS frame is rejected
    Tool: Bash
    Steps: Send WebSocket frame `{ "type": "input", "dataBase64": "not-base64***" }`.
    Expected: Gateway sends sanitized `error` with `VALIDATION_ERROR` or closes with documented code; no crash.
    Evidence: .sisyphus/evidence/task-4-wss-invalid.txt
  ```

  **Commit**: YES | Message: `feat(gateway): add websocket terminal transport` | Files: `apps/gateway/**`, `packages/protocol/**`

- [ ] 5. Implement SSE + POST HTTP Fallback Transport

  **What to do**: Add HTTP fallback endpoints: `POST /sessions` creates SSH session and returns `sessionId` after shell readiness; `GET /sse/terminal/:sessionId/events` streams `output`, `error`, `close`, and heartbeat events; `POST /sse/terminal/:sessionId/input` accepts `input`, `resize`, and `close` frames. Enforce `8KiB` POST body limit and `4096` decoded data frame limit. SSE disconnect should not immediately kill SSH; cleanup after idle timeout or explicit close.
  **Must NOT do**: Do not add long-polling, WebTransport, WebRTC, Socket.IO, database-backed sessions, or reconnect/resume beyond SSE reconnect to the same in-memory session.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: HTTP fallback must preserve bidirectional terminal semantics under constraints.
  - Skills: `[]` - No specialized skill required.
  - Omitted: [`visual-engineering`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Tasks 8, 9, 10 | Blocked By: Tasks 1, 2, 3

  **References**:
  - External: `https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events` - SSE is server-to-client only.
  - Metis addition: `.sisyphus/plans/browser-ssh-proxy.md` - SSE downlink + POST uplink decision.

  **Acceptance Criteria**:
  - [ ] HTTP fallback integration test creates session, receives output over SSE, sends input over POST, and receives command output.
  - [ ] POST body over `8KiB` returns `413` or protocol `FRAME_TOO_LARGE` without writing to SSH.
  - [ ] SSE reconnect to same active session resumes output stream until idle timeout.
  - [ ] Explicit close POST closes SSH channel and removes session.

  **QA Scenarios**:
  ```
  Scenario: SSE+POST interactive round trip
    Tool: Bash
    Steps: Run fallback integration test; `POST /sessions` with mock SSH credentials, open SSE stream, POST input `printf http-ok\n`.
    Expected: SSE receives `output` event containing `http-ok`.
    Evidence: .sisyphus/evidence/task-5-sse-post-roundtrip.txt

  Scenario: Oversized POST is blocked
    Tool: Bash
    Steps: POST an `input` frame whose decoded data is 4097 bytes or whose body exceeds 8KiB.
    Expected: Gateway rejects with documented error and mock SSH server receives no data.
    Evidence: .sisyphus/evidence/task-5-sse-post-oversize.txt
  ```

  **Commit**: YES | Message: `feat(gateway): add sse post fallback transport` | Files: `apps/gateway/**`, `packages/protocol/**`

- [ ] 6. Build Next.js Connection UI with Unsafe-Mode Warnings

  **What to do**: In `apps/web`, create the main page with host, port, username, password fields, “Remember password on this browser” checkbox, “Force HTTP fallback” checkbox, connect/disconnect controls, connection status, and persistent localStorage profile/password behavior. Save password to `localStorage` only if checkbox is checked. Load remembered values on page load. Show prominent warnings before connect: no app auth, arbitrary targets allowed, localStorage password storage is unsafe, host keys auto-accepted.
  **Must NOT do**: Do not add login/auth to the app, user accounts, encryption passphrase flow, SSH key fields, SFTP/file transfer controls, or host allowlist UI.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Browser UI, validation UX, and warning clarity.
  - Skills: [`playwright`] - Browser behavior must be verified.
  - Omitted: [`git-master`] - Not a git history task.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Tasks 8, 10 | Blocked By: Tasks 1, 2

  **References**:
  - Decision: `.sisyphus/drafts/browser-ssh-proxy.md:20` - no app authentication.
  - Decision: `.sisyphus/drafts/browser-ssh-proxy.md:37` - browser localStorage remembered password option.
  - External: `https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage` - browser localStorage behavior.

  **Acceptance Criteria**:
  - [ ] Form validates empty host, invalid port, empty username, empty password before network calls.
  - [ ] Checking remember stores host/port/username/password in `localStorage`; unchecking removes password.
  - [ ] Force HTTP fallback checkbox is available and passes mode to transport client.
  - [ ] Unsafe warnings are visible in the UI before connecting.

  **QA Scenarios**:
  ```
  Scenario: Remember password stores localStorage
    Tool: Playwright
    Steps: Open `http://localhost:3000`; fill host `127.0.0.1`, port `2222`, username `testuser`, password `testpass`; check `Remember password on this browser`; reload page.
    Expected: Fields are restored including password; warning remains visible.
    Evidence: .sisyphus/evidence/task-6-localstorage.png

  Scenario: Invalid form blocks connect
    Tool: Playwright
    Steps: Open app; leave host blank and port `99999`; click Connect.
    Expected: Inline validation errors appear and no gateway request is made.
    Evidence: .sisyphus/evidence/task-6-invalid-form.png
  ```

  **Commit**: YES | Message: `feat(web): add ssh connection form` | Files: `apps/web/**`

- [ ] 7. Build xterm.js Terminal Component

  **What to do**: Add a client-only React component using `@xterm/xterm` and `@xterm/addon-fit`. Initialize `Terminal` in `useEffect`, open on a `ref`, load `FitAddon`, use `ResizeObserver`, debounce fit/resize, emit `onInput` from `terminal.onData`, emit `onResize` when cols/rows change, render output via `terminal.write`, and dispose terminal/addons on unmount. Import xterm CSS in the client-supported location.
  **Must NOT do**: Do not initialize xterm during server render, do not log terminal input/output, do not add terminal recording, file transfer, or clipboard auto-read.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Client-only terminal UI and resize behavior.
  - Skills: [`playwright`] - Browser terminal rendering must be verified.
  - Omitted: [`deep`] - Protocol/gateway complexity is handled elsewhere.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Tasks 8, 10 | Blocked By: Tasks 1, 2

  **References**:
  - External: `https://github.com/xtermjs/xterm.js` - `Terminal`, `open`, `onData`, `write`, `dispose`.
  - External: `https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit` - `FitAddon`.
  - Research: `.sisyphus/drafts/browser-ssh-proxy.md:27` - xterm.js client-only and addon-fit recommendation.

  **Acceptance Criteria**:
  - [ ] Component renders only client-side without Next.js hydration errors.
  - [ ] Input callback fires for typed text and multiline paste.
  - [ ] Output writes Unicode and ANSI text into terminal.
  - [ ] Resize callback emits changed cols/rows and ignores duplicate dimensions.
  - [ ] Unmount disposes terminal and observers.

  **QA Scenarios**:
  ```
  Scenario: Terminal renders and accepts input
    Tool: Playwright
    Steps: Open terminal test page/story; click terminal; type `hello`; paste `line1\nline2`.
    Expected: Test harness records input callbacks for typed and pasted data.
    Evidence: .sisyphus/evidence/task-7-terminal-input.png

  Scenario: Resize emits dimensions
    Tool: Playwright
    Steps: Resize viewport from 1280x720 to 900x600 on terminal test page.
    Expected: Test harness records a resize event with cols/rows in allowed bounds.
    Evidence: .sisyphus/evidence/task-7-terminal-resize.png
  ```

  **Commit**: YES | Message: `feat(web): add xterm terminal component` | Files: `apps/web/**`

- [ ] 8. Integrate Frontend Transport Client with UI and Terminal

  **What to do**: Implement a frontend transport client that tries WSS first and falls back to SSE+POST after `3s`, WSS failure, or force-fallback setting. Wire connection form to create sessions, wire xterm input/resize to protocol frames, wire output/error/close frames to terminal/status UI, and support explicit disconnect. Use gateway URL from `NEXT_PUBLIC_GATEWAY_URL`, default `http://localhost:3001` in dev. Convert terminal strings to/from base64 frame payloads through `packages/protocol` helpers.
  **Must NOT do**: Do not add app auth, backend credential persistence, reconnect/resume beyond current SSE reconnect behavior, or unbounded frame buffering.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Cross-cutting frontend state, transport negotiation, and terminal integration.
  - Skills: [`playwright`] - Browser transport behavior must be verified.
  - Omitted: [`writing`] - Not primarily documentation.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Tasks 10, 11 | Blocked By: Tasks 2, 4, 5, 6, 7

  **References**:
  - Protocol Contract: `.sisyphus/plans/browser-ssh-proxy.md` - exact frames, URLs, timeouts.
  - External: `https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API` - browser WebSocket.
  - External: `https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events` - EventSource fallback.

  **Acceptance Criteria**:
  - [ ] Default mode attempts WSS first and records connected transport in UI.
  - [ ] Force fallback uses SSE+POST without opening WSS.
  - [ ] WSS failure within `3s` automatically falls back to SSE+POST.
  - [ ] Terminal input, output, resize, error, and close states work in both transports.

  **QA Scenarios**:
  ```
  Scenario: WSS selected by default
    Tool: Playwright
    Steps: Start web, gateway, mock SSH; open app; fill `127.0.0.1`, mock port, `testuser`, `testpass`; click Connect.
    Expected: Status shows WSS connected and terminal displays mock shell prompt/output.
    Evidence: .sisyphus/evidence/task-8-wss-ui.png

  Scenario: Forced HTTP fallback works
    Tool: Playwright
    Steps: Start web, gateway, mock SSH; check Force HTTP fallback; connect with same credentials; type `echo fallback`.
    Expected: Status shows HTTP fallback/SSE+POST and terminal displays `fallback`.
    Evidence: .sisyphus/evidence/task-8-http-fallback-ui.png
  ```

  **Commit**: YES | Message: `feat(web): connect terminal transports` | Files: `apps/web/**`, `packages/protocol/**`

- [ ] 9. Add Mock SSH Server and Integration Test Coverage

  **What to do**: Add a deterministic test harness with a mock SSH server that accepts `testuser`/`testpass`, rejects other credentials, emits a predictable prompt, echoes commands, supports PTY shell, and records resize/input events. Cover gateway core, WSS, SSE+POST, validation errors, unreachable host, timeout, tab/network-style disconnect, large output bursts, Unicode, multiline paste, and cleanup.
  **Must NOT do**: Do not require real external SSH hosts or network access outside localhost tests.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Integration tests across SSH, streams, and transports.
  - Skills: `[]` - No specialized skill required.
  - Omitted: [`visual-engineering`] - Browser E2E handled in Task 10.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Task 11, Final Verification | Blocked By: Tasks 3, 4, 5

  **References**:
  - External: `https://github.com/mscdex/ssh2` - can be used for client behavior; mock server may use `ssh2.Server` if suitable.
  - Missing acceptance from Metis: `.sisyphus/plans/browser-ssh-proxy.md` - mocked SSH integration required.

  **Acceptance Criteria**:
  - [ ] `npm test` runs integration tests without external SSH dependencies.
  - [ ] Tests cover successful WSS and SSE+POST shell round trips.
  - [ ] Tests cover bad credentials, invalid host/port, oversized frame, timeout/unreachable host, large output burst, Unicode, multiline paste, and cleanup.
  - [ ] Tests prove passwords are not present in captured gateway logs.

  **QA Scenarios**:
  ```
  Scenario: Full integration suite passes
    Tool: Bash
    Steps: Run `npm test` from repo root.
    Expected: All unit and integration tests pass with mock SSH server only.
    Evidence: .sisyphus/evidence/task-9-integration-suite.txt

  Scenario: Cleanup after disconnect
    Tool: Bash
    Steps: Run integration test that opens a session, sends input, closes transport, then queries/inspects session manager test hook.
    Expected: Session count returns to 0 and mock SSH channel is closed.
    Evidence: .sisyphus/evidence/task-9-cleanup.txt
  ```

  **Commit**: YES | Message: `test(gateway): add mocked ssh integration coverage` | Files: `apps/gateway/**`, `packages/protocol/**`, test files

- [ ] 10. Add Playwright End-to-End Browser QA

  **What to do**: Add Playwright tests that start web, gateway, and mock SSH server. Verify happy path over WSS, forced SSE+POST fallback, automatic WSS failure fallback, localStorage remembered password, invalid form validation, bad SSH credentials, terminal resize, Unicode output, multiline paste, and explicit disconnect cleanup. Use stable selectors/data attributes.
  **Must NOT do**: Do not require a real SSH server, real credentials, external network, or manual browser actions.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Browser-driven UI and terminal QA.
  - Skills: [`playwright`] - Required for browser testing.
  - Omitted: [`deep`] - Architecture already decided.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Final Verification | Blocked By: Tasks 6, 7, 8, 9

  **References**:
  - External: `https://playwright.dev/docs/test-configuration` - web server and test config.
  - UI decisions: `.sisyphus/drafts/browser-ssh-proxy.md:37` and `.sisyphus/drafts/browser-ssh-proxy.md:39` - localStorage password, no built-in app auth.

  **Acceptance Criteria**:
  - [ ] `npm run test:e2e` passes headless.
  - [ ] Playwright captures screenshots/traces on failure.
  - [ ] E2E verifies both transports using exact mock credentials: host `127.0.0.1`, mock port, username `testuser`, password `testpass`.
  - [ ] Bad credential test asserts visible sanitized error and closed session.

  **QA Scenarios**:
  ```
  Scenario: Browser WSS SSH terminal
    Tool: Playwright
    Steps: Start dev servers and mock SSH; open app; fill host `127.0.0.1`, mock port, username `testuser`, password `testpass`; click Connect; type `echo e2e-wss`.
    Expected: Terminal displays `e2e-wss`; status shows WSS connected.
    Evidence: .sisyphus/evidence/task-10-e2e-wss.png

  Scenario: Browser HTTP fallback SSH terminal
    Tool: Playwright
    Steps: Same setup; check Force HTTP fallback; connect; type `echo e2e-http`.
    Expected: Terminal displays `e2e-http`; status shows HTTP fallback/SSE+POST connected.
    Evidence: .sisyphus/evidence/task-10-e2e-http.png
  ```

  **Commit**: YES | Message: `test(e2e): verify browser ssh terminal flows` | Files: `apps/web/**`, `playwright.config.*`, E2E test files

- [ ] 11. Add Docker Production Files and Smoke Validation

  **What to do**: Add production Dockerfiles and `docker-compose.yml` for `web` and `gateway`. Bind host ports to `127.0.0.1` by default because app has no built-in auth. Add healthchecks for both services. Add `npm run docker:smoke` script that builds images, starts compose, waits for health, runs mocked SSH browser/integration smoke against the running containers, then tears down. README must explain that public exposure requires external HTTPS reverse proxy and protection.
  **Must NOT do**: Do not add Kubernetes, production database, automatic TLS certificate management, or app login/auth.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Production packaging plus automated validation.
  - Skills: `[]` - No specialized skill required.
  - Omitted: [`visual-engineering`] - UI already implemented.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Final Verification | Blocked By: Tasks 1, 3, 8, 9

  **References**:
  - Deployment decision: `.sisyphus/drafts/browser-ssh-proxy.md:19` - create Docker production files, test via dev server normally.
  - App access decision: `.sisyphus/drafts/browser-ssh-proxy.md:20` - no app auth, warn and bind/private proxy.

  **Acceptance Criteria**:
  - [ ] `docker compose build` succeeds.
  - [ ] `docker compose up -d` starts `web` and `gateway` healthy.
  - [ ] `npm run docker:smoke` exits 0 and tears down containers.
  - [ ] Compose binds services to `127.0.0.1` by default, not `0.0.0.0`.
  - [ ] README explains reverse proxy/HTTPS/443 requirement for real restrictive-network use.

  **QA Scenarios**:
  ```
  Scenario: Docker smoke succeeds
    Tool: Bash
    Steps: Run `npm run docker:smoke`.
    Expected: Images build, services become healthy, mocked SSH smoke passes, compose tears down.
    Evidence: .sisyphus/evidence/task-11-docker-smoke.txt

  Scenario: Docker ports are localhost-bound
    Tool: Bash
    Steps: Inspect `docker-compose.yml` and/or `docker compose config` output.
    Expected: Published ports use `127.0.0.1:3000:3000` and `127.0.0.1:3001:3001` or equivalent localhost binding.
    Evidence: .sisyphus/evidence/task-11-docker-bindings.txt
  ```

  **Commit**: YES | Message: `build(docker): add production compose smoke validation` | Files: `Dockerfile*`, `docker-compose.yml`, scripts, README updates

- [ ] 12. Write README Runbook and Security Warnings

  **What to do**: Expand `README.md` with project overview, architecture diagram/text, dev commands, test commands, Docker production instructions, reverse proxy guidance, transport behavior, protocol limits, and explicit unsafe-mode warnings. Warnings must say: no built-in app auth, localStorage password storage is unsafe, auto-accepted host keys are MITM-vulnerable, arbitrary targets can reach networks visible to the gateway, do not expose publicly without external protection. Document exclusions: no key auth, SFTP, port forwarding, RBAC, database persistence, terminal recording.
  **Must NOT do**: Do not claim this is safe for public multi-user use; do not document unimplemented features.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: Technical documentation and runbook clarity.
  - Skills: `[]` - No specialized skill required.
  - Omitted: [`visual-engineering`] - No UI implementation.

  **Parallelization**: Can Parallel: YES | Wave 1 and update again after Wave 4 | Blocks: Final Verification | Blocked By: Task 1 for initial structure; final update blocked by Tasks 3-11

  **References**:
  - Repo baseline: `README.md:1` - currently only project title.
  - User decisions: `.sisyphus/drafts/browser-ssh-proxy.md:9-21` - architecture, transport, credential, host key, testing, deployment, app access decisions.
  - External: `https://github.com/xtermjs/xterm.js` and `https://github.com/mscdex/ssh2` - library references.

  **Acceptance Criteria**:
  - [ ] README includes exact commands: `npm install`, `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run docker:smoke`.
  - [ ] README contains a clearly labeled “Unsafe by Design / Single-User Mode” section.
  - [ ] README documents ports `3000` and `3001`, gateway URL env var, and localhost Docker binding.
  - [ ] README exclusions match the Must NOT Have list.

  **QA Scenarios**:
  ```
  Scenario: README commands are executable
    Tool: Bash
    Steps: Run each documented non-destructive verification command from README.
    Expected: Commands exist and exit 0 after implementation.
    Evidence: .sisyphus/evidence/task-12-readme-commands.txt

  Scenario: Security warnings are present
    Tool: Bash
    Steps: Search README for `no built-in app auth`, `localStorage`, `auto-accept`, `MITM`, `arbitrary targets`, and `do not expose publicly`.
    Expected: All warning phrases or equivalent explicit warnings are present.
    Evidence: .sisyphus/evidence/task-12-readme-warnings.txt
  ```

  **Commit**: YES | Message: `docs: document browser ssh proxy runbook` | Files: `README.md`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
  - Verify every user decision and Metis guardrail is implemented exactly.
  - Verify no forbidden features were added.
  - Evidence: `.sisyphus/evidence/f1-plan-compliance.md`
- [ ] F2. Code Quality Review — unspecified-high
  - Run `npm run typecheck`, `npm run lint`, `npm test`.
  - Review stream cleanup, frame validation, and password redaction.
  - Evidence: `.sisyphus/evidence/f2-code-quality.md`
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
  - Run `npm run test:e2e` and manually drive browser through WSS and forced HTTP fallback against mock SSH.
  - Capture screenshots for successful terminal output and bad credential error.
  - Evidence: `.sisyphus/evidence/f3-manual-qa.md`
- [ ] F4. Scope Fidelity Check — deep
  - Verify no app auth, key auth, SFTP, port forwarding, RBAC, DB persistence, or terminal recording was introduced.
  - Verify README warns about unsafe decisions and public exposure.
  - Evidence: `.sisyphus/evidence/f4-scope-fidelity.md`

## Commit Strategy
- Commit after each task using the specified message.
- Do not commit `.env`, credentials, terminal recordings, SSH host secrets, or generated evidence unless explicitly requested.
- After final user approval, push only if explicitly instructed by the active execution instructions/environment.

## Success Criteria
- Browser can connect to a mock SSH server using username/password over WSS and SSE+POST fallback.
- Browser can remember connection details and password in `localStorage` when opted in.
- Gateway supports arbitrary user-entered host/port and validates malformed inputs.
- Gateway never logs SSH passwords.
- Auto-accepted host keys, no app auth, localStorage password storage, and arbitrary targets are all visibly documented as unsafe.
- All verification commands pass: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run docker:smoke`.
