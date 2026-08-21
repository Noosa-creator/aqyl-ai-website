// api/_lib/llm.js — shared Gemini-primary/Groq-fallback caller for the demo
// edge functions (api/query.js, api/run-flow.js). Mirrors the provider
// pattern in api/chat.js (kept untouched — this is a separate, smaller copy
// without chat.js's Sentry/Resend alerting, since these are lower-stakes
// portfolio demos rather than the lead-gen chat widget).

const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const GEMINI_TIMEOUT_MS = 8000;
const DEFAULT_TIMEOUT_MS = 10000;

async function callModel(provider, url, apiKey, model, messages, { maxTokens = 400, temp = 0.4, timeoutMs = DEFAULT_TIMEOUT_MS, jsonMode = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: temp,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages
      }),
      signal: controller.signal
    });
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? `${provider}_timeout` : `${provider}_network_error`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`${provider}_${res.status}`);
  const data = await res.json();
  const choice = data?.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) {
    // Log enough of the raw response to diagnose *why* it was empty (content filter,
    // unexpected shape, etc.) without ever logging the request (which may contain
    // user-typed input) or the API key.
    console.error(`[llm] ${provider}_empty — finish_reason=${choice?.finish_reason}, raw choice: ${JSON.stringify(choice).slice(0, 400)}`);
    throw new Error(`${provider}_empty`);
  }
  if (choice?.finish_reason === 'length') {
    // Log what was actually generated before the token budget ran out — this is the
    // one piece of evidence that tells us whether maxTokens is genuinely too small for
    // this call site, or the model is burning its budget on something else entirely
    // (e.g. invisible reasoning tokens ahead of the visible content — see api/chat.js).
    console.error(`[llm] ${provider}_truncated — maxTokens=${maxTokens}, partial output (${text.length} chars): ${text.slice(0, 500)}`);
    throw new Error(`${provider}_truncated`);
  }
  return text;
}

// Gemini primary, Groq automatic fallback on any Gemini failure.
export async function llm(messages, opts = {}) {
  const fn = opts.fnTag || 'llm';
  try {
    return await callModel('gemini', GEMINI_URL, process.env.GEMINI_API_KEY, GEMINI_MODEL, messages, { ...opts, timeoutMs: opts.timeoutMs || GEMINI_TIMEOUT_MS });
  } catch (geminiErr) {
    console.error(`[llm:${fn}] gemini failed, falling back to groq:`, geminiErr?.message || geminiErr);
    try {
      return await callModel('groq', GROQ_URL, process.env.GROQ_API_KEY, GROQ_MODEL, messages, opts);
    } catch (groqErr) {
      console.error(`[llm:${fn}] groq fallback ALSO failed:`, groqErr?.message || groqErr);
      const bothFailed = new Error(`both_providers_failed: gemini=${geminiErr?.message}, groq=${groqErr?.message}`);
      bothFailed.bothProvidersFailed = true;
      throw bothFailed;
    }
  }
}
