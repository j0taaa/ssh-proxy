# F4 Scope Fidelity Check

VERDICT: APPROVE

## Scope Fidelity Summary

- No forbidden feature implementation was found in source, tests, scripts, Docker compose, README, or browser-ssh-proxy notepads.
- Rerun after the output chunking fix remains APPROVE: `apps/gateway/src/output-frame-chunks.ts` only splits outbound SSH output into base64 protocol-sized frames and the new WSS/SSE tests only assert chunk sizing and output reconstruction.
- Forbidden terms in `README.md` and notepads are exclusion/warning documentation, not implementation.
- SSH password authentication appears only in the gateway SSH session core and mock/smoke SSH servers.
- Password persistence is limited to opt-in browser `localStorage`; no backend database, file, or credential persistence was found.
- Docker Compose binds the web UI and gateway to localhost by default, and README warns against public exposure without external protection.
- Auto-accepted SSH host keys are explicitly warned as MITM-vulnerable in README, UI, and gateway startup logging.

## 2026-05-06 Rerun After Output Chunking Fix

VERDICT: APPROVE

### Output Chunking Scope Evidence

Command:

```bash
grep -RInE --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.yml' --include='*.json' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "output-frame-chunks|encodeOutputFrameChunks|DATA_FRAME_MAX_DECODED_BYTES|large output|protocol-sized" apps/gateway/src
```

Hits inspected:

```text
apps/gateway/src/terminal-ws.test.ts:50:  it("splits a single large SSH output chunk into protocol-sized output frames", async () => {
apps/gateway/src/terminal-ws.test.ts:65:    expect(outputs.map(decodedOutputByteLength).every((byteLength) => byteLength <= DATA_FRAME_MAX_DECODED_BYTES)).toBe(true);
apps/gateway/src/output-frame-chunks.ts:1:import { DATA_FRAME_MAX_DECODED_BYTES, encodeBase64 } from "@ssh-proxy/protocol";
apps/gateway/src/output-frame-chunks.ts:3:export function encodeOutputFrameChunks(chunk: Buffer): string[] {
apps/gateway/src/output-frame-chunks.ts:11:    if (currentBytes + characterBytes > DATA_FRAME_MAX_DECODED_BYTES && current.length > 0) {
apps/gateway/src/terminal-http.ts:18:import { encodeOutputFrameChunks } from "./output-frame-chunks.js";
apps/gateway/src/terminal-http.ts:115:      for (const dataBase64 of encodeOutputFrameChunks(chunk)) {
apps/gateway/src/terminal-http.test.ts:177:  it("splits a single large SSH output chunk into protocol-sized SSE output frames", async () => {
apps/gateway/src/terminal-http.test.ts:191:    expect(outputs.map(decodedOutputByteLength).every((byteLength) => byteLength <= DATA_FRAME_MAX_DECODED_BYTES)).toBe(true);
apps/gateway/src/terminal-ws.ts:21:import { encodeOutputFrameChunks } from "./output-frame-chunks.js";
apps/gateway/src/terminal-ws.ts:160:        for (const dataBase64 of encodeOutputFrameChunks(chunk)) {
```

Conclusion: The new helper only converts an SSH output `Buffer` to UTF-8 text and emits base64 strings whose decoded byte length stays within `DATA_FRAME_MAX_DECODED_BYTES`. Gateway transports use it only for outbound `output` frames. No auth, key auth, SFTP/file transfer, port forwarding, recording, persistence, Kubernetes, or TLS automation was introduced by the chunking fix or tests.

### Forbidden Source Implementation Sweep

Command:

```bash
grep -RInE --include='*.ts' --include='*.tsx' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "privateKey|publicKey|sftp|forwardOut|forwardIn|exec\(|subsys|tcpip|direct-tcpip|recording|replay|sqlite|postgres|database|sessionStorage|fs\." apps/web apps/gateway packages/protocol scripts tests
```

Hits inspected:

```text
apps/gateway/src/terminal-http.ts:257:  const match = /^\/sse\/terminal\/([^/]+)\/(events|input)$/.exec(pathname);
```

Conclusion: The only source hit is JavaScript regex `.exec()` for HTTP route parsing, not SSH exec or a forbidden feature.

### App Auth / Login / RBAC Sweep

