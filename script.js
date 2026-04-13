/* L'Oréal-only advisor — sent as the API system message */
const LOREAL_SYSTEM_PROMPT = `You are the L'Oréal Smart Product Advisor for this demo chat.

Scope: Answer only questions about L'Oréal (and L'Oréal Group brands), products, ingredients at a high level, skincare and haircare routines, makeup tips, and product recommendations that fit the user's needs.

Out of scope: If the user asks about anything else—general knowledge, other companies, politics, medical diagnosis, or unrelated topics—reply briefly that you only help with L'Oréal beauty topics, then invite them to ask about products or routines.

Style: Clear, friendly, concise. Do not claim to be an official L'Oréal representative. If you are unsure about a specific product name, shade, price, or availability, say so and suggest they check packaging, a store, or L'Oréal's official sites for the latest information.`;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CHAT_MODEL = "gpt-4o-mini";

/* DOM */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");

/** Full message list sent to the API (includes system + history) */
const messages = [
  { role: "system", content: LOREAL_SYSTEM_PROMPT },
  { role: "assistant", content: "👋 Hello! How can I help you today?" },
];

function appendMessage(role, text) {
  const div = document.createElement("div");
  div.className = role === "user" ? "msg user" : "msg ai";
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function setBusy(isBusy) {
  userInput.disabled = isBusy;
  sendBtn.disabled = isBusy;
}

function showTypingIndicator() {
  const div = document.createElement("div");
  div.className = "msg ai";
  div.dataset.typing = "true";
  div.textContent = "…";
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return div;
}

function renderInitialChat() {
  chatWindow.innerHTML = "";
  appendMessage("assistant", "👋 Hello! How can I help you today?");
}

async function sendChatCompletion(workerUrl, apiKey) {
  const typingEl = showTypingIndicator();
  setBusy(true);
  const useWorker = workerUrl.length > 0;

  try {
    const res = await fetch(useWorker ? workerUrl : OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(useWorker ? {} : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify(
        useWorker ? { messages } : { model: CHAT_MODEL, messages }
      ),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg =
        data.error?.message ||
        `Request failed (${res.status}). Check your key and network.`;
      throw new Error(errMsg);
    }

    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error("No reply from the model.");
    }

    messages.push({ role: "assistant", content: reply });
    appendMessage("assistant", reply);
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : "Something went wrong. If this is a browser CORS block, use a small server proxy instead of calling the API directly from the page.";
    const shown = `Sorry — ${msg}`;
    messages.push({ role: "assistant", content: shown });
    appendMessage("assistant", shown);
  } finally {
    typingEl.remove();
    setBusy(false);
  }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = userInput.value.trim();
  if (!text) return;

  const workerUrl =
    typeof window.CHAT_API_URL === "string" ? window.CHAT_API_URL.trim() : "";
  const apiKey =
    typeof window.OPENAI_API_KEY === "string" ? window.OPENAI_API_KEY.trim() : "";

  if (!workerUrl && !apiKey) {
    appendMessage(
      "assistant",
      "Set window.CHAT_API_URL to your Cloudflare Worker URL (recommended), or window.OPENAI_API_KEY in secrets.js for local-only testing."
    );
    return;
  }

  appendMessage("user", text);
  messages.push({ role: "user", content: text });
  userInput.value = "";

  await sendChatCompletion(workerUrl, apiKey);
});

renderInitialChat();
