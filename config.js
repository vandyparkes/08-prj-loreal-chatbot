// Client config (this file is in git so the app runs for everyone who opens the site).
//
// Recommended: deploy the Cloudflare Worker, then set CHAT_API_URL to its public URL.
// Your OpenAI key stays only in Cloudflare; visitors never need a key.
//
// Optional: for local testing without a Worker, set OPENAI_API_KEY here — do not commit real keys.
window.CHAT_API_URL = "https://snowy-water-5575.vparkes.workers.dev";
window.OPENAI_API_KEY = "";