Command:

```bash
grep -RInE --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.yml' --include='*.json' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "auth|login|RBAC|rbac|account|allowlist|api key|API key|jwt|cookie|session token|bcrypt|passport" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
```

Summary of hits inspected: README no-auth warnings/exclusions, UI warning text, SSH password-auth error handling/tests, mock SSH server `authentication` events, docker smoke mock SSH authentication, and notepad scope notes. No application login, accounts, RBAC, JWT/cookie session, API key, or allowlist implementation found.

### SSH Key Auth / SFTP / Port Forwarding / Recording / Kubernetes / TLS Automation

Commands:

```bash
grep -RInEi --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "privateKey|publicKey|hostVerifier|hostHash|key auth|SSH key authentication|Keyboard|agentForward|ssh-agent|identity" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
grep -RInEi --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "sftp|file transfer|scp|upload|download" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
grep -RInEi --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "forwardOut|forwardIn|port forwarding|forwarding|tcpip|direct-tcpip" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
grep -RInEi --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "recording|replay|transcript|capture|log.*input|log.*output" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
grep -RInEi --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "Kubernetes|k8s|helm|ingress|certbot|acme|letsencrypt|TLS automation|certificate management|https.*cert" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
```

Summary of hits inspected: README exclusions for SSH key auth, SFTP/file transfer, port forwarding, terminal recording/replay, database persistence, TLS certificate management, and Kubernetes; notepad scope notes; Playwright keyboard input calls; test helper names; and deployment-boundary notes. No forbidden implementation found.

### Password Auth, localStorage, and Backend Persistence Boundary

Commands:

```bash
grep -nE "password|context.method === \"password\"|privateKey|publicKey|hostKeys" apps/gateway/src/ssh-session.ts apps/gateway/src/test-utils/mock-ssh-server.ts scripts/docker-smoke.mjs
grep -RInE --include='*.ts' --include='*.tsx' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist "localStorage|getItem|setItem|removeItem" apps/web apps/gateway packages/protocol scripts tests
grep -nE "sessions = new Map|writeFile|appendFile|database|sqlite|postgres|localStorage" apps/gateway/src/session-manager.ts apps/gateway/src/*.ts
```

Key hits:

```text
apps/gateway/src/ssh-session.ts:175:        password: frame.password,
apps/gateway/src/test-utils/mock-ssh-server.ts:31:      if (context.method === "password" && context.username === "testuser" && context.password === "testpass") {
scripts/docker-smoke.mjs:72:      if (context.method === "password" && context.username === "testuser" && context.password === "testpass") {
apps/web/components/connection-form.tsx:44:      localStorage.getItem(STORAGE_KEYS.rememberPassword) === "true";
apps/web/components/connection-form.tsx:70:      localStorage.setItem(STORAGE_KEYS.password, fields.password);
apps/web/components/connection-form.tsx:72:      localStorage.removeItem(STORAGE_KEYS.password);
apps/web/components/connection-form.tsx:148:        localStorage.removeItem(STORAGE_KEYS.password);
apps/gateway/src/session-manager.ts:17:  private readonly sessions = new Map<string, SshSession>();
```

Conclusion: SSH client auth remains password-only in the gateway core and mock/smoke servers. Password persistence remains browser-only, opt-in localStorage and is removed when disabled. Backend sessions remain in an in-memory `Map`; no backend credential/database/file persistence found.

### Warning and Exclusion Coverage

Commands:

```bash
grep -nE "No built-in application authentication|localStorage password storage is unsafe|Auto-accepted SSH host keys|man-in-the-middle|Arbitrary SSH targets|Do not expose publicly|SSH key authentication|SFTP|port forwarding|Terminal recording|User accounts|Database persistence|TLS certificate|Kubernetes" README.md
grep -nE "127\.0\.0\.1.*3000|127\.0\.0\.1.*3001" docker-compose.yml README.md
grep -nE "hostVerifier|hostHash|SSH host keys|without verification|man-in-the-middle|MITM" apps/gateway/src/index.ts README.md apps/web/components/connection-form.tsx
```

Key hits:

