import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { openDB } from "../src/db.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
import { sessionCookie } from "../src/auth.js";
import { proofFor } from "./helpers/captcha.js";
import { sendWelcome } from "../src/welcome-message.js";
import { teamLogoDirectory } from "../src/team-logos.js";

test(
  "welcome delivery, registration forms and team logos",
  { timeout: 60000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "nebu-onboarding-")),
      previous = config.DATA_DIR;
    config.DATA_DIR = dir;
    const db = await openDB(true),
      app = await buildApp(db);
    await app.ready();
    t.after(async () => {
      await app.close();
      await db.close();
      config.DATA_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    });
    async function person(role = "user") {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID(),
        team = crypto.randomUUID(),
        username = "form_" + id.slice(0, 8);
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role,phone) VALUES($1,$2,$3,'test',$4,'13800138000')",
        [id, username, id + "@example.test", role],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      await db.query(
        "INSERT INTO teams(id,name,captain_id,invite_hash) VALUES($1,$2,$3,$4)",
        [team, username, id, crypto.randomUUID()],
      );
      await db.query("INSERT INTO memberships VALUES($1,$2)", [id, team]);
      return {
        id,
        team,
        username,
        headers: {
          cookie: `${sessionCookie}=${token}`,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
      };
    }
    const admin = await person("admin"),
      a = await person(),
      b = await person(),
      outsider = await person();
    await db.query("INSERT INTO memberships VALUES($1,$2)", [b.id, a.team]);
    const req = (
      path: string,
      actor = a,
      body?: unknown,
      method: any = body === undefined ? "GET" : "POST",
    ) =>
      app.inject({
        url: "/api" + path,
        method,
        headers: actor.headers,
        payload: body,
      });
    const fields = [
      {
        id: crypto.randomUUID(),
        label: "邮箱",
        type: "email",
        scope: "member",
        required: true,
        options: [],
      },
      {
        id: crypto.randomUUID(),
        label: "证书寄件地址",
        type: "address",
        scope: "team",
        required: true,
        options: [],
      },
      {
        id: crypto.randomUUID(),
        label: "参赛身份",
        type: "select",
        scope: "team",
        required: true,
        options: ["在校生", "社会选手"],
      },
    ];
    const setup = {
      title: "报名资料测试",
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
      published: true,
      require_review: true,
      registration_form: fields,
      groups: [
        { name: "公开组", review_mode: "auto" },
        { name: "审核组", review_mode: "required" },
        { name: "默认组", review_mode: "inherit" },
      ],
    };
    let cid: string, groups: any[], revision: string;
    const answers = {
      team: { [fields[1]!.id]: "上海市测试地址", [fields[2]!.id]: "在校生" },
      members: {
        [a.id]: { [fields[0]!.id]: "a@example.test" },
        [b.id]: { [fields[0]!.id]: "b@example.test" },
      },
    };
    await t.test(
      "configuration validates fields and exposes no submitted data publicly",
      async () => {
        assert.equal((await req("/admin/contests", a, setup)).statusCode, 403);
        assert.equal(
          (
            await req("/admin/contests", admin, {
              ...setup,
              registration_form: [fields[0], fields[0]],
            })
          ).statusCode,
          400,
        );
        const created = await req("/admin/contests", admin, setup);
        assert.equal(created.statusCode, 200, created.body);
        cid = created.json().id;
        const c = (await req("/contests/" + cid)).json();
        groups = c.groups.filter((g: any) => !g.is_default);
        assert.equal(c.registration_form.length, 3);
        assert.equal(c.form_answers, undefined);
        assert.equal(
          (
            await req(
              `/contests/${cid}/registration-form?team=${a.team}`,
              outsider,
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (await req(`/contests/${cid}/registration-form?team=${a.team}`, b))
            .statusCode,
          403,
        );
        const form = (
          await req(`/contests/${cid}/registration-form?team=${a.team}`)
        ).json();
        revision = form.revision;
        assert.ok(form.members.find((m: any) => m.id === a.id).email);
        assert.equal(form.members.find((m: any) => m.id === b.id).email, "");
      },
    );
    await t.test(
      "submission is atomic, validates revision, membership, required fields and field types",
      async () => {
        const body = {
          team_id: a.team,
          group_id: groups[0].id,
          form_revision: revision,
          form_answers: answers,
        };
        assert.equal(
          (
            await req(`/contests/${cid}/register`, a, {
              ...body,
              form_revision: "old",
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await req(`/contests/${cid}/register`, a, {
              ...body,
              form_answers: { ...answers, team: {} },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await req(`/contests/${cid}/register`, a, {
              ...body,
              form_answers: {
                ...answers,
                members: { ...answers.members, [outsider.id]: {} },
              },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await req(`/contests/${cid}/register`, a, {
              ...body,
              form_answers: {
                ...answers,
                members: {
                  ...answers.members,
                  [a.id]: { [fields[0]!.id]: "invalid" },
                },
              },
            })
          ).statusCode,
          400,
        );
        const sent = await req(`/contests/${cid}/register`, a, body);
        assert.equal(sent.statusCode, 200, sent.body);
        const [r] = await db.query(
          "SELECT * FROM registrations WHERE contest_id=$1 AND team_id=$2",
          [cid, a.team],
        );
        assert.equal(r!.status, "accepted");
        assert.deepEqual(r!.form_answers, answers);
        assert.equal(r!.submitted_members.length, 2);
        const list = (
          await req(`/admin/contests/${cid}/registrations`, admin)
        ).json();
        assert.equal(list.items[0].form_answers, undefined);
        assert.equal(list.items[0].form_fields, 3);
        const detail = await req(
          `/admin/contests/${cid}/registrations/${a.team}`,
          admin,
        );
        assert.deepEqual(detail.json().form_answers, answers);
        assert.equal(
          (
            await req(
              `/admin/contests/${cid}/registrations/${a.team}`,
              outsider,
            )
          ).statusCode,
          403,
        );
        await db.query("INSERT INTO memberships VALUES($1,$2)", [
          outsider.id,
          a.team,
        ]);
        await db.query("UPDATE teams SET captain_id=$1 WHERE id=$2", [
          outsider.id,
          a.team,
        ]);
        assert.equal(
          (
            await req(
              `/contests/${cid}/registration-form?team=${a.team}`,
              outsider,
            )
          ).statusCode,
          403,
        );
        await db.query("UPDATE teams SET captain_id=$1 WHERE id=$2", [
          a.id,
          a.team,
        ]);
        await db.query(
          "DELETE FROM memberships WHERE user_id=$1 AND team_id=$2",
          [outsider.id, a.team],
        );
      },
    );
    await t.test(
      "group rules override the contest, while inherited rules keep the default",
      async () => {
        const c2 = (
          await req("/admin/contests", admin, {
            ...setup,
            registration_form: [],
            require_review: false,
          })
        ).json().id;
        const c = (await req("/contests/" + c2)).json();
        const sent = await req(`/contests/${c2}/register`, outsider, {
          team_id: outsider.team,
          group_id: c.groups.filter((g: any) => !g.is_default)[1].id,
        });
        assert.equal(sent.statusCode, 200, sent.body);
        assert.equal(
          (await req("/contests/" + c2, outsider)).json().registration.status,
          "pending",
        );
        const oldGroups = (await req(`/admin/contests/${c2}`, admin)).json()
          .groups;
        const changed = await req(
          `/admin/contests/${c2}`,
          admin,
          {
            ...setup,
            registration_form: [],
            require_review: false,
            groups: oldGroups.map((g: any) => ({
              id: g.id,
              name: g.name,
              description: g.description,
              permissions: g.permissions,
              review_mode: "inherit",
            })),
          },
          "PUT",
        );
        assert.equal(changed.statusCode, 200, changed.body);
        const inherited = await req(`/contests/${c2}/register`, a, {
          team_id: a.team,
          group_id: c.groups.filter((g: any) => !g.is_default)[1].id,
        });
        assert.equal(inherited.statusCode, 200, inherited.body);
        assert.equal(
          (await req("/contests/" + c2, a)).json().registration.status,
          "accepted",
        );
        const c3 = (
          await req("/admin/contests", admin, {
            ...setup,
            registration_form: [],
            require_review: true,
          })
        ).json().id;
        const g = (await req("/contests/" + c3))
          .json()
          .groups.filter((g: any) => !g.is_default)[2].id;
        assert.equal(
          (
            await req(`/contests/${c3}/register`, a, {
              team_id: a.team,
              group_id: g,
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (await req("/contests/" + c3)).json().registration.status,
          "pending",
        );
      },
    );
    await t.test(
      "review retains the submitted schema and blocks changed member rosters",
      async () => {
        const c2 = (await req("/admin/contests", admin, setup)).json().id,
          current = (await req("/contests/" + c2)).json();
        assert.equal(
          (
            await req(`/contests/${c2}/register`, a, {
              team_id: a.team,
              group_id: current.groups.filter((g: any) => !g.is_default)[1].id,
              form_revision: revision,
              form_answers: answers,
            })
          ).statusCode,
          200,
        );
        await db.query(
          "DELETE FROM memberships WHERE user_id=$1 AND team_id=$2",
          [b.id, a.team],
        );
        const review = await req(
          `/admin/contests/${c2}/registrations`,
          admin,
          { team_ids: [a.team], status: "accepted" },
          "PUT",
        );
        assert.equal(review.statusCode, 409);
        const detail = (
          await req(`/admin/contests/${c2}/registrations/${a.team}`, admin)
        ).json();
        assert.ok(
          detail.members.some((m: any) => m.id === b.id && !m.current_member),
        );
        const edit = await req(
          "/admin/contests/" + cid,
          admin,
          { ...setup, registration_form: [], groups },
          "PUT",
        );
        assert.equal(edit.statusCode, 200, edit.body);
        assert.equal(
          (
            await req(`/admin/contests/${cid}/registrations/${a.team}`, admin)
          ).json().form_snapshot.length,
          3,
        );
      },
    );
    await t.test(
      "welcome settings deliver once after a successful registration with safe guidance buttons",
      async () => {
        const welcome = {
          enabled: true,
          title: "欢迎 {username}",
          body: "欢迎来到 {site_name}",
          actions: [
            { label: "个人资料", href: "/account?section=profile" },
            { label: "创建战队", href: "/team/new" },
          ],
        };
        assert.equal(
          (await req("/admin/settings/welcome", a, welcome, "PUT")).statusCode,
          403,
        );
        assert.equal(
          (
            await req(
              "/admin/settings/welcome",
              admin,
              { ...welcome, actions: [{ label: "bad", href: "//evil.test" }] },
              "PUT",
            )
          ).statusCode,
          400,
        );
        assert.equal(
          (await req("/admin/settings/welcome", admin, welcome, "PUT"))
            .statusCode,
          200,
        );
        const register = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          headers: { origin: config.APP_ORIGIN, "x-csrf-protection": "1" },
          payload: {
            username: "welcome_player",
            email: "welcome@example.test",
            password: "pass1234",
            captcha: await proofFor(app, "register"),
          },
        });
        assert.equal(register.statusCode, 200, register.body);
        const user = register.json().user;
        await db.transaction((tx) => sendWelcome(tx, user));
        const rows = await db.query(
          "SELECT n.* FROM notifications n JOIN notification_recipients r ON r.notification_id=n.id WHERE r.user_id=$1",
          [user.id],
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.title, "欢迎 welcome_player");
        assert.equal(rows[0]!.actions.length, 2);
        await req(
          "/admin/settings/welcome",
          admin,
          { ...welcome, enabled: false },
          "PUT",
        );
        await db.transaction((tx) => sendWelcome(tx, outsider));
        assert.equal(
          (
            await db.query("SELECT 1 FROM notifications WHERE event_key=$1", [
              "welcome:" + outsider.id,
            ])
          ).length,
          0,
        );
      },
    );
    await t.test(
      "logos are captain-only, compressed, cacheable, and replaced without orphan files",
      async () => {
        const image = await sharp({
          create: {
            width: 640,
            height: 400,
            channels: 3,
            background: "#64748b",
          },
        })
          .png()
          .toBuffer();
        const upload = async (actor = a, content = image) => {
          const boundary = "nebu-logo";
          return app.inject({
            method: "POST",
            url: `/api/teams/${a.team}/logo`,
            headers: {
              ...actor.headers,
              "content-type": `multipart/form-data; boundary=${boundary}`,
            },
            payload: Buffer.concat([
              Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`,
              ),
              content,
              Buffer.from(`\r\n--${boundary}--\r\n`),
            ]),
          });
        };
        assert.equal((await upload(b)).statusCode, 403);
        assert.equal((await upload(outsider)).statusCode, 403);
        const first = await upload();
        assert.equal(first.statusCode, 200, first.body);
        const logo = first.json().logo_id;
        const file = await readFile(join(teamLogoDirectory(), logo + ".webp")),
          meta = await sharp(file).metadata();
        assert.equal(meta.width, 256);
        assert.equal(meta.height, 256);
        assert.equal(meta.format, "webp");
        assert.equal(meta.exif, undefined);
        const publicFile = await app.inject("/api/team-logos/" + logo);
        assert.equal(publicFile.statusCode, 200);
        assert.deepEqual(publicFile.rawPayload, file);
        assert.equal(
          (
            await app.inject({
              url: "/api/team-logos/" + logo,
              headers: { "if-none-match": `"${logo}"` },
            })
          ).statusCode,
          304,
        );
        assert.equal((await upload(a, Buffer.from("bad"))).statusCode, 400);
        assert.equal(
          (await req("/teams/mine"))
            .json()
            .items.find((t: any) => t.id === a.team).logo_id,
          logo,
        );
        const second = await upload();
        assert.equal(second.statusCode, 200);
        await assert.rejects(
          readFile(join(teamLogoDirectory(), logo + ".webp")),
        );
        const board = (await req("/scoreboard?scope=" + cid, admin)).json();
        assert.equal(
          board.items.find((r: any) => r.id === a.team).logo_id,
          second.json().logo_id,
        );
        assert.equal(
          (await req(`/teams/${a.team}/logo`, a, undefined, "DELETE"))
            .statusCode,
          200,
        );
        await assert.rejects(
          readFile(join(teamLogoDirectory(), second.json().logo_id + ".webp")),
        );
      },
    );
  },
);
