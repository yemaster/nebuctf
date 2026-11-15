import { flagForInstance } from "../src/flag-environment.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DockerEngine } from "../src/docker.js";
import { Worker } from "../src/worker.js";
import type { DB, Row } from "../src/db.js";
import { config } from "../src/config.js";
import { cleanupContainerGroup } from "../src/container-runtime.js";

const server = `
import http.server,json,os,urllib.request
from urllib.parse import urlparse,parse_qs
def reachable(host):
 try:
  with urllib.request.urlopen('http://'+host+':8080/probe',timeout=0.5) as response:
   return json.load(response).get('role') in ('main','backend','vault')
 except (OSError,ValueError): return False
if os.environ['ROLE']=='main':
 urllib.request.urlopen('http://backend:8080/probe',timeout=3).read()
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path in ('/','/probe'):
   body=json.dumps({'role':os.environ['ROLE']}).encode()
   self.send_response(200);self.end_headers();self.wfile.write(body);return
  result={'role':os.environ['ROLE'],'custom':os.environ.get('CUSTOM'),'flag':os.environ.get('FLAG'),'backend':reachable('backend'),'vault':reachable('vault'),'main':reachable('main')}
  target=parse_qs(urlparse(self.path).query).get('target',[None])[0]
  if target: result['target']=reachable(target)
  if os.environ['ROLE']=='main':
   result['helper']=json.load(urllib.request.urlopen('http://backend:8080/state',timeout=3))
  body=json.dumps(result).encode()
  self.send_response(200);self.end_headers();self.wfile.write(body)
http.server.ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()
`;
const command = [
  "python",
  "-B",
  "-c",
  "import sys;exec(''.join(sys.argv[1:]))",
  ...server.match(/[\s\S]{1,900}/g)!,
];

