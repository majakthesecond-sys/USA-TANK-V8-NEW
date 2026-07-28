const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const MIME_TYPES = new Map([
  [".bin", "application/octet-stream"],
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".gltf", "model/gltf+json; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveRequestPath(pathname, publicDir, threeDir) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return { error: 400 };
  }

  if (decodedPath.includes("\0") || decodedPath.includes("\\")) {
    return { error: 400 };
  }

  let root = publicDir;
  let relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);

  if (decodedPath === "/vendor/three" || decodedPath.startsWith("/vendor/three/")) {
    root = threeDir;
    relativePath = decodedPath.slice("/vendor/three/".length);
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (!isInside(resolvedRoot, candidate)) {
    return { error: 403 };
  }

  return { candidate, root: resolvedRoot };
}

function parseRange(rangeHeader, fileSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || "");
  if (!match || (!match[1] && !match[2]) || fileSize === 0) {
    return null;
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : fileSize - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return null;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(message);
}

async function serveFile(request, response, publicDir, threeDir) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed");
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(request.url, "http://127.0.0.1");
  } catch {
    sendText(response, 400, "Bad request");
    return;
  }

  const resolved = resolveRequestPath(requestUrl.pathname, publicDir, threeDir);
  if (resolved.error) {
    sendText(response, resolved.error, "Request blocked");
    return;
  }

  let filePath = resolved.candidate;
  let stats;
  try {
    stats = await fs.promises.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      if (!isInside(resolved.root, filePath)) {
        sendText(response, 403, "Request blocked");
        return;
      }
      stats = await fs.promises.stat(filePath);
    }
  } catch {
    sendText(response, 404, "File not found");
    return;
  }

  if (!stats.isFile()) {
    sendText(response, 404, "File not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const range = request.headers.range ? parseRange(request.headers.range, stats.size) : null;
  if (request.headers.range && !range) {
    response.writeHead(416, {
      "Content-Range": `bytes */${stats.size}`,
      "X-Content-Type-Options": "nosniff",
    });
    response.end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(stats.size - 1, 0);
  const contentLength = range ? end - start + 1 : stats.size;
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": extension === ".html"
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "Content-Length": contentLength,
    "Content-Type": MIME_TYPES.get(extension) || "application/octet-stream",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  };

  if (range) {
    headers["Content-Range"] = `bytes ${start}-${end}/${stats.size}`;
  }

  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD" || stats.size === 0) {
    response.end();
    return;
  }

  const stream = fs.createReadStream(filePath, range ? { start, end } : undefined);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

function startLocalGameServer({ publicDir, threeDir, port = 0 } = {}) {
  if (!publicDir || !threeDir) {
    return Promise.reject(new Error("publicDir and threeDir are required"));
  }

  const server = http.createServer((request, response) => {
    void serveFile(request, response, publicDir, threeDir);
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Local game server did not return a TCP address"));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        server,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        }),
      });
    });
  });
}

module.exports = {
  startLocalGameServer,
};
