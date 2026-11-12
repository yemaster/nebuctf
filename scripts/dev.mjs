import { spawn } from "node:child_process";
const services = [
  ["apps/api", "dev"],
  ["apps/web", "dev"],
];
// A separate process is safe only with PostgreSQL, never with embedded PGlite.
if (process.env.DATABASE_URL) services.push(["apps/api", "scheduler:dev"]);
const children = services.map(([workspace, script]) =>
  spawn("npm", ["run", script, "-w", workspace], { stdio: "inherit" }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const child of children)
  child.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
