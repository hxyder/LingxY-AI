export function buildScreenshotCaptureRequest({
  screenshotPath,
  width,
  height,
  displayId = "primary"
}) {
  return {
    protocolVersion: "1.0",
    action: "submit_screenshot",
    payload: {
      screenshotPath,
      width,
      height,
      displayId
    }
  };
}
