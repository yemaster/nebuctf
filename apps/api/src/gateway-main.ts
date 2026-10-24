import { openDB } from "./db.js";
import { buildGateway } from "./gateway.js";
import { config } from "./config.js";
if (!config.DATABASE_URL) throw Error("Gateway requires shared PostgreSQL");
const db = await openDB(),
  server = buildGateway(db);
server.listen(config.GATEWAY_PORT, "0.0.0.0", () =>
  console.log("Challenge gateway ready"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
