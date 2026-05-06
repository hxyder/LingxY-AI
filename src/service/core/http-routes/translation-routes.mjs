import { translateText } from "../../translation/free-translator.mjs";
import { readJsonBody, sendJson } from "../http-helpers.mjs";

const MAX_TRANSLATE_BODY_BYTES = 96 * 1024;

export async function tryHandleTranslationRoute({ request, response, method, url }) {
  if (method !== "POST" || url.pathname !== "/translate") return false;

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: MAX_TRANSLATE_BODY_BYTES });
  } catch (error) {
    const status = error.code === "body_too_large" ? 413 : 400;
    return sendJson(response, status, {
      ok: false,
      error: error.code ?? "invalid_json",
      message: error.message
    });
  }

  const text = String(body?.text ?? body?.selectionText ?? "").trim();
  if (!text) {
    return sendJson(response, 400, {
      ok: false,
      error: "empty_text"
    });
  }

  try {
    const result = await translateText({
      text,
      source: body?.source ?? "auto",
      target: body?.target ?? null,
      preferredProvider: body?.preferredProvider ?? null
    });
    return sendJson(response, 200, {
      ok: true,
      text: result.text,
      source_language: result.source_language,
      target_language: result.target_language,
      provider: result.provider,
      chunks: result.chunks
    });
  } catch (error) {
    return sendJson(response, 502, {
      ok: false,
      error: "translation_failed",
      message: error.message
    });
  }
}
