import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { dynamicFlag } from "../src/security.js";
import { config } from "../src/config.js";
import {
  inspectFlagTemplate,
  flagTemplateInput,
} from "../src/flag-template.js";
import { flagEnvironment } from "../src/flag-environment.js";
import { challengeInput } from "../src/schemas.js";

test("templates preserve legacy flags and isolate challenge, owner, scope, part and round", () => {
  for (const part of [undefined, "part-a"]) {
    const legacy = `flag{${createHmac("sha256", config.APP_SECRET)
      .update(
        JSON.stringify(
          part
            ? ["dynamic-part", "challenge", part, "practice", "u:a"]
            : ["dynamic", "challenge", "practice", "u:a"],
        ),
      )
      .digest("hex")
      .slice(0, 40)}}`;
    for (const template of [undefined, null, ""])
      assert.equal(
        dynamicFlag("challenge", "practice", "u:a", part, template),
        legacy,
      );
  }
  const template = "NebuCTF{literal_[GUID]_[TEAM_HASH]_[GUID]}",
    flag = dynamicFlag("c", "contest", "t:a", "part", template);
  assert.match(
    flag,
    /^NebuCTF\{literal_([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})_[a-f0-9]{12}_\1\}$/,
  );
  assert.equal(flag, dynamicFlag("c", "contest", "t:a", "part", template));
  for (const args of [
    ["other", "contest", "t:a", "part"],
    ["c", "practice", "t:a", "part"],
    ["c", "contest", "t:b", "part"],
    ["c", "contest", "t:a", "round-2"],
  ])
    assert.notEqual(
      flag,
      dynamicFlag(args[0]!, args[1]!, args[2]!, args[3], template),
    );
  assert.equal(inspectFlagTemplate(template).length, flag.length);
  assert.equal(inspectFlagTemplate("flag{[GUID]_[GUID]}").entropy, 122);
  assert.equal(
    inspectFlagTemplate("flag{[TEAM_HASH]_[TEAM_HASH]}").entropy,
    48,
  );
});

test("Leet changes only literal body text and rejects weak or malformed templates", () => {
  const template = "Custom_Name{aaaaaaaaaaaaaaaaaaaaaaaa}";
  assert(inspectFlagTemplate(template).entropy >= 32);
  const variants = new Set(
    Array.from({ length: 20 }, (_, n) =>
      dynamicFlag("c", "practice", `u:${n}`, undefined, template),
    ),
  );
  assert.equal(variants.size, 20);
  for (const flag of variants) assert.match(flag, /^Custom_Name\{[Aa4]{24}\}$/);
  const special = dynamicFlag(
    "c",
    "s",
    "u",
    undefined,
    "[CLEET]Custom{aaaaaaaaaaaaaaaaaaaaaaaa_[GUID]}",
  );
  assert.match(special, /^Custom\{[Aa4@]{24}_[a-f0-9-]{36}\}$/);
  assert.match(
    dynamicFlag(
      "c",
      "s",
      "u",
      undefined,
      "[LEET]Custom{hello world_[TEAM_HASH]}",
    ),
    /^Custom\{[Hh][Ee3][Ll1I]{2}[Oo0]_[Ww][Oo0][Rr][Ll1I][Dd]_[a-f0-9]{12}\}$/,
  );
  for (const invalid of [
    "flag{short}",
    "flag{}",
    "flag{[UNKNOWN]}",
    "[GUID]",
    "flag{[GUID]}\n",
    "flag{a\u0000[GUID]}",
    "flag{{[GUID]}}",
    "[LEET]flag{a}",
    "flag{" + "[GUID]".repeat(8) + "}",
    "flag{" + "x".repeat(260) + "}",
  ])
    assert.equal(flagTemplateInput.safeParse(invalid).success, false, invalid);
  const base = {
    title: "Test",
    category: "Web",
    difficulty: "入门",
    flag_template: "flag{[GUID]}",
  };
  assert(!challengeInput.safeParse({ ...base, flag_mode: "static" }).success);
  assert(
    !challengeInput.safeParse({
      ...base,
      challenge_type: "objective",
      flag_mode: "dynamic",
      objective: {
        type: "single",
        options: [
          { id: "A", text: "A" },
          { id: "B", text: "B" },
        ],
        correct_options: ["A"],
      },
    }).success,
  );
});

test("single and multipart snapshots use the same inherited or overridden template everywhere", () => {
  const instance = {
    challenge_id: "c",
    scope: "s",
    owner_key: "u",
    kind: "dynamic_container",
    spec: {
      flag_mode: "dynamic",
      flag_env: "GZCTF_FLAG",
      flag_template: "Nebu{[GUID]}",
    },
  };
  const expected = dynamicFlag(
    "c",
    "s",
    "u",
    undefined,
    instance.spec.flag_template,
  );
  assert.deepEqual(flagEnvironment(instance), [
    `FLAG=${expected}`,
    `GZCTF_FLAG=${expected}`,
  ]);
  const env = flagEnvironment({
    ...instance,
    spec: {
      ...instance.spec,
      parts: ["a", "b"],
      part_templates: { a: null, b: "Root{[TEAM_HASH]}" },
    },
  });
  assert(
    env.includes(`FLAG_1=${dynamicFlag("c", "s", "u", "a", "Nebu{[GUID]}")}`),
  );
  assert(
    env.includes(
      `FLAG_2=${dynamicFlag("c", "s", "u", "b", "Root{[TEAM_HASH]}")}`,
    ),
  );
});
