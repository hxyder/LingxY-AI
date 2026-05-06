import { spawn } from "node:child_process";

// Cross-platform OS-native TTS for Echo. No third-party deps, no model
// downloads. Phase 1 spawns a fresh process per utterance — codex review
// flagged 300-500 ms PowerShell startup as the cost; daemon化 is a follow-up
// once we have real frequency data.
//
// Three platform paths, all driven through this module:
//   - Windows: powershell.exe runs System.Speech.SpeechSynthesizer.Speak.
//     Text is passed via -EncodedCommand (UTF-16LE base64) so quotes,
//     newlines, emoji, and CJK in user content cannot escape into shell
//     argv. Codex review caught this before any -Command "..." path made
//     it in.
//   - macOS: `say` reads text from stdin (-).
//   - Linux: prefer `spd-say` (speech-dispatcher) then `espeak`; both also
//     read from stdin. Missing on minimal installs — we surface that as
//     "unavailable" so the dock toggle reflects reality.

const PLATFORM_UNAVAILABLE_REASONS = Object.freeze({
  unsupported_platform: "TTS is not available on this platform.",
  command_not_found: "No TTS command found (install speech-dispatcher / espeak / say / SAPI).",
  spawn_failed: "Failed to start the TTS process.",
  disabled: "TTS is disabled in preferences."
});

function buildPowerShellEncodedCommand(text, { rate = null, voice = null } = {}) {
  // PowerShell -EncodedCommand expects UTF-16LE base64. We embed the text
  // as a single-quoted string after the .NET-style ` doubling so any
  // single quotes in the original text are escaped without us touching
  // shell parsing. -ExecutionPolicy Bypass + -NonInteractive avoid policy
  // and prompt stalls; codex review noted both.
  const escaped = String(text ?? "").replace(/'/g, "''");
  const voiceLine = voice ? `$s.SelectVoice('${String(voice).replace(/'/g, "''")}');` : "";
  const rateLine = (typeof rate === "number" && rate >= -10 && rate <= 10) ? `$s.Rate=${Math.round(rate)};` : "";
  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    voiceLine,
    rateLine,
    `$s.Speak('${escaped}');`
  ].join(" ");
  // PowerShell wants UTF-16LE for -EncodedCommand. Buffer.from with 'utf16le'
  // gives the right layout (LE on all our targets).
  return Buffer.from(script, "utf16le").toString("base64");
}

function buildPowerShellArgs(text, options) {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", buildPowerShellEncodedCommand(text, options)
  ];
}

function detectLinuxCommand(envPath = process.env.PATH ?? "") {
  // Cheap detection: only fires once during process lifetime via the
  // engine cache. We avoid spawning `which` because that is itself a
  // process; instead we walk PATH ourselves.
  const candidates = ["spd-say", "espeak"];
  const directories = String(envPath).split(/[:;]/).filter(Boolean);
  for (const command of candidates) {
    for (const dir of directories) {
      try {
        const probe = `${dir}/${command}`;
        // eslint-disable-next-line global-require
        const fs = globalThis.process?.binding?.("fs");
        // Node fs.existsSync without importing — keeps this module easy
        // to mock in tests by passing a custom commandLookup.
        if (fs && typeof fs.access === "function") {
          fs.access(probe, 0, () => {});
        }
      } catch { /* ignore */ }
    }
  }
  return null;
}

function defaultPlatformLookup({ platform = process.platform } = {}) {
  if (platform === "win32") {
    return { command: "powershell.exe", buildArgs: buildPowerShellArgs, useStdin: false };
  }
  if (platform === "darwin") {
    return {
      command: "say",
      buildArgs: () => ["-f", "-"],
      useStdin: true
    };
  }
  // Linux best-effort. detectLinuxCommand would need fs; for Phase 1
  // we just try `spd-say` and let spawn ENOENT surface as unavailable.
  return {
    command: "spd-say",
    buildArgs: () => ["-e"],
    useStdin: true,
    fallback: { command: "espeak", buildArgs: () => ["--stdin"], useStdin: true }
  };
}

