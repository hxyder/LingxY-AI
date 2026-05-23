export function parseJsonLinesChunk(chunk, state = { remainder: "" }) {
  const text = `${state.remainder}${chunk}`;
  const lines = text.split(/\r?\n/);
  state.remainder = lines.pop() ?? "";

  return lines
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function finalizeJsonLines(state = { remainder: "" }) {
  if (!state.remainder.trim()) {
    return [];
  }

  const finalEvent = JSON.parse(state.remainder);
  state.remainder = "";
  return [finalEvent];
}
