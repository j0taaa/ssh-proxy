
## 2026-05-05T17:00:28Z - task-1-scaffold

- Blank repo scaffold now uses npm workspaces for `apps/web`, `apps/gateway`, and `packages/protocol`.
- Root QA scripts are wired as `dev`, `dev:web`, `dev:gateway`, `typecheck`, `lint`, `test`, `test:e2e`, and `docker:smoke`.
- Gateway is an honest placeholder with only `GET /healthz` returning `{ "ok": true }`; SSH behavior remains intentionally unimplemented.

## 2026-05-05T17:06:30Z - task-1-clean-browser-fix

- Next.js may regenerate `apps/web/next-env.d.ts` with ignored `.next/dev/types/routes.d.ts`; the scaffold keeps only stable Next type references for clean clones.
- A source-controlled `app/favicon.ico/route.ts` can satisfy browser `/favicon.ico` requests without adding binary icon assets during the scaffold task.

## 2026-05-05T17:08:18Z - task-1-playwright-mcp-artifact-fix

- Playwright MCP can leave `.playwright-mcp/` QA artifacts in the repo root; `.gitignore` now excludes that directory and the generated copy was removed from the working tree.

## 2026-05-05T17:12:02Z - task-1-next-env-clean-clone-correction

- Next 16 rewrites `apps/web/next-env.d.ts` during dev/E2E to import `.next/dev/types/routes.d.ts`; `npm run test:e2e` now runs `scripts/sanitize-next-env.mjs` afterward so the committed scaffold stays clean-clone safe.

## 2026-05-06T01:20:04Z - task-2-protocol

- `packages/protocol` now owns the shared terminal frame contract with constants, TypeScript frame types, base64 helpers, and runtime validation for all planned frame types.
- The root Vitest include works from the repo root, but workspace-local protocol tests need a package-local `vitest.config.ts` so `npm test --workspace packages/protocol -- --run` discovers `src/index.test.ts`.

## 2026-05-06T01:34:30Z - task-3-gateway

- Gateway session core now keeps all SSH sessions in process memory through `SessionManager`; no websocket or HTTP session transport was added in this task.
- `ssh2.Client` shell resize works through `ClientChannel.setWindow(rows, cols, 0, 0)`, while the mocked `ssh2.Server` emits resize info asynchronously, so tests wait for the resize observation after issuing it.
- Gateway-local tests again need `apps/gateway/vitest.config.ts` so `npm test --workspace apps/gateway -- --run` discovers `src/session-manager.test.ts`.
- Completion notification to `ntfy.sh/codex_jaypussy` succeeded with message id `Qx0633fxeVmP`.

## 2026-05-06T01:50:00Z - task-4-wss-terminal-transport

- Gateway WebSocket upgrades are now attached directly to the existing Node `http.Server` with `ws` `WebSocketServer({ noServer: true })`; unknown upgrade paths receive a clear 404 response before socket destroy.
- The WSS transport keeps protocol heartbeat frames and WebSocket control pings together: active clients answer control pings automatically through `ws`, and protocol `ping` frames are emitted on the same interval for frontend-visible liveness.
- WSS tests can run quickly by injecting `webSocketOptions.heartbeatIntervalMs` into `createGatewayServer` while production defaults still use the protocol `HEARTBEAT_INTERVAL_MS` value.

## 2026-05-05T18:03:00Z - task-5-sse-post-fallback

- HTTP fallback now routes through the existing Node `http.Server` request handler with a dedicated transport module; no frontend code or alternate transport stack was added.
- `POST /sessions` returns only `{ "sessionId": "..." }` after `SessionManager.createSession()` completes shell readiness, while `GET /sse/terminal/:sessionId/events` attaches only to live in-memory session output and does not replay output emitted before SSE subscription.
- SSE disconnect cleanup removes listeners and heartbeat intervals without closing SSH, so reconnecting to the same active session attaches a fresh stream until idle timeout or explicit close.

## 2026-05-06T02:26:00Z - task-6-connection-ui

