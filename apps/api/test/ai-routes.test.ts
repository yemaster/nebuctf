import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
import { sessionCookie } from "../src/auth.js";
import {
  translateRequest,
  translateResponse,
  StreamTranslator,
  sse,
} from "../src/ai-protocol.js";

test(
  "authenticated AI routes forward both protocols with bounded streaming and usage",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1"),
      app = await buildApp(db),
      user = crypto.randomUUID(),
      session = "ai-admin";
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,'ai-admin','ai-admin@example.test','test','admin')",
      [user],
    );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
      [digest(session), user],
    );
    const seen: any[] = [];
    let disconnected = false;
    const upstream = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ body, headers: req.headers, url: req.url });
      if (req.method === "GET") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      const anthro = req.url?.startsWith("/anthropic"),
        text = JSON.stringify(body.messages);
      if (text.includes("fail-upstream")) {
        res.writeHead(401);
        res.end("secret-upstream-error");
        return;
      }
      if (text.includes("slow-upstream")) {
        res.on("close", () => {
          disconnected = true;
        });
        await delay(1000);
        if (res.destroyed) return;
      }
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const frames = anthro
          ? [
              sse(
                {
                  type: "message_start",
                  message: {
                    id: "msg_mock",
                    model: body.model,
                    usage: { input_tokens: 4, output_tokens: 0 },
                  },
                },
                "message_start",
              ),
              sse(
                {
                  type: "content_block_start",
                  index: 0,
                  content_block: { type: "text", text: "" },
                },
                "content_block_start",
              ),
              sse(
                {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: "你好" },
                },
                "content_block_delta",
              ),
              sse(
                { type: "content_block_stop", index: 0 },
                "content_block_stop",
              ),
              sse(
                {
                  type: "message_delta",
                  delta: { stop_reason: "end_turn" },
                  usage: { output_tokens: 2 },
                },
                "message_delta",
              ),
              sse({ type: "message_stop" }, "message_stop"),
            ]
          : [
              sse({
                id: "chat_mock",
                model: body.model,
                choices: [
                  {
                    index: 0,
                    delta: { role: "assistant", content: "你好" },
                    finish_reason: null,
                  },
                ],
              }),
              sse({
                id: "chat_mock",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: 4,
                  completion_tokens: 2,
                  total_tokens: 6,
                },
              }),
              sse("[DONE]"),
            ];
        const bytes = Buffer.from(frames.join("").replaceAll("\n", "\r\n"));
        for (let n = 0; n < bytes.length; n += 19)
          res.write(bytes.subarray(n, n + 19));
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          anthro
            ? {
                id: "msg_mock",
                type: "message",
                role: "assistant",
                model: body.model,
                content: [{ type: "text", text: "你好" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 4, output_tokens: 2 },
              }
            : {
                id: "chat_mock",
                object: "chat.completion",
                model: body.model,
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "你好" },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 4,
                  completion_tokens: 2,
                  total_tokens: 6,
                },
              },
        ),
      );
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(upstream.address() as any).port}`;
    t.after(async () => {
      upstream.closeAllConnections();
      await new Promise<void>((r) => upstream.close(() => r()));
      await app.close();
      await db.close();
    });
    const admin = (
      path: string,
      payload?: unknown,
      method: any = payload ? "POST" : "GET",
    ) =>
      app.inject({
        method,
        url: "/api/admin/ai-routes" + path,
        headers: {
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
          cookie: `${sessionCookie}=${session}`,
        },
        payload: payload as any,
      });
    const create = async (protocol: string, extra = {}) => {
      const data = {
        name: protocol,
        enabled: true,
        protocol,
        base_url: origin + `/${protocol}/v1`,
        api_key: "upstream-secret",
        models: [{ alias: "test-model", upstream: "upstream-model" }],
        rpm: 100,
        daily_limit: 1000,
        concurrency: 2,
        max_tokens: 100,
        timeout_seconds: 5,
        ...extra,
      };
      const r = await admin("", data);
      assert.equal(r.statusCode, 200, r.body);
      return { ...r.json(), data };
    };
    const routes = [await create("openai"), await create("anthropic")];
    const call = (route: any, format: string, body: any = {}) =>
      app.inject({
        method: "POST",
        url: `/api/ai/${route.id}/v1/${format === "openai" ? "chat/completions" : "messages"}`,
        headers: {
          ...(format === "openai"
            ? { authorization: `Bearer ${route.access_key}` }
            : { "x-api-key": route.access_key }),
          cookie: "secret-browser-cookie",
        },
        payload: {
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 30,
          ...body,
        },
      });
    await t.test(
      "admin secrets are write-only and proxy keys never use browser credentials",
      async () => {
        const list = await admin("");
        assert.equal(list.statusCode, 200);
        assert(!list.body.includes("upstream-secret"));
        assert(!list.body.includes(routes[0].access_key));
        const row = (await admin("/" + routes[0].id)).json();
        assert(row.key_set);
        assert(!("key_cipher" in row));
        const saved = (
          await db.query(
            "SELECT key_cipher,access_hash FROM ai_routes WHERE id=$1",
            [routes[0].id],
          )
        )[0]!;
        assert(!saved.key_cipher.includes("upstream-secret"));
        assert.equal(saved.access_hash, digest(routes[0].access_key));
        const unauthorized = await app.inject({
          method: "POST",
          url: `/api/ai/${routes[0].id}/v1/chat/completions`,
          headers: { cookie: `${sessionCookie}=${session}` },
          payload: {},
        });
        assert.equal(unauthorized.statusCode, 401);
        const models = await app.inject({
          url: `/api/ai/${routes[0].id}/v1/models`,
          headers: { authorization: `Bearer ${routes[0].access_key}` },
        });
        assert.equal(models.json().data[0].id, "test-model");
        const management = await app.inject({
          method: "PUT",
          url: `/api/admin/ai-routes/${routes[0].id}`,
          headers: { authorization: `Bearer ${routes[0].access_key}` },
          payload: routes[0].data,
        });
        // The proxy credential must never authorize administrative mutations.
        assert(management.statusCode >= 400 && management.statusCode < 500);
        assert.deepEqual(
          (
            await db.query(
              "SELECT key_cipher,access_hash FROM ai_routes WHERE id=$1",
              [routes[0].id],
            )
          )[0],
          saved,
        );
      },
    );
    await t.test(
      "all four request/response and streaming combinations preserve aliases and usage",
      async () => {
        for (const route of routes)
          for (const format of ["openai", "anthropic"])
            for (const stream of [false, true]) {
              const res = await call(route, format, { stream });
              assert.equal(res.statusCode, 200, res.body);
              assert(res.body.includes("你好"));
              assert(res.body.includes("test-model"));
              assert(!res.body.includes("upstream-model"));
              if (stream) {
                assert(
                  res.headers["content-type"]?.includes("text/event-stream"),
                );
                assert(
                  res.body.includes(
                    format === "openai" ? "[DONE]" : "message_stop",
                  ),
                );
              }
              const last = seen.at(-1)!;
              assert.equal(last.body.model, "upstream-model");
              assert.equal(last.headers.cookie, undefined);
              assert(!JSON.stringify(last.headers).includes(route.access_key));
            }
        const usage = await db.query(
          "SELECT status,input_tokens,output_tokens FROM ai_calls",
        );
        assert.equal(usage.length, 8);
        assert(
          usage.every(
            (row) =>
              row.status === 200 &&
              row.input_tokens === 4 &&
              row.output_tokens === 2,
          ),
        );
      },
    );
    await t.test(
      "caps, unavailable models, upstream errors, disable and rotation are enforced",
      async () => {
        const route = routes[0];
        assert.equal(
          (await call(route, "openai", { max_tokens: 101 })).statusCode,
          400,
        );
        assert.equal(
          (await call(route, "openai", { model: "other" })).statusCode,
          400,
        );
        const fail = await call(route, "openai", {
          messages: [{ role: "user", content: "fail-upstream" }],
        });
        assert.equal(fail.statusCode, 502);
        assert(!fail.body.includes("secret-upstream-error"));
        assert.equal(
          (
            await call(route, "anthropic", {
              thinking: { type: "enabled", budget_tokens: 100 },
            })
          ).statusCode,
          400,
        );
        await admin("/" + route.id, { enabled: false }, "PATCH");
        assert.equal((await call(route, "openai")).statusCode, 401);
        await admin("/" + route.id, { enabled: true }, "PATCH");
        const rotated = (await admin("/" + route.id + "/rotate", {})).json();
        assert.equal((await call(route, "openai")).statusCode, 401);
        route.access_key = rotated.access_key;
        assert.equal((await call(route, "openai")).statusCode, 200);
        const limited = await create("openai", { rpm: 1 });
        assert.equal((await call(limited, "openai")).statusCode, 200);
        assert.equal((await call(limited, "openai")).statusCode, 429);
        const one = await create("openai", { concurrency: 1 });
        const pending = call(one, "openai", {
          messages: [{ role: "user", content: "slow-upstream" }],
        });
        const requestPromise = pending.then((r) => r);
        await delay(150);
        assert.equal((await call(one, "openai")).statusCode, 429);
        assert.equal((await requestPromise).statusCode, 200);
      },
    );
    await t.test(
      "tool histories and tool stream deltas translate without executing tools",
      async () => {
        const outbound = translateRequest(
          {
            model: "m",
            messages: [
              { role: "system", content: "system" },
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "tool_1",
                    type: "function",
                    function: { name: "lookup", arguments: '{"id":1}' },
                  },
                ],
              },
              { role: "tool", tool_call_id: "tool_1", content: "found" },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "lookup",
                  parameters: { type: "object", properties: {} },
                },
              },
            ],
            max_tokens: 10,
          },
          "openai",
          "anthropic",
        );
        assert.equal(outbound.system, "system");
        assert.equal(outbound.messages[0].content[0].type, "tool_use");
        const reverse = translateRequest(outbound, "anthropic", "openai");
        assert.equal(
          reverse.messages[1].tool_calls[0].function.arguments,
          '{"id":1}',
        );
        assert.equal(reverse.messages[2].role, "tool");
        const converted = translateResponse(
          {
            id: "m",
            content: [
              {
                type: "tool_use",
                id: "tool_1",
                name: "lookup",
                input: { id: 1 },
              },
            ],
            stop_reason: "tool_use",
            usage: {},
          },
          "anthropic",
          "openai",
          "alias",
        );
        assert.equal(converted.choices[0].finish_reason, "tool_calls");
        const stream = new StreamTranslator("openai", "anthropic", "alias"),
          frames = [
            ...stream.feed({
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "tool_1",
                        function: { name: "lookup", arguments: '{"id":' },
                      },
                    ],
                  },
                },
              ],
            }),
            ...stream.feed({
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [{ index: 0, function: { arguments: "1}" } }],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            }),
            ...stream.feed("[DONE]"),
          ].join("");
        assert(frames.includes("input_json_delta"));
        assert(frames.includes("tool_use"));
        assert(frames.includes("message_stop"));
        assert.throws(() =>
          translateRequest(
            {
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: { url: "http://example.com" },
                    },
                  ],
                },
              ],
            },
            "openai",
            "anthropic",
          ),
        );
      },
    );
    await t.test(
      "disconnect aborts an upstream request and expires its reservation",
      async () => {
        const host = await app.listen({ host: "127.0.0.1", port: 0 }),
          route = routes[1],
          abort = new AbortController();
        const request = fetch(host + `/api/ai/${route.id}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": route.access_key,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "test-model",
            messages: [{ role: "user", content: "slow-upstream" }],
            max_tokens: 10,
          }),
          signal: abort.signal,
        }).catch(() => {});
        await delay(150);
        disconnected = false;
        abort.abort();
        await request;
        await delay(150);
        assert(disconnected);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM ai_calls WHERE status=0",
            )
          )[0]!.n,
          0,
        );
      },
    );
  },
);
