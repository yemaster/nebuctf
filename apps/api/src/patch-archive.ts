import { gunzipSync } from "node:zlib";
export type PatchFile = { name: string; data: Buffer; executable: boolean };
const limit = 20 * 1024 * 1024;
// Parse in memory. Never extract an untrusted archive on the host or accept links/special entries.
export function readPatch(input: Buffer): PatchFile[] {
  const tar =
    input[0] === 0x1f && input[1] === 0x8b
      ? gunzipSync(input, { maxOutputLength: limit + 1024 * 512 })
      : input;
  if (tar.length < 1024 || tar.length > limit + 1024 * 512 || tar.length % 512)
    throw Error("补丁包必须是 tar 或 tar.gz");
  const files: PatchFile[] = [],
    names = new Set<string>();
  let total = 0,
    offset = 0,
    terminated = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((n) => n === 0)) {
      if (tar.subarray(offset).some((n) => n !== 0))
        throw Error("补丁包包含尾随数据");
      terminated = true;
      break;
    }
    const str = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const oct = (start: number, length: number) => {
      const value = str(start, length).trim();
      if (!/^[0-7]+$/.test(value)) throw Error("无效的 tar 头");
      return parseInt(value, 8);
    };
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (checksum !== oct(148, 8)) throw Error("补丁包校验失败");
    const type = header[156],
      size = oct(124, 12),
      prefix = str(345, 155);
    const raw = (prefix ? prefix + "/" : "") + str(0, 100),
      name = raw.replace(/^\.\//, "").replace(/\/$/, "");
    if (!name && type === 53) continue;
    if (
      !name ||
      name.length > 180 ||
      name.startsWith("/") ||
      name.split("/").some((p) => !p || p === "." || p === "..") ||
      /[\\\x00-\x1f\x7f]/.test(name)
    )
      throw Error("补丁包含无效路径");
    if (![0, 48, 53].includes(type!))
      throw Error("补丁只允许普通文件与目录，不支持链接或扩展头");
    if (type === 53) {
      if (size) throw Error("目录不能包含文件数据");
      continue;
    }
    if (names.has(name)) throw Error("补丁包含重复路径");
    names.add(name);
    total += size;
    if (
      size < 0 ||
      total > limit ||
      files.length >= 256 ||
      offset + Math.ceil(size / 512) * 512 > tar.length
    )
      throw Error("补丁超过 20 MiB 或 256 个文件");
    files.push({
      name,
      data: tar.subarray(offset, offset + size),
      executable: !!(oct(100, 8) & 0o111),
    });
    offset += Math.ceil(size / 512) * 512;
  }
  if (!terminated || !files.length) throw Error("补丁包为空或不完整");
  for (const file of files)
    if (files.some((other) => other.name.startsWith(file.name + "/")))
      throw Error("补丁路径冲突");
  return files;
}
export function readUpdatePackage(input: Buffer): PatchFile[] {
  if (input[0] !== 0x1f || input[1] !== 0x8b)
    throw Error("补丁包必须是 tar.gz");
  const files = readPatch(input);
  const entrypoint = files.find((file) => file.name === "update.sh");
  if (!entrypoint || !entrypoint.data.length)
    throw Error("补丁包根目录必须包含非空的普通文件 update.sh");
  return files;
}
export function makeTar(files: PatchFile[]) {
  const chunks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512),
      name = file.name;
    let leaf = name,
      prefix = "";
    if (Buffer.byteLength(leaf) > 100) {
      const split = name.lastIndexOf("/");
      prefix = name.slice(0, split);
      leaf = name.slice(split + 1);
    }
    if (Buffer.byteLength(leaf) > 100 || Buffer.byteLength(prefix) > 155)
      throw Error("文件路径过长");
    header.write(leaf, 0, 100);
    header.write(prefix, 345, 155);
    const oct = (n: number, at: number, len: number) =>
      header.write(n.toString(8).padStart(len - 1, "0") + "\0", at, len);
    oct(file.executable ? 0o755 : 0o644, 100, 8);
    oct(65534, 108, 8);
    oct(65534, 116, 8);
    oct(file.data.length, 124, 12);
    oct(0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar\0", 257, 6);
    header.write("00", 263, 2);
    const checksum = header.reduce((a, b) => a + b, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    chunks.push(
      header,
      file.data,
      Buffer.alloc((512 - (file.data.length % 512)) % 512),
    );
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}
export function patchContext(base: string, files: PatchFile[]) {
  return makeTar([
    {
      name: "Dockerfile",
      executable: false,
      data: Buffer.from(
        `FROM ${base}\nCOPY --chown=65534:65534 patch/ /.nebuctf-update/\nUSER 65534:65534\n`,
      ),
    },
    ...files.map((file) => ({ ...file, name: "patch/" + file.name })),
  ]);
}
