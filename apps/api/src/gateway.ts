import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
  type OutgoingHttpHeaders,
} from "node:http";
import type { Duplex } from "node:stream";
import { isIPv4 } from "node:net";
import type { DB } from "./db.js";
import { config } from "./config.js";
export function instanceFromHost(
  host: string | undefined,
  domain = config.CHALLENGE_DOMAIN,
) {
  if (!host) return null;
  const hostname = host.toLowerCase().replace(/:\d+$/, "");
  const suffix = `.${domain}`;
  if (!hostname.endsWith(suffix)) return null;
  const id = hostname.slice(0, -suffix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    id,
  )
    ? id
    : null;
}
export function proxyHeaders(
  req: Pick<IncomingMessage, "headers" | "socket">,
  upgrade = false,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...req.headers };
  const connectionTokens = String(headers.connection ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase());
  for (const key of [
    ...connectionTokens,
    "connection",
    "proxy-connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "forwarded",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-real-ip",
    "x-csrf-protection",
  ])
    delete headers[key];
  for (const key of Object.keys(headers))
    if (key.startsWith("x-forwarded-")) delete headers[key];
  const cookies = String(headers.cookie ?? "")
    .split(";")
    .filter(
      (v) =>
        !["session", "nebu_session", "__Host-nebu_session"].includes(
          v.trim().split("=")[0] ?? "",
        ),
    )
    .join(";")
    .trim();
  if (cookies) headers.cookie = cookies;
  else delete headers.cookie;
  headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
  headers["x-forwarded-proto"] = config.DOMAIN_SCHEME;
  if (upgrade) {
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
  }
  return headers;
}
function privateAddress(ip: string) {
  if (!isIPv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || (a === 192 && b === 168) || (a === 172 && b! >= 16 && b! <= 31)
  );
}
export async function resolveTarget(db: DB, host: string | undefined) {
  const id = instanceFromHost(host);
  if (!id) return null;
  const [i] = await db.query(
    "SELECT upstream_host,upstream_port,expires_at FROM instances WHERE id=$1 AND status='running' AND expires_at>now() AND spec->>'access_mode'='domain' AND kind IN ('static_container','dynamic_container')",
    [id],
  );
  if (
    !i ||
    !privateAddress(i.upstream_host ?? "") ||
    !Number.isInteger(i.upstream_port) ||
    i.upstream_port < 1024 ||
    i.upstream_port > 65535
  )
    return null;
  return {
    host: i.upstream_host as string,
    port: i.upstream_port as number,
    expires: new Date(i.expires_at).getTime(),
  };
}
function rejectSocket(socket: Duplex, status = 404) {
  socket.end(
    `HTTP/1.1 ${status} ${status === 404 ? "Not Found" : "Bad Gateway"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}
export function buildGateway(db: DB) {
  const server = createServer(
    { maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 10000 },
    (req, res) => {
      void handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(502);
        res.end("Gateway unavailable");
      });
    },
  );
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (
      req.url === "/healthz" &&
      req.headers.host === `127.0.0.1:${config.GATEWAY_PORT}`
    ) {
      await db.query("SELECT 1");
      res.end("ok");
      return;
    }
    const target = await resolveTarget(db, req.headers.host);
    if (!target) {
      res.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain",
      });
      res.end("Instance not available");
      return;
    }
    const upstream = request(
      {
        hostname: target.host,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: proxyHeaders(req),
        timeout: 30000,
      },
      (response) => {
        if (res.destroyed || res.writableEnded) {
          response.destroy();
          return;
        }
        const headers = { ...response.headers };
        delete headers["alt-svc"];
        res.writeHead(response.statusCode ?? 502, headers);
        response.pipe(res);
        response.on("error", () => res.destroy());
      },
    );
    const timer = setTimeout(
      () => {
        upstream.destroy();
        res.destroy();
      },
      Math.max(1, Math.min(target.expires - Date.now(), 300000)),
    );
    timer.unref();
    let size = 0,
      tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        tooLarge = true;
        req.unpipe(upstream);
        req.resume();
        upstream.destroy();
        if (res.headersSent) res.destroy();
        else {
          res.writeHead(413, { Connection: "close" });
          res.end("Request too large");
        }
      }
    });
    req.on("aborted", () => upstream.destroy());
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(502);
        res.end("Upstream unavailable");
      }
    });
    res.on("close", () => {
      clearTimeout(timer);
      upstream.destroy();
    });
    req.pipe(upstream);
  }
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    void (async () => {
      if (String(req.headers.upgrade).toLowerCase() !== "websocket") {
        rejectSocket(socket);
        return;
      }
      const target = await resolveTarget(db, req.headers.host);
      if (socket.destroyed) return;
      if (!target) {
        rejectSocket(socket);
        return;
      }
      const upstream = request({
        hostname: target.host,
        port: target.port,
        path: req.url,
        method: "GET",
        headers: proxyHeaders(req, true),
        timeout: 10000,
      });
      upstream.on("upgrade", (response, remote, remoteHead) => {
        remote.setTimeout(0);
        socket.write("HTTP/1.1 101 Switching Protocols\r\n");
        for (const [key, value] of Object.entries(response.headers))
          if (value !== undefined)
            for (const v of Array.isArray(value) ? value : [value])
              socket.write(`${key}: ${v}\r\n`);
        socket.write("\r\n");
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        const timer = setTimeout(
          () => {
            socket.destroy();
            remote.destroy();
          },
          Math.max(1, target.expires - Date.now()),
        );
        timer.unref();
        socket.on("close", () => {
          clearTimeout(timer);
          remote.destroy();
        });
        remote.on("close", () => socket.destroy());
        socket.on("error", () => remote.destroy());
        remote.on("error", () => socket.destroy());
        remote.pipe(socket);
        socket.pipe(remote);
      });
      upstream.on("response", (response) => {
        response.resume();
        rejectSocket(socket, 502);
      });
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => rejectSocket(socket, 502));
      socket.on("error", () => upstream.destroy());
      upstream.end();
    })().catch(() => rejectSocket(socket, 502));
  });
  server.maxConnections = 2048;
  return server;
}
