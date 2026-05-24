import assert from "node:assert/strict";
import test from "node:test";

import { registerProviderConfigIpc } from "../../src/desktop/main/ipc/register-provider-config-ipc.mjs";
import { IPC_CHANNELS } from "../../src/desktop/shared/manifest.mjs";

function createProviderIpcHarness({ requestDesktopServiceJson = async () => ({}) } = {}) {
  const handlers = new Map();
  const requests = [];
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };

  registerProviderConfigIpc({
    ipcMain,
    IPC_CHANNELS,
    getServiceBaseUrl: () => "http://127.0.0.1:4310",
    desktopActorForSender: () => "desktop_console:test",
    postDesktopServiceJson: async () => ({ ok: true }),
    requestDesktopServiceJson: async (request) => {
      requests.push(request);
      return requestDesktopServiceJson(request);
    }
  });

  return { handlers, requests };
}

test("provider list IPC reads configured providers through the desktop service bridge", async () => {
  const { handlers, requests } = createProviderIpcHarness({
    requestDesktopServiceJson: async () => ({
      providers: [{ id: "demo", configured: true }],
      taskRouting: { default: "demo" }
    })
  });

  const result = await handlers.get(IPC_CHANNELS.providerList)({ sender: {} });

  assert.deepEqual(result.providers, [{ id: "demo", configured: true }]);
  assert.deepEqual(requests[0], {
    base: "http://127.0.0.1:4310",
    method: "GET",
    actor: "desktop_console:test",
    pathname: "/config/providers"
  });
});

test("provider list IPC returns a structured error when the runtime is unreachable", async () => {
  const { handlers } = createProviderIpcHarness({
    requestDesktopServiceJson: async () => {
      throw new Error("connect ECONNREFUSED");
    }
  });

  const result = await handlers.get(IPC_CHANNELS.providerList)({ sender: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error, "provider_list_failed");
  assert.match(result.message, /ECONNREFUSED/u);
});
