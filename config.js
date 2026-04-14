// Client config (this file is in git so the app runs for everyone who opens the site).
//
// Recommended: deploy the Cloudflare Worker, then set CHAT_API_URL to its public URL.
// Your OpenAI key stays only in Cloudflare; visitors never need a key.
//
// Optional: for local testing without a Worker, set OPENAI_API_KEY here — do not commit real keys.
//
// CHAT_API_URL must be THIS project’s Cloudflare Worker (OpenAI chat completions proxy):
//   RESOURCE_cloudflare-worker.js — see wrangler.toml. Deploy: npm run worker:deploy
// Then paste the workers.dev URL Wrangler prints (not another Worker on workers.dev).
window.CHAT_API_URL = "https://silent-base-b242.vparkes.workers.dev";
window.OPENAI_API_KEY = "";

// Optional: default address shown in the "Email routine" dialog (user can change it). Leave "" to use last-used address from this browser only, or an empty field.
window.ROUTINE_EMAIL_TO = "";

// Optional: default number shown in the "Text routine" dialog (digits or +country…). Leave "" for last-used number from this browser only, or an empty field.
window.ROUTINE_SMS_PHONE = "";
