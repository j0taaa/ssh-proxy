import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "NOT_IMPLEMENTED", message: "Gateway scaffold exposes only /healthz." }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Gateway scaffold listening on http://127.0.0.1:${port}`);
});
