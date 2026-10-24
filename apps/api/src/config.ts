import { z } from "zod";
const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default("127.0.0.1"),
    DATABASE_URL: z.string().optional(),
    DATA_DIR: z.string().default("../../.data"),
    APP_ORIGIN: z.string().url().default("http://localhost:5173"),
    APP_SECRET: z
      .string()
      .min(32)
      .default("development-only-change-this-secret-32chars"),
    COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
    TRUST_PROXY: z.string().default(""),
    CHALLENGE_DOMAIN: z
      .string()
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
      .default("labs.localhost"),
    DOMAIN_SCHEME: z.enum(["http", "https"]).default("https"),
    GATEWAY_CONTAINER: z.string().default("nebuctf-gateway"),
    GATEWAY_PORT: z.coerce.number().default(8081),
    DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
    CHALLENGE_HOST: z
      .string()
      .regex(/^[a-zA-Z0-9.-]+$/)
      .default("localhost"),
    CHALLENGE_BIND: z.string().default("127.0.0.1"),
    IMAGE_PREFIXES: z.string().default("nebuctf/"),
    MAX_INSTANCES: z.coerce.number().int().min(1).default(64),
    MAX_OWNER_INSTANCES: z.coerce.number().int().min(1).default(2),
    MAX_CPU: z.coerce.number().int().default(16000),
    MAX_MEMORY: z.coerce.number().int().default(16384),
  })
  .parse(process.env);
if (
  env.NODE_ENV === "production" &&
  (!env.DATABASE_URL || env.APP_SECRET.startsWith("development-"))
)
  throw Error("生产环境必须配置 DATABASE_URL 和随机 APP_SECRET");
if (
  env.NODE_ENV === "production" &&
  env.APP_ORIGIN.startsWith("https:") &&
  env.COOKIE_SECURE !== "true"
)
  throw Error("HTTPS requires COOKIE_SECURE=true");
export const config = env;
