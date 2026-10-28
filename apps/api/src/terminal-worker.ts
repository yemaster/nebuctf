import { WebSocket, WebSocketServer } from "ws";
import type { Duplex } from "node:stream";
import { DockerEngine } from "./docker.js";
import { config } from "./config.js";
import type { DB } from "./db.js";
import { terminalAccess, verifyTerminalTicket } from "./terminal-auth.js";
import { terminalTarget } from "./terminal-target.js";
import type { User } from "./context.js";
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
    let resize: ReturnType<typeof setTimeout> | undefined;
    const scheduleResize = () => {
      if (resize || !execId || !dimensions) return;
      resize = setTimeout(() => {
        resize = undefined;
        const value = dimensions;
        dimensions = undefined;
        if (value && execId)
          void docker
            .resizeTerminal(execId, value.cols, value.rows)
            .catch(() => socket.close(1011, "Resize failed"));
      }, 100);
    };
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
        if (value.type === "resize") {
          dimensions = value;
          scheduleResize();
        } else {
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
      clearTimeout(resize);
      clearInterval(heartbeat);
      clearInterval(validate);
      if (instance && active.get(instance) === socket) active.delete(instance);
    });
    void (async () => {
      const ticket = verifyTerminalTicket(
        request.headers.authorization?.replace(/^Bearer /, "") ?? "",
      );
      const getTarget = async () => {
        if (!ticket.target) return undefined;
        const [user] = await db.query<User>(
          "SELECT id,username,email,role FROM users WHERE id=$1 AND NOT disabled",
          [ticket.user],
        );
        if (!user) throw Error("Session expired");
        return terminalTarget(db, ticket.target, user);
      };
      if (!(await terminalAccess(db, ticket)))
        return socket.close(1008, "Session expired");
      if (socket.readyState !== WebSocket.OPEN) return;
      const target = await getTarget();
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
      execId = await docker.createTerminalExec(info.Id, target);
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
          .then(async (allowed) => {
            if (!allowed) socket.close(1008, "Session expired");
            else await getTarget();
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
