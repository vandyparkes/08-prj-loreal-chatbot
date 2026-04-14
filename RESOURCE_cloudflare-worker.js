/**
 * L'Oréal chatbot — Cloudflare Worker proxy for OpenAI (keeps the API key off the static site).
 *
 * Required secret (Workers → Settings → Variables and Secrets):
 *   OPENAI_API_KEY
 *
 * Optional environment variables (plain text vars, not secrets, unless you prefer):
 *   ALLOWED_ORIGINS — Comma-separated browser origins allowed to call this worker
 *     (e.g. https://yourname.github.io,http://127.0.0.1:5500). If omitted, CORS uses * (demo only).
 *   WORKER_BEARER_TOKEN — If set, POST / must include header: Authorization: Bearer <token>.
 *     Do not commit tokens in public config.js; use only for private deploys or non-browser callers.
 *
 * Deploy: npm run worker:deploy  (see wrangler.toml)
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const CHAT_MODEL = "gpt-4o-mini";
const CHAT_TEMPERATURE = 0.6;
const MAX_COMPLETION_TOKENS = 1024;

/** Must cover client system messages + transcript cap (see script.js MAX_TRANSCRIPT_MESSAGES). */
const MAX_MESSAGES = 48;
const MAX_MESSAGE_CHARS = 20000;
const MAX_JSON_BYTES = 400_000;

const ALLOWED_ROLES = new Set(["system", "user", "assistant"]);

function parseAllowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGINS || "").trim();
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * @returns {{ headers: Record<string, string>, ok: boolean }}
 * ok === false → caller should return 403 (browser origin not allowed).
 */
function corsHeaders(request, env) {
  const allowed = parseAllowedOrigins(env);
  const origin = request.headers.get("Origin");

  const base = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  if (!allowed || allowed.length === 0) {
    return { ok: true, headers: { ...base, "Access-Control-Allow-Origin": "*" } };
  }

  if (origin && !allowed.includes(origin)) {
    return { ok: false, headers: base };
  }

  if (origin) {
    return {
      ok: true,
      headers: {
        ...base,
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
      },
    };
  }

  // Non-browser callers (no Origin): allow; CORS headers not required.
  return { ok: true, headers: base };
}

function jsonResponse(cors, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors.headers,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function readContentLength(request) {
  const raw = request.headers.get("Content-Length");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function validateBearer(request, env) {
  const expected = env.WORKER_BEARER_TOKEN;
  if (!expected) return true;
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m && m[1] === expected;
}

function normalizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Expected a non-empty messages array" };
  }
  if (raw.length > MAX_MESSAGES) {
    return { error: `Too many messages (max ${MAX_MESSAGES})` };
  }

  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    if (!m || typeof m !== "object") {
      return { error: `Invalid message at index ${i}` };
    }
    const role = m.role;
    const content = m.content;
    if (typeof role !== "string" || !ALLOWED_ROLES.has(role)) {
      return { error: `Invalid role at index ${i}` };
    }
    if (typeof content !== "string") {
      return { error: `Invalid content at index ${i}` };
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return { error: `Message ${i} exceeds maximum length` };
    }
    out.push({ role, content });
  }
  return { messages: out };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      if (!cors.ok) {
        return new Response(null, { status: 403, headers: cors.headers });
      }
      return new Response(null, { headers: cors.headers });
    }

    if (request.method === "GET") {
      if (!cors.ok) {
        return new Response(null, { status: 403, headers: cors.headers });
      }
      const body = {
        ok: true,
        service: "loreal-chatbot-api",
        hint: "POST JSON { messages: [...] } for chat completions.",
      };
      return jsonResponse(cors, 200, body);
    }

    if (request.method !== "POST") {
      return jsonResponse(cors, 405, { error: { message: "Method not allowed" } });
    }

    if (!cors.ok) {
      return jsonResponse(cors, 403, { error: { message: "Origin not allowed" } });
    }

    if (!validateBearer(request, env)) {
      return jsonResponse(cors, 401, { error: { message: "Unauthorized" } });
    }

    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return jsonResponse(cors, 415, { error: { message: "Content-Type must be application/json" } });
    }

    const len = readContentLength(request);
    if (len != null && len > MAX_JSON_BYTES) {
      return jsonResponse(cors, 413, { error: { message: "Request body too large" } });
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse(cors, 500, {
        error: {
          message:
            "Worker missing OPENAI_API_KEY. Add it under Workers → Variables and Secrets (encrypted).",
        },
      });
    }

    let text;
    try {
      text = await request.text();
    } catch {
      return jsonResponse(cors, 400, { error: { message: "Could not read body" } });
    }

    if (text.length > MAX_JSON_BYTES) {
      return jsonResponse(cors, 413, { error: { message: "Request body too large" } });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return jsonResponse(cors, 400, { error: { message: "Invalid JSON body" } });
    }

    const checked = normalizeMessages(parsed.messages);
    if (checked.error) {
      return jsonResponse(cors, 400, { error: { message: checked.error } });
    }

    const upstream = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: checked.messages,
        temperature: CHAT_TEMPERATURE,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      }),
    });

    const rawOut = await upstream.text();
    let data;
    try {
      data = JSON.parse(rawOut);
    } catch {
      data = { error: { message: "Invalid response from model API" } };
    }

    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: {
        ...cors.headers,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
