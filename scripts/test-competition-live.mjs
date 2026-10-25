import { captchaPurpose, solveCaptcha } from "./captcha.mjs";
// Explicit, stateful acceptance checks against a running demonstration server.
// Creates real accounts, teams and submissions; never writes scores directly.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { WebSocket } from "ws";

assert.equal(
  process.env.DEMO_ALLOW_WRITE,
  "1",
  "Set DEMO_ALLOW_WRITE=1 for an explicitly authorized demo server",
);
const origin = new URL(process.env.DEMO_ORIGIN).origin;
const directory = resolve(process.env.DEMO_STATE_DIR ?? ".data/server-demo");
await mkdir(directory, { recursive: true, mode: 0o700 });
const file = `${directory}/state.json`;
let state;
try {
  state = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
state ??= {
  origin,
  users: {},
  teams: {},
  challenges: {},
  contests: {},
  passed: [],
  results: [],
};
assert.equal(state.origin, origin, "State belongs to a different server");
const save = () =>
  writeFile(file, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
const iso = (time) => new Date(time).toISOString();
const now = () => Date.now();
const admin = (state.admin ??= JSON.parse(
  await readFile(process.env.DEMO_ADMIN_FILE, "utf8"),
));
async function request(
  actor,
  path,
  body,
  {
    method = body === undefined ? "GET" : "POST",
    status = 200,
    binary = false,
  } = {},
) {
  const purpose = captchaPurpose(path);
  if (method === "POST" && purpose) {
    const challenge = await request(actor, "/captcha/challenge", { purpose });
    body = { ...body, captcha: solveCaptcha(challenge) };
  }
  await delay(90);
  const response = await fetch(`${origin}/api${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      origin,
      "x-csrf-protection": "1",
      ...(actor?.cookie ? { cookie: actor.cookie } : {}),
      ...(body === undefined || body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (binary && response.status === status)
    return Buffer.from(await response.arrayBuffer());
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${response.status} ${data.error ?? ""}`,
  );
  const cookie = response.headers.get("set-cookie");
  if (cookie && actor) actor.cookie = cookie.split(";")[0];
  return data;
}
if (!admin.cookie || !(await request(admin, "/me")).user) {
  const response = await request(admin, "/auth/login", {
    email: admin.email,
    password: admin.password,
  });
  assert.equal(response.user.role, "admin");
  await save();
}
async function waitFor(label, fn, timeout = 90000, interval = 1000) {
  const end = now() + timeout;
  while (now() < end) {
    const result = await fn();
    if (result) return result;
    await delay(interval);
  }
  throw Error(`Timed out: ${label}`);
}
async function until(time) {
  while (now() < time) await delay(Math.min(10000, time - now()));
}
async function check(name, fn) {
  if (state.passed.includes(name)) {
    console.log(`Already verified: ${name}`);
    return;
  }
  console.log(`Checking: ${name}`);
  let result;
  try {
    result = await fn();
  } catch (error) {
    state.results.push({
      name,
      time: iso(now()),
      status: "failed",
      error: error.message,
    });
    await save();
    throw error;
  }
  state.passed.push(name);
  state.results.push({ name, time: iso(now()), status: "passed", ...result });
  await save();
  console.log(`Passed: ${name}`);
}
const points = (value) => ({
  initial_points: value,
  minimum_points: value,
  decay: 4,
});
const fixed = (value) => ({ mode: "fixed", points: points(value) });
const users = () => [
  state.users.alpha1,
  state.users.alpha2,
  state.users.bravo1,
  state.users.bravo2,
  state.users.charlie,
];
const detail = (actor, key, scope) =>
  request(actor, `/challenges/${state.challenges[key].id}?scope=${scope}`);
const submit = (actor, key, scope, flag, options) =>
  request(
    actor,
    `/challenges/${state.challenges[key].id}/submit`,
    { scope, flag },
    options,
  );
const answer = (actor, key, scope, value, finalize = true, options) =>
  request(
    actor,
    `/challenges/${state.challenges[key].id}/answer`,
    { scope, answer: value, finalize },
    options,
  );
const board = (scope, suffix = "") =>
  request(admin, `/scoreboard?scope=${scope}${suffix}`);
async function scoreEquals(scope, expected) {
  const value = await board(scope);
  for (const [team, score] of Object.entries(expected))
    assert.equal(
      value.items.find((row) => row.id === state.teams[team].id)?.score,
      score,
      `${team} score`,
    );
  return value;
}
async function makeContest(key, input) {
  if (!state.contests[key]) {
    const c = await request(admin, "/admin/contests", {
      team_limit: 3,
      published: true,
      ...input,
    });
    state.contests[key] = { ...input, id: c.id };
    await save();
    const form = new FormData();
    form.append(
      "file",
      new Blob([await readFile("apps/web/public/images/contest-lab.jpg")], {
        type: "image/jpeg",
      }),
      "contest-lab.jpg",
    );
    await request(admin, `/admin/contests/${c.id}/poster`, form);
  }
  return state.contests[key];
}
async function register(contest, team, group) {
  const actor = state.users[team === "charlie" ? team : `${team}1`];
  const view = await request(actor, `/contests/${contest.id}`);
  if (!view.registration)
    await request(actor, `/contests/${contest.id}/register`, {
      team_id: state.teams[team].id,
      ...(group ? { group_id: group } : {}),
    });
}
async function seed() {
  for (const name of ["alpha1", "alpha2", "bravo1", "bravo2", "charlie"]) {
    if (state.users[name]?.id) continue;
    const actor = (state.users[name] ??= {
      username: `test_${name}`,
      email: `${name}@nebuctf.test`,
      password: randomBytes(18).toString("base64url"),
    });
    await save();
    const { user } = await request(actor, "/auth/register", actor);
    actor.id = user.id;
    await save();
  }
  for (const name of ["alpha", "bravo", "charlie"]) {
    if (state.teams[name]) continue;
    const captain = state.users[name === "charlie" ? name : `${name}1`];
    const team = await request(captain, "/teams", {
      name: `[测试] ${name === "charlie" ? "体验队" : name.toUpperCase()}`,
    });
    if (name !== "charlie")
      await request(state.users[`${name}2`], "/team/join", {
        invite: team.invite,
      });
    state.teams[name] = { id: team.id, name: team.name };
    await save();
  }
  const profile = (image, extra = {}) => ({
    image: `nebuctf/${image}:local`,
    cpu: 250,
    memory: 64,
    ttl: 60,
    mode: "private",
    port: 8080,
    access_mode: "port",
    ...extra,
  });
  const definitions = {
    welcome: {
      title: "提交第一个 Flag",
      description: "提交 `flag{hello_nebuctf_test}`。",
      flag: "flag{hello_nebuctf_test}",
      ...points(100),
    },
    caesar: {
      title: "Base64 来信",
      category: "Crypto",
      description: `解码下面的 Base64：\n\n\`${Buffer.from("flag{decode_me_test}").toString("base64")}\``,
      flag: "flag{decode_me_test}",
      initial_points: 300,
      minimum_points: 100,
      decay: 4,
      dynamic_score: true,
    },
    parts: {
      title: "两段编码",
      category: "Reverse",
      description: `每段对应一个 Flag。\n\nBase64：\`${Buffer.from("flag{first_step_test}").toString("base64")}\`\n\n十六进制：\`${Buffer.from("flag{second_step_test}").toString("hex")}\``,
      parts: [
        { title: "Base64", flag: "flag{first_step_test}", ...points(100) },
        { title: "十六进制", flag: "flag{second_step_test}", ...points(150) },
      ],
    },
    single: {
      title: "HTTP 方法",
      challenge_type: "objective",
      ...points(50),
      objective: {
        type: "single",
        options: [
          { id: "A", text: "GET" },
          { id: "B", text: "POST" },
          { id: "C", text: "HEAD" },
        ],
        correct_options: ["B"],
      },
      description: "下面哪种方法通常用于提交登录表单？",
    },
    multiple: {
      title: "编码与加密",
      challenge_type: "objective",
      ...points(80),
      objective: {
        type: "multiple",
        options: [
          { id: "A", text: "Base64" },
          { id: "B", text: "AES" },
          { id: "C", text: "十六进制" },
        ],
        correct_options: ["A", "C"],
      },
      description: "选择所有编码方式。",
    },
    blank: {
      title: "基础填空",
      challenge_type: "objective",
      ...points(70),
      objective: {
        type: "blank",
        case_sensitive: false,
        blanks: [
          { id: "port", label: "HTTP 默认端口", answers: ["80"] },
          { id: "method", label: "获取资源的方法", answers: ["GET"] },
        ],
      },
      description: "填写 HTTP 的默认端口与获取资源的方法。",
    },
    container: {
      title: "一个靶机两个 Flag",
      category: "Web",
      flag_mode: "dynamic",
      resources: { container: profile("example-multi"), attachment: null },
      description: "启动环境，依次访问 `/entry` 和 `/root`，提交两个 Flag。",
      parts: [
        { title: "入口", flag_env: "ENTRY_FLAG", ...points(50) },
        { title: "深入", flag_env: "ROOT_FLAG", ...points(50) },
      ],
    },
    attachment: {
      title: "专属附件",
      flag_mode: "dynamic",
      resources: { container: null, attachment: profile("example-generator") },
      ...points(100),
      description: "生成并下载附件，解压后将 challenge.txt 中的 Base64 解码。",
    },
    awdp: {
      title: "AWDP 修复入口",
      category: "Web",
      challenge_type: "awdp",
      flag_mode: "dynamic",
      resources: {
        container: profile("example-ad", { ttl: 90 }),
        attachment: null,
      },
      patch_config: {
        checker_image: "nebuctf/example-checker:local",
        patch_root: "/app",
        timeout: 20,
        cpu: 250,
        memory: 64,
      },
      description:
        "攻击：启动靶机，访问 `/leak`。\n\n防守：上传包含 `settings.py` 的 tar 包，将 `VULNERABLE = True` 改为 `VULNERABLE = False`。保留 `/health` 和 `/checksum`。",
      parts: [
        { title: "攻击", role: "attack", ...points(100) },
        { title: "防守", role: "defense", ...points(100) },
      ],
    },
    awd: {
      title: "AWD 双队对抗",
      category: "Web",
      challenge_type: "awd",
      flag_mode: "dynamic",
      practice: false,
      resources: {
        container: profile("example-ad", { ttl: 300 }),
        attachment: null,
      },
      patch_config: {
        checker_image: "nebuctf/example-checker:local",
        patch_root: "/app",
        timeout: 20,
        cpu: 250,
        memory: 64,
      },
      awd_config: {
        checker_image: "nebuctf/example-checker:local",
        timeout: 10,
      },
      description:
        "访问对手的 `/leak` 获取本轮 Flag。修复方式同 AWDP：上传 `VULNERABLE = False` 的 settings.py。每 60 秒一轮。",
    },
  };
  for (const [key, definition] of Object.entries(definitions)) {
    if (state.challenges[key]) continue;
    const c = await request(admin, "/admin/challenges", {
      category: "Misc",
      difficulty: "入门",
      published: true,
      practice: true,
      dynamic_score: false,
      ...definition,
      title: `[测试] ${definition.title}`,
    });
    state.challenges[key] = { id: c.id, title: `[测试] ${definition.title}` };
    await save();
  }
  const all = Object.entries(state.challenges)
    .filter(([key]) => key !== "awd")
    .map(([, c]) => c.id);
  const parts = await request(
    admin,
    `/admin/challenges/${state.challenges.parts.id}`,
  );
  const basic = await makeContest("basic", {
    title: "[测试] 综合解题体验赛",
    description:
      "CTF、多 Flag、客观题和 AWDP 混合体验。测试账号与成绩仅用于功能验证。",
    starts_at: iso(now() - 60000),
    ends_at: iso(now() + 7 * 86400000),
    challenge_ids: all,
    challenge_settings: [
      { challenge_id: state.challenges.welcome.id, scoring: fixed(120) },
      {
        challenge_id: state.challenges.parts.id,
        scoring: {
          ...fixed(200),
          parts: parts.parts.map((p, index) => ({
            id: p.id,
            points: points(index ? 120 : 80),
          })),
        },
      },
    ],
    groups: [
      { name: "公开组" },
      { name: "校园组", permissions: { require_review: true } },
      {
        name: "只读组",
        permissions: {
          submit: false,
          resources: false,
          score: false,
          blood: false,
          dynamic: false,
          rank_overall: false,
        },
      },
    ],
  });
  const groups = (await request(admin, `/contests/${basic.id}`)).groups;
  await register(basic, "alpha", groups[0].id);
  await register(basic, "bravo", groups[1].id);
  // Charlie stays unregistered until the access-denial checks are complete.
  if (!state.notice) {
    state.notice = (
      await request(admin, "/admin/announcements", {
        title: "测试赛与练习题已准备",
        body: "带 [测试] 的题目、战队与成绩是功能验证数据。综合赛可直接体验；短时赛保留了分阶段、轮次和对抗成绩。",
      })
    ).id;
    await save();
  }
  console.log(
    `Seeded ${Object.keys(state.challenges).length} challenges, ${Object.keys(state.users).length} users and ${Object.keys(state.teams).length} teams`,
  );
}
async function core() {
  const [a1, a2, b1, b2, c] = users();
  const scope = state.contests.basic.id;
  const groups = (await request(admin, `/contests/${scope}`)).groups;
  await check("registration review and spectator permissions", async () => {
    await detail(b1, "welcome", scope).then(
      () => assert.fail("pending team entered contest"),
      (error) => assert.match(error.message, /403/),
    );
    await request(
      c,
      `/challenges/${state.challenges.welcome.id}?scope=${scope}`,
      undefined,
      { status: 403 },
    );
    await request(
      b2,
      `/contests/${scope}/register`,
      { team_id: state.teams.bravo.id, group_id: groups[1].id },
      { status: 403 },
    );
    const roster = await request(
      admin,
      `/admin/contests/${scope}/registrations/${state.teams.bravo.id}`,
    );
    assert.equal(roster.members.length, 2);
    await request(
      admin,
      `/admin/contests/${scope}/registrations`,
      { team_ids: [state.teams.bravo.id], status: "accepted" },
      { method: "PUT" },
    );
    await register(state.contests.basic, "charlie", groups[2].id);
    await detail(c, "welcome", scope);
    await submit(c, "welcome", scope, "flag{hello_nebuctf_test}", {
      status: 403,
    });
    await request(
      c,
      `/challenges/${state.challenges.container.id}/instances`,
      { scope },
      { status: 403 },
    );
  });
  await check(
    "fixed overrides, wrong answers and concurrent team duplicates",
    async () => {
      assert.equal(
        (await submit(a1, "welcome", scope, "wrong")).correct,
        false,
      );
      const results = await Promise.all(
        [a1, a2, a1].map((actor) =>
          submit(actor, "welcome", scope, "flag{hello_nebuctf_test}"),
        ),
      );
      assert.equal(results.filter((r) => !r.already_solved).length, 1);
      await submit(b1, "welcome", scope, "flag{hello_nebuctf_test}");
      await scoreEquals(scope, { alpha: 120, bravo: 120 });
      assert.equal((await detail(a1, "welcome", "practice")).points, 100);
      await submit(a1, "welcome", "practice", "flag{hello_nebuctf_test}");
      const individual = await request(
        a1,
        `/scoreboard/${a1.id}?scope=practice`,
      );
      assert.equal(individual.score, 100);
      await scoreEquals(scope, { alpha: 120, bravo: 120 });
    },
  );
  await check(
    "dynamic scores recalculate both teams and retain solver attribution",
    async () => {
      await submit(a1, "caesar", scope, "flag{decode_me_test}");
      await scoreEquals(scope, { alpha: 408, bravo: 120 });
      await submit(b2, "caesar", scope, "flag{decode_me_test}");
      await scoreEquals(scope, { alpha: 370, bravo: 370 });
      assert.equal(
        (await submit(a2, "caesar", scope, "flag{decode_me_test}"))
          .already_solved,
        true,
      );
      await scoreEquals(scope, { alpha: 370, bravo: 370 });
      const ranked = await board(scope, `&group=${groups[1].id}`);
      assert.equal(ranked.items.length, 1);
      assert.equal(ranked.items[0].id, state.teams.bravo.id);
      assert.equal(ranked.items[0].group_rank, 1);
    },
  );
  await check(
    "multipart completion counts each part once across teammates",
    async () => {
      const one = await submit(a1, "parts", scope, "flag{first_step_test}");
      assert.equal(one.completed, false);
      assert.equal((await detail(a2, "parts", scope)).solved_parts, 1);
      const two = await submit(a2, "parts", scope, "flag{second_step_test}");
      assert.equal(two.completed, true);
      await submit(b2, "parts", scope, "flag{first_step_test}");
      await scoreEquals(scope, { alpha: 570, bravo: 450 });
      assert.equal(
        (await submit(a2, "parts", scope, "flag{second_step_test}"))
          .already_solved,
        true,
      );
      await scoreEquals(scope, { alpha: 570, bravo: 450 });
    },
  );
  await check(
    "single choice, multiple choice, blanks and immutable final answers",
    async () => {
      const exposed = await detail(a1, "single", scope);
      assert.ok(!JSON.stringify(exposed.objective).includes("correct_options"));
      assert.equal(
        (await answer(a1, "single", scope, { choices: ["A"] }, false)).correct,
        null,
      );
      assert.equal(
        (await answer(a2, "single", scope, { choices: ["B"] })).correct,
        true,
      );
      const immutable = await answer(a1, "single", scope, { choices: ["A"] });
      assert.equal(immutable.correct, true);
      assert.deepEqual(immutable.answer.choices, ["B"]);
      assert.equal(
        (await answer(b1, "single", scope, { choices: ["A"] })).correct,
        false,
      );
      assert.equal(
        (await answer(b2, "single", scope, { choices: ["B"] })).correct,
        false,
      );
      assert.equal(
        (await answer(a1, "multiple", scope, { choices: ["C", "A"] })).correct,
        true,
      );
      assert.equal(
        (await answer(b2, "multiple", scope, { choices: ["A", "C"] })).correct,
        true,
      );
      assert.equal(
        (
          await answer(a2, "blank", scope, {
            blanks: { port: " 80 ", method: " get " },
          })
        ).correct,
        true,
      );
      assert.equal(
        (
          await answer(b1, "blank", scope, {
            blanks: { port: "443", method: "GET" },
          })
        ).correct,
        false,
      );
      await scoreEquals(scope, { alpha: 770, bravo: 530 });
      const team = await request(
        a1,
        `/scoreboard/${state.teams.alpha.id}?scope=${scope}`,
      );
      assert.equal(
        team.categories.reduce((sum, row) => sum + row.score, 0),
        team.score,
      );
      assert.equal(
        team.members.reduce((sum, row) => sum + row.score, 0) +
          (team.team_points ?? 0),
        team.score,
      );
      assert.ok(team.cells.every((cell) => cell.solver_name));
      assert.ok(team.members.every((member) => member.score > 0));
      return { scores: { alpha: 770, bravo: 530 } };
    },
  );
}

async function instance(actor, key, scope, type = "container") {
  const result = await request(
    actor,
    `/challenges/${state.challenges[key].id}/instances`,
    { scope, resource_type: type },
  );
  return waitFor(`${key} ready`, async () => {
    const row = (await request(actor, `/instances?scope=${scope}`)).items.find(
      (item) => item.id === result.id,
    );
    if (row?.status === "failed")
      throw Error(`${key} environment failed: ${row.error}`);
    return row && ["running", "ready"].includes(row.status) ? row : false;
  });
}
async function released(actor, scope, id) {
  await waitFor(
    "automatic environment release",
    async () =>
      !(await request(actor, `/instances?scope=${scope}`)).items.some(
        (row) => row.id === id,
      ),
    125000,
  );
}
async function target(endpoint, path) {
  assert.ok(
    endpoint.startsWith(new URL(origin).hostname + ":"),
    "target must be on the authorized demo host",
  );
  const port = Number(endpoint.split(":").at(-1));
  assert.ok(port >= 30000 && port <= 50000);
  return fetch(`http://${endpoint}${path}`, {
    signal: AbortSignal.timeout(8000),
  });
}
function patch(vulnerable, filename = "settings.py") {
  const data = execFileSync(
    "python3",
    [
      "-c",
      "import io,json,sys,tarfile; x=json.load(sys.stdin); b=io.BytesIO(); t=tarfile.open(fileobj=b,mode='w'); d=x['body'].encode(); i=tarfile.TarInfo(x['name']); i.size=len(d); i.mode=0o644; t.addfile(i,io.BytesIO(d)); t.close(); sys.stdout.buffer.write(b.getvalue())",
    ],
    {
      input: JSON.stringify({
        name: filename,
        body: `VULNERABLE = ${vulnerable ? "True" : "False"}\n`,
      }),
    },
  );
  const body = new FormData();
  body.append(
    "file",
    new Blob([data], { type: "application/x-tar" }),
    "patch.tar",
  );
  return body;
}
async function patchResult(actor, key, scope, id) {
  return waitFor(
    "patch verdict",
    async () => {
      const row = (
        await request(
          actor,
          `/challenges/${state.challenges[key].id}/patches?scope=${scope}`,
        )
      ).items.find((j) => j.id === id);
      return row && ["passed", "failed", "cancelled"].includes(row.status)
        ? row
        : false;
    },
    120000,
  );
}
async function resources() {
  const [a1, a2, b1, b2] = users(),
    scope = state.contests.basic.id;
  await check(
    "two-team containers inject distinct multipart flags and expire automatically",
    async () => {
      const [a, b] = await Promise.all([
        instance(a1, "container", scope),
        instance(b1, "container", scope),
      ]);
      assert.ok(a.endpoint !== b.endpoint);
      const [entry, root, other] = await Promise.all([
        target(a.endpoint, "/entry").then((r) => r.text()),
        target(a.endpoint, "/root").then((r) => r.text()),
        target(b.endpoint, "/entry").then((r) => r.text()),
      ]);
      assert.ok(
        entry !== root && entry !== other,
        "flags must be isolated by part and team",
      );
      assert.equal(
        (await submit(a1, "container", scope, other)).correct,
        false,
      );
      assert.equal(
        (await submit(a1, "container", scope, entry)).completed,
        false,
      );
      assert.equal(
        (await submit(a2, "container", scope, root)).completed,
        true,
      );
      assert.equal((await submit(b1, "container", scope, other)).correct, true);
      await request(a2, `/instances/${a.id}/stop`, {}, { status: 429 });
      await request(
        a1,
        `/challenges/${state.challenges.attachment.id}/instances`,
        { scope, resource_type: "attachment" },
        { status: 409 },
      );
      await scoreEquals(scope, { alpha: 870, bravo: 580 });
      await Promise.all([released(a1, scope, a.id), released(b1, scope, b.id)]);
      return { ports: [a.endpoint, b.endpoint], automaticRelease: true };
    },
  );
  await check(
    "generated attachments stay private, grade correctly and release their reservations",
    async () => {
      const [a, b] = await Promise.all([
        instance(a1, "attachment", scope, "attachment"),
        instance(b1, "attachment", scope, "attachment"),
      ]);
      await request(b1, `/instances/${a.id}/artifact`, undefined, {
        status: 403,
      });
      const decode = (zip) =>
        execFileSync(
          "python3",
          [
            "-c",
            "import io,zipfile,base64,sys; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); sys.stdout.write(base64.b64decode(z.read('challenge.txt')).decode())",
          ],
          { input: zip },
        ).toString();
      const af = decode(
        await request(a2, `/instances/${a.id}/artifact`, undefined, {
          binary: true,
        }),
      );
      const bf = decode(
        await request(b2, `/instances/${b.id}/artifact`, undefined, {
          binary: true,
        }),
      );
      assert.ok(af !== bf, "attachments must contain team-specific flags");
      assert.equal((await submit(b2, "attachment", scope, af)).correct, false);
      assert.equal((await submit(a1, "attachment", scope, af)).correct, true);
      assert.equal((await submit(b2, "attachment", scope, bf)).correct, true);
      await request(a2, `/instances/${a.id}/stop`, {}, { status: 429 });
      await scoreEquals(scope, { alpha: 970, bravo: 680 });
      await Promise.all([released(a1, scope, a.id), released(b1, scope, b.id)]);
    },
  );
  await check(
    "AWDP attack and real patch builds award separate credits, failed patches can be retried",
    async () => {
      const live = await instance(a1, "awdp", scope);
      const flag = await target(live.endpoint, "/leak").then((r) => r.text());
      assert.equal((await submit(a1, "awdp", scope, flag)).completed, false);
      const path = `/challenges/${state.challenges.awdp.id}/patches?scope=${scope}`;
      await request(a1, path, patch(false, "../escape.py"), { status: 400 });
      const accepted = await request(a2, path, patch(false));
      const failed = await request(b1, path, patch(true));
      await request(b2, path, patch(false), { status: 429 });
      const [good, bad] = await Promise.all([
        patchResult(a1, "awdp", scope, accepted.id),
        patchResult(b1, "awdp", scope, failed.id),
      ]);
      assert.equal(good.status, "passed", good.error ?? "good patch");
      assert.equal(bad.status, "failed");
      assert.match(bad.error, /安全检查/);
      assert.equal((await detail(a1, "awdp", scope)).solved, true);
      await scoreEquals(scope, { alpha: 1170, bravo: 680 });
      await until(Date.parse(bad.created_at) + 61000);
      const retry = await request(b2, path, patch(false));
      const fixedPatch = await patchResult(b1, "awdp", scope, retry.id);
      assert.equal(
        fixedPatch.status,
        "passed",
        fixedPatch.error ?? "retry patch",
      );
      assert.equal((await detail(b1, "awdp", scope)).solved_parts, 1);
      await scoreEquals(scope, { alpha: 1170, bravo: 780 });
      await released(a1, scope, live.id);
      return {
        passedPatches: 2,
        rejectedPatches: 1,
        scores: { alpha: 1170, bravo: 780 },
      };
    },
  );
}

async function timing() {
  const [a1, a2, b1, b2, c] = users();
  await check(
    "flexible phases share a team clock, remain independent and reject expired answers",
    async () => {
      const opens = now() - 30000,
        closes = now() + 7 * 86400000;
      const contest = await makeContest("flexible", {
        title: "[测试] 自由计时体验赛",
        description:
          "全队共享开始时间。客观题 60 秒，实操题 90 秒，两阶段分别开始。体验队尚未开始，可继续测试。",
        starts_at: iso(opens),
        ends_at: iso(closes),
        challenge_ids: ["single", "multiple", "blank", "welcome", "caesar"].map(
          (key) => state.challenges[key].id,
        ),
        challenge_settings: [
          { challenge_id: state.challenges.welcome.id, scoring: fixed(777) },
        ],
        timing: {
          objective: {
            mode: "flexible",
            opens_at: iso(opens),
            closes_at: iso(closes),
            duration_seconds: 60,
          },
          practical: {
            mode: "flexible",
            opens_at: iso(opens),
            closes_at: iso(closes),
            duration_seconds: 90,
          },
        },
      });
      for (const team of ["alpha", "bravo", "charlie"])
        await register(contest, team);
      const scope = contest.id;
      await request(
        a1,
        `/challenges/${state.challenges.single.id}?scope=${scope}`,
        undefined,
        { status: 403 },
      );
      const [first, duplicate] = await Promise.all(
        [a1, a2].map((actor) =>
          request(actor, `/contests/${scope}/start/objective`, {}),
        ),
      );
      assert.equal(first.deadline_at, duplicate.deadline_at);
      const teammate = (
        await request(a2, `/contests/${scope}/timing`)
      ).phases.find((p) => p.section === "objective");
      assert.equal(teammate.deadline_at, first.deadline_at);
      const other = (await request(b1, `/contests/${scope}/timing`)).phases;
      assert.ok(other.every((phase) => phase.status === "ready"));
      await request(b1, `/contests/${scope}/start/objective`, {});
      assert.equal(
        (await answer(a2, "single", scope, { choices: ["B"] })).correct,
        true,
      );
      await answer(a1, "multiple", scope, { choices: ["A", "C"] });
      await answer(a2, "blank", scope, {
        blanks: { port: "80", method: "GET" },
      });
      await answer(b1, "single", scope, { choices: ["A"] });
      await answer(b2, "multiple", scope, { choices: ["A"] });
      await answer(b2, "blank", scope, {
        blanks: { port: "80", method: "GET" },
      });
      await submit(a1, "welcome", scope, "flag{hello_nebuctf_test}", {
        status: 403,
      });
      const practical = await request(
        a2,
        `/contests/${scope}/start/practical`,
        {},
      );
      await request(b1, `/contests/${scope}/start/practical`, {});
      await submit(a1, "welcome", scope, "flag{hello_nebuctf_test}");
      await submit(b2, "welcome", scope, "flag{hello_nebuctf_test}");
      await scoreEquals(scope, { alpha: 977, bravo: 847, charlie: 0 });
      await until(Date.parse(first.deadline_at) + 500);
      await answer(a2, "single", scope, { choices: ["B"] }, true, {
        status: 403,
      });
      assert.equal(
        (await request(a1, `/contests/${scope}/timing`)).phases.find(
          (p) => p.section === "practical",
        ).status,
        "active",
      );
      await until(Date.parse(practical.deadline_at) + 500);
      await submit(a1, "caesar", scope, "flag{decode_me_test}", {
        status: 403,
      });
      assert.ok(
        (await request(c, `/contests/${scope}/timing`)).phases.every(
          (p) => p.status === "ready",
        ),
      );
      return { contest: scope, scores: { alpha: 977, bravo: 847, charlie: 0 } };
    },
  );
  await check(
    "fixed objective and practical windows open and close independently",
    async () => {
      const start = now() + 12000,
        practical = start + 35000,
        end = start + 80000;
      const contest = await makeContest("fixed", {
        title: "[测试] 分阶段限时赛",
        description: "已完成实测：先客观题、再实操题，保留成绩供检查。",
        starts_at: iso(start),
        ends_at: iso(end),
        challenge_ids: [
          state.challenges.single.id,
          state.challenges.welcome.id,
        ],
        timing: {
          objective: {
            mode: "fixed",
            opens_at: iso(start),
            closes_at: iso(practical),
          },
          practical: {
            mode: "fixed",
            opens_at: iso(practical),
            closes_at: iso(end),
          },
        },
      });
      for (const team of ["alpha", "bravo"]) await register(contest, team);
      await request(
        a1,
        `/challenges/${state.challenges.single.id}?scope=${contest.id}`,
        undefined,
        { status: 403 },
      );
      await until(start + 300);
      await detail(a1, "single", contest.id);
      await submit(a1, "welcome", contest.id, "flag{hello_nebuctf_test}", {
        status: 403,
      });
      for (const actor of [a1, b1])
        await answer(actor, "single", contest.id, { choices: ["B"] });
      await until(practical + 300);
      await answer(a2, "single", contest.id, { choices: ["B"] }, true, {
        status: 403,
      });
      for (const actor of [a2, b2])
        await submit(actor, "welcome", contest.id, "flag{hello_nebuctf_test}");
      await scoreEquals(contest.id, { alpha: 150, bravo: 150 });
      await until(end + 300);
      await submit(a1, "welcome", contest.id, "flag{hello_nebuctf_test}", {
        status: 403,
      });
      await scoreEquals(contest.id, { alpha: 150, bravo: 150 });
      return { contest: contest.id, scores: { alpha: 150, bravo: 150 } };
    },
  );
}
async function openActivity(actor, scope) {
  const frames = [];
  const socket = new WebSocket(
    `${origin.replace(/^http/, "ws")}/api/contests/${scope}/activity/ws`,
    { headers: { origin, cookie: actor.cookie }, handshakeTimeout: 10000 },
  );
  socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.on("error", () => {});
  return { socket, frames };
}
async function rounds() {
  const [a1, a2, b1, b2, c] = users();
  await check(
    "three real rounds support carried and resubmitted solves, with live blood notifications",
    async () => {
      const start = now() + 12000,
        end = start + 180000;
      const rules = (value, carry) => ({
        mode: "round",
        points: points(value),
        round: { interval: 60, carry, dynamic: false },
      });
      const contest = await makeContest("rounds", {
        title: "[测试] 三轮积分赛",
        description:
          "每轮 60 秒。第一题解出后持续得分，第二题每轮重新提交；比赛结束后保留逐轮积分。",
        starts_at: iso(start),
        ends_at: iso(end),
        challenge_ids: [
          state.challenges.welcome.id,
          state.challenges.caesar.id,
        ],
        challenge_settings: [
          {
            challenge_id: state.challenges.welcome.id,
            scoring: rules(50, true),
          },
          {
            challenge_id: state.challenges.caesar.id,
            scoring: rules(30, false),
          },
        ],
      });
      for (const team of ["alpha", "bravo", "charlie"])
        await register(contest, team);
      await until(start + 300);
      const live = await openActivity(a1, contest.id);
      const events = () =>
        live.frames.flatMap((frame) => frame.data?.items ?? []);
      try {
        await submit(a1, "welcome", contest.id, "flag{hello_nebuctf_test}");
        await submit(b1, "welcome", contest.id, "flag{hello_nebuctf_test}");
        assert.equal(
          (await submit(a2, "caesar", contest.id, "flag{decode_me_test}"))
            .already_solved,
          false,
        );
        assert.equal(
          (await submit(a1, "caesar", contest.id, "flag{decode_me_test}"))
            .already_solved,
          true,
        );
        await waitFor(
          "WebSocket first and second blood",
          () =>
            [1, 2].every((rank) =>
              events().some(
                (event) =>
                  event.challenge_id === state.challenges.welcome.id &&
                  event.blood_rank === rank,
              ),
            ),
          10000,
        );
        await waitFor(
          "first round settlement",
          async () => {
            const snapshot = await board(contest.id);
            return (
              snapshot.items.find((row) => row.id === state.teams.alpha.id)
                ?.score === 80
            );
          },
          80000,
        );
        await scoreEquals(contest.id, { alpha: 80, bravo: 50, charlie: 0 });
        assert.equal(
          (await submit(a1, "caesar", contest.id, "flag{decode_me_test}"))
            .already_solved,
          false,
        );
        await submit(b2, "caesar", contest.id, "flag{decode_me_test}");
        await submit(c, "welcome", contest.id, "flag{hello_nebuctf_test}");
        await waitFor(
          "WebSocket third blood",
          () =>
            events().some(
              (event) =>
                event.challenge_id === state.challenges.welcome.id &&
                event.blood_rank === 3,
            ),
          10000,
        );
        await waitFor(
          "second round settlement",
          async () =>
            (await board(contest.id)).items.find(
              (row) => row.id === state.teams.alpha.id,
            )?.score === 160,
          80000,
        );
        await scoreEquals(contest.id, { alpha: 160, bravo: 130, charlie: 50 });
        await submit(b1, "caesar", contest.id, "flag{decode_me_test}");
        await until(end + 500);
        await submit(a1, "caesar", contest.id, "flag{decode_me_test}", {
          status: 403,
        });
        await waitFor(
          "third round settlement",
          async () =>
            (await board(contest.id)).items.find(
              (row) => row.id === state.teams.alpha.id,
            )?.score === 210,
          25000,
        );
        await scoreEquals(contest.id, { alpha: 210, bravo: 210, charlie: 100 });
        const breakdown = await request(
          a1,
          `/scoreboard/${state.teams.alpha.id}?scope=${contest.id}`,
        );
        assert.equal(
          breakdown.cells.filter((cell) => cell.round_number).length,
          5,
        );
        await delay(11000);
        await scoreEquals(contest.id, { alpha: 210, bravo: 210, charlie: 100 });
        return {
          contest: contest.id,
          rounds: 3,
          websocketFrames: live.frames.length,
          scores: { alpha: 210, bravo: 210, charlie: 100 },
        };
      } finally {
        live.socket.close();
      }
    },
  );
}

async function awd() {
  const [a1, a2, b1, b2] = users();
  await check(
    "AWD rotates flags, attributes attacks, deploys repairs and settles four real rounds",
    async () => {
      const start = now() + 15000,
        end = start + 240000;
      const contest = await makeContest("awd", {
        title: "[测试] AWD 双队对抗赛",
        description:
          "四轮真实对抗，每轮 60 秒。攻击 100 分、防守 40 分、可用性 10 分；BRAVO 在第二轮提交修复。保留逐轮成绩供检查。",
        starts_at: iso(start),
        ends_at: iso(end),
        challenge_ids: [state.challenges.awd.id],
        challenge_settings: [
          {
            challenge_id: state.challenges.awd.id,
            scoring: {
              mode: "round",
              points: points(100),
              round: {
                interval: 60,
                carry: false,
                dynamic: false,
                flag_lifetime: 1,
                defense_points: 40,
                availability_points: 10,
              },
            },
          },
        ],
      });
      for (const team of ["alpha", "bravo"]) await register(contest, team);
      const scope = contest.id,
        base = `/challenges/${state.challenges.awd.id}`;
      const arena = () => request(a1, `${base}/arena?scope=${scope}`);
      const attack = (actor, flag, options) =>
        request(actor, `${base}/attack`, { scope, flag }, options);
      const ready = (round, changedTeam, oldInstance) =>
        waitFor(
          `AWD round ${round} healthy targets`,
          async () => {
            const value = await arena();
            return value.round?.number === round &&
              value.items.length === 2 &&
              value.items.every(
                (item) => item.status === "running" && item.health === "up",
              ) &&
              (!changedTeam ||
                value.items.find(
                  (item) => item.team_id === state.teams[changedTeam].id,
                )?.instance_id !== oldInstance)
              ? value
              : false;
          },
          45000,
        );
      const teamTarget = (value, team) =>
        value.items.find((item) => item.team_id === state.teams[team].id);
      const flagAt = (value, team) =>
        target(teamTarget(value, team).endpoint, "/leak").then((response) => {
          assert.equal(response.status, 200, `${team} vulnerable service`);
          return response.text();
        });
      const settled = (expected) =>
        waitFor(
          "AWD settlement",
          async () => {
            const value = await board(scope);
            return Object.entries(expected).every(
              ([team, score]) =>
                value.items.find((item) => item.id === state.teams[team].id)
                  ?.score === score,
            );
          },
          25000,
        );
      await until(start + 300);
      let value = await ready(1);
      const alphaFlag = await flagAt(value, "alpha"),
        bravoFlag = await flagAt(value, "bravo");
      assert.ok(alphaFlag !== bravoFlag, "AWD flags differ by team");
      assert.equal((await attack(a1, alphaFlag)).correct, false);
      assert.equal((await attack(a1, "flag{wrong_test}")).correct, false);
      assert.equal((await attack(a1, bravoFlag)).already_solved, false);
      assert.equal((await attack(a2, bravoFlag)).already_solved, true);
      await request(
        a1,
        `/instances/${teamTarget(value, "alpha").instance_id}/stop`,
        {},
        { status: 400 },
      );
      await until(start + 60000 + 300);
      value = await ready(2);
      await settled({ alpha: 150, bravo: 10 });
      assert.equal((await attack(a2, bravoFlag)).correct, false);
      const rotated = await flagAt(value, "alpha");
      assert.ok(rotated !== alphaFlag, "flags rotate with the round");
      assert.equal((await attack(b2, rotated)).correct, true);
      const oldBravo = teamTarget(value, "bravo").instance_id;
      const job = await request(
        b1,
        `${base}/patches?scope=${scope}`,
        patch(false),
      );
      const result = await patchResult(b2, "awd", scope, job.id);
      assert.equal(result.status, "passed", result.error ?? "AWD repair");
      value = await ready(2, "bravo", oldBravo);
      assert.equal(
        (await target(teamTarget(value, "bravo").endpoint, "/leak")).status,
        403,
      );
      assert.equal(
        (await target(teamTarget(value, "bravo").endpoint, "/health")).status,
        200,
      );
      await until(start + 120000 + 300);
      value = await ready(3);
      await settled({ alpha: 160, bravo: 160 });
      assert.equal(
        (await attack(b1, await flagAt(value, "alpha"))).correct,
        true,
      );
      const patchedInstance = teamTarget(value, "bravo").instance_id;
      await request(b2, `${base}/restart`, { scope });
      await request(b1, `${base}/restart`, { scope }, { status: 429 });
      value = await ready(3, "bravo", patchedInstance);
      assert.equal(
        (await target(teamTarget(value, "bravo").endpoint, "/leak")).status,
        403,
      );
      await until(start + 180000 + 300);
      await ready(4);
      await settled({ alpha: 170, bravo: 310 });
      await until(end + 500);
      await attack(a1, bravoFlag, { status: 403 });
      await settled({ alpha: 220, bravo: 360 });
      for (const team of ["alpha", "bravo"]) {
        const result = await request(
          admin,
          `/scoreboard/${state.teams[team].id}?scope=${scope}`,
        );
        assert.equal(result.cells.length, 4);
        const expected =
          team === "alpha"
            ? [
                [100, 40, 10],
                [0, 0, 10],
                [0, 0, 10],
                [0, 40, 10],
              ]
            : [
                [0, 0, 10],
                [100, 40, 10],
                [100, 40, 10],
                [0, 40, 10],
              ];
        for (const cell of result.cells) {
          const detail = cell.round_details;
          assert.deepEqual(
            [detail.attack, detail.defense, detail.availability],
            expected[cell.round_number - 1],
          );
          assert.equal(detail.health, "up");
        }
        assert.equal(
          result.members.reduce(
            (sum, member) => sum + member.score,
            result.team_points,
          ),
          team === "alpha" ? 220 : 360,
        );
      }
      await Promise.all(
        [a1, b1].map((actor) =>
          waitFor(
            "AWD automatic cleanup",
            async () =>
              !(await request(actor, `/instances?scope=${scope}`)).items.length,
            30000,
          ),
        ),
      );
      return {
        contest: scope,
        rounds: 4,
        repairedAndRestarted: true,
        scores: { alpha: 220, bravo: 360 },
      };
    },
  );
}

const command = process.argv[2];
if (command === "seed") await seed();
else if (command === "core") await core();
else if (command === "resources") await resources();
else if (command === "timing") await timing();
else if (command === "rounds") await rounds();
else if (command === "awd") await awd();
else
  throw Error(
    "Usage: test-competition-live.mjs seed|core|resources|timing|rounds|awd",
  );
await save();
await writeFile(
  `${directory}/accounts.json`,
  JSON.stringify(
    Object.entries(state.users).map(([key, user]) => ({
      username: user.username,
      email: user.email,
      password: user.password,
      team: state.teams[
        key.startsWith("alpha")
          ? "alpha"
          : key.startsWith("bravo")
            ? "bravo"
            : "charlie"
      ]?.name,
    })),
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
await writeFile(
  `${directory}/report.json`,
  JSON.stringify(
    {
      origin,
      updated_at: iso(now()),
      passed: state.passed.length,
      challenges: state.challenges,
      contests: state.contests,
      results: state.results,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(
  `Verified ${state.passed.length} cases; private state: ${directory}`,
);
