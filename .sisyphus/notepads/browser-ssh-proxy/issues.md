
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

## 2026-05-06T04:36:00Z - task-8-frontend-transport

- `rg` is not installed in this environment, so the forbidden-pattern source scan used `grep -RInE` with `node_modules` and `.next` excluded.
- Manual QA initially hit a stale `scripts/mock-harness.mts` process occupying ports `2222` and `3001`; identified it with `lsof`, stopped only that stale process, then ran a temporary mock SSH harness from `/tmp/opencode`.
- No unresolved Task 8 issues remain.

## 2026-05-05T20:50:41Z - task-9-integration-tests

- `npm run lint` initially failed on unused `encodeBase64` imports left in WSS/HTTP tests after refactoring to shared frame helpers; removed the imports and reran lint successfully.
- The first timeout test design used a blackhole TCP server and exceeded Vitest's 5s default; replaced it with bounded unreachable-host coverage plus sanitizer timeout coverage to keep tests deterministic.

## 2026-05-05T21:55:00Z - task-11-docker-smoke

- `docker compose up -d` returns after the web container starts but before the web healthcheck is necessarily healthy; validation should poll `GET /healthz` or inspect health after startup instead of doing an immediate one-shot fetch.
- `ssh2` is CommonJS in the root smoke script, so ESM smoke code must default-import it and destructure `Server`/`utils`.
- `npm audit` still reports 2 moderate vulnerabilities during local/package-lock and Docker image installs; this was pre-existing and not changed in Docker scope.
