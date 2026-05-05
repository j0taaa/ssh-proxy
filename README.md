# ssh-proxy

Browser SSH proxy with a Next.js web UI and a separate long-lived Node gateway.

## Production Docker

Build and start the production containers:

```bash
docker compose build
docker compose up -d
```

The default compose file binds the web UI and gateway only to localhost because this app has no built-in authentication:

- Web: `127.0.0.1:3000`
- Gateway: `127.0.0.1:3001`

Both services expose `GET /healthz` and compose healthchecks. Override `WEB_PORT`, `GATEWAY_PORT`, or `NEXT_PUBLIC_GATEWAY_URL` only when the replacement endpoint is still protected by your deployment boundary.

For internet-facing use, put an external reverse proxy in front of the services. Terminate HTTPS on port `443` there, proxy WSS traffic for `/ws/terminal`, and proxy the gateway HTTP fallback routes for `/sessions` and `/sse/terminal/*`. Keep the compose host bindings private unless the reverse proxy, firewall, or private network provides access control.

## Docker Smoke Validation

Run the production smoke test from the repo root:

```bash
npm run docker:smoke
```

The smoke script builds the images, starts compose, waits for service health, starts a local mocked SSH server, exercises WSS and forced HTTP fallback through the running web and gateway containers, writes `.sisyphus/evidence/task-11-docker-smoke.txt`, and tears compose down on success or failure.