```text
README.md:157:**No built-in application authentication.** Anyone who can reach the web UI or gateway can open SSH sessions to arbitrary hosts. The app has no login, no API keys, no user accounts, and no RBAC. Protect it at the network level: run it behind a firewall, on localhost, or behind a reverse proxy with external auth.
README.md:159:**localStorage password storage is unsafe.** If you check "Remember password on this browser," the password is stored in browser localStorage. Any script running on the same origin can read it.
README.md:161:**Auto-accepted SSH host keys.** The gateway accepts any SSH host key without verification. This means connections are vulnerable to man-in-the-middle attacks.
README.md:163:**Arbitrary SSH targets.** The gateway will attempt to connect to any host and port the user enters.
README.md:165:**Do not expose publicly without external protection.** This app is designed for localhost use or private networks.
README.md:171:- SSH key authentication (password only)
README.md:172:- SFTP or file transfer
README.md:173:- SSH port forwarding
README.md:174:- Terminal recording or session replay
README.md:175:- User accounts, RBAC, or admin allowlists
README.md:176:- Database persistence (sessions are in-memory only)
README.md:177:- Built-in TLS certificate management
README.md:178:- Kubernetes deployment manifests
docker-compose.yml:7:      - "127.0.0.1:${GATEWAY_PORT:-3001}:3001"
docker-compose.yml:30:      - "127.0.0.1:${WEB_PORT:-3000}:3000"
apps/gateway/src/index.ts:9:logger.warn("SSH host keys are accepted without verification in this development gateway.");
apps/web/components/connection-form.tsx:239:            SSH host keys are automatically accepted &mdash; connections are
apps/web/components/connection-form.tsx:240:            vulnerable to man-in-the-middle attacks
```

Conclusion: README warnings/exclusions, Docker localhost defaults, UI host-key MITM warning, and gateway startup host-key warning remain present.

## Commands Run

`rg --version`

Result: `rg` is unavailable in this environment (`/bin/bash: rg: command not found`), so evidence uses safe `grep` searches with `node_modules`, `.next`, and `dist` excluded.

## Forbidden-Scope Grep Evidence

### App Auth / Login / Users / RBAC

Command:

```bash
grep --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --include='*.ts' --include='*.tsx' --include='*.mjs' -RInE "auth|login|RBAC|rbac|account|allowlist|api key|API key|jwt|cookie|session token|bcrypt|passport" apps/web apps/gateway packages/protocol scripts tests
```

Hits inspected:

```text
apps/web/components/connection-form.tsx:227:            No built-in application authentication &mdash; anyone with
apps/gateway/src/session-manager.test.ts:62:  it("rejects bad passwords with sanitized auth failure and redacted logs", async () => {
apps/gateway/src/session-manager.test.ts:68:      await expect(manager.createSession(connectFrame("bad-auth-session", sshServer.port, { password: "wrongpass" }))).rejects.toMatchObject({
apps/gateway/src/errors.ts:25:    if (normalized.includes("authentication") || normalized.includes("auth")) {
apps/gateway/src/errors.ts:45:      return "SSH authentication failed.";
apps/gateway/src/test-utils/mock-ssh-server.ts:28:    client.on("authentication", (context: AuthContext) => {
apps/gateway/src/terminal-http.test.ts:117:  it("returns sanitized auth errors and keeps passwords out of gateway logs", async () => {
apps/gateway/src/terminal-http.test.ts:122:    const response = await postJson(`${gateway.url}/sessions`, connectFrame("http-bad-auth", sshServer.port, { password: "wrongpass" }));
apps/gateway/src/terminal-http.test.ts:125:    expect(await response.json()).toEqual({ error: ProtocolErrorCode.SshAuthFailed, message: "SSH authentication failed." });
scripts/docker-smoke.mjs:71:    client.on("authentication", (context) => {
tests/e2e/scaffold.spec.ts:11:    page.getByText("No built-in application authentication"),
```

Conclusion: Hits are warning UI/docs, SSH password-auth error handling, and mock SSH server authentication. No app login, account, RBAC, JWT/cookie session, allowlist, or API-key auth implementation found.

### SSH Key Auth

Command:

```bash
grep --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.yml' --include='*.json' -RInE "privateKey|publicKey|hostVerifier|hostHash|key auth|Keyboard|agentForward|ssh-agent|identity" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
```

Hits inspected:

