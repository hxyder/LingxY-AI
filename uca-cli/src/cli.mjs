#!/usr/bin/env node
import process from "node:process";
import { createRuntimeTransport } from "./runtime-client.mjs";
import { submitCommand } from "./submit.mjs";

async function main(argv) {
  const transport = createRuntimeTransport();
  const result = await submitCommand(argv, transport);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
