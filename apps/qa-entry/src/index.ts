import { loadEnv } from "./loadEnv.js";
import { buildServer } from "./server.js";

async function main() {
  const env = loadEnv();
  const server = buildServer(env);
  await server.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Server startup failed."}\n`);
  process.exitCode = 1;
});
