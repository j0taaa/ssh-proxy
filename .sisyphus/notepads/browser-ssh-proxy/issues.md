
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
