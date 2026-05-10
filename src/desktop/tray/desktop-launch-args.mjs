export function getArgValue(argv = [], flagName) {
  const index = argv.findIndex((item) => item === flagName);
  if (index < 0 || index + 1 >= argv.length) {
    return null;
  }
  return argv[index + 1];
}

export function parseDesktopLaunchArgs(argv = []) {
  return {
    serviceBaseUrl: getArgValue(argv, "--uca-service-url"),
    handoffFile: getArgValue(argv, "--uca-handoff-file"),
    openOverlay: argv.includes("--uca-open-overlay")
  };
}
