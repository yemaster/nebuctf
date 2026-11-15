import { test } from "node:test";
import assert from "node:assert/strict";
import type { HTTPMethods, LightMyRequestResponse } from "fastify";
import { openDB } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { sessionCookie } from "../src/auth.js";
import { config } from "../src/config.js";
import { digest } from "../src/security.js";
import type { ApiKeyPolicy } from "../src/api-keys.js";
import { defaults, saveSetting } from "../src/settings.js";

// Exercise real handlers and persisted credentials, including current ACL changes.
test(
  "personal API keys enforce policy, ownership and live account permissions",
  { timeout: 60000 },
  async (t) => {
    const db = await openDB(process.env.TEST_POSTGRES !== "1");
    const app = await buildApp(db);
    t.after(async () => {
      await app.close();
      await db.close();
    });
    const account = async (role = "user", permissions: string[] = []) => {
      const id = crypto.randomUUID(),
        token = crypto.randomUUID();
      await db.query(
        "INSERT INTO users(id,username,email,password_hash,role,access_profile) VALUES($1,$2,$3,'test',$4,$5)",
        [
          id,
          `key${id.slice(0, 8)}`,
          `${id}@example.test`,
          role,
          JSON.stringify({ permissions, roles: [], grants: [] }),
        ],
      );
      await db.query(
        "INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",
        [digest(token), id],
      );
      return { id, cookie: `${sessionCookie}=${token}` };
    };
    const admin = await account("admin"),
      owner = await account(),
      other = await account();
    const reader = await account("user", ["settings.read"]);
    const policy: ApiKeyPolicy = {
      enabled: true,
      allowed_scopes: ["profile:read", "profile:write", "admin:content:read"],
      max_lifetime_days: 30,
      identities: [],
    };
    const input = (scopes = ["profile:read"]) => ({
      name: "automation",
      scopes,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    const session = (
      url: string,
      who = owner,
      payload?: object,
      method: HTTPMethods = payload ? "POST" : "GET",
    ) =>
      app.inject({
        url: `/api${url}`,
        method,
        headers: {
          cookie: who.cookie,
          origin: config.APP_ORIGIN,
          "x-csrf-protection": "1",
        },
        payload,
      });
    const bearer = (
      url: string,
      key: string,
      payload?: object,
      method: HTTPMethods = payload ? "PUT" : "GET",
      cookie?: string,
    ) =>
      app.inject({
        url: `/api${url}`,
        method,
        headers: {
          authorization: `Bearer ${key}`,
          ...(cookie ? { cookie } : {}),
        },
        payload,
      });
    const succeeds = async (response: PromiseLike<LightMyRequestResponse>) => {
      const r = await response;
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    let readKey: {
      item: {
        id: string;
        prefix: string;
        identity_id: string | null;
        identity_name: string | null;
      };
      key: string;
    };
    await t.test(
      "policy requires session settings privileges and CSRF; catalog hides disabled scopes",
      async () => {
        const disabledCatalog = await succeeds(
          app.inject({ url: "/api/api-keys/catalog" }),
        );
        assert.deepEqual(disabledCatalog.scopes, []);
        assert.deepEqual(disabledCatalog.identities, []);
        assert.equal(
          (await session("/admin/api-keys/policy", owner)).statusCode,
          403,
        );
        assert.equal(
          (await session("/account/api-keys", owner, input())).statusCode,
          403,
        );
        assert.equal(
          (await session("/admin/api-keys/policy", reader, policy, "PUT"))
            .statusCode,
          403,
        );
        const snapshot = await succeeds(
          session("/admin/api-keys/policy", reader),
        );
        assert.ok(
          snapshot.scopes.some(
            (scope: { id: string }) => scope.id === "profile:read",
          ),
        );
        assert.equal("identity_presets" in snapshot, false);
        assert.equal(
          (
            await app.inject({
              url: "/api/admin/api-keys/policy",
              method: "PUT",
              headers: { cookie: admin.cookie },
              payload: policy,
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await session(
              "/admin/api-keys/policy",
              admin,
              { ...policy, allowed_scopes: ["*"] },
              "PUT",
            )
          ).statusCode,
          400,
        );
        await succeeds(session("/admin/api-keys/policy", admin, policy, "PUT"));
        const catalog = await succeeds(
          app.inject({ url: "/api/api-keys/catalog" }),
        );
        assert.deepEqual(
          catalog.scopes.map((scope: { id: string }) => scope.id).sort(),
          [...policy.allowed_scopes].sort(),
        );
        assert.equal(
          JSON.stringify(catalog).includes("/api/admin/challenges"),
          false,
        );
      },
    );
    await t.test(
      "creation validates permissions/expiry and reveals a secret only once",
      async () => {
        assert.equal(
          (await session("/account/api-keys", owner, input(["content:read"])))
            .statusCode,
          403,
        );
        assert.equal(
          (
            await session("/account/api-keys", owner, {
              ...input(),
              scopes: ["profile:read", "profile:read"],
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await session("/account/api-keys", owner, {
              ...input(),
              expires_at: new Date(Date.now() - 1000).toISOString(),
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await session("/account/api-keys", owner, {
              ...input(),
              expires_at: new Date(Date.now() + 31 * 86400000).toISOString(),
            })
          ).statusCode,
          400,
        );
        readKey = await succeeds(session("/account/api-keys", owner, input()));
        assert.match(readKey.key, /^nebu_[A-Za-z0-9_-]{43}$/);
        assert.equal(readKey.item.prefix, readKey.key.slice(0, 12));
        assert.equal(readKey.item.identity_id, null);
        assert.equal(readKey.item.identity_name, null);
        const [stored] = await db.query(
          "SELECT token_hash FROM api_keys WHERE id=$1",
          [readKey.item.id],
        );
        assert.equal(stored!.token_hash, digest(readKey.key));
        const list = await succeeds(session("/account/api-keys"));
        assert.equal(
          list.items.find((item: { id: string }) => item.id === readKey.item.id)
            .name,
          "automation",
        );
        assert.equal(JSON.stringify(list).includes(readKey.key), false);
        assert.equal(JSON.stringify(list).includes(stored!.token_hash), false);
        const audit = await db.query(
          "SELECT action,target FROM audit_logs WHERE actor_id=$1",
          [owner.id],
        );
        assert.equal(JSON.stringify(audit).includes(readKey.key), false);
      },
    );
    await t.test(
      "Bearer identity wins over cookies, read/write are independent, and use is recorded",
      async () => {
        const profile = await succeeds(
          bearer(
            "/account/profile",
            readKey.key,
            undefined,
            "GET",
            admin.cookie,
          ),
        );
        assert.equal(profile.real_name, "");
        assert.equal(
          (
            await bearer("/me", readKey.key, undefined, "GET", admin.cookie)
          ).json().user.id,
          owner.id,
        );
        assert.equal(
          (
            await bearer("/account/profile", readKey.key, {
              real_name: "forbidden",
              student_number: "",
              phone: "",
            })
          ).statusCode,
          403,
        );
        const [usage] = await db.query(
          "SELECT last_used_at FROM api_keys WHERE id=$1",
          [readKey.item.id],
        );
        assert.ok(usage!.last_used_at);
        const firstUse = new Date(usage!.last_used_at).getTime();
        assert.equal(
          (await bearer("/account/profile", readKey.key, undefined, "HEAD"))
            .statusCode,
          200,
        );
        const [again] = await db.query(
          "SELECT last_used_at FROM api_keys WHERE id=$1",
          [readKey.item.id],
        );
        assert.equal(new Date(again!.last_used_at).getTime(), firstUse);
        const writeKey = await succeeds(
          session("/account/api-keys", other, input(["profile:write"])),
        );
        const changed = await succeeds(
          bearer("/account/profile", writeKey.key, {
            real_name: "API owner",
            student_number: "2026",
            phone: "123",
          }),
        );
        assert.equal(changed.real_name, "API owner");
        assert.equal(
          (await bearer("/account/profile", writeKey.key)).statusCode,
          403,
        );
        assert.equal(
          (await succeeds(session("/account/profile", other))).real_name,
          "API owner",
        );
        assert.equal(
          (await succeeds(session("/account/profile", owner))).real_name,
          "",
        );
        assert.equal(
          (
            await bearer(
              "/account/profile",
              "nebu_" + "x".repeat(43),
              undefined,
              "GET",
              admin.cookie,
            )
          ).statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              url: "/api/help",
              headers: { authorization: "Basic invalid", cookie: admin.cookie },
            })
          ).statusCode,
          401,
        );
      },
    );
    await t.test(
      "keys cannot manage credentials, security settings or unlisted routes even with admin cookies",
      async () => {
        for (const path of [
          "/account/api-keys",
          "/admin/api-keys/policy",
          "/admin/settings/site",
          "/admin/users",
          "/api-keys/catalog",
          "/not-registered",
        ]) {
          assert.equal(
            (await bearer(path, readKey.key, undefined, "GET", admin.cookie))
              .statusCode,
            403,
            path,
          );
        }
        assert.equal(
          (
            await bearer(
              "/account/api-keys",
              readKey.key,
              input(),
              "POST",
              admin.cookie,
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await bearer(
              "/auth/password",
              readKey.key,
              { current: "irrelevant", password: "different-password" },
              "POST",
              admin.cookie,
            )
          ).statusCode,
          403,
        );
        const foreign = `/account/api-keys/${readKey.item.id}`;
        assert.equal(
          (await session(foreign, other, input(), "PUT")).statusCode,
          404,
        );
        assert.equal(
          (await session(foreign, other, undefined, "DELETE")).statusCode,
          404,
        );
        assert.equal(
          (await succeeds(session("/account/api-keys", other))).items.some(
            (item: { id: string }) => item.id === readKey.item.id,
          ),
          false,
        );
      },
    );
    await t.test(
      "normal account ACLs and administrator scope removal apply on the next request",
      async () => {
        const key = await succeeds(
          session("/account/api-keys", other, input(["admin:content:read"])),
        );
        assert.equal(
          (await bearer("/admin/help", key.key, undefined, "GET", admin.cookie))
            .statusCode,
          403,
        );
        await db.query("UPDATE users SET access_profile=$2 WHERE id=$1", [
          other.id,
          JSON.stringify({
            permissions: ["content.read"],
            roles: [],
            grants: [],
          }),
        ]);
        const documents = await succeeds(bearer("/admin/help", key.key));
        assert.ok(
          documents.items.some(
            (item: { slug: string }) => item.slug === "quick-start",
          ),
        );
        await db.query("UPDATE users SET access_profile=$2 WHERE id=$1", [
          other.id,
          JSON.stringify({ permissions: [], roles: [], grants: [] }),
        ]);
        assert.equal((await bearer("/admin/help", key.key)).statusCode, 403);
        await succeeds(
          session(
            "/admin/api-keys/policy",
            admin,
            { ...policy, allowed_scopes: ["profile:write"] },
            "PUT",
          ),
        );
        assert.equal(
          (await bearer("/account/profile", readKey.key)).statusCode,
          403,
        );
        assert.deepEqual(
          (
            await succeeds(app.inject({ url: "/api/api-keys/catalog" }))
          ).scopes.map((scope: { id: string }) => scope.id),
          ["profile:write"],
        );
        await succeeds(session("/admin/api-keys/policy", admin, policy, "PUT"));
        await db.query("UPDATE users SET disabled=true WHERE id=$1", [
          owner.id,
        ]);
        assert.equal(
          (await bearer("/account/profile", readKey.key)).statusCode,
          401,
        );
        await db.query("UPDATE users SET disabled=false WHERE id=$1", [
          owner.id,
        ]);
      },
    );
    await t.test(
      "editing changes effective scopes, revocation works while disabled, and expired keys cannot revive",
      async () => {
        const changed = await succeeds(
          session(
            `/account/api-keys/${readKey.item.id}`,
            owner,
            { ...input(["profile:write"]), name: "renamed" },
            "PUT",
          ),
        );
        assert.equal(changed.item.name, "renamed");
        assert.equal("key" in changed, false);
        assert.equal(
          (await bearer("/account/profile", readKey.key)).statusCode,
          403,
        );
        await succeeds(
          bearer("/account/profile", readKey.key, {
            real_name: "changed scope",
            student_number: "",
            phone: "",
          }),
        );
        await succeeds(
          session(
            "/admin/api-keys/policy",
            admin,
            { ...policy, enabled: false },
            "PUT",
          ),
        );
        assert.equal(
          (
            await bearer("/account/profile", readKey.key, {
              real_name: "blocked",
              student_number: "",
              phone: "",
            })
          ).statusCode,
          403,
        );
        assert.deepEqual(
          (await succeeds(app.inject({ url: "/api/api-keys/catalog" }))).scopes,
          [],
        );
        assert.equal(
          (await succeeds(session("/account/api-keys"))).items.some(
            (item: { id: string }) => item.id === readKey.item.id,
          ),
          true,
        );
        await succeeds(
          session(
            `/account/api-keys/${readKey.item.id}`,
            owner,
            undefined,
            "DELETE",
          ),
        );
        await succeeds(session("/admin/api-keys/policy", admin, policy, "PUT"));
        assert.equal(
          (await bearer("/account/profile", readKey.key)).statusCode,
          401,
        );
        assert.equal(
          (
            await session(
              `/account/api-keys/${readKey.item.id}`,
              owner,
              input(),
              "PUT",
            )
          ).statusCode,
          409,
        );
        const expired = await succeeds(
          session("/account/api-keys", other, input()),
        );
        await db.query(
          "UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1",
          [expired.item.id],
        );
        assert.equal(
          (await bearer("/account/profile", expired.key)).statusCode,
          401,
        );
        assert.equal(
          (
            await session(
              `/account/api-keys/${expired.item.id}`,
              other,
              input(),
              "PUT",
            )
          ).statusCode,
          409,
        );
      },
    );
    await t.test(
      "concurrent creation cannot exceed the live-key limit, and revoked history frees capacity",
      async () => {
        const crowded = await account();
        for (let n = 0; n < 19; n++) {
          await db.query(
            "INSERT INTO api_keys(id,user_id,name,token_hash,prefix,scopes,expires_at) VALUES($1,$2,$3,$4,'nebu_fixture',$5,now()+interval '1 day')",
            [
              crypto.randomUUID(),
              crowded.id,
              `existing-${n}`,
              digest(crypto.randomUUID()),
              JSON.stringify(["profile:read"]),
            ],
          );
        }
        const responses = await Promise.all([
          session("/account/api-keys", crowded, input()),
          session("/account/api-keys", crowded, input()),
        ]);
        assert.deepEqual(
          responses.map((response) => response.statusCode).sort(),
          [200, 409],
        );
        const inventory = await succeeds(session("/account/api-keys", crowded));
        assert.equal(inventory.total, 20);
        await succeeds(
          session(
            `/account/api-keys/${inventory.items[0].id}`,
            crowded,
            undefined,
            "DELETE",
          ),
        );
        await succeeds(session("/account/api-keys", crowded, input()));
        const final = await succeeds(session("/account/api-keys", crowded));
        assert.equal(final.total, 21);
        assert.equal(
          final.items.filter(
            (item: { revoked_at: string | null }) => !item.revoked_at,
          ).length,
          20,
        );
      },
    );
    const identityPolicy = (
      scopes = ["profile:read"],
      enabled = true,
    ): ApiKeyPolicy => ({
      ...policy,
      allowed_scopes: ["profile:read", "profile:write"],
      identities: [
        { id: "readonly", name: "Read access", enabled, scopes },
        {
          id: "participant",
          name: "Participant",
          enabled: false,
          scopes: ["submissions:write"],
        },
        {
          id: "content-manager",
          name: "Content manager",
          enabled: false,
          scopes: ["admin:content:read"],
        },
        {
          id: "contest-manager",
          name: "Contest manager",
          enabled: false,
          scopes: [],
        },
      ],
    });
    const identityInput = (identity_id = "readonly") => ({
      name: "identity automation",
      identity_id,
      expires_at: input().expires_at,
    });
    const saveIdentityPolicy = (value = identityPolicy()) =>
      succeeds(session("/admin/api-keys/policy", admin, value, "PUT"));
    await t.test(
      "legacy stored identities gain names only on read and empty identities stay empty",
      async () => {
        const legacy = {
          ...identityPolicy(),
          identities: identityPolicy().identities.map(
            ({ name: _name, ...identity }) => identity,
          ),
        };
        await saveSetting(db, "api_keys", legacy);
        const normalized = await succeeds(
          session("/admin/api-keys/policy", admin),
        );
        assert.deepEqual(
          normalized.policy.identities,
          legacy.identities.map((identity) => ({
            ...identity,
            name: defaults.api_keys.identities.find(
              (entry) => entry.id === identity.id,
            )!.name,
          })),
        );
        const [stored] = await db.query(
          "SELECT value FROM system_settings WHERE key='api_keys'",
        );
        assert.deepEqual(stored!.value, legacy);
        assert.equal(
          (await session("/admin/api-keys/policy", admin, legacy, "PUT"))
            .statusCode,
          400,
        );
        await succeeds(
          session("/admin/api-keys/policy", admin, normalized.policy, "PUT"),
        );
        const { identities: _identities, ...oldPolicy } = policy;
        await saveSetting(db, "api_keys", oldPolicy);
        const old = await succeeds(session("/admin/api-keys/policy", admin));
        assert.deepEqual(old.policy.identities, defaults.api_keys.identities);
        await saveIdentityPolicy({ ...policy, identities: [] });
        assert.deepEqual(
          (await succeeds(session("/admin/api-keys/policy", admin))).policy
            .identities,
          [],
        );
      },
    );
    await t.test(
      "custom identities support rename, live grants, deletion and safe recreation",
      async () => {
        const identityOwner = await account();
        const id = crypto.randomUUID();
        const customPolicy: ApiKeyPolicy = {
          ...policy,
          allowed_scopes: ["profile:read"],
          identities: [
            {
              id,
              name: "  Integration reader  ",
              enabled: true,
              scopes: ["profile:read", "profile:write", "admin:content:read"],
            },
          ],
        };
        await saveIdentityPolicy(customPolicy);
        const issued = await succeeds(
          session("/account/api-keys", identityOwner, identityInput(id)),
        );
        assert.equal(issued.item.identity_name, "Integration reader");
        assert.deepEqual(issued.item.scopes, ["profile:read"]);
        const plain = await succeeds(
          session("/account/api-keys", identityOwner, input()),
        );
        const catalog = await succeeds(
          app.inject({ url: "/api/api-keys/catalog" }),
        );
        assert.deepEqual(catalog.identities, [
          {
            id,
            name: "Integration reader",
            scopes: ["profile:read"],
          },
        ]);
        const inventory = await succeeds(
          session("/account/api-keys", identityOwner),
        );
        assert.deepEqual(inventory.policy.identities, [
          {
            ...catalog.identities[0],
            enabled: true,
          },
        ]);
        assert.equal(
          JSON.stringify(inventory.policy).includes("admin:content:read"),
          false,
        );
        assert.deepEqual(
          catalog.scopes.map((scope: { id: string }) => scope.id),
          ["profile:read"],
        );
        customPolicy.identities[0]!.name = "Renamed integration";
        customPolicy.allowed_scopes.push("profile:write");
        await saveIdentityPolicy(customPolicy);
        const renamed = await succeeds(
          session("/account/api-keys", identityOwner),
        );
        assert.equal(
          renamed.items.find(
            (item: { id: string }) => item.id === issued.item.id,
          ).identity_name,
          "Renamed integration",
        );
        const profileUpdate = {
          real_name: "custom identity",
          student_number: "",
          phone: "",
        };
        for (const key of [issued.key, plain.key]) {
          await succeeds(bearer("/account/profile", key));
          assert.equal(
            (await bearer("/account/profile", key, profileUpdate)).statusCode,
            403,
          );
        }
        const fresh = await succeeds(
          session("/account/api-keys", identityOwner, identityInput(id)),
        );
        assert.equal(fresh.item.identity_name, "Renamed integration");
        assert.deepEqual(fresh.item.scopes, ["profile:read", "profile:write"]);
        await succeeds(bearer("/account/profile", fresh.key, profileUpdate));
        customPolicy.allowed_scopes = ["profile:read"];
        await saveIdentityPolicy(customPolicy);
        assert.equal(
          (await bearer("/account/profile", fresh.key, profileUpdate))
            .statusCode,
          403,
        );
        await succeeds(bearer("/account/profile", fresh.key));
        const path = `/account/api-keys/${fresh.item.id}`;
        assert.equal(
          (
            await session(
              path,
              identityOwner,
              identityInput(crypto.randomUUID()),
              "PUT",
            )
          ).statusCode,
          403,
        );
        customPolicy.allowed_scopes = ["profile:write"];
        customPolicy.identities[0]!.scopes = ["profile:read"];
        await saveIdentityPolicy(customPolicy);
        for (const method of ["POST", "PUT"] as const) {
          assert.equal(
            (
              await session(
                method === "POST" ? "/account/api-keys" : path,
                identityOwner,
                identityInput(id),
                method,
              )
            ).statusCode,
            403,
          );
        }
        assert.deepEqual(
          (await succeeds(app.inject({ url: "/api/api-keys/catalog" })))
            .identities,
          [],
        );
        await saveIdentityPolicy({ ...customPolicy, identities: [] });
        const [removed] = await db.query(
          "SELECT revoked_at FROM api_keys WHERE id=$1",
          [issued.item.id],
        );
        assert.ok(removed!.revoked_at);
        const history = await succeeds(
          session("/account/api-keys", identityOwner),
        );
        for (const key of [issued, fresh]) {
          const item = history.items.find(
            (item: { id: string }) => item.id === key.item.id,
          );
          assert.equal(item.identity_name, null);
          assert.ok(item.revoked_at);
          assert.equal(JSON.stringify(history).includes(key.key), false);
          assert.equal(
            (await bearer("/account/profile", key.key)).statusCode,
            401,
          );
        }
        assert.equal(JSON.stringify(history).includes("token_hash"), false);
        assert.deepEqual(history.policy.identities, []);
        customPolicy.allowed_scopes = ["profile:read"];
        await saveIdentityPolicy(customPolicy);
        for (const key of [issued, fresh]) {
          assert.equal(
            (await bearer("/account/profile", key.key)).statusCode,
            401,
          );
          assert.equal(
            (
              await session(
                `/account/api-keys/${key.item.id}`,
                identityOwner,
                identityInput(id),
                "PUT",
              )
            ).statusCode,
            409,
          );
        }
        const recreated = await succeeds(
          session("/account/api-keys", identityOwner, identityInput(id)),
        );
        await succeeds(bearer("/account/profile", recreated.key));
        // Even a stored key referencing an unknown identity cannot authenticate.
        await db.query("UPDATE api_keys SET identity_id=$2 WHERE id=$1", [
          recreated.item.id,
          crypto.randomUUID(),
        ]);
        assert.equal(
          (await bearer("/account/profile", recreated.key)).statusCode,
          403,
        );
        await succeeds(bearer("/account/profile", plain.key));
      },
    );
    await t.test(
      "identity catalogs and account policy expose only the global intersection",
      async () => {
        await saveIdentityPolicy(
          identityPolicy(["profile:read", "admin:content:read"]),
        );
        const expected = [{ id: "readonly", scopes: ["profile:read"] }];
        const catalog = await succeeds(
          app.inject({ url: "/api/api-keys/catalog" }),
        );
        assert.deepEqual(
          catalog.identities.map(
            ({ id, scopes }: { id: string; scopes: string[] }) => ({
              id,
              scopes,
            }),
          ),
          expected,
        );
        assert.deepEqual(
          catalog.scopes.map((scope: { id: string }) => scope.id),
          ["profile:read", "profile:write"],
        );
        const inventory = await succeeds(session("/account/api-keys"));
        assert.deepEqual(
          inventory.identities.map(
            ({ id, scopes }: { id: string; scopes: string[] }) => ({
              id,
              scopes,
            }),
          ),
          expected,
        );
        assert.deepEqual(inventory.policy.identities, [
          identityPolicy().identities[0],
        ]);
        assert.deepEqual(inventory.scopes, catalog.scopes);
        assert.equal(
          JSON.stringify(catalog).includes("submissions:write"),
          false,
        );
        assert.equal(
          JSON.stringify(inventory.policy).includes("admin:content:read"),
          false,
        );
        await saveIdentityPolicy({ ...identityPolicy(), enabled: false });
        const disabled = await succeeds(
          app.inject({ url: "/api/api-keys/catalog" }),
        );
        assert.deepEqual(disabled.identities, []);
        assert.deepEqual(disabled.scopes, []);
        assert.deepEqual(
          (await succeeds(session("/account/api-keys"))).policy.identities,
          [],
        );
        await saveIdentityPolicy(identityPolicy([]));
        assert.deepEqual(
          (await succeeds(app.inject({ url: "/api/api-keys/catalog" })))
            .identities,
          [],
        );
        await saveIdentityPolicy(identityPolicy(["admin:content:read"]));
        const emptyEffective = await succeeds(session("/account/api-keys"));
        assert.deepEqual(emptyEffective.policy.identities, []);
        assert.deepEqual(emptyEffective.identities, []);
        assert.deepEqual(
          (await succeeds(app.inject({ url: "/api/api-keys/catalog" })))
            .identities,
          [],
        );
        await succeeds(session("/admin/api-keys/policy", admin, policy, "PUT"));
        const normalized = await succeeds(
          session("/admin/api-keys/policy", admin),
        );
        assert.deepEqual(normalized.policy.identities, []);
        assert.deepEqual(
          (await succeeds(app.inject({ url: "/api/api-keys/catalog" })))
            .identities,
          [],
        );
      },
    );
    await t.test(
      "policy and key inputs reject unknown, duplicate or ambiguous identity permissions",
      async () => {
        const valid = identityPolicy();
        for (const identities of [
          Array.from({ length: 51 }, () => ({
            ...valid.identities[0],
            id: crypto.randomUUID(),
          })),
          [...valid.identities.slice(1), valid.identities[1]],
          valid.identities.map((identity, index) =>
            index === 0 ? { ...identity, id: "administrator" } : identity,
          ),
          valid.identities.map((identity, index) =>
            index === 0 ? { ...identity, scopes: ["*"] } : identity,
          ),
          valid.identities.map((identity, index) =>
            index === 0
              ? { ...identity, scopes: ["profile:read", "profile:read"] }
              : identity,
          ),
          ...["", "   ", "x".repeat(49), "bad\u0000name"].map((name) =>
            valid.identities.map((identity, index) =>
              index === 0 ? { ...identity, name } : identity,
            ),
          ),
          valid.identities.map(({ name, ...identity }, index) =>
            index === 0 ? identity : { ...identity, name },
          ),
          valid.identities.map((identity, index) =>
            index === 0 ? { ...identity, id: "custom" } : identity,
          ),
          [{ id: crypto.randomUUID(), enabled: true, scopes: [] }],
        ]) {
          assert.equal(
            (
              await session(
                "/admin/api-keys/policy",
                admin,
                { ...valid, identities },
                "PUT",
              )
            ).statusCode,
            400,
          );
        }
        assert.equal(
          (
            await session(
              "/admin/api-keys/policy",
              admin,
              {
                ...valid,
                allowed_scopes: ["profile:read", "profile:read"],
              },
              "PUT",
            )
          ).statusCode,
          400,
        );
        await saveIdentityPolicy();
        const invalidOwner = await account();
        for (const payload of [
          { name: "missing selection", expires_at: input().expires_at },
          { ...identityInput(), scopes: ["profile:read"] },
          { ...identityInput(), identity_id: "administrator" },
          { ...identityInput(), identity_id: null },
          { ...identityInput(), identity_name: "管理员" },
          input(["*"]),
          input(["profile:read", "profile:read"]),
        ]) {
          assert.equal(
            (await session("/account/api-keys", invalidOwner, payload))
              .statusCode,
            400,
          );
        }
        assert.equal(
          (
            await session(
              "/account/api-keys",
              invalidOwner,
              identityInput("participant"),
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await session(
              "/account/api-keys",
              invalidOwner,
              identityInput(crypto.randomUUID()),
            )
          ).statusCode,
          403,
        );
        await saveIdentityPolicy(identityPolicy(["admin:content:read"]));
        assert.equal(
          (await session("/account/api-keys", invalidOwner, identityInput()))
            .statusCode,
          403,
        );
        await saveIdentityPolicy(identityPolicy([]));
        assert.equal(
          (await session("/account/api-keys", invalidOwner, identityInput()))
            .statusCode,
          403,
        );
      },
    );
    await t.test(
      "identity snapshots obey current identity grants and the global ceiling",
      async () => {
        const identityOwner = await account();
        await saveIdentityPolicy();
        const issued = await succeeds(
          session("/account/api-keys", identityOwner, identityInput()),
        );
        assert.equal(issued.item.identity_id, "readonly");
        assert.deepEqual(issued.item.scopes, ["profile:read"]);
        await succeeds(bearer("/account/profile", issued.key));
        const expanded = identityPolicy(["profile:read", "profile:write"]);
        await saveIdentityPolicy(expanded);
        const profileUpdate = {
          real_name: "identity edit",
          student_number: "",
          phone: "",
        };
        assert.equal(
          (await bearer("/account/profile", issued.key, profileUpdate))
            .statusCode,
          403,
        );
        const inventory = await succeeds(
          session("/account/api-keys", identityOwner),
        );
        assert.deepEqual(
          inventory.items.find(
            (item: { id: string }) => item.id === issued.item.id,
          ).scopes,
          ["profile:read"],
        );
        assert.deepEqual(inventory.identities[0].scopes, [
          "profile:read",
          "profile:write",
        ]);
        assert.equal(JSON.stringify(inventory).includes(issued.key), false);
        assert.equal(JSON.stringify(inventory).includes("token_hash"), false);
        const fresh = await succeeds(
          session("/account/api-keys", identityOwner, identityInput()),
        );
        assert.deepEqual(fresh.item.scopes, ["profile:read", "profile:write"]);
        await succeeds(bearer("/account/profile", fresh.key, profileUpdate));
        await saveIdentityPolicy(identityPolicy(["profile:write"]));
        assert.equal(
          (await bearer("/account/profile", issued.key)).statusCode,
          403,
        );
        assert.equal(
          (await bearer("/account/profile", fresh.key)).statusCode,
          403,
        );
        await succeeds(bearer("/account/profile", fresh.key, profileUpdate));
        const custom = await succeeds(
          session("/account/api-keys", identityOwner, input(["profile:write"])),
        );
        assert.equal(custom.item.identity_id, null);
        await saveIdentityPolicy(identityPolicy(["profile:write"], false));
        assert.equal(
          (await bearer("/account/profile", fresh.key, profileUpdate))
            .statusCode,
          403,
        );
        await succeeds(bearer("/account/profile", custom.key, profileUpdate));
        await saveIdentityPolicy({ ...expanded, allowed_scopes: [] });
        assert.equal(
          (await bearer("/account/profile", custom.key, profileUpdate))
            .statusCode,
          403,
        );
        assert.equal(
          (await bearer("/account/profile", fresh.key, profileUpdate))
            .statusCode,
          403,
        );
        assert.equal(
          (await bearer("/account/profile", issued.key)).statusCode,
          403,
        );
        for (const payload of [identityInput(), input(["profile:write"])]) {
          assert.equal(
            (await session("/account/api-keys", identityOwner, payload))
              .statusCode,
            403,
          );
          assert.equal(
            (
              await session(
                `/account/api-keys/${fresh.item.id}`,
                identityOwner,
                payload,
                "PUT",
              )
            ).statusCode,
            403,
          );
        }
        await saveIdentityPolicy(expanded);
        await succeeds(bearer("/account/profile", fresh.key, profileUpdate));
        await succeeds(bearer("/account/profile", issued.key));
        await saveIdentityPolicy({ ...expanded, enabled: false });
        assert.equal(
          (await bearer("/account/profile", fresh.key)).statusCode,
          403,
        );
        assert.deepEqual(
          (await succeeds(session("/account/api-keys", identityOwner)))
            .identities,
          [],
        );
      },
    );
    await t.test(
      "explicit lifecycle edits switch grant modes without granting account ACLs",
      async () => {
        const identityOwner = await account();
        await saveIdentityPolicy();
        const issued = await succeeds(
          session("/account/api-keys", identityOwner, identityInput()),
        );
        const path = `/account/api-keys/${issued.item.id}`;
        assert.equal(
          (
            await session(
              path,
              identityOwner,
              { ...identityInput(), scopes: ["profile:read"] },
              "PUT",
            )
          ).statusCode,
          400,
        );
        const custom = await succeeds(
          session(path, identityOwner, input(["profile:write"]), "PUT"),
        );
        assert.equal(custom.item.identity_id, null);
        assert.equal(custom.item.identity_name, null);
        assert.deepEqual(custom.item.scopes, ["profile:write"]);
        assert.equal("key" in custom, false);
        assert.equal(
          (await bearer("/account/profile", issued.key)).statusCode,
          403,
        );
        const selected = await succeeds(
          session(path, identityOwner, identityInput(), "PUT"),
        );
        assert.equal(selected.item.identity_id, "readonly");
        await succeeds(bearer("/account/profile", issued.key));
        const managedPolicy = identityPolicy();
        const managementId = crypto.randomUUID();
        managedPolicy.identities[2] = {
          id: managementId,
          name: "Content manager",
          enabled: true,
          scopes: ["admin:content:read"],
        };
        managedPolicy.allowed_scopes.push("admin:content:read");
        await saveIdentityPolicy(managedPolicy);
        const management = await succeeds(
          session(
            "/account/api-keys",
            identityOwner,
            identityInput(managementId),
          ),
        );
        assert.equal(
          (
            await bearer(
              "/admin/help",
              management.key,
              undefined,
              "GET",
              admin.cookie,
            )
          ).statusCode,
          403,
        );
        await db.query("UPDATE users SET access_profile=$2 WHERE id=$1", [
          identityOwner.id,
          JSON.stringify({
            permissions: ["content.read"],
            roles: [],
            grants: [],
          }),
        ]);
        await succeeds(bearer("/admin/help", management.key));
        await db.query("UPDATE users SET access_profile=$2 WHERE id=$1", [
          identityOwner.id,
          JSON.stringify({ permissions: [], roles: [], grants: [] }),
        ]);
        assert.equal(
          (await bearer("/admin/help", management.key)).statusCode,
          403,
        );
        await saveIdentityPolicy(identityPolicy(["profile:read"], false));
        assert.equal(
          (await session(path, identityOwner, identityInput(), "PUT"))
            .statusCode,
          403,
        );
        await succeeds(session(path, identityOwner, undefined, "DELETE"));
        assert.equal(
          (await bearer("/account/profile", issued.key)).statusCode,
          401,
        );
      },
    );
  },
);
