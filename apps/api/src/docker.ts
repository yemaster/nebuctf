import type { TerminalTarget } from "./terminal-target.js";
import type { Duplex } from "node:stream";
import { request } from "node:http";
import { config } from "./config.js";
import { StringDecoder } from "node:string_decoder";
import { imageReference, cleanDockerMessage } from "./image-reference.js";
export interface ImageInfo {
  Id: string;
  RepoTags: string[] | null;
  RepoDigests: string[] | null;
  Size: number;
}
export interface PullEvent {
  id?: string;
  status?: string;
  progressDetail?: { current?: number; total?: number };
  error?: string;
  errorDetail?: { message?: string };
}
export interface ContainerInfo {
  Id: string;
  Config: { Labels: Record<string, string> };
  State: { Running: boolean; Status: string; Health?: { Status: string } };
  NetworkSettings: {
    Ports: Record<string, { HostPort: string }[] | null>;
    Networks: Record<string, { IPAddress: string }>;
  };
}
export interface NetworkInfo {
  Containers?: Record<string, { Name: string }>;
  Id: string;
  Labels: Record<string, string>;
}
export class DockerError extends Error {
  constructor(public statusCode: number) {
    super(`Docker API returned ${statusCode}`);
  }
}
// Small, deliberately restricted Docker client. No arbitrary host URL or user-supplied API path.
export class DockerEngine {
  constructor(private socketPath = config.DOCKER_SOCKET) {}
  private call<T>(
    method: string,
    path: string,
    body?: unknown,
    binary = false,
    timeout = 15000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const data =
        body === undefined
          ? undefined
          : Buffer.isBuffer(body)
            ? body
            : JSON.stringify(body);
      const req = request(
        {
          socketPath: this.socketPath,
          path: `/v1.45${path}`,
          method,
          headers: data
            ? {
                "Content-Type": Buffer.isBuffer(data)
                  ? "application/x-tar"
                  : "application/json",
                "Content-Length": Buffer.byteLength(data),
              }
            : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 21 * 1024 * 1024) {
              req.destroy(Error("Docker response too large"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const status = res.statusCode ?? 500;
            if (status < 200 || status >= 300) {
              reject(new DockerError(status));
              return;
            }
            const buffer = Buffer.concat(chunks);
            try {
              resolve(
                (binary
                  ? buffer
                  : buffer.length
                    ? JSON.parse(buffer.toString())
                    : undefined) as T,
              );
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.setTimeout(timeout, () => req.destroy(Error("Docker API timeout")));
      const deadline = setTimeout(
        () => req.destroy(Error("Docker API deadline")),
        timeout,
      );
      deadline.unref();
      req.on("close", () => clearTimeout(deadline));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }
  ping() {
    return this.call("GET", "/_ping", undefined, true);
  }
  containerStats(id: string) {
    return this.call<{
      networks?: Record<
        string,
        {
          rx_bytes: number;
          tx_bytes: number;
          rx_dropped: number;
          tx_dropped: number;
        }
      >;
    }>(
      "GET",
      `/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`,
      undefined,
      false,
      5000,
    );
  }
  stopContainer(id: string, seconds = 8) {
    return this.call(
      "POST",
      `/containers/${encodeURIComponent(id)}/stop?t=${seconds}`,
      undefined,
      false,
      (seconds + 3) * 1000,
    );
  }
  inspectImage(image: string) {
    return this.call("GET", `/images/${encodeURIComponent(image)}/json`);
  }
  async buildPatch(
    tag: string,
    context: Buffer,
    labels: Record<string, string>,
  ) {
    const params = new URLSearchParams({
      t: tag,
      networkmode: "none",
      rm: "1",
      forcerm: "1",
      pull: "0",
      nocache: "1",
      memory: String(256 * 1024 * 1024),
      memswap: String(256 * 1024 * 1024),
      cpuperiod: "100000",
      cpuquota: "50000",
      labels: JSON.stringify(labels),
    });
    const stream = await this.call<Buffer>(
      "POST",
      `/build?${params}`,
      context,
      true,
      120000,
    );
    for (const line of stream.toString("utf8").split("\n").filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.error || event.errorDetail) throw Error("补丁镜像构建失败");
    }
    const image = (await this.inspectImage(tag)) as { Id: string };
    return image.Id;
  }
  removeImage(id: string) {
    return this.call("DELETE", `/images/${encodeURIComponent(id)}`);
  }
  async writeFlag(container: string, flag: string) {
    // No shell expansion: the only writable path is the target's dedicated tmpfs flag file.
    const exec = await this.call<{ Id: string }>(
      "POST",
      `/containers/${encodeURIComponent(container)}/exec`,
      {
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: false,
        Tty: false,
        Privileged: false,
        User: "65534:65534",
        Cmd: [
          "/bin/sh",
          "-c",
          'printf %s "$1" > /run/nebuctf/flag',
          "nebuctf",
          flag,
        ],
      },
    );
    await this.call<Buffer>(
      "POST",
      `/exec/${encodeURIComponent(exec.Id)}/start`,
      { Detach: false, Tty: false },
      true,
    );
    const state = await this.call<{ ExitCode: number; Running: boolean }>(
      "GET",
      `/exec/${encodeURIComponent(exec.Id)}/json`,
    );
    if (state.Running || state.ExitCode !== 0) throw Error("Flag 写入失败");
  }
  async createTerminalExec(container: string, target?: TerminalTarget) {
    const exec = await this.call<{ Id: string }>(
      "POST",
      `/containers/${encodeURIComponent(container)}/exec`,
      {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Privileged: false,
        User: "65534:65534",
        WorkingDir: "/home/player",
        Env: ["HOME=/home/player", "TERM=xterm-256color", "LANG=C.UTF-8"],
        Cmd: target
          ? [
              "tmux",
              "new-session",
              "-A",
              "-D",
              "-s",
              `nc-${target.id}`,
              "nc",
              "-v",
              target.host,
              String(target.port),
            ]
          : ["tmux", "new-session", "-A", "-D", "-s", "shell"],
      },
    );
    return exec.Id;
  }
  resizeTerminal(exec: string, cols: number, rows: number) {
    return this.call(
      "POST",
      `/exec/${encodeURIComponent(exec)}/resize?w=${cols}&h=${rows}`,
    );
  }
  attachTerminal(exec: string, signal: AbortSignal): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ Detach: false, Tty: true });
      const req = request({
        socketPath: this.socketPath,
        path: `/v1.45/exec/${encodeURIComponent(exec)}/start`,
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Connection: "Upgrade",
          Upgrade: "tcp",
        },
      });
      const timeout = setTimeout(
        () => req.destroy(Error("Terminal attach timeout")),
        10000,
      );
      req.on("upgrade", (res, socket, head) => {
        clearTimeout(timeout);
        if (res.statusCode !== 101) {
          socket.destroy();
          reject(Error("Terminal upgrade failed"));
          return;
        }
        socket.pause();
        if (head.length) socket.unshift(head);
        const abort = () => socket.destroy();
        signal.addEventListener("abort", abort, { once: true });
        socket.once("close", () => signal.removeEventListener("abort", abort));
        if (signal.aborted) socket.destroy();
        resolve(socket);
      });
      req.on("response", (res) => {
        res.resume();
        req.destroy(Error("Terminal upgrade refused"));
      });
      req.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      req.end(body);
    });
  }
  listImages() {
    return this.call<ImageInfo[]>("GET", "/images/json");
  }
  pullImage(
    image: string,
    onProgress: (event: PullEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    imageReference.parse(image);
    return new Promise((resolve, reject) => {
      const decoder = new StringDecoder("utf8");
      let pending = "",
        bytes = 0;
      const req = request(
        {
          socketPath: this.socketPath,
          method: "POST",
          path: `/v1.45/images/create?fromImage=${encodeURIComponent(image)}`,
          signal,
        },
        (res) => {
          const consume = (line: string) => {
            if (!line.trim()) return;
            const event = JSON.parse(line) as PullEvent & { message?: string };
            if ((res.statusCode ?? 500) >= 300 && event.message)
              throw Error(cleanDockerMessage(event.message));
            if (event.error || event.errorDetail?.message)
              throw Error(
                cleanDockerMessage(event.errorDetail?.message ?? event.error),
              );
            onProgress(event);
          };
          res.on("data", (chunk: Buffer) => {
            try {
              bytes += chunk.length;
              if (bytes > 32 * 1024 * 1024) throw Error("镜像拉取日志超过限制");
              pending += decoder.write(chunk);
              if (pending.length > 1024 * 1024) throw Error("镜像拉取响应过长");
              let end: number;
              while ((end = pending.indexOf("\n")) >= 0) {
                const line = pending.slice(0, end);
                pending = pending.slice(end + 1);
                consume(line);
              }
            } catch (error) {
              reject(error);
              res.destroy();
              req.destroy();
            }
          });
          res.on("error", reject);
          res.on("aborted", () => reject(Error("镜像拉取连接中断")));
          res.on("end", () => {
            try {
              pending += decoder.end();
              consume(pending);
              if ((res.statusCode ?? 500) >= 300)
                throw new DockerError(res.statusCode ?? 500);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.setTimeout(120000, () => req.destroy(Error("镜像拉取连接超时")));
      const deadline = setTimeout(
        () => req.destroy(Error("镜像拉取超过 15 分钟")),
        15 * 60 * 1000,
      );
      deadline.unref();
      req.on("close", () => clearTimeout(deadline));
      req.on("error", reject);
      req.end();
    });
  }
  inspectContainer(id: string) {
    return this.call<ContainerInfo>(
      "GET",
      `/containers/${encodeURIComponent(id)}/json`,
    );
  }
  createContainer(spec: Record<string, unknown>) {
    const { name, ...body } = spec;
    return this.call<{ Id: string }>(
      "POST",
      `/containers/create?name=${encodeURIComponent(String(name))}`,
      body,
    );
  }
  startContainer(id: string) {
    return this.call("POST", `/containers/${encodeURIComponent(id)}/start`);
  }
  removeContainer(id: string) {
    return this.call(
      "DELETE",
      `/containers/${encodeURIComponent(id)}?force=true&v=true`,
    );
  }
  waitContainer(id: string, timeout = 65000) {
    return this.call<{ StatusCode: number }>(
      "POST",
      `/containers/${encodeURIComponent(id)}/wait?condition=not-running`,
      undefined,
      false,
      timeout,
    );
  }
  async archive(id: string) {
    // Docker's archive endpoint reads the root filesystem, not a live tmpfs.
    // A fixed, unprivileged command reads only the generator's published artifact.
    const exec = await this.call<{ Id: string }>(
      "POST",
      `/containers/${encodeURIComponent(id)}/exec`,
      {
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: false,
        Tty: false,
        Privileged: false,
        User: "65534:65534",
        Cmd: ["/bin/tar", "-c", "-f", "-", "-C", "/output", "artifact.zip"],
      },
    );
    const stream = await this.call<Buffer>(
      "POST",
      `/exec/${encodeURIComponent(exec.Id)}/start`,
      { Detach: false, Tty: false },
      true,
    );
    const state = await this.call<{ Running: boolean; ExitCode: number }>(
      "GET",
      `/exec/${encodeURIComponent(exec.Id)}/json`,
    );
    if (state.Running || state.ExitCode !== 0) throw new DockerError(404);
    return dockerStdout(stream);
  }
  inspectNetwork(id: string) {
    return this.call<NetworkInfo>("GET", `/networks/${encodeURIComponent(id)}`);
  }
  createNetwork(body: Record<string, unknown>) {
    return this.call("POST", "/networks/create", body);
  }
  connectNetwork(id: string, container: string) {
    return this.call("POST", `/networks/${encodeURIComponent(id)}/connect`, {
      Container: container,
    });
  }
  disconnectNetwork(id: string, container: string) {
    return this.call("POST", `/networks/${encodeURIComponent(id)}/disconnect`, {
      Container: container,
      Force: true,
    });
  }
  removeNetwork(id: string) {
    return this.call("DELETE", `/networks/${encodeURIComponent(id)}`);
  }
  listContainers(label: string) {
    return this.call<{ Id: string; Labels: Record<string, string> }[]>(
      "GET",
      `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: [label] }))}`,
    );
  }
  listNetworks(label: string) {
    return this.call<NetworkInfo[]>(
      "GET",
      `/networks?filters=${encodeURIComponent(JSON.stringify({ label: [label] }))}`,
    );
  }
}
export function dockerStdout(stream: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0,
    size = 0;
  while (offset < stream.length) {
    if (offset + 8 > stream.length) throw Error("truncated Docker stream");
    const channel = stream[offset],
      length = stream.readUInt32BE(offset + 4);
    if (
      ![1, 2].includes(channel!) ||
      stream.subarray(offset + 1, offset + 4).some((v) => v !== 0) ||
      offset + 8 + length > stream.length
    )
      throw Error("invalid Docker frame");
    offset += 8;
    if (channel === 1) {
      size += length;
      if (size > 21 * 1024 * 1024) throw Error("artifact stream too large");
      chunks.push(stream.subarray(offset, offset + length));
    }
    offset += length;
  }
  return Buffer.concat(chunks);
}
export function readArtifact(tar: Buffer): Buffer {
  if (
    tar.length < 1536 ||
    tar.length > 21 * 1024 * 1024 ||
    tar.length % 512 !== 0
  )
    throw Error("invalid archive size");
  const header = tar.subarray(0, 512);
  const text = (start: number, length: number) =>
    header
      .subarray(start, start + length)
      .toString("utf8")
      .replace(/\0.*$/s, "")
      .trim();
  const name = text(0, 100),
    prefix = text(345, 155),
    type = header[156];
  const sizeText = text(124, 12),
    checksumText = text(148, 8);
  if (
    name !== "artifact.zip" ||
    prefix ||
    !(type === 0 || type === 48) ||
    !/^0?[0-7]+$/.test(sizeText) ||
    !/^0?[0-7]+$/.test(checksumText)
  )
    throw Error("invalid artifact entry");
  let checksum = 0;
  for (let i = 0; i < 512; i++)
    checksum += i >= 148 && i < 156 ? 32 : header[i]!;
  if (checksum !== parseInt(checksumText, 8))
    throw Error("invalid tar checksum");
  const size = parseInt(sizeText, 8);
  if (
    size > 20 * 1024 * 1024 ||
    size < 0 ||
    512 + Math.ceil(size / 512) * 512 + 1024 > tar.length
  )
    throw Error("invalid artifact size");
  if (tar.subarray(512 + size).some((v) => v !== 0))
    throw Error("archive contains additional entries");
  return tar.subarray(512, 512 + size);
}
