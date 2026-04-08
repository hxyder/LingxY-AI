export function buildNativeHostManifest({ hostName = "com.uca.host", executablePath, allowedOrigins }) {
  return {
    name: hostName,
    description: "UCA Native Messaging Host",
    path: executablePath,
    type: "stdio",
    allowed_origins: allowedOrigins
  };
}
