import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  dynamicFlag,
  flagHash,
  equal,
  score,
} from "../src/security.js";
import { containerConfig } from "../src/worker.js";
import { readArtifact, dockerStdout } from "../src/docker.js";
import {
  orderNodes,
  learningProgress,
  type LearningNode,
} from "../src/learning.js";
import { challengeInput, contestInput } from "../src/schemas.js";

test("Argon2id hashes use independent salts and reject incorrect passwords", async () => {
  const password = "a-long-example-password";
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.match(a, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await verifyPassword(a, password), true);
  assert.equal(await verifyPassword(a, "incorrect-password"), false);
  assert.equal(await verifyPassword("invalid", password), false);
});
test("dynamic flags are stable within a scope and isolated across users, contests and challenges", () => {
  const flag = dynamicFlag("challenge", "practice", "u:alice");
  assert.equal(flag, dynamicFlag("challenge", "practice", "u:alice"));
  for (const args of [
    ["challenge", "practice", "u:bob"],
    ["challenge", "contest", "u:alice"],
    ["other", "practice", "u:alice"],
  ])
    assert.notEqual(flag, dynamicFlag(...(args as [string, string, string])));
  assert.equal(equal(flagHash(flag), flagHash(flag)), true);
  assert.equal(equal(flagHash(flag), ""), false);
});
test("dynamic score is bounded, monotone and retroactive; static score stays constant", () => {
  let previous = 500;
  for (let n = 0; n < 100; n++) {
    const value = score(500, 100, 20, n);
    assert.ok(value >= 100 && value <= previous);
    previous = value;
  }
  assert.equal(score(500, 100, 20, 0), 500);
  assert.equal(score(500, 100, 20, 20), 100);
  assert.equal(score(500, 100, 20, 200, false), 500);
});
const instance = {
  id: "11111111-1111-4111-8111-111111111111",
  challenge_id: "c1",
  scope: "practice",
  owner_key: "u:1",
  kind: "dynamic_container",
  spec: {
    port: 8080,
    image: "nebuctf/test:1",
    cpu: 500,
    memory: 256,
    ttl: 1800,
  },
};
test("container limits and isolation cannot be relaxed by an image spec", () => {
  const spec = containerConfig({
    ...instance,
    spec: { ...instance.spec, Privileged: true, Binds: ["/:/host"] },
  });
  assert.equal(spec.User, "65534:65534");
  assert.equal(spec.HostConfig.Memory, 268435456);
  assert.equal(spec.HostConfig.NanoCpus, 500000000);
  assert.equal(spec.HostConfig.PidsLimit, 128);
  assert.deepEqual(spec.HostConfig.CapDrop, ["ALL"]);
  assert.equal(spec.HostConfig.Privileged, false);
  assert.equal(spec.HostConfig.ReadonlyRootfs, true);
  assert.equal(spec.HostConfig.Binds, undefined);
  assert.notEqual(spec.HostConfig.NetworkMode, "host");
  assert.match(spec.Env[0], /^FLAG=flag\{/);
  const generator = containerConfig({
    ...instance,
    kind: "dynamic_attachment",
  });
  assert.equal(generator.HostConfig.NetworkMode, "none");
  assert.equal(generator.NetworkDisabled, true);
  assert.deepEqual(generator.HostConfig.PortBindings, {});
  const shared = containerConfig({ ...instance, kind: "static_container" });
  assert.deepEqual(shared.Env, []);
});
function archive(name: string, content: string, type = "0") {
  const b = Buffer.alloc(
    512 + Math.ceil(Buffer.byteLength(content) / 512) * 512 + 1024,
  );
  b.write(name, 0);
  b.write("0000644\0", 100);
  b.write("0000000\0", 108);
  b.write("0000000\0", 116);
  b.write(Buffer.byteLength(content).toString(8).padStart(11, "0") + "\0", 124);
  b.fill(32, 148, 156);
  b.write(type, 156);
  b.write("ustar\0", 257);
  let checksum = 0;
  for (const byte of b.subarray(0, 512)) checksum += byte;
  b.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
  b.write(content, 512);
  return b;
}
test("Docker artifact stream separates stderr and rejects malformed frames", () => {
  const frame = (channel: number, text: string) => {
    const header = Buffer.alloc(8);
    header[0] = channel;
    header.writeUInt32BE(Buffer.byteLength(text), 4);
    return Buffer.concat([header, Buffer.from(text)]);
  };
  assert.equal(
    dockerStdout(
      Buffer.concat([frame(1, "abc"), frame(2, "diagnostic"), frame(1, "def")]),
    ).toString(),
    "abcdef",
  );
  assert.throws(() => dockerStdout(frame(1, "abc").subarray(0, 9)));
  assert.throws(() => dockerStdout(frame(3, "invalid")));
});
test("artifact parser accepts only a single named regular file with valid tar checksum", () => {
  assert.equal(
    readArtifact(archive("artifact.zip", "payload")).toString(),
    "payload",
  );
  assert.throws(() => readArtifact(archive("../artifact.zip", "payload")));
  assert.throws(() => readArtifact(archive("artifact.zip", "payload", "2")));
  const invalid = archive("artifact.zip", "payload");
  invalid[0] = 0;
  assert.throws(() => readArtifact(invalid));
  const extra = archive("artifact.zip", "payload");
  extra[extra.length - 1] = 1;
  assert.throws(() => readArtifact(extra));
  assert.throws(() => readArtifact(Buffer.alloc(30 * 1024 * 1024)));
});
const nodes: LearningNode[] = [
  {
    id: "a",
    title: "基础",
    article_id: "doc",
    challenge_id: null,
    prerequisites: [],
  },
  {
    id: "b",
    title: "实践",
    article_id: null,
    challenge_id: "challenge",
    prerequisites: ["a"],
  },
  {
    id: "c",
    title: "进阶",
    article_id: "advanced",
    challenge_id: null,
    prerequisites: ["b"],
  },
];
test("skill graph rejects cycles, missing prerequisites and duplicate IDs", () => {
  assert.deepEqual(
    orderNodes([...nodes].reverse()).map((n) => n.id),
    ["a", "b", "c"],
  );
  assert.throws(() =>
    orderNodes([{ ...nodes[0]!, prerequisites: ["c"] }, ...nodes.slice(1)]),
  );
  assert.throws(() =>
    orderNodes([{ ...nodes[0]!, prerequisites: ["missing"] }]),
  );
  assert.throws(() => orderNodes([nodes[0]!, nodes[0]!]));
});
test("skill progress requires completed prerequisites and actual practice solves", () => {
  let result = learningProgress(nodes, new Set(), new Set(["challenge"]));
  assert.equal(result[1]!.completed, false);
  assert.equal(result[1]!.unlocked, false);
  result = learningProgress(nodes, new Set(["doc"]), new Set(["challenge"]));
  assert.equal(result[1]!.completed, true);
  assert.equal(result[2]!.unlocked, true);
  assert.equal(result[2]!.completed, false);
  assert.equal(result[2]!.level, 2);
  result = learningProgress(
    nodes,
    new Set(["doc", "advanced"]),
    new Set(["challenge"]),
  );
  assert.equal(result.filter((n) => n.completed).length, 3);
});
test("challenge and contest schemas reject invalid limits and timestamps", () => {
  assert.equal(
    challengeInput.safeParse({
      title: "x",
      category: "Web",
      difficulty: "入门",
      kind: "dynamic_container",
      image: "evil image",
      cpu: 999999,
    }).success,
    false,
  );
  assert.equal(
    contestInput.safeParse({
      title: "x",
      starts_at: "2026-01-02T00:00:00.000Z",
      ends_at: "2026-01-01T00:00:00.000Z",
    }).success,
    false,
  );
});
