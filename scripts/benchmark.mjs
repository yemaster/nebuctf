// Read-only benchmark against your own local/staging installation. Never treats mock timings as capacity evidence.
const origin = process.env.BENCH_ORIGIN ?? "http://localhost:8080";
const requests = Number(process.env.BENCH_REQUESTS ?? 200),
  concurrency = Number(process.env.BENCH_CONCURRENCY ?? 10);
if (
  !Number.isInteger(requests) ||
  requests < 1 ||
  requests > 10000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 100
)
  throw Error("Invalid benchmark limits");
const paths = [
  "/api/challenges",
  "/api/contests",
  "/api/scoreboard",
  "/api/articles",
];
const times = [];
const statusCounts = {};
let next = 0,
  failed = 0;
const start = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < requests) {
      const i = next++;
      const begin = performance.now();
      try {
        const r = await fetch(origin + paths[i % paths.length], {
          signal: AbortSignal.timeout(10000),
        });
        await r.arrayBuffer();
        statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
        if (!r.ok) failed++;
      } catch {
        failed++;
      }
      times.push(performance.now() - begin);
    }
  }),
);
times.sort((a, b) => a - b);
const elapsed = (performance.now() - start) / 1000;
console.log(
  JSON.stringify(
    {
      requests,
      concurrency,
      failed,
      seconds: elapsed,
      rps: requests / elapsed,
      successful_rps: (requests - failed) / elapsed,
      status_counts: statusCounts,
      p50_ms: times[Math.floor(times.length * 0.5)],
      p95_ms:
        times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
    },
    null,
    2,
  ),
);
if (failed) process.exitCode = 1;
