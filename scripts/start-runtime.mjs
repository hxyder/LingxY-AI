import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";

const runtime = createPersistentRuntime({
  port: process.env.UCA_PORT ? Number(process.env.UCA_PORT) : 4310
});

const listening = await runtime.start();
console.log(`UCA runtime listening at ${listening.baseUrl}`);
console.log(`Runtime directory: ${runtime.paths.baseDir}`);

const shutdown = async () => {
  await runtime.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
