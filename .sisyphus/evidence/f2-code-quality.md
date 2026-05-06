# F2 Code Quality Review Rerun

VERDICT: APPROVE

## Commands

- `npm run typecheck`: passed. Workspaces `apps/web`, `apps/gateway`, and `packages/protocol` completed `tsc --noEmit` with exit code 0.
- `npm run lint`: passed. `eslint .` completed with exit code 0.
- `npm test`: passed. Protocol package built successfully, then Vitest reported 4 test files passed and 34 tests passed.
- `lsp_diagnostics` on `apps/gateway/src/output-frame-chunks.ts`, `apps/gateway/src/terminal-ws.ts`, and `apps/gateway/src/terminal-http.ts`: passed with no diagnostics.

## Files Reviewed

- `apps/gateway/src/output-frame-chunks.ts`
- `apps/gateway/src/terminal-ws.ts`
- `apps/gateway/src/terminal-http.ts`
- `apps/gateway/src/terminal-ws.test.ts`
- `apps/gateway/src/terminal-http.test.ts`
- `apps/gateway/src/test-utils/mock-ssh-server.ts`
- `apps/gateway/src/session-manager.ts`
- `apps/gateway/src/ssh-session.ts`
- `apps/gateway/src/errors.ts`
- `apps/gateway/src/logger.ts`
- `apps/web/lib/transport.ts`
- `apps/web/components/connection-form.tsx`
- `scripts/docker-smoke.mjs`
- `packages/protocol/src/index.ts`

## Chunking Fix Review

- The previous oversized single-output-frame risk is resolved. `encodeOutputFrameChunks()` splits SSH output by JavaScript code point while tracking UTF-8 byte length and emits base64 chunks no larger than `DATA_FRAME_MAX_DECODED_BYTES`.
- WSS output uses `encodeOutputFrameChunks()` before `sendFrame()`, assigning a fresh sequence number to every output frame.
- SSE output uses the same helper before writing `output` events, preserving the same protocol limit for HTTP fallback.
- WSS and SSE tests now exercise a single large SSH output containing 4097 ASCII bytes plus Unicode text and assert every decoded output frame is `<= DATA_FRAME_MAX_DECODED_BYTES` while the joined output preserves content.
- Pattern scan confirmed the stale `DATA_FRAME_MAX_DECODED_BYTES + 8` tolerance is absent.

## Quality Findings

- Stream/listener cleanup remains acceptable. WSS clears heartbeat intervals, unsubscribes SSH listeners, terminates clients on transport close, and closes managed SSH sessions on socket cleanup. SSE clears heartbeat intervals and unregisters output/error/close listeners on request or response close while keeping the SSH session alive for reconnect. SSH session close still clears timers, tears down channel/client resources, emits close, removes listeners, and logs only safe fields. Browser transport and xterm cleanup paths remain bounded.
- Frame validation remains acceptable. Protocol validation rejects malformed hosts/ports, empty credentials, invalid resize bounds, unknown frame types, malformed base64, oversized input/output frames, invalid session IDs, and invalid sequences. Gateway input paths still route frames through the shared validator.
- Password handling remains acceptable. Server-side code does not persist passwords beyond passing them to `ssh2.Client.connect`; logs include session ID, host, port, username, resize dimensions, and reasons, but not passwords. Tests still assert bad and good test passwords are absent from gateway logs. Browser password persistence remains opt-in localStorage only.
- Transport error handling remains sanitized. Gateway errors map to protocol codes/messages via `toSanitizedError()` and `messageForCode()` before being sent to WSS/SSE/HTTP clients. Tests cover bad credentials, unreachable/connect failures, validation failures, oversized frames, and session cleanup.
- Docker smoke teardown remains acceptable. The script wraps smoke execution in `try`/`catch`/`finally`, runs `docker compose down --remove-orphans`, closes the mock SSH server, closes Playwright browsers in their own `finally`, writes evidence, and exits nonzero on failure.

## Pattern Scan

- `TODO`, `FIXME`, `HACK`, `@ts-ignore`, `as any`, and empty catches: no matches in source/test/script files.
- Credential and terminal logging: no server-side terminal input/output logging found. Password hits are expected protocol/test fixtures, browser form persistence, mock SSH auth, Docker smoke automation, and E2E tests.
- `console.*`: limited to sanitized gateway console logger, Docker smoke evidence output, and E2E setup/teardown messages.
- Forbidden feature terms: only expected README/UI warning, test, and mock/auth references found; no out-of-scope SSH key auth, SFTP, port forwarding, terminal recording, RBAC, database, JWT, token, or login implementation found.

## Risks

- No blocking code-quality risks found in the rerun.
