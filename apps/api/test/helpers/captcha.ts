import assert from "node:assert/strict";
import type { FastifyInstance, InjectOptions } from "fastify";
import { config } from "../../src/config.js";
import { captchaPurpose, solveCaptcha } from "../../../../scripts/captcha.mjs";

export async function proofFor(
  app: FastifyInstance,
  purpose: string,
  cookie = "",
  remoteAddress = "127.0.0.1",
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/captcha/challenge",
    remoteAddress,
    headers: { cookie, origin: config.APP_ORIGIN, "x-csrf-protection": "1" },
    payload: { purpose },
  });
  assert.equal(response.statusCode, 200, response.body);
  return solveCaptcha(response.json());
}

export async function verified(
  app: FastifyInstance,
  options: InjectOptions | string,
) {
  if (typeof options === "string") return app.inject(options);
  const purpose = captchaPurpose(String(options.url).replace(/^\/api/, ""));
  const headers = options.headers ?? {};
  if (
    options.method === "POST" &&
    purpose &&
    headers.origin === config.APP_ORIGIN &&
    headers["x-csrf-protection"] === "1"
  ) {
    return app.inject({
      ...options,
      payload: {
        ...(options.payload as object),
        captcha: await proofFor(
          app,
          purpose,
          String(headers.cookie ?? ""),
          options.remoteAddress,
        ),
      },
    });
  }
  return app.inject(options);
}
