import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const requestedPort = Number.parseInt(process.env.PORT ?? "4173", 10);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function safePath(urlPath) {
  const pathWithoutQuery = decodeURIComponent(urlPath.split("?")[0]);
  const requested = pathWithoutQuery === "/" ? "/index.html" : pathWithoutQuery;
  const filePath = normalize(join(projectRoot, requested));

  if (!filePath.startsWith(`${projectRoot}/`) && filePath !== projectRoot) {
    return null;
  }

  return filePath;
}

const server = createServer((request, response) => {
  const filePath = safePath(request.url ?? "/");

  if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    "content-security-policy": "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(requestedPort, "127.0.0.1", () => {
  console.log(`CareerOps is running at http://localhost:${requestedPort}`);
  console.log("Press Ctrl+C to stop the local demo.");
});
