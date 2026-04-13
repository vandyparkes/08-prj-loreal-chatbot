# Project 8: L'Oréal Chatbot

L’Oréal is exploring the power of AI, and your job is to showcase what's possible. Your task is to build a chatbot that helps users discover and understand L’Oréal’s extensive range of products—makeup, skincare, haircare, and fragrances—as well as provide personalized routines and recommendations.

## 🚀 Launch via GitHub Codespaces

1. In the GitHub repo, click the **Code** button and select **Open with Codespaces → New codespace**.
2. Once your codespace is ready, open the `index.html` file via the live preview.

## ☁️ Cloudflare Worker

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages** and note your account (Wrangler will use it when you deploy).
2. **Store the API key securely:** after the worker exists, open the worker → **Settings** → **Variables and Secrets** → **Add** → choose **Secret**, name **`OPENAI_API_KEY`**, and paste your OpenAI key.  
   Alternatively, from the project folder: `npx wrangler secret put OPENAI_API_KEY`
3. **Deploy** (from this repo root, after `npm install`):

   ```bash
   npm run worker:deploy
   ```

   This uses `RESOURCE_cloudflare-worker.js` as the Worker entry (see `wrangler.toml`).

4. Copy the Worker URL (e.g. `https://loreal-chatbot-api.<your-subdomain>.workers.dev`) into `secrets.js` as:

   ```js
   window.CHAT_API_URL = "https://loreal-chatbot-api.<your-subdomain>.workers.dev";
   ```

   Leave `OPENAI_API_KEY` unset in the browser when using the Worker so the key stays only in Cloudflare.

When calling the Worker, the client sends a JSON body with a `messages` array; the response is handled like the OpenAI API (`data.choices[0].message.content`).

Enjoy building your L’Oréal beauty assistant! 💄
