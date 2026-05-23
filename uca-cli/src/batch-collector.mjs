import { appendFile, mkdir, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeGroupKey(groupKey) {
  return groupKey.replace(/[^a-z0-9_-]/gi, "_");
}

export async function collectFileBatch({
  filePaths,
  groupKey,
  flushWindowMs = 300,
  rootDir = path.join(tmpdir(), "uca-submit-batches")
}) {
  const key = sanitizeGroupKey(groupKey ?? `ppid-${process.ppid}`);
  const batchDir = path.join(rootDir, key);
  const manifestPath = path.join(batchDir, "submit-batch.jsonl");
  const lockPath = path.join(batchDir, "collector.lock");

  await mkdir(batchDir, { recursive: true });
  await appendFile(manifestPath, filePaths.map((filePath) => JSON.stringify({ filePath })).join("\n") + "\n", "utf8");

  let ownerHandle = null;
  let ownerResult = null;
  try {
    ownerHandle = await open(lockPath, "wx");
  } catch {
    await sleep(flushWindowMs + 50);
    return {
      role: "participant",
      submitted: false,
      filePaths: []
    };
  }

  try {
    await sleep(flushWindowMs);
    const rows = (await readFile(manifestPath, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).filePath);

    const uniqueFilePaths = [...new Set(rows)];
    await rm(manifestPath, { force: true });
    ownerResult = {
      role: "owner",
      submitted: true,
      filePaths: uniqueFilePaths
    };
  } finally {
    await ownerHandle.close();
    await rm(lockPath, { force: true });
  }

  return ownerResult;
}