test(
  "real Docker groups resolve dependency aliases, isolate segments and tenants, enforce limits and clean up helper failures",
  {
    skip: process.env.TEST_DOCKER !== "1",
    timeout: 180000,
  },
  async (t) => {
    const docker = new DockerEngine();
    const rows: Row[] = Array.from({ length: 2 }, () => ({
      id: crypto.randomUUID(),
      challenge_id: crypto.randomUUID(),
      scope: "practice",
      owner_key: "u:topology-regression",
      kind: "dynamic_container",
      spec: {
        image: "nebuctf/example-web:local",
        port: 8080,
        cpu: 250,
        memory: 96,
        ttl: 180,
        access_mode: "port",
        command,
        environment: { ROLE: "main", CUSTOM: "primary" },
        topology: {
          networks: [
            { name: "default", internal: false },
            { name: "data", internal: true },
          ],
          primary_networks: ["default"],
          services: [
            {
              name: "backend",
              image: "nebuctf/example-web:local",
              cpu: 250,
              memory: 96,
              command,
              environment: { ROLE: "backend", CUSTOM: "helper" },
              networks: ["default", "data"],
              depends_on: ["vault"],
              inject_flag: false,
            },
            {
              name: "vault",
              image: "nebuctf/example-web:local",
              cpu: 250,
              memory: 64,
              command,
              environment: { ROLE: "vault" },
              networks: ["data"],
              depends_on: [],
              inject_flag: false,
            },
          ],
        },
      },
    }));
    Object.assign(rows[0]!.spec, {
      parts: ["first", "second"],
      part_targets: { first: ["main"], second: ["vault"] },
    });
    const updates: string[] = [];
    let reconcile = false;
    const db = {
      query: async (sql: string) => {
        updates.push(sql);
        if (sql.includes("SELECT * FROM instances WHERE status='running'"))
          return reconcile ? [rows[0]] : [];
        if (sql.startsWith("SELECT status FROM instances"))
          return [{ status: "running" }];
        return [{ id: "accepted" }];
      },
    } as unknown as DB;
    const worker = new Worker(db, docker);
    t.after(async () => {
      for (const row of rows) await worker.cleanup(row);
    });
    await Promise.all(rows.map((row) => worker.start(row)));
    const main = await docker.inspectContainer(`nebuctf-${rows[0]!.id}`);
    const other = await docker.inspectContainer(`nebuctf-${rows[1]!.id}`);
    const backend = await docker.inspectContainer(
      `nebuctf-${rows[0]!.id}-backend`,
    );
    const vault = await docker.inspectContainer(`nebuctf-${rows[0]!.id}-vault`);
    const firstFlag = flagForInstance(rows[0]!, "first"),
      secondFlag = flagForInstance(rows[0]!, "second");
    assert.ok(main.Config.Env?.includes(`FLAG_1=${firstFlag}`));
    assert.ok(!main.Config.Env?.join().includes(secondFlag));
    assert.ok(vault.Config.Env?.includes(`FLAG_2=${secondFlag}`));
    assert.ok(!vault.Config.Env?.join().includes(firstFlag));
    assert.ok(!backend.Config.Env?.join().includes(firstFlag));
    assert.ok(!backend.Config.Env?.join().includes(secondFlag));
    const defaultNetwork = `nebuctf-${rows[0]!.id}`;
    const base = `http://${config.CHALLENGE_HOST}:${main.NetworkSettings.Ports["8080/tcp"]![0]!.HostPort}`;
    const request = async (target?: string) => {
      const response = await fetch(
        `${base}/state${target ? `?target=${encodeURIComponent(target)}` : ""}`,
        { signal: AbortSignal.timeout(10000) },
      );
      assert.equal(response.status, 200);
      return (await response.json()) as {
        custom: string;
        backend: boolean;
        vault: boolean;
        main: boolean;
        target?: boolean;
        helper: { custom: string; vault: boolean; flag: string | null };
      };
    };
    const result = await request();
    assert.equal(result.custom, "primary");
    assert.equal(
      result.backend,
      true,
      "primary reaches dependency by network alias",
    );
    assert.equal(result.main, true, "primary has stable main alias");
    assert.equal(
      result.vault,
      false,
      "private service is not reachable from another segment",
    );
    assert.equal(
      result.helper.vault,
      true,
      "dual-homed backend can reach the private dependency",
    );
    assert.equal(result.helper.custom, "helper");
    assert.equal(result.helper.flag, null, "helpers do not inherit flags");
    assert.equal(
      (
        await request(
          vault.NetworkSettings.Networks[`${defaultNetwork}-data`]!.IPAddress,
        )
      ).target,
      false,
      "disconnected segments cannot bypass DNS isolation via IP",
    );
    assert.equal(
      (
        await request(
          other.NetworkSettings.Networks[`nebuctf-${rows[1]!.id}`]!.IPAddress,
        )
      ).target,
      false,
      "another tenant bridge is unreachable via IP",
    );
    assert.equal(backend.HostConfig?.NanoCpus, 250e6);
    assert.equal(backend.HostConfig?.Memory, 96 * 1024 * 1024);
    assert.equal(backend.HostConfig?.MemorySwap, backend.HostConfig?.Memory);
    assert.equal(backend.HostConfig?.ReadonlyRootfs, true);
    assert.deepEqual(backend.HostConfig?.PortBindings, {});
    assert.deepEqual(
      backend.NetworkSettings.Networks[defaultNetwork]!.Aliases?.filter(
        (name) => name === "backend",
      ),
      ["backend"],
    );
    assert.equal(main.HostConfig?.NanoCpus, 250e6);
    assert.equal(main.HostConfig?.Memory, 96 * 1024 * 1024);
    await docker.stopContainer(`nebuctf-${rows[0]!.id}-vault`, 1);
    reconcile = true;
    await worker.reconcile();
    assert.ok(
      updates.some((sql) => sql.includes("status='stopping'")),
      "helper failure stops the logical environment",
    );
    await worker.cleanup(rows[0]!);
    for (const name of [
      defaultNetwork,
      `${defaultNetwork}-backend`,
      `${defaultNetwork}-vault`,
    ])
      await assert.rejects(docker.inspectContainer(name));
    for (const name of [defaultNetwork, `${defaultNetwork}-data`])
      await assert.rejects(docker.inspectNetwork(name));
    // Cleanup must discover helper containers and extra networks with no persisted spec.
    await cleanupContainerGroup(docker, {
      namespace: `nebuctf-${rows[1]!.id}`,
      ownerLabel: "io.nebuctf.instance",
      ownerId: rows[1]!.id,
    });
    assert.equal(
      (await docker.listContainers("io.nebuctf.instance")).some(
        (c) => c.Labels["io.nebuctf.instance"] === rows[1]!.id,
      ),
      false,
    );
    assert.equal(
      (await docker.listNetworks("io.nebuctf.instance")).some(
        (n) => n.Labels["io.nebuctf.instance"] === rows[1]!.id,
      ),
      false,
    );
  },
);
