
## 2026-05-05T17:00:28Z - task-1-scaffold

- `npm install` reports 2 moderate vulnerabilities in the dependency tree; not changed in scaffold scope because all required verification commands pass.
- `rg` is not installed in the environment, so forbidden-scope confirmation used the available grep/search tooling instead.

## 2026-05-05T17:06:30Z - task-1-clean-browser-fix

- Hands-on browser QA originally found `/favicon.ico` returning 404; fixed with a minimal route and verified `favicon status: 200` with zero console/page errors.
- Playwright MCP browser was locked by an existing browser profile, so the console-clean verification used a direct Playwright Chromium script instead.

## 2026-05-05T17:12:02Z - task-1-next-env-clean-clone-correction

- Earlier verification missed that Next regenerated the `.next/dev/types/routes.d.ts` import after E2E/dev; corrected by adding a sanitizer and proving the final `next-env.d.ts` content has no `.next` import after all required commands.

## 2026-05-06T01:20:04Z - task-2-protocol

- `apps/web/app/page.tsx` still imports `scaffoldStatus`; the protocol package keeps a non-placeholder compatibility export so root typecheck remains green without touching web UI in this task.

## 2026-05-06T01:34:30Z - task-3-gateway

- Port `127.0.0.1:3001` was occupied by a stale `tsx src/index.ts` gateway process during manual dev verification; stopped it, then verified the new gateway `/healthz` and sanitized 404 responses on the default port.
- The mocked bad-password test initially surfaced Node EventEmitter's special unhandled `error` behavior; the SSH session event bus now installs a no-op internal error listener while still allowing explicit `onError` subscribers.

## 2026-05-06T01:50:00Z - task-4-wss-terminal-transport

- `ws` delivers text frames as raw Buffer data with `isBinary === false`, so WSS validation must reject binary by the flag and then decode non-binary `RawData` to UTF-8 text before JSON parsing.
- Server shutdown can hang if active WebSocket clients remain open while `server.close()` waits for connections; WSS tests close clients before closing the gateway server.

## 2026-05-05T18:03:00Z - task-5-sse-post-fallback

- SSE clients that attach after `POST /sessions` cannot observe shell banner output already emitted during SSH shell startup; fallback tests should assert live output produced after the SSE stream is open.
- `npx tsx --eval` in this environment emits CommonJS output for eval snippets, so manual smoke scripts need an async IIFE rather than top-level await.

## 2026-05-06T02:26:00Z - task-6-connection-ui

- The `forceHttp` state is tracked inside ConnectionForm but not yet consumed by any transport client; Task 8 will integrate it into transport selection.
- Connection status transitions to "connecting" on valid Connect click but stays there indefinitely since no transport is wired yet; Task 8 will manage the actual status lifecycle.
