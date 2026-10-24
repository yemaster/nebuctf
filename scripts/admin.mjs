import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
const rl = createInterface({ input: stdin, output: stdout });
const username = await rl.question("管理员用户名: "),
  email = await rl.question("管理员邮箱: ");
rl.close();
// Read without terminal echo. Credentials go only to the child process stdin.
if (!stdin.isTTY) throw Error("Run this helper in a terminal");
stdout.write("管理员密码（至少 12 位，不回显）: ");
stdin.setRawMode(true);
stdin.resume();
const password = await new Promise((resolve, reject) => {
  let value = "";
  const onData = (buffer) => {
    for (const ch of buffer.toString()) {
      if (ch === "\u0003") {
        stdin.off("data", onData);
        reject(Error("cancelled"));
        return;
      }
      if (ch === "\r" || ch === "\n") {
        stdin.off("data", onData);
        resolve(value);
        return;
      }
      if (ch === "\u007f") {
        value = value.slice(0, -1);
        continue;
      }
      if (ch >= " ") value += ch;
    }
  };
  stdin.on("data", onData);
}).finally(() => {
  stdin.setRawMode(false);
  stdin.pause();
  stdout.write("\n");
});
const args = process.argv.includes("--local")
  ? ["--import", "tsx", "apps/api/src/cli.ts", "admin"]
  : ["compose", "exec", "-T", "api", "node", "dist/cli.js", "admin"];
const child = spawn(
  process.argv.includes("--local") ? process.execPath : "docker",
  args,
  { stdio: ["pipe", "inherit", "inherit"] },
);
child.stdin.end(JSON.stringify({ username, email, password }));
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
