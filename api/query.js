// api/query.js — "Ask a database in plain English" live demo.
// Turns a natural-language question into SQL via an LLM, then runs that SQL
// through a hand-rolled SELECT-only engine (api/_lib/sql-engine.js) over a
// hardcoded, fictional, in-memory dataset. There is no real database
// anywhere in this path — no Supabase, no credentials, nothing persistent.
// The generated SQL is always returned alongside the result, even on
// failure, because showing the SQL is the point of the demo.

export const config = { runtime: 'edge' };

import { cors, originAllowed, json } from './_lib/cors.js';
import { llm } from './_lib/llm.js';
import { rateLimited, clientIp } from './_lib/ratelimit.js';
import { runSelect, assertSafeSelect, SqlError, SCHEMA_DESCRIPTION } from './_lib/sql-engine.js';

const MAX_QUESTION_LEN = 300;
const RATE_LIMIT = 10; // requests
const RATE_WINDOW_MS = 60_000; // per minute, per IP, per warm instance — see _lib/ratelimit.js

function systemPrompt(lang) {
  const rules = lang === 'ru'
    ? `Правила:
- Верни ТОЛЬКО одну SQL-инструкцию SELECT. Без markdown, без пояснений, без точки с запятой в конце.
- Разрешено: SELECT, FROM, явный JOIN...ON (один или несколько), WHERE, GROUP BY, HAVING, ORDER BY, LIMIT.
- Разрешённые функции: COUNT, SUM, AVG, MIN, MAX (можно с DISTINCT, например COUNT(DISTINCT x)), SUBSTR, STRFTIME, ROUND, UPPER, LOWER, ABS, LENGTH.
- ЗАПРЕЩЕНО: любые не-SELECT операторы, подзапросы, WITH/CTE, UNION, оконные функции, "SELECT *" (перечисляй колонки явно), несколько инструкций через ";", соединение таблиц через запятую в FROM (всегда используй явный JOIN...ON).
- Всегда указывай алиасы (AS) для агрегатных выражений.
- Используй только таблицы и колонки из схемы ниже — ничего не выдумывай.
- Для вопросов вида "N и более / повторные / минимум дважды" используй GROUP BY + HAVING COUNT(...) >= N — не оконные функции и не подзапросы.`
    : `Rules:
- Return ONLY a single SELECT statement. No markdown, no explanation, no trailing semicolon.
- Allowed: SELECT, FROM, explicit JOIN...ON (one or more), WHERE, GROUP BY, HAVING, ORDER BY, LIMIT.
- Allowed functions: COUNT, SUM, AVG, MIN, MAX (optionally with DISTINCT, e.g. COUNT(DISTINCT x)), SUBSTR, STRFTIME, ROUND, UPPER, LOWER, ABS, LENGTH.
- FORBIDDEN: any non-SELECT statement, subqueries, WITH/CTEs, UNION, window functions, "SELECT *" (list columns explicitly), multiple statements separated by ";", comma-separated tables in FROM (always use explicit JOIN...ON instead).
- Always alias (AS) aggregate expressions.
- Use only the tables/columns in the schema below — never invent one.
- For "N or more / repeat / at least twice" style questions, use GROUP BY + HAVING COUNT(...) >= N — not window functions or subqueries.`;

  return `You translate a natural-language question into a single SQLite SELECT statement over this fictional demo dataset.

${SCHEMA_DESCRIPTION}

${rules}`;
}

function extractSql(raw) {
  // Strip markdown fences if the model wraps its answer despite instructions.
  const fenced = raw.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  let text = (fenced ? fenced[1] : raw).trim();
  // If it still babbles, grab the first line that looks like it starts a SELECT.
  if (!/^SELECT\b/i.test(text)) {
    const m = text.match(/SELECT[\s\S]*/i);
    if (m) text = m[0];
  }
  return text.trim();
}

async function handleRequest(req) {
  const origin = req.headers.get('origin') || '';
  const headers = cors(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);
  if (!originAllowed(origin)) return json({ error: 'forbidden' }, 403, headers);

  if (rateLimited(`query:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return json({ error: 'rate_limited' }, 429, headers);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400, headers);
  }

  const question = typeof body.question === 'string' ? body.question.slice(0, MAX_QUESTION_LEN).trim() : '';
  if (!question) return json({ error: 'no_question' }, 400, headers);
  const lang = body.lang === 'ru' ? 'ru' : 'en';

  let rawSql;
  try {
    rawSql = await llm(
      [
        { role: 'system', content: systemPrompt(lang) },
        { role: 'user', content: question }
      ],
      // 250 was too tight in production: real Gemini/Groq responses for some questions
      // were hitting finish_reason:'length' and getting thrown away as "truncated" before
      // ever reaching the SQL engine (see api/_lib/llm.js's truncation logging) -- this
      // was the actual cause of a live "Customers who ordered twice" failure, unrelated
      // to the engine's SQL support. 600 mirrors the headroom api/chat.js already uses
      // for ordinary turns, for the same invisible-reasoning-tokens reason noted there.
      { maxTokens: 600, temp: 0.1, fnTag: 'query' }
    );
  } catch (e) {
    console.error('[query] llm() failed:', String(e?.message || e));
    return json({ error: 'llm_unavailable' }, 502, headers);
  }

  const sql = extractSql(rawSql);

  try {
    assertSafeSelect(sql);
    const { columns, rows } = runSelect(sql);
    return json({ sql, columns, rows }, 200, headers);
  } catch (e) {
    // Still return the generated SQL — showing it is the point of the demo,
    // even when the engine can't run it (an unsupported construct, an
    // unknown column, etc). This is never a real-database error: nothing
    // here ever touches a real connection.
    const reason = e instanceof SqlError ? e.message : 'execution_failed';
    return json({ sql, error: reason }, 200, headers);
  }
}

export default async function handler(req) {
  try {
    return await handleRequest(req);
  } catch (e) {
    console.error('[query] unhandled:', String(e?.message || e));
    const origin = req.headers.get('origin') || '';
    return json({ error: 'internal' }, 500, cors(origin));
  }
}