export function createTtsEngine({
  spawnImpl = spawn,
  platformLookup = defaultPlatformLookup,
  platform = process.platform,
  now = () => Date.now(),
  warn = (msg) => {
    // eslint-disable-next-line no-console
    console.warn(`[tts] ${msg}`);
  },
  unavailableWarnIntervalMs = 60_000
} = {}) {
  let inflight = null;
  // Generation token. Each speak() bumps the token; only the active
  // generation's child is treated as "current". Stale child still alive
  // when its kill signal hasn't propagated cannot poison state.
  let generation = 0;
  let unavailable = null; // { reason, message } when we have detected the host cannot speak.
  let lastUnavailableWarnAt = 0;

  function warnUnavailable(reason, detail) {
    const t = now();
    if (t - lastUnavailableWarnAt < unavailableWarnIntervalMs) return;
    lastUnavailableWarnAt = t;
    warn(`TTS unavailable: ${reason}${detail ? ` (${detail})` : ""}`);
  }

  function killInflight(reason = "superseded") {
    if (!inflight) return;
    const child = inflight.child;
    inflight = null;
    try {
      if (child && !child.killed) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
        }
      }
    } catch { /* ignore */ }
    return reason;
  }

  function isUnavailable() {
    return Boolean(unavailable);
  }

  async function speak(text, options = {}) {
    const cleanText = String(text ?? "").trim();
    if (!cleanText) return { ok: false, reason: "empty_text" };
    if (unavailable) return { ok: false, reason: unavailable.reason, message: unavailable.message };

    // Bump generation BEFORE killing the previous child so any racing
    // observer sees the new id immediately.
    generation += 1;
    const myGeneration = generation;
    killInflight();

    const lookup = platformLookup({ platform });
    if (!lookup) {
      unavailable = { reason: "unsupported_platform", message: PLATFORM_UNAVAILABLE_REASONS.unsupported_platform };
      warnUnavailable(unavailable.reason);
      return { ok: false, ...unavailable };
    }

    const tryStart = (target) => {
      const args = target.buildArgs(cleanText, options);
      let child;
      try {
        child = spawnImpl(target.command, args, {
          stdio: target.useStdin ? ["pipe", "ignore", "pipe"] : ["ignore", "ignore", "pipe"]
        });
      } catch (error) {
        return { error };
      }
      return { child };
    };

    let started = tryStart(lookup);
    if (started.error && lookup.fallback) {
      started = tryStart(lookup.fallback);
    }
    if (started.error) {
      const errCode = started.error?.code ?? "spawn_failed";
      // ENOENT on Windows / macOS is fatal — flag unavailable so the dock
      // toggle / preference layer stops trying.
      if (errCode === "ENOENT") {
        unavailable = { reason: "command_not_found", message: PLATFORM_UNAVAILABLE_REASONS.command_not_found };
        warnUnavailable("command_not_found", started.error?.message);
        return { ok: false, ...unavailable };
      }
      return { ok: false, reason: "spawn_failed", message: String(started.error?.message ?? started.error) };
    }

    const child = started.child;
    inflight = { child, generation: myGeneration };

    // For stdin-driven engines push the text now and close the pipe.
    if (lookup.useStdin && child.stdin?.writable) {
      try {
        child.stdin.end(`${cleanText}\n`, "utf8");
      } catch { /* ignore — surfaced via close exit code */ }
    }
    child.stdin?.on?.("error", () => { /* swallow EPIPE; close handler covers exit */ });
    child.stderr?.on?.("data", () => { /* drain so the kernel pipe does not stall */ });

    return await new Promise((resolve) => {
      let settled = false;
      const settle = (payload) => {
        if (settled) return;
        settled = true;
        if (inflight && inflight.generation === myGeneration) inflight = null;
        resolve(payload);
      };
      child.on("close", (code, signal) => {
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          settle({ ok: false, cancelled: true, generation: myGeneration });
          return;
        }
        if (code === 0) {
          settle({ ok: true, generation: myGeneration });
          return;
        }
        settle({ ok: false, reason: "tts_exit_nonzero", code, generation: myGeneration });
      });
      child.on("error", (error) => {
        settle({ ok: false, reason: "tts_runtime_error", message: String(error?.message ?? error), generation: myGeneration });
      });
    });
  }

  function cancel() {
    const reason = killInflight("manual_cancel");
    return { cancelled: Boolean(reason) };
  }

  return {
    speak,
    cancel,
    isUnavailable,
    get inflightGeneration() {
      return inflight?.generation ?? null;
    },
    _markUnavailableForTest(reason, message) {
      unavailable = { reason, message: message ?? PLATFORM_UNAVAILABLE_REASONS[reason] ?? reason };
    }
  };
}

let singleton = null;
export function getTtsEngine(options = {}) {
  if (!singleton) singleton = createTtsEngine(options);
  return singleton;
}
export function resetTtsEngineForTest() {
  singleton = null;
}
