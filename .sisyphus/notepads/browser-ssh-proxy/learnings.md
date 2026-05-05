
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
