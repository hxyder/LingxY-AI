let finished = false;

process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stdout.write(`${JSON.stringify({ type: "accepted", ts: Date.now() })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "started", ts: Date.now() + 10 })}\n`);
  setTimeout(() => {
    if (!finished) {
      process.stdout.write(`${JSON.stringify({ type: "success", ts: Date.now() + 1000, summary: "late success" })}\n`);
      finished = true;
      process.exit(0);
    }
  }, 1000);
});

process.on("SIGTERM", () => {
  if (!finished) {
    finished = true;
    process.exit(143);
  }
});
