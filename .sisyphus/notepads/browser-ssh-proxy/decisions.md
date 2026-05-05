## 2026-05-05T21:55:00Z - task-11-docker-smoke

- Chose separate production Dockerfiles for `apps/web` and `apps/gateway` so each image can copy only its runtime package, built output, production dependencies, and the built shared protocol package.
- Kept compose localhost-bound by default and documented reverse proxy/HTTPS responsibility instead of adding auth or TLS automation, matching the task's no-auth deployment boundary.
- Put the mock SSH server in `scripts/docker-smoke.mjs` rather than in production containers so dev-only SSH mocking is limited to smoke validation.
