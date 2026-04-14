/* L'Oréal-only advisor — sent as the API system message */
const LOREAL_SYSTEM_PROMPT = `You are the L'Oréal Smart Product Advisor for this demo chat.

In scope (answer helpfully): L'Oréal and L'Oréal Group brands, products, shades and product types, high-level ingredient education, skincare and haircare routines, makeup application tips, how to choose products for concerns (dryness, frizz, uneven tone, etc.), and recommendations that stay within L'Oréal's beauty universe.

Out of scope (do not fulfill the request): Anything not tied to L'Oréal beauty—general knowledge, homework, coding, sports, politics, religion, gossip, other companies' products as the main topic, legal or financial advice, or personal topics unrelated to beauty. Never give a medical diagnosis or replace a clinician; you may share general skincare or haircare guidance only.

Polite refusal (required for off-topic messages): Do not answer the off-topic part, even partially. Respond warmly in one short paragraph: thank the user, say you are here only for L'Oréal products and beauty routines, and invite them to ask about a product, concern, or routine. Keep the tone professional and kind, never curt.

Conversation memory: You receive the full thread. Use earlier turns for follow-ups (e.g. "that serum", "the same concern"). If the user shared their name, use it naturally when it fits; do not overuse it.

Style: Clear, friendly, concise. Do not claim to be an official L'Oréal representative. If unsure about a specific product name, shade, price, or availability, say so and suggest they check packaging, a retailer, or L'Oréal's official sites.`;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CHAT_MODEL = "gpt-4o-mini";

const STORAGE_KEY = "lorealAdvisorSession";
/** Max user + assistant messages kept when calling the API (avoids huge payloads) */
const MAX_TRANSCRIPT_MESSAGES = 40;

const DEFAULT_GREETING = "👋 Hello! How can I help you today?";

const NAME_FALSE_POSITIVES = new Set([
  "looking",
  "trying",
  "wondering",
  "going",
  "here",
  "just",
  "not",
  "sure",
  "asking",
  "interested",
  "using",
  "shopping",
  "searching",
  "curious",
  "from",
  "the",
  "a",
  "an",
]);

/* DOM */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const chatMessages = document.getElementById("chatMessages");
const sendBtn = document.getElementById("sendBtn");
const historyBtn = document.getElementById("historyBtn");
const historyDialog = document.getElementById("historyDialog");
const historyDialogBody = document.getElementById("historyDialogBody");
const historyCloseBtn = document.getElementById("historyCloseBtn");

let userName = null;
/** [base system, memory system, ...user/assistant transcript] */
let messages = [];

function buildMemorySystemContent(name) {
  if (name) {
    return `Session memory: The user's name is ${name}. Address them by name when it feels natural (not every sentence). Use prior messages in this chat—including products or concerns they already mentioned—when answering new questions or follow-ups.`;
  }
  return `Session memory: The user has not shared their name yet. If they introduce themselves, treat that as their name for the rest of the chat. Use prior messages in this chat when they refer to something without repeating details.`;
}

function tryLearnNameFromUserText(text) {
  const t = text.trim();
  let m = t.match(
    /\bmy name is\s+([A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)?)\b/i
  );
  if (m) return normalizeDisplayName(m[1]);

  m = t.match(
    /\bcall me\s+([A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)?)\b/i
  );
  if (m) return normalizeDisplayName(m[1]);

  m = t.match(/^(?:i am|i'm)\s+([A-Za-z][A-Za-z'.-]*)\b/i);
  if (m) {
    const word = m[1].toLowerCase();
    if (NAME_FALSE_POSITIVES.has(word)) return null;
    return normalizeDisplayName(m[1]);
  }
  return null;
}

function normalizeDisplayName(s) {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function syncMemorySystemMessage() {
  if (messages.length < 2) return;
  messages[1] = {
    role: "system",
    content: buildMemorySystemContent(userName),
  };
}

function messagesForApi() {
  const head = messages.slice(0, 2);
  const body = messages.slice(2);
  const tail =
    body.length > MAX_TRANSCRIPT_MESSAGES
      ? body.slice(-MAX_TRANSCRIPT_MESSAGES)
      : body;
  return [...head, ...tail];
}

function persistSession() {
  try {
    const transcript = messages.slice(2).filter(
      (m) => m.role === "user" || m.role === "assistant"
    );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, userName, transcript })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.v !== 1 || !Array.isArray(data.transcript)) return null;
    const transcript = data.transcript.filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    );
    return {
      userName: typeof data.userName === "string" ? data.userName : null,
      transcript,
    };
  } catch {
    return null;
  }
}

function initMessagesFromStorage(loaded) {
  userName = loaded?.userName ?? null;
  const transcript =
    loaded?.transcript?.length > 0
      ? loaded.transcript
      : [{ role: "assistant", content: DEFAULT_GREETING }];
  messages = [
    { role: "system", content: LOREAL_SYSTEM_PROMPT },
    { role: "system", content: buildMemorySystemContent(userName) },
    ...transcript,
  ];
}

function scrollChatToBottom() {
  const el = chatMessages || chatWindow;
  el.scrollTop = el.scrollHeight;
}