```text
README.md:171:- SSH key authentication (password only)
.sisyphus/notepads/browser-ssh-proxy/learnings.md:95:- Required warning phrases (no built-in auth, localStorage, auto-accept, MITM, arbitrary targets, do not expose publicly) and required exclusions (SSH key auth, SFTP, port forwarding, terminal recording, RBAC, database persistence) all verified present by grep.
.sisyphus/notepads/browser-ssh-proxy/problems.md:24:- No unresolved Task 8 blockers remain. App auth, credential persistence beyond the existing optional localStorage checkbox, SSH key auth, SFTP, port forwarding, terminal recording, and reconnect/resume beyond existing SSE reconnect behavior remain out of scope.
.sisyphus/notepads/browser-ssh-proxy/problems.md:28:- No unresolved Task 9 blockers remain. Browser-driven SSH terminal E2E coverage, Docker production files, CI/Docker smoke validation, app auth, SSH key auth, SFTP, port forwarding, and terminal recording remain out of scope for later tasks.
.sisyphus/notepads/browser-ssh-proxy/problems.md:32:- No unresolved Task 10 blockers remain. App auth, credential persistence, SSH key auth, SFTP, port forwarding, terminal recording, Docker production files, README updates, and CI/Docker smoke validation remain out of scope.
.sisyphus/notepads/browser-ssh-proxy/problems.md:36:- No unresolved Task 11 blockers remain. External reverse proxy configuration, TLS certificate automation, app auth, SSH key auth, SFTP, port forwarding, terminal recording, and backend credential persistence remain out of scope.
```

Conclusion: Only exclusions/notepad scope notes. No SSH key auth implementation found.

### SFTP / File Transfer

Command:

```bash
grep --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.yml' --include='*.json' -RInE "sftp|file transfer|scp|upload|download" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
```

Hits inspected:

```text
README.md:172:- SFTP or file transfer
```

Conclusion: README exclusion only. No SFTP, SCP, upload, or download implementation found.

### Port Forwarding

Command:

```bash
grep --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.yml' --include='*.json' -RInE "forwardOut|forwardIn|port forwarding|forwarding|tcpip|direct-tcpip" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
```

Hits inspected:

```text
README.md:173:- SSH port forwarding
.sisyphus/notepads/browser-ssh-proxy/learnings.md:95:- Required warning phrases (no built-in auth, localStorage, auto-accept, MITM, arbitrary targets, do not expose publicly) and required exclusions (SSH key auth, SFTP, port forwarding, terminal recording, RBAC, database persistence) all verified present by grep.
.sisyphus/notepads/browser-ssh-proxy/problems.md:8:- No unresolved Task 4 blockers remain. Frontend transport integration, SSE/POST fallback, reconnect/resume, auth, key-based SSH auth, SFTP, port forwarding, and terminal recording remain out of scope for later tasks.
.sisyphus/notepads/browser-ssh-proxy/problems.md:12:- No unresolved Task 5 blockers remain. Frontend transport selection, reconnect behavior beyond attaching SSE to the same active in-memory session, persistence, auth hardening, SFTP, port forwarding, and terminal recording remain out of scope for later tasks.
.sisyphus/notepads/browser-ssh-proxy/problems.md:24:- No unresolved Task 8 blockers remain. App auth, credential persistence beyond the existing optional localStorage checkbox, SSH key auth, SFTP, port forwarding, terminal recording, and reconnect/resume beyond existing SSE reconnect behavior remain out of scope.
.sisyphus/notepads/browser-ssh-proxy/problems.md:28:- No unresolved Task 9 blockers remain. Browser-driven SSH terminal E2E coverage, Docker production files, CI/Docker smoke validation, app auth, SSH key auth, SFTP, port forwarding, and terminal recording remain out of scope for later tasks.
.sisyphus/notepads/browser-ssh-proxy/problems.md:32:- No unresolved Task 10 blockers remain. App auth, credential persistence, SSH key auth, SFTP, port forwarding, terminal recording, Docker production files, README updates, and CI/Docker smoke validation remain out of scope.
.sisyphus/notepads/browser-ssh-proxy/problems.md:36:- No unresolved Task 11 blockers remain. External reverse proxy configuration, TLS certificate automation, app auth, SSH key auth, SFTP, port forwarding, terminal recording, and backend credential persistence remain out of scope.
```

