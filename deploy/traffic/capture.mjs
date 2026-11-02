import { spawn } from "node:child_process";
import { open, readdir, stat, unlink, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const root = "/capture",
  max =
    Math.max(8, Math.min(1024, Number(process.env.MAX_MIB) || 64)) * 1048576;
const snap = Math.max(
  128,
  Math.min(65535, Number(process.env.SNAP_LENGTH) || 65535),
);
const limit = Math.min(4 * 1048576, Math.floor(max / 2));
let header,
  pending = Buffer.alloc(0),
  little = true,
  file,
  filename,
  size = 0,
  opened = 0,
  serial = Promise.resolve(),
  closing = false;
const files = [];
for (const name of await readdir(root)) {
  if (/^[0-9]+-[0-9a-f-]+\.pcap$/.test(name))
    files.push({
      name,
      size: (
        await stat(join(root, name)).catch((e) => {
          if (e.code !== "ENOENT") throw e;
          return { size: 0 };
        })
      ).size,
    });
  else if (/^[0-9]+-[0-9a-f-]+\.part$/.test(name))
    await unlink(join(root, name));
}
files.sort((a, b) => a.name.localeCompare(b.name));
async function prune(extra = 0) {
  let total = files.reduce((sum, f) => sum + f.size, 0);
  while (files.length && (total + extra > max || files.length >= 128)) {
    const old = files.shift();
    total -= old.size;
    await unlink(join(root, old.name)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
async function finish() {
  if (!file) return;
  await file.close();
  file = undefined;
  const name = filename.replace(/\.part$/, ".pcap");
  await rename(join(root, filename), join(root, name));
  files.push({ name, size });
  await prune();
}
async function packet(data) {
  if (file && (size + data.length > limit || Date.now() - opened >= 60000))
    await finish();
  if (!file) {
    await prune(limit + 65551);
    filename = `${Date.now()}-${randomUUID()}.part`;
    file = await open(join(root, filename), "wx", 0o644);
    await file.writeFile(header);
    size = 24;
    opened = Date.now();
  }
  await file.writeFile(data);
  size += data.length;
}
await prune();
const tcp = spawn(
  "tcpdump",
  [
    "-n",
    "-p",
    "-U",
    "-i",
    "any",
    "-s",
    String(snap),
    "-Z",
    "nobody",
    "-w",
    "-",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = new Promise((resolve) => {
  tcp.once("close", (code) => resolve(code));
  tcp.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    resolve(1);
  });
});
tcp.stderr.on("data", (data) => process.stderr.write(data.subarray(0, 4096)));
const stop = () => {
  closing = true;
  tcp.kill("SIGINT");
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const run = (fn) => (serial = serial.then(fn));
const timer = setInterval(() => {
  if (file && Date.now() - opened >= 60000) void run(finish).catch(stop);
}, 1000);
try {
  for await (const chunk of tcp.stdout)
    await run(async () => {
      pending = Buffer.concat([pending, chunk]);
      if (!header) {
        if (pending.length < 24) return;
        header = Buffer.from(pending.subarray(0, 24));
        pending = pending.subarray(24);
        const magic = header.readUInt32LE();
        if (magic !== 0xa1b2c3d4 && magic !== 0xd4c3b2a1)
          throw Error("Unsupported PCAP");
        little = magic === 0xa1b2c3d4;
      }
      while (pending.length >= 16) {
        const length = little
          ? pending.readUInt32LE(8)
          : pending.readUInt32BE(8);
        if (length > 65535) throw Error("Invalid packet length");
        if (pending.length < 16 + length) break;
        await packet(pending.subarray(0, 16 + length));
        pending = pending.subarray(16 + length);
      }
    });
  await serial;
  await finish();
  if ((await exited) !== 0 && !closing) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  stop();
} finally {
  clearInterval(timer);
  if (file) await file.close().catch(() => {});
}