function renderChat() {
  if (!chatMessages) {
    chatWindow.innerHTML = "";
    for (const m of messages.slice(2)) {
      if (m.role === "user") appendMessage("user", m.content);
      else if (m.role === "assistant") appendMessage("assistant", m.content);
    }
    return;
  }
  chatMessages.innerHTML = "";
  for (const m of messages.slice(2)) {
    if (m.role === "user") appendMessage("user", m.content);
    else if (m.role === "assistant") appendMessage("assistant", m.content);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function getTranscriptForHistory() {
  return messages.slice(2).filter(
    (m) => m.role === "user" || m.role === "assistant"
  );
}

function renderHistoryPanel() {
  if (!historyDialogBody) return;
  const parts = [];
  if (userName) {
    parts.push(
      `<p class="history-meta">Name on file: <strong>${escapeHtml(
        userName
      )}</strong></p>`
    );
  }
  const transcript = getTranscriptForHistory();
  if (transcript.length === 0) {
    parts.push('<p class="history-empty">No messages yet.</p>');
  } else {
    for (const m of transcript) {
      const label = m.role === "user" ? "You" : "Advisor";
      const roleClass =
        m.role === "user" ? "history-turn--user" : "history-turn--assistant";
      parts.push(
        `<div class="history-turn ${roleClass}"><span class="history-turn-label">${label}</span><div class="history-turn-text">${escapeHtml(
          m.content
        )}</div></div>`
      );
    }
  }
  historyDialogBody.innerHTML = parts.join("");
}

function openHistoryDialog() {
  renderHistoryPanel();
  if (historyDialog && typeof historyDialog.showModal === "function") {
    historyDialog.showModal();
  }
}

function appendMessage(role, text) {
  const row = document.createElement("div");
  row.className =
    role === "user" ? "msg-row msg-row--user" : "msg-row msg-row--assistant";

  const stack = document.createElement("div");
  stack.className = "msg-stack";

  const label = document.createElement("span");
  label.className = "msg-sender";
  label.textContent = role === "user" ? "You" : "Advisor";

  const bubble = document.createElement("div");
  bubble.className =
    role === "user" ? "msg-bubble msg-bubble--user" : "msg-bubble msg-bubble--assistant";
  bubble.textContent = text;

  stack.appendChild(label);
  stack.appendChild(bubble);
  row.appendChild(stack);

  const parent = chatMessages || chatWindow;
  parent.appendChild(row);
  scrollChatToBottom();
}

function setBusy(isBusy) {
  userInput.disabled = isBusy;
  sendBtn.disabled = isBusy;
}

function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "msg-row msg-row--assistant";
  row.dataset.typing = "true";

  const stack = document.createElement("div");
  stack.className = "msg-stack";

  const label = document.createElement("span");
  label.className = "msg-sender";
  label.textContent = "Advisor";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble msg-bubble--assistant msg-bubble--typing";
  bubble.setAttribute("aria-label", "Advisor is typing");

  const dots = document.createElement("span");
  dots.className = "typing-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.appendChild(document.createElement("span"));
  dots.appendChild(document.createElement("span"));
  dots.appendChild(document.createElement("span"));
  bubble.appendChild(dots);

  stack.appendChild(label);
  stack.appendChild(bubble);
  row.appendChild(stack);

  const parent = chatMessages || chatWindow;
  parent.appendChild(row);
  scrollChatToBottom();
  return row;
}

async function sendChatCompletion(workerUrl, apiKey) {
  const typingEl = showTypingIndicator();
  setBusy(true);
  const useWorker = workerUrl.length > 0;
  const payloadMessages = messagesForApi();

  try {
    const res = await fetch(useWorker ? workerUrl : OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(useWorker ? {} : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify(
        useWorker
          ? { messages: payloadMessages }
          : {
              model: CHAT_MODEL,
              messages: payloadMessages,
              temperature: 0.6,
            }
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
    persistSession();
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : "Something went wrong. If this is a browser CORS block, use a small server proxy instead of calling the API directly from the page.";
    const shown = `Sorry — ${msg}`;
    messages.push({ role: "assistant", content: shown });
    appendMessage("assistant", shown);
    persistSession();
  } finally {
    typingEl.remove();
    setBusy(false);
    userInput.focus();
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
      "Set window.CHAT_API_URL in config.js to your Cloudflare Worker URL (recommended), or window.OPENAI_API_KEY there for local-only testing."
    );
    return;
  }

  messages.push({ role: "user", content: text });
  appendMessage("user", text);

  const learned = tryLearnNameFromUserText(text);
  if (learned && learned !== userName) {
    userName = learned;
    syncMemorySystemMessage();
  }
  persistSession();

  userInput.value = "";

  await sendChatCompletion(workerUrl, apiKey);
});

if (historyBtn && historyDialog && historyCloseBtn) {
  historyBtn.addEventListener("click", openHistoryDialog);
  historyCloseBtn.addEventListener("click", () => historyDialog.close());
}

const loaded = loadSession();
initMessagesFromStorage(loaded);
renderChat();
