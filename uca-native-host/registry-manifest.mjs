export function buildNativeHostManifest({ hostName = "com.uca.host", executablePath, allowedOrigins }) {
  return {
    name: hostName,
    description: "LingxY Native Messaging Host",
    path: executablePath,
    type: "stdio",
    allowed_origins: allowedOrigins
  };
}
