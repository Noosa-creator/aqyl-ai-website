// api/run-flow.js — "Trigger an automation" live demo.
// Runs a fixed, safe 4-step workflow server-side (Webhook -> Transform ->
// AI step -> Notify) and returns each step's input/output so the frontend
// can animate the node graph lighting up in sequence. This never touches a
// real n8n instance, a real notification channel, or any external system
// other than the LLM call in the AI step — "Notify" is a simulated payload.

export const config = { runtime: 'edge' };

import { cors, originAllowed, json } from './_lib/cors.js';
import { llm } from './_lib/llm.js';
import { rateLimited, clientIp } from './_lib/ratelimit.js';

const MAX_INPUT_LEN = 400;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function detectLang(text) {
  return /[Ѐ-ӿ]/.test(text) ? 'ru' : 'en';
}

function extractEmail(text) {
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

function extractPhone(text) {
  const m = text.match(/\+?\d[\d\s().-]{6,}\d/);
  return m ? m[0].trim() : null;
}

// Step 2: pure JS, deterministic, no model call.
function transform(rawInput) {
  const text = rawInput.trim();
  return {
    normalized_text: text,
    detected_language: detectLang(text),
    word_count: text.split(/\s+/).filter(Boolean).length,
    contains_email: extractEmail(text),
    contains_phone: extractPhone(text),
    received_at: new Date().toISOString()
  };
}

function aiSystemPrompt(lang) {
  return lang === 'ru'
    ? `Ты — шаг классификации в демо автоматизации. Дан входящий текст клиента. Верни ТОЛЬКО JSON:
{"intent":"одно-два слова, категория запроса","urgency":"low|medium|high","one_line_reply":"один короткий вежливый черновик ответа на русском"}
Никаких пояснений вне JSON.`
    : `You are the classification step in a workflow-automation demo. Given an inbound customer message, return ONLY JSON:
{"intent":"one-two word category of the request","urgency":"low|medium|high","one_line_reply":"one short, polite draft reply"}
No explanation outside the JSON.`;
}

async function handleRequest(req) {
  const origin = req.headers.get('origin') || '';
  const headers = cors(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);
  if (!originAllowed(origin)) return json({ error: 'forbidden' }, 403, headers);

  if (rateLimited(`flow:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return json({ error: 'rate_limited' }, 429, headers);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400, headers);
  }

  const input = typeof body.input === 'string' ? body.input.slice(0, MAX_INPUT_LEN).trim() : '';
  if (!input) return json({ error: 'no_input' }, 400, headers);
  const lang = body.lang === 'ru' ? 'ru' : 'en';

  const steps = [];

  // Step 1: Webhook — receives the raw input, exactly as a real inbound webhook would.
  steps.push({ key: 'webhook', input: null, output: { received: input } });

  // Step 2: Transform — deterministic parsing, no LLM.
  const transformed = transform(input);
  steps.push({ key: 'transform', input: { received: input }, output: transformed });

  // Step 3: AI step — one small classification/drafting call.
  let aiOut;
  try {
    const raw = await llm(
      [
        { role: 'system', content: aiSystemPrompt(lang) },
        { role: 'user', content: transformed.normalized_text }
      ],
      { maxTokens: 200, temp: 0.4, jsonMode: true, fnTag: 'run-flow' }
    );
    const match = raw.match(/\{[\s\S]*\}/);
    aiOut = match ? JSON.parse(match[0]) : null;
  } catch (e) {
    console.error('[run-flow] AI step failed:', String(e?.message || e));
    aiOut = null;
  }
  if (!aiOut || !aiOut.intent) {
    aiOut = {
      intent: 'general_inquiry',
      urgency: 'medium',
      one_line_reply: lang === 'ru' ? 'Спасибо за сообщение, скоро ответим.' : 'Thanks for reaching out — we will follow up shortly.'
    };
  }
  steps.push({ key: 'ai', input: { text: transformed.normalized_text }, output: aiOut });

  // Step 4: Notify — a simulated payload, nothing is actually sent anywhere.
  const notifyPayload = {
    channel: '#inbound-leads (simulated)',
    message: `[${String(aiOut.urgency).toUpperCase()}] ${aiOut.intent} — "${aiOut.one_line_reply}"`,
    would_deliver_to: ['Slack', 'Email'],
    simulated: true
  };
  steps.push({ key: 'notify', input: aiOut, output: notifyPayload });

  return json({ steps }, 200, headers);
}

export default async function handler(req) {
  try {
    return await handleRequest(req);
  } catch (e) {
    console.error('[run-flow] unhandled:', String(e?.message || e));
    const origin = req.headers.get('origin') || '';
    return json({ error: 'internal' }, 500, cors(origin));
  }
}
