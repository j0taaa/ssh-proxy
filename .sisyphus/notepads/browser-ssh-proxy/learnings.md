
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