Conclusion: README/notepad exclusion notes only. No `forwardOut`, `forwardIn`, or forwarding implementation found.

### Terminal Recording / Replay

Command:

```bash
grep --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.yml' --include='*.json' -RInEi "recording|replay|transcript|capture|log.*input|log.*output" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
```

Hits inspected:

```text
README.md:174:- Terminal recording or session replay
apps/gateway/src/session-manager.test.ts:6:import { connectFrame, inputFrame, MemoryLogger, onceSessionClose, resizeFrame, waitForSessionOutput } from "./test-utils/gateway-test-utils.js";
.sisyphus/notepads/browser-ssh-proxy/learnings.md:42:- `POST /sessions` returns only `{ "sessionId": "..." }` after `SessionManager.createSession()` completes shell readiness, while `GET /sse/terminal/:sessionId/events` attaches only to live in-memory session output and does not replay output emitted before SSE subscription.
.sisyphus/notepads/browser-ssh-proxy/learnings.md:69:- WSS and HTTP fallback manual QA should type a live command after connection because HTTP SSE does not replay shell output emitted before the EventSource subscribes.
.sisyphus/notepads/browser-ssh-proxy/learnings.md:73:- Gateway integration tests now share `apps/gateway/src/test-utils/mock-ssh-server.ts`, a deterministic `ssh2.Server` harness with `testuser`/`testpass`, predictable prompt, command echo, resize recording, input recording, burst output, and channel-close tracking.
.sisyphus/notepads/browser-ssh-proxy/learnings.md:95:- Required warning phrases (no built-in auth, localStorage, auto-accept, MITM, arbitrary targets, do not expose publicly) and required exclusions (SSH key auth, SFTP, port forwarding, terminal recording, RBAC, database persistence) all verified present by grep.
.sisyphus/notepads/browser-ssh-proxy/problems.md:8:- No unresolved Task 4 blockers remain. Frontend transport integration, SSE/POST fallback, reconnect/resume, auth, key-based SSH auth, SFTP, port forwarding, and terminal recording remain out of scope for later tasks.
.sisyphus/notepads/browser-ssh-proxy/problems.md:12:- No unresolved Task 5 blockers remain. Frontend transport selection, reconnect behavior beyond attaching SSE to the same active in-memory session, persistence, auth hardening, SFTP, port forwarding, and terminal recording remain out of scope for later tasks.
.sisyphus/notepads/browser-ssh-proxy/problems.md:24:- No unresolved Task 8 blockers remain. App auth, credential persistence beyond the existing optional localStorage checkbox, SSH key auth, SFTP, port forwarding, terminal recording, and reconnect/resume beyond existing SSE reconnect behavior remain out of scope.
.sisyphus/notepads/browser-ssh-proxy/problems.md:28:- No unresolved Task 9 blockers remain. Browser-driven SSH terminal E2E coverage, Docker production files, CI/Docker smoke validation, app auth, SSH key auth, SFTP, port forwarding, and terminal recording remain out of scope for later tasks.
.sisyphus/notepads/browser-ssh-proxy/problems.md:32:- No unresolved Task 10 blockers remain. App auth, credential persistence, SSH key auth, SFTP, port forwarding, terminal recording, Docker production files, README updates, and CI/Docker smoke validation remain out of scope.
.sisyphus/notepads/browser-ssh-proxy/problems.md:36:- No unresolved Task 11 blockers remain. External reverse proxy configuration, TLS certificate automation, app auth, SSH key auth, SFTP, port forwarding, terminal recording, and backend credential persistence remain out of scope.
```

Conclusion: README exclusion, notepad explanations, test helper naming only. No terminal recording or replay feature found.

### Database / Backend Persistence / Storage

Command:

```bash
grep --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.yml' --include='*.json' -RInE "database|sql|sqlite|postgres|persistence|persist|storage|localStorage|sessionStorage|writeFile|appendFile|fs\." README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
```

Hits inspected:

```text
README.md:155:This project is a personal tool with deliberate security tradeoffs. Read this section before you deploy it.
README.md:159:**localStorage password storage is unsafe.** If you check "Remember password on this browser," the password is stored in browser localStorage. Any script running on the same origin can read it. This is a convenience tradeoff for a single-user personal tool. Do not enable it on shared machines.
README.md:176:- Database persistence (sessions are in-memory only)
apps/web/components/connection-form.tsx:44:      localStorage.getItem(STORAGE_KEYS.rememberPassword) === "true";
apps/web/components/connection-form.tsx:46:      host: localStorage.getItem(STORAGE_KEYS.host) || "",
apps/web/components/connection-form.tsx:47:      port: localStorage.getItem(STORAGE_KEYS.port) || DEFAULT_PORT,
apps/web/components/connection-form.tsx:48:      username: localStorage.getItem(STORAGE_KEYS.username) || "",
apps/web/components/connection-form.tsx:50:        ? localStorage.getItem(STORAGE_KEYS.password) || ""
apps/web/components/connection-form.tsx:62:    localStorage.setItem(STORAGE_KEYS.host, fields.host);
apps/web/components/connection-form.tsx:63:    localStorage.setItem(STORAGE_KEYS.port, fields.port);
apps/web/components/connection-form.tsx:64:    localStorage.setItem(STORAGE_KEYS.username, fields.username);
apps/web/components/connection-form.tsx:65:    localStorage.setItem(
apps/web/components/connection-form.tsx:70:      localStorage.setItem(STORAGE_KEYS.password, fields.password);
apps/web/components/connection-form.tsx:72:      localStorage.removeItem(STORAGE_KEYS.password);
apps/web/components/connection-form.tsx:148:        localStorage.removeItem(STORAGE_KEYS.password);
apps/web/components/connection-form.tsx:235:            Passwords stored in browser localStorage when remembered &mdash;
scripts/docker-smoke.mjs:2:import { mkdirSync, writeFileSync } from "node:fs";
scripts/docker-smoke.mjs:207:    writeFileSync(evidencePath, `${evidence.join("\n")}\n`);
scripts/sanitize-next-env.mjs:1:import { readFile, writeFile } from "node:fs/promises";
scripts/sanitize-next-env.mjs:14:  await writeFile(nextEnvPath, stableContent);
tests/e2e/global-setup.ts:1:import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
tests/e2e/global-setup.ts:70:  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
tests/e2e/ssh-terminal.spec.ts:143:  test("localStorage remembers password when checkbox is checked", async ({ page }) => {
```

Conclusion: Backend session state is `new Map<string, SshSession>()` in `apps/gateway/src/session-manager.ts:17`. Storage hits are browser opt-in localStorage, evidence/test-state file writes, and build sanitation scripts, not backend credential/session persistence.

### Kubernetes / TLS Automation

Command:

```bash
grep --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.yml' --include='*.json' -RInE "Kubernetes|k8s|helm|ingress|certbot|acme|letsencrypt|TLS automation|certificate management|https.*cert" README.md apps/web apps/gateway packages/protocol scripts tests .sisyphus/notepads/browser-ssh-proxy docker-compose.yml
```

Hits inspected:

```text
README.md:177:- Built-in TLS certificate management
README.md:178:- Kubernetes deployment manifests
.sisyphus/notepads/browser-ssh-proxy/decisions.md:4:- Kept compose localhost-bound by default and documented reverse proxy/HTTPS responsibility instead of adding auth or TLS automation, matching the task's no-auth deployment boundary.
```

Conclusion: README exclusions/notepad decision only. No Kubernetes manifests, Helm charts, certbot, ACME, Let's Encrypt, or TLS automation found.

### Source-Only Forbidden Implementation Sweep

Command:

```bash
grep --include='*.ts' --include='*.tsx' --include='*.mjs' -RInE "privateKey|publicKey|sftp|forwardOut|forwardIn|exec\(|subsys|tcpip|direct-tcpip|recording|replay|sqlite|postgres|database|sessionStorage|fs\." apps/web apps/gateway packages/protocol scripts tests --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist
```

Hits inspected:

```text
apps/gateway/src/terminal-http.ts:255:  const match = /^\/sse\/terminal\/([^/]+)\/(events|input)$/.exec(pathname);
```

Conclusion: The only source hit is JavaScript regex `.exec()` for route parsing, not SSH `exec` or a forbidden feature.

### Dependency Sweep