- Connection form is a self-contained `"use client"` component at `apps/web/components/connection-form.tsx` managing host, port, username, password, rememberPassword, forceHttp, validation, connection status, and localStorage internally.
- `globals.css` now has a full CSS custom property design token system (--color-*, --space-*, --radius-*, --font-mono) extending the original dark theme (#101820 bg, #9cc9ff accent, #f7c46c warning).
- `useId()` provides stable label-input associations for the single-instance form without hardcoded IDs.
- Port field uses `type="number"` with `step={1}` and manual validation via `Number.isInteger()` to reject decimals and non-numeric input.
- localStorage values load in useEffect after hydration to avoid server/client mismatch; a `hydrated` flag prevents premature cleanup effects.
- The `scaffoldStatus` import from `@ssh-proxy/protocol` is no longer used in page.tsx; the export remains in the protocol package for backward compatibility.
- The scaffold E2E test at `tests/e2e/scaffold.spec.ts` was updated from checking "Scaffold ready" to verifying the connection form and warning box.

## 2026-05-06T18:40:00Z - task-7-xterm-terminal

- Terminal component is a `"use client"` forwardRef component at `apps/web/components/terminal.tsx` using `@xterm/xterm` Terminal and `@xterm/addon-fit` FitAddon.
- xterm CSS imported via `import "@xterm/xterm/css/xterm.css"` at top of the client component file; Next.js App Router handles this correctly without SSR issues.
- Callback refs (`onInputRef`, `onResizeRef`) assigned synchronously outside effects avoid stale closures without re-attaching xterm event listeners on every callback change.
- Empty catch blocks require a comment body to satisfy ESLint `no-empty` rule.
- `FitAddon.fit()` can throw if the container element is not yet visible (zero dimensions); wrapping in try/catch is necessary.
- The test harness route at `apps/web/app/terminal-test/page.tsx` provides echo-mode verification without any backend transport.
- Resize events are debounced at 100ms and only emitted when cols/rows change within protocol bounds (20-300 cols, 5-120 rows).

## 2026-05-06T04:36:00Z - task-8-frontend-transport

- Browser HTTP fallback from `http://127.0.0.1:3000` to `http://localhost:3001` requires CORS on the fallback routes because JSON POSTs trigger preflight; the minimal gateway support is `OPTIONS`, reflected `Access-Control-Allow-Origin` for localhost dev origins, and SSE/JSON response headers.
- Forced HTTP fallback opens `POST /sessions`, `GET /sse/terminal/:sessionId/events`, and per-keystroke `POST /sse/terminal/:sessionId/input` requests, while the checkbox path avoids creating a WebSocket entirely.
- WSS and HTTP fallback manual QA should type a live command after connection because HTTP SSE does not replay shell output emitted before the EventSource subscribes.

## 2026-05-05T20:50:41Z - task-9-integration-tests

- Gateway integration tests now share `apps/gateway/src/test-utils/mock-ssh-server.ts`, a deterministic `ssh2.Server` harness with `testuser`/`testpass`, predictable prompt, command echo, resize recording, input recording, burst output, and channel-close tracking.
- Fast unreachable/timeout coverage is deterministic by using an ephemeral closed localhost port for real connection failure and direct sanitizer coverage for timeout messages; no external SSH host is required.
- Large output burst assertions should check accumulated content rather than transport chunking details; the mock emits multiple chunks below the decoded frame limit.

## 2026-05-06T05:07:00Z - task-10-e2e-playwright

- Playwright E2E global setup starts mock SSH server + gateway on ephemeral ports, then spawns the Next.js dev server with `NEXT_PUBLIC_GATEWAY_URL` env var pointing to the ephemeral gateway; returning a teardown function keeps the global setup process alive.
- The global setup writes server state (sshPort, gatewayUrl, webUrl) to `.test-state/e2e-env.json` which tests read via `loadE2eState()`.
- Playwright's `fullyParallel: false` is required because tests share the single mock SSH server instance started in global setup.
- The WSS failure fallback test replaces `window.WebSocket` with a `FailingWebSocket` class in the browser context; the class immediately triggers `onerror`/`onclose` so the transport client falls back to HTTP.
- Evidence screenshots show connected status with transport type labels ("via WSS" and "HTTP fallback"); xterm canvas rendering means terminal text may not be readable in PNG screenshots but connection state indicators are clearly visible.

## 2026-05-05T21:55:00Z - task-11-docker-smoke

- Production Docker now builds the shared protocol package to `packages/protocol/dist` before building either runtime image; gateway build uses the built protocol declarations so runtime imports resolve to JavaScript instead of TypeScript source.
- Compose keeps default host exposure on `127.0.0.1` for both `web` and `gateway`, while containers listen on `0.0.0.0` internally so Docker port publishing and healthchecks work.
- Docker smoke uses a host-local mock SSH server reached from the gateway container through `host.docker.internal` plus `extra_hosts: host-gateway`, then verifies both WSS and forced HTTP fallback through the production web container.

## 2026-05-06T06:01:00Z - task-12-readme-runbook

- README expanded from 31 lines to a full runbook covering architecture, transport behavior, protocol limits, Docker production, reverse proxy guidance, environment variables, tech stack, and testing.
- All six verification commands (install, typecheck, lint, test, test:e2e, docker:smoke) pass cleanly.
- Required warning phrases (no built-in auth, localStorage, auto-accept, MITM, arbitrary targets, do not expose publicly) and required exclusions (SSH key auth, SFTP, port forwarding, terminal recording, RBAC, database persistence) all verified present by grep.

## 2026-05-06T00:00:00Z - f4-scope-fidelity

- F4 scope audit approved: forbidden-scope grep hits were limited to README/notepad exclusions, UI warnings, SSH password-auth code/tests, browser opt-in localStorage, and evidence/test file writes.
- `rg` is unavailable in the environment, so F4 evidence used `grep` with `node_modules`, `.next`, and `dist` excluded and text-file includes where needed.
- Docker compose remains localhost-bound by default, and README/UI/gateway startup warnings cover no app auth, localStorage password risk, public exposure, arbitrary targets, and auto-accepted host-key MITM risk.

## 2026-05-06T06:12:00Z - f2-code-quality-review

- F2 review approved after inspecting protocol validation, WSS/SSE/browser/xterm cleanup, SSH session timers, password redaction, sanitized transport errors, Docker smoke teardown behavior, and related tests.
- Required verification passed: `npm run typecheck`, `npm run lint`, `npm test`, and repo TypeScript LSP diagnostics.

## 2026-05-06T06:53:00Z - final-wave-output-frame-chunking

- F1 final verification rejected WSS/SSE output framing because a single SSH output chunk could exceed the protocol's 4096 decoded-byte frame limit; both gateway transports now share `encodeOutputFrameChunks()` so output frames are split before emission.
- The output chunker splits on JavaScript code point boundaries and measures UTF-8 bytes per frame, preserving Unicode terminal output while enforcing `DATA_FRAME_MAX_DECODED_BYTES` exactly.
