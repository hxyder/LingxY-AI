process.stdin.resume();
process.stdin.on("end", () => {
  process.stderr.write("Mock Kimi CLI failed with exit code 1.\n");
  process.exit(1);
});
