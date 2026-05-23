export function createRuntimeHttpClient({
  getBaseUrl,
  fetchFn = globalThis.fetch?.bind(globalThis)
} = {}) {
  if (typeof getBaseUrl !== "function") {
    throw new TypeError("createRuntimeHttpClient requires getBaseUrl.");
  }
  if (typeof fetchFn !== "function") {
    throw new TypeError("createRuntimeHttpClient requires fetchFn.");
  }

  async function fetchJson(pathname, options = {}) {
    const response = await fetchFn(`${getBaseUrl()}${pathname}`, options);
    const payloadText = await response.text();
    const payload = payloadText ? JSON.parse(payloadText) : {};
    if (!response.ok) throw new Error(payload.message ?? payload.error ?? pathname);
    return payload;
  }

  function fetchResponse(pathname, options = {}) {
    return fetchFn(`${getBaseUrl()}${pathname}`, options);
  }

  async function fetchJsonResponse(pathname, options = {}) {
    const response = await fetchFn(`${getBaseUrl()}${pathname}`, options);
    const payloadText = await response.text();
    let payload = {};
    try {
      payload = payloadText ? JSON.parse(payloadText) : {};
    } catch {
      payload = {};
    }
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  }

  return { fetchJson, fetchJsonResponse, fetchResponse };
}