Command:

```bash
grep -RInE "sqlite|postgres|mysql|prisma|typeorm|sequelize|knex|mongoose|mongodb|redis|jsonwebtoken|passport|bcrypt|cookie|next-auth|authjs|kubernetes|certbot|acme" package.json package-lock.json apps/web/package.json apps/gateway/package.json packages/protocol/package.json
```

Hits inspected:

```text
package-lock.json:2328:    "node_modules/bcrypt-pbkdf": {
package-lock.json:2330:      "resolved": "https://registry.npmjs.org/bcrypt-pbkdf/-/bcrypt-pbkdf-1.0.2.tgz",
package-lock.json:3981:        "bcrypt-pbkdf": "^1.0.2"
```

Conclusion: `bcrypt-pbkdf` is transitive from SSH tooling, not app auth. No direct forbidden auth/database/Kubernetes/TLS automation dependencies found.

## Password Auth and Persistence Boundary Evidence

Command:

```bash
grep -nE "password|context.method === \"password\"|privateKey|publicKey|hostKeys" apps/gateway/src/ssh-session.ts apps/gateway/src/test-utils/mock-ssh-server.ts scripts/docker-smoke.mjs
```

Hits inspected:

```text
apps/gateway/src/ssh-session.ts:175:        password: frame.password,
apps/gateway/src/test-utils/mock-ssh-server.ts:22:  const server = new Server({ hostKeys: [hostKey] });
apps/gateway/src/test-utils/mock-ssh-server.ts:29:      if (context.method === "password" && context.username === "testuser" && context.password === "testpass") {
apps/gateway/src/test-utils/mock-ssh-server.ts:33:      context.reject(["password"]);
scripts/docker-smoke.mjs:64:  const server = new Server({ hostKeys: [hostKey] });
scripts/docker-smoke.mjs:72:      if (context.method === "password" && context.username === "testuser" && context.password === "testpass") {
scripts/docker-smoke.mjs:76:      context.reject(["password"]);
scripts/docker-smoke.mjs:156:    await page.getByTestId("password-input").fill("testpass");
```

Conclusion: Gateway production SSH connect uses only `password: frame.password`; mock/smoke servers accept only `context.method === "password"`. `hostKeys` only creates mock SSH server host keys for test/smoke servers, not client key auth.

Command:

```bash
grep --include='*.ts' --include='*.tsx' --include='*.mjs' -RInE "localStorage|setItem|getItem|removeItem" apps/web apps/gateway packages/protocol scripts tests --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist
```

Hits inspected:

```text
apps/web/components/connection-form.tsx:44:      localStorage.getItem(STORAGE_KEYS.rememberPassword) === "true";
apps/web/components/connection-form.tsx:46:      host: localStorage.getItem(STORAGE_KEYS.host) || "",
apps/web/components/connection-form.tsx:47:      port: localStorage.getItem(STORAGE_KEYS.port) || DEFAULT_PORT,
apps/web/components/connection-form.tsx:48:      username: localStorage.getItem(STORAGE_KEYS.username) || "",
apps/web/components/connection-form.tsx:50:        ? localStorage.getItem(STORAGE_KEYS.password) || ""
apps/web/components/connection-form.tsx:62:    localStorage.setItem(STORAGE_KEYS.host, fields.host);
apps/web/components/connection-form.tsx:63:    localStorage.setItem(STORAGE_KEYS.port, fields.port);
apps/web/components/connection-form.tsx:64:    localStorage.setItem(STORAGE_KEYS.username, fields.username);
apps/web/components/connection-form.tsx:65:    localStorage.setItem(
apps/web/components/connection-form.tsx:70:      localStorage.setItem(STORAGE_KEYS.password, fields.password);
apps/web/components/connection-form.tsx:72:      localStorage.removeItem(STORAGE_KEYS.password);
apps/web/components/connection-form.tsx:148:        localStorage.removeItem(STORAGE_KEYS.password);
apps/web/components/connection-form.tsx:235:            Passwords stored in browser localStorage when remembered &mdash;
tests/e2e/ssh-terminal.spec.ts:143:  test("localStorage remembers password when checkbox is checked", async ({ page }) => {
```

