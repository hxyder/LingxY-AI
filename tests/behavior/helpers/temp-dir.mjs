import { rm } from "node:fs/promises";

export async function removeTempDirWithRetry(root, {
  attempts = 5,
  initialDelayMs = 25
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, initialDelayMs * (attempt + 1)));
    }
  }
}
