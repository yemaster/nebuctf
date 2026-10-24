import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { AddressInfo } from "node:net";
import { buildGateway } from "../src/gateway.js";
import { config } from "../src/config.js";
import type { DB } from "../src/db.js";
const address = Object.values(networkInterfaces())
  .flat()
  .find(
    (n): n is NetworkInterfaceInfo =>
      !!n &&
      n.family === "IPv4" &&
      !n.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address),
  );
test(
  "live HTTP gateway bounds request bodies and survives upstream disconnects",
  {
    skip: !address
      ? "No private IPv4 interface for upstream integration"
      : false,
  },
  async (t) => {
    const upstream = createServer((req, res) => {
      if (req.url === "/disconnect") {
        req.socket.destroy();
        return;
      }
      req.resume();
      req.on("end", () => {
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, address!.address, resolve),
    );
    const port = (upstream.address() as AddressInfo).port;
    const db = {
      query: async () => [
        {
          upstream_host: address!.address,
          upstream_port: port,
          expires_at: new Date(Date.now() + 60000),
        },
      ],
    } as unknown as DB;
    const gateway = buildGateway(db);
    await new Promise<void>((resolve) =>
      gateway.listen(0, "127.0.0.1", resolve),
    );
    t.after(async () => {
      upstream.closeAllConnections();
      gateway.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => upstream.close(() => r())),
        new Promise<void>((r) => gateway.close(() => r())),
      ]);
    });
    const gatewayPort = (gateway.address() as AddressInfo).port;
    const send = (path: string, body = Buffer.alloc(0)) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port: gatewayPort,
            path,
            method: "POST",
            headers: {
              host: `11111111-1111-4111-8111-111111111111.${config.CHALLENGE_DOMAIN}`,
              "content-length": body.length,
            },
            timeout: 5000,
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode!));
          },
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(Error("timeout")));
        req.end(body);
      });
    assert.equal(await send("/large", Buffer.alloc(21 * 1024 * 1024, 65)), 413);
    assert.equal(await send("/disconnect"), 502);
    assert.equal(await send("/healthy", Buffer.from("ok")), 204);
  },
);