Conclusion: `localStorage` is confined to `apps/web/components/connection-form.tsx` browser UI and E2E coverage. The password is read only if `ssh-proxy-remember` is `true`, written only when the checkbox is checked, and removed otherwise.

## README Warning Coverage

Command:

```bash
grep -nE "No built-in application authentication|127\.0\.0\.1|localStorage password storage is unsafe|Auto-accepted SSH host keys|man-in-the-middle|SSH key authentication|SFTP|port forwarding|Terminal recording|Database persistence|TLS certificate|Kubernetes" README.md
```

Hits:

```text
README.md:134:- Web: `127.0.0.1:3000`
README.md:135:- Gateway: `127.0.0.1:3001`
README.md:157:**No built-in application authentication.** Anyone who can reach the web UI or gateway can open SSH sessions to arbitrary hosts. The app has no login, no API keys, no user accounts, and no RBAC. Protect it at the network level: run it behind a firewall, on localhost, or behind a reverse proxy with external auth.
README.md:159:**localStorage password storage is unsafe.** If you check "Remember password on this browser," the password is stored in browser localStorage. Any script running on the same origin can read it. This is a convenience tradeoff for a single-user personal tool. Do not enable it on shared machines.
README.md:161:**Auto-accepted SSH host keys.** The gateway accepts any SSH host key without verification. This means connections are vulnerable to man-in-the-middle attacks. An attacker on the network path between the gateway and the SSH target could intercept the session.
README.md:165:**Do not expose publicly without external protection.** This app is designed for localhost use or private networks. If you need to access it over the internet, you must add your own authentication layer (HTTP basic auth via reverse proxy, VPN, zero-trust network, or similar). The Docker compose file binds to `127.0.0.1` by default for this reason.
README.md:171:- SSH key authentication (password only)
README.md:172:- SFTP or file transfer
README.md:173:- SSH port forwarding
README.md:174:- Terminal recording or session replay
README.md:176:- Database persistence (sessions are in-memory only)
README.md:177:- Built-in TLS certificate management
README.md:178:- Kubernetes deployment manifests
README.md:185:| `HOST` | `127.0.0.1` | Gateway | HTTP listen host |
```

Conclusion: README contains required unsafe-decision warnings, public exposure warning, localhost binding documentation, and explicit forbidden-scope exclusions.

Command:

```bash
grep -nE "127\.0\.0\.1.*3000|127\.0\.0\.1.*3001" docker-compose.yml README.md
```

Hits:

```text
docker-compose.yml:7:      - "127.0.0.1:${GATEWAY_PORT:-3001}:3001"
docker-compose.yml:17:        - "node -e \"fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""
docker-compose.yml:28:        NEXT_PUBLIC_GATEWAY_URL: ${NEXT_PUBLIC_GATEWAY_URL:-http://127.0.0.1:3001}
docker-compose.yml:30:      - "127.0.0.1:${WEB_PORT:-3000}:3000"
docker-compose.yml:35:      NEXT_PUBLIC_GATEWAY_URL: ${NEXT_PUBLIC_GATEWAY_URL:-http://127.0.0.1:3001}
docker-compose.yml:42:        - "node -e \"fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""
README.md:134:- Web: `127.0.0.1:3000`
README.md:135:- Gateway: `127.0.0.1:3001`
```

Conclusion: Docker Compose defaults bind both runtime ports to localhost, with README coverage.

Command:

```bash
grep -nE "hostVerifier|hostHash|SSH host keys|without verification|man-in-the-middle|MITM" apps/gateway/src/index.ts README.md apps/web/components/connection-form.tsx
```

Hits:

```text
apps/gateway/src/index.ts:9:logger.warn("SSH host keys are accepted without verification in this development gateway.");
README.md:161:**Auto-accepted SSH host keys.** The gateway accepts any SSH host key without verification. This means connections are vulnerable to man-in-the-middle attacks. An attacker on the network path between the gateway and the SSH target could intercept the session.
apps/web/components/connection-form.tsx:239:            SSH host keys are automatically accepted &mdash; connections are
apps/web/components/connection-form.tsx:240:            vulnerable to man-in-the-middle attacks
```

Conclusion: Auto-accepted host keys are warned in README, browser UI, and gateway startup log; no `hostVerifier` or `hostHash` implementation was found.
