// api/_lib/cors.js — shared CORS allowlist for the new demo edge functions.
// Mirrors the allowlist already duplicated in api/chat.js and api/shorten.js.

export const ALLOWED = [
  'https://aqyl-ai.kz',
  'https://www.aqyl-ai.kz',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];

export function cors(origin) {
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

export function originAllowed(origin) {
  return !origin || ALLOWED.includes(origin) || origin.endsWith('.vercel.app');
}

export const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers });
