import { WebSocket, WebSocketServer } from "ws";
import type { Duplex } from "node:stream";
import { DockerEngine } from "./docker.js";
import { config } from "./config.js";
import type { DB } from "./db.js";
import { terminalAccess, verifyTerminalTicket } from "./terminal-auth.js";
import { z } from "zod";

const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string().max(1024) }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().min(2).max(300),
    rows: z.number().int().min(1).max(120),
  }),
]);
export function startTerminalWorker(
  db: DB,
  docker = new DockerEngine(),
  port = config.TERMINAL_PORT,
) {
  const server = new WebSocketServer({
    host: "0.0.0.0",
    port,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  const active = new Map<string, WebSocket>();
  server.on("connection", (socket, request) => {
    let stream: Duplex | undefined,
      execId: string | undefined,
      instance: string | undefined;
    let checking = false,
      alive = true;
    let dimensions: { cols: number; rows: number } | undefined;
    const controller = new AbortController();
    const handshake = setTimeout(
      () => socket.close(1008, "Authentication timeout"),
      10000,
    );
    const resize = setInterval(() => {
      if (!execId || !dimensions) return;
      const value = dimensions;
      dimensions = undefined;
      void docker
        .resizeTerminal(execId, value.cols, value.rows)
        .catch(() => socket.close(1011, "Resize failed"));
    }, 150);
    const heartbeat = setInterval(() => {
      if (!alive) socket.terminate();
      else {
        alive = false;
        socket.ping();
      }
    }, 20000);
    let validate: ReturnType<typeof setInterval> | undefined;
    socket.on("pong", () => {
      alive = true;
    });
    socket.on("message", (raw, binary) => {
      if (!stream) return;
      try {
        if (binary) throw Error("Invalid input");
        const value = command.parse(JSON.parse(raw.toString()));
        if (value.type === "resize") dimensions = value;
        else {
          if (stream.writableLength > 65536) throw Error("Input too fast");
          stream.write(value.data);
        }
      } catch {
        socket.close(1008, "Invalid terminal message");
      }
    });
    socket.on("error", () => socket.terminate());
    socket.on("close", () => {
      controller.abort();
      stream?.destroy();
      clearTimeout(handshake);
      clearInterval(resize);
      clearInterval(heartbeat);
      clearInterval(validate);
      if (instance && active.get(instance) === socket) active.delete(instance);
    });
    void (async () => {
      const ticket = verifyTerminalTicket(
        request.headers.authorization?.replace(/^Bearer /, "") ?? "",
      );
      if (!(await terminalAccess(db, ticket)))
        return socket.close(1008, "Session expired");
      if (socket.readyState !== WebSocket.OPEN) return;
      instance = ticket.instance;
      const info = await docker.inspectContainer(`nebuctf-${instance}`);
      if (
        info.Config.Labels?.["io.nebuctf.instance"] !== instance ||
        !info.State.Running
      )
        throw Error("Terminal unavailable");
      if (socket.readyState !== WebSocket.OPEN) return;
      active.get(instance)?.close(4001, "Connected elsewhere");
      active.set(instance, socket);
      execId = await docker.createTerminalExec(info.Id);
      stream = await docker.attachTerminal(execId, controller.signal);
      if (socket.readyState !== WebSocket.OPEN) {
        stream.destroy();
        return;
      }
      clearTimeout(handshake);
      validate = setInterval(() => {
        if (checking) return;
        checking = true;
        void terminalAccess(db, ticket)
          .then((allowed) => {
            if (!allowed) socket.close(1008, "Session expired");
          })
          .catch(() => socket.close(1011, "Session check failed"))
          .finally(() => {
            checking = false;
          });
      }, 10000);
      stream.on("data", (data: Buffer) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 1024 * 1024)
          return socket.close(1013, "Output too fast");
        socket.send(data, { binary: true });
      });
      stream.on("error", () => socket.close(1011, "Terminal disconnected"));
      stream.on("close", () => socket.close(1000, "Shell ended"));
      socket.send(JSON.stringify({ type: "ready" }));
      stream.resume();
    })().catch(() => socket.close(1011, "Terminal unavailable"));
  });
  return server;
}
