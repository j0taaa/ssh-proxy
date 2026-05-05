Task 12: README Runbook and Security Warnings - Command Evidence
================================================================

All documented verification commands were run from the repo root on 2026-05-06.

1. npm install
   Result: PASS (exit 0)
   Notes: Reports 2 moderate vulnerabilities (pre-existing, unchanged).

2. npm run typecheck
   Result: PASS (exit 0)
   Notes: TypeScript type checking passed for @ssh-proxy/web, @ssh-proxy/gateway, @ssh-proxy/protocol.

3. npm run lint
   Result: PASS (exit 0)
   Notes: ESLint found no issues.

4. npm test
   Result: PASS (exit 0)
   Notes: 4 test files, 32 tests passed. Duration ~11s. Mock SSH server only.

5. npm run test:e2e
   Result: PASS (exit 0)
   Notes: 11 Playwright tests passed (21.3s). Covers WSS, HTTP fallback, auto-fallback,
   localStorage, form validation, bad credentials, resize, Unicode, paste, disconnect.

6. npm run docker:smoke
   Result: PASS (exit 0)
   Notes: Images built, services healthy, WSS and HTTP fallback browser smoke passed,
   containers torn down. ~26s total.

7. npm run dev
   Result: NOT RUN (documented only, not left running per task requirements)

Summary: 6/6 non-destructive verification commands passed (dev command documented but not run long).
