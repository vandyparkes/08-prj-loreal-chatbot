/* L'Oréal-only advisor — sent as the API system message */
const LOREAL_SYSTEM_PROMPT = `You are the L'Oréal Smart Product Advisor for this demo chat.

In scope (answer helpfully): L'Oréal and L'Oréal Group brands, products, shades and product types, high-level ingredient education, skincare and haircare routines, makeup application tips, how to choose products for concerns (dryness, frizz, uneven tone, etc.), and recommendations that stay within L'Oréal's beauty universe.

Out of scope (do not fulfill the request): Anything not tied to L'Oréal beauty—general knowledge, homework, coding, sports, politics, religion, gossip, other companies' products as the main topic, legal or financial advice, or personal topics unrelated to beauty. Never give a medical diagnosis or replace a clinician; you may share general skincare or haircare guidance only.

Polite refusal (required for off-topic messages): Do not answer the off-topic part, even partially. Respond warmly in one short paragraph: thank the user, say you are here only for L'Oréal products and beauty routines, and invite them to ask about a product, concern, or routine. Keep the tone professional and kind, never curt.

Conversation memory: You receive the full thread. Use earlier turns for follow-ups (e.g. "that serum", "the same concern"). If the user shared their name, use it naturally when it fits; do not overuse it.

Style: Clear, friendly, concise. Do not claim to be an official L'Oréal representative. If unsure about a specific product name, shade, price, or availability, say so and suggest they check packaging, a retailer, or L'Oréal's official sites.

Email / text routine: When you give steps, order of use, or a routine the user may want to keep, briefly mention they can use "Email routine" or "Text routine" in the chat header — they enter their email or phone, then their own email or messaging app opens with your advice and shop links for recommended products (when shown).

Product pictures (required when you discuss or recommend any item from the demo product list the app knows about): After your normal answer, add a separate block so the UI can show photos. Use this exact format, with one catalog line per product (copy the full line including the em dash, no extra characters):
[[VISUALS]]
(full catalog product line 1)
(full catalog product line 2)
[[/VISUALS]]
Include at most three products in the block, only when they are genuinely part of your advice. For short off-topic refusals, omit the block.`;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const CHAT_MODEL = "gpt-4o-mini";

const STORAGE_KEY = "lorealAdvisorSession";
const ROUTINE_EMAIL_ADDRESS_KEY = "lorealAdvisorRoutineEmailTo";
const ROUTINE_SMS_PHONE_KEY = "lorealAdvisorRoutineSmsPhone";
/** Max user + assistant messages kept when calling the API (avoids huge payloads) */
const MAX_TRANSCRIPT_MESSAGES = 40;

const DEFAULT_GREETING = "👋 Hello! How can I help you today?";

/** Representative L'Oréal Group products the advisor can discuss (demo list). */
const PRODUCT_CATALOG = [
  "L'Oréal Paris — Revitalift Triple Power Anti-Aging Serum",
  "L'Oréal Paris — Elvive Total Repair 5 Shampoo",
  "L'Oréal Paris — Infallible Fresh Wear Foundation",
  "L'Oréal Paris — Voluminous Lash Paradise Mascara",
  "Maybelline New York — Fit Me Matte + Poreless Foundation",
  "Maybelline New York — Sky High Mascara",
  "NYX Professional Makeup — Butter Gloss",
  "Garnier — Micellar Cleansing Water",
  "Garnier — Fructis Sleek & Shine Shampoo",
  "Lancôme — Advanced Génifique Youth Activating Serum",
  "Kiehl's — Ultra Facial Cream",
  "CeraVe — Hydrating Facial Cleanser",
  "La Roche-Posay — Anthelios Melt-In Milk Sunscreen SPF 60",
  "Yves Saint Laurent Beauté — Rouge Pur Couture Lipstick",
  "IT Cosmetics — CC+ Cream with SPF 50+",
  "Urban Decay — Naked3 Eyeshadow Palette",
  "Essie — Gel Couture Longwear Nail Polish",
  "Matrix — Total Results Brass Off Shampoo",
  "Redken — Acidic Bonding Concentrate Leave-In Treatment",
  "Kérastase — Nutritive 8H Magic Night Hair Serum",
];

/** Stock beauty imagery for demo UI (Unsplash); keyed by exact PRODUCT_CATALOG strings. */
const PRODUCT_IMAGE_MAP = (() => {
  const shots = [
    "https://images.unsplash.com/photo-1571875257727-256c39da42af?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1608248542234-44b545f6a1c4?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1570172619643-d90203ee9f33?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1617897903246-719242758050?w=480&h=480&fit=crop&q=80",
    "https://images.unsplash.com/photo-1596755094514-f87a8407b67c?w=480&h=480&fit=crop&q=80",
  ];
  const map = {};
  PRODUCT_CATALOG.forEach((name, i) => {
    map[name] = shots[i % shots.length];
  });
  return map;
})();

/**
 * Optional per-product shop URLs (https only). If missing, a retailer search link is built from the catalog name.
 * @type {Record<string, string>}
 */
const PRODUCT_PURCHASE_MAP = {};

const PURCHASE_SEARCH_BASE = "https://www.amazon.com/s?k=";

function purchaseUrlForProduct(catalogName) {
  const direct = PRODUCT_PURCHASE_MAP[catalogName];
  if (
    typeof direct === "string" &&
    direct.startsWith("https://") &&
    !/\s/.test(direct)
  ) {
    return direct;
  }
  return `${PURCHASE_SEARCH_BASE}${encodeURIComponent(catalogName)}`;
}

function buildLorealSystemPrompt() {
  const catalogLines = PRODUCT_CATALOG.map((p) => `- ${p}`).join("\n");
  return `${LOREAL_SYSTEM_PROMPT}

Exact catalog strings for [[VISUALS]] lines (copy a full line verbatim, including the em dash):
${catalogLines}`;
}

const VISUALS_BLOCK_RE =
  /\[\[VISUALS\]\]\s*([\s\S]*?)\s*\[\[\/VISUALS\]\]/i;

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
const emailRoutineBtn = document.getElementById("emailRoutineBtn");
const textRoutineBtn = document.getElementById("textRoutineBtn");
const historyBtn = document.getElementById("historyBtn");
const historyDialog = document.getElementById("historyDialog");
const historyDialogBody = document.getElementById("historyDialogBody");
const historyCloseBtn = document.getElementById("historyCloseBtn");
const emailRoutineDialog = document.getElementById("emailRoutineDialog");
const emailRoutineForm = document.getElementById("emailRoutineForm");
const emailRoutineAddress = document.getElementById("emailRoutineAddress");
const emailRoutineError = document.getElementById("emailRoutineError");
const emailRoutineCloseBtn = document.getElementById("emailRoutineCloseBtn");
const emailRoutineCancelBtn = document.getElementById("emailRoutineCancelBtn");
const textRoutineDialog = document.getElementById("textRoutineDialog");
const textRoutineForm = document.getElementById("textRoutineForm");
const textRoutinePhone = document.getElementById("textRoutinePhone");
const textRoutineError = document.getElementById("textRoutineError");
const textRoutineCloseBtn = document.getElementById("textRoutineCloseBtn");
const textRoutineCancelBtn = document.getElementById("textRoutineCancelBtn");
const productSelect = document.getElementById("productSelect");
const productPickerDetails = document.getElementById("productPickerDetails");
const productPickerPanel = document.getElementById("productPickerPanel");
const productPickerSummary = document.getElementById("productPickerSummary");
const productPickerTriggerText = document.querySelector(
  ".product-picker-trigger-text"
);

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
    { role: "system", content: buildLorealSystemPrompt() },
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

function stripVisualsFromText(text) {
  return text.replace(VISUALS_BLOCK_RE, "").trim();
}

/** Catalog lines inside [[VISUALS]]…[[/VISUALS]] (exact match only). */
function parseVisualsBlockLines(blockBody) {
  const names = [];
  if (!blockBody) return names;
  for (const line of blockBody.split("\n")) {
    const t = line.trim();
    if (t && PRODUCT_IMAGE_MAP[t] && !names.includes(t)) names.push(t);
  }
  return names;
}

/** Up to three catalog products whose full names appear in plain text. */
function catalogProductsMentionedIn(text) {
  const found = [];
  for (const name of PRODUCT_CATALOG) {
    if (text.includes(name) && !found.includes(name)) found.push(name);
    if (found.length >= 3) break;
  }
  return found;
}

/**
 * Text shown in the bubble (without machine block) + product rows for trusted image + shop URLs.
 */
function assistantVisualPayload(fullText) {
  const m = fullText.match(VISUALS_BLOCK_RE);
  const displayText = stripVisualsFromText(fullText);
  let products = m ? parseVisualsBlockLines(m[1]) : [];
  if (products.length === 0) products = catalogProductsMentionedIn(displayText);
  const cards = products
    .slice(0, 3)
    .map((name) => ({
      name,
      imageUrl: PRODUCT_IMAGE_MAP[name],
      shopUrl: purchaseUrlForProduct(name),
    }))
    .filter((c) => Boolean(c.imageUrl && c.shopUrl));
  return { displayText, cards };
}

/** Most recent assistant `content` in the live transcript, or null. */
function getLatestAssistantRawContent() {
  for (let i = messages.length - 1; i >= 2; i--) {
    if (messages[i].role === "assistant") return messages[i].content;
  }
  return null;
}

function transcriptHasUserMessage() {
  return messages.slice(2).some((m) => m.role === "user");
}

/** True when the latest saved turn is from the advisor (so mail reflects the current reply). */
function lastTranscriptTurnIsAssistant() {
  const turns = messages.slice(2);
  const last = turns[turns.length - 1];
  return Boolean(last && last.role === "assistant");
}

/**
 * Plain-text body: advisor reply + product lines with https shop URLs.
 * @param {{ displayText: string, cards: { name: string, shopUrl: string }[] }} payload
 */
function buildRoutineEmailBody(payload) {
  const lines = [payload.displayText.trim()];
  if (payload.cards.length > 0) {
    lines.push("", "— Product links —");
    for (const { name, shopUrl } of payload.cards) {
      lines.push("", name, shopUrl);
    }
  }
  lines.push("", "—", "L'Oréal Smart Product Advisor (student demo)");
  return lines.join("\n");
}

/**
 * Many browsers cap `mailto:` URL length; shrink body if needed.
 * @param {{ to?: string, subject: string, body: string }} opts
 */
function buildMailtoUrl(opts) {
  const to = (opts.to || "").trim();
  const subject = opts.subject;
  let body = opts.body;
  const prefix =
    to && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) ? `mailto:${to}?` : "mailto:?";
  const enc = (s) => encodeURIComponent(s);

  const urlForBody = (b) => `${prefix}subject=${enc(subject)}&body=${enc(b)}`;
  let url = urlForBody(body);
  const maxLen = 2000;
  if (url.length <= maxLen) return url;

  const note =
    "\n\n[Some text was shortened so your email app can open this message. See the chat for the full routine.]";
  let low = 0;
  let high = body.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = body.slice(0, mid).trimEnd() + note;
    if (urlForBody(candidate).length <= maxLen) low = mid;
    else high = mid - 1;
  }
  const trimmed = body.slice(0, low).trimEnd() + note;
  return urlForBody(trimmed);
}

/**
 * Normalize user-entered phone to digits for `sms:` URIs (no + in path).
 * 10-digit US numbers get a leading country code 1.
 * @returns {string | null} digits only, 8–15 chars, or null if invalid
 */
function normalizePhoneDigitsForSms(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (s.startsWith("+")) {
    const rest = s.slice(1).replace(/\D/g, "");
    if (rest.length < 8 || rest.length > 15) return null;
    return rest;
  }
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `1${d}`;
  if (d.length === 11 && d.startsWith("1")) return d;
  if (d.length >= 8 && d.length <= 15) return d;
  return null;
}

/**
 * `sms:` URLs are length-capped like mailto; body may be truncated.
 * @param {{ phoneDigits: string, body: string }} opts
 */
function buildSmsUrl(opts) {
  const phoneDigits = (opts.phoneDigits || "").replace(/\D/g, "");
  const body = opts.body;
  const prefix = phoneDigits ? `sms:${phoneDigits}?` : `sms:?`;
  const enc = (s) => encodeURIComponent(s);
  const urlForBody = (b) => `${prefix}body=${enc(b)}`;
  let url = urlForBody(body);
  const maxLen = 2000;
  if (url.length <= maxLen) return url;

  const note = "\n\n[Shortened — open the chat for the full routine.]";
  let low = 0;
  let high = body.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = body.slice(0, mid).trimEnd() + note;
    if (urlForBody(candidate).length <= maxLen) low = mid;
    else high = mid - 1;
  }
  const trimmed = body.slice(0, low).trimEnd() + note;
  return urlForBody(trimmed);
}

function getRoutineEmailConfig() {
  const raw =
    typeof window.ROUTINE_EMAIL_TO === "string" ? window.ROUTINE_EMAIL_TO.trim() : "";
  return { to: raw };
}

function getRoutineSmsConfig() {
  const raw =
    typeof window.ROUTINE_SMS_PHONE === "string" ? window.ROUTINE_SMS_PHONE.trim() : "";
  return { phoneDigits: normalizePhoneDigitsForSms(raw) };
}

const ROUTINE_EMAIL_SUBJECT = "My L'Oréal routine from the Smart Product Advisor";

function isLatestRoutineSharable() {
  return (
    transcriptHasUserMessage() &&
    lastTranscriptTurnIsAssistant() &&
    getLatestAssistantRawContent() != null
  );
}

function isValidEmailForMailto(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || "").trim());
}

/** @returns {{ body: string, subject: string } | null} */
function getLatestRoutineEmailParts() {
  if (!isLatestRoutineSharable()) return null;
  const raw = getLatestAssistantRawContent();
  if (!raw) return null;
  const payload = assistantVisualPayload(raw);
  return {
    body: buildRoutineEmailBody(payload),
    subject: ROUTINE_EMAIL_SUBJECT,
  };
}

function readSavedRoutineEmailAddress() {
  try {
    const v = localStorage.getItem(ROUTINE_EMAIL_ADDRESS_KEY);
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

function saveRoutineEmailAddressForNextTime(address) {
  try {
    localStorage.setItem(ROUTINE_EMAIL_ADDRESS_KEY, address.trim());
  } catch {
    /* ignore quota / private mode */
  }
}

function setEmailRoutineFormError(message) {
  if (!emailRoutineError) return;
  if (message) {
    emailRoutineError.textContent = message;
    emailRoutineError.hidden = false;
  } else {
    emailRoutineError.textContent = "";
    emailRoutineError.hidden = true;
  }
}

function closeEmailRoutineDialog() {
  if (emailRoutineDialog && typeof emailRoutineDialog.close === "function") {
    emailRoutineDialog.close();
  }
}

function openEmailRoutineDialog() {
  const parts = getLatestRoutineEmailParts();
  if (!parts) {
    appendMessage(
      "assistant",
      "After the advisor's latest reply, use Email routine to enter your email and open your email app with that message and any shop links. Send a question first and wait for the reply."
    );
    return;
  }
  if (
    !emailRoutineDialog ||
    typeof emailRoutineDialog.showModal !== "function" ||
    !emailRoutineAddress
  ) {
    const { to } = getRoutineEmailConfig();
    const url = buildMailtoUrl({ to, subject: parts.subject, body: parts.body });
    window.location.assign(url);
    return;
  }
  setEmailRoutineFormError("");
  const configTo = getRoutineEmailConfig().to;
  const saved = readSavedRoutineEmailAddress();
  emailRoutineAddress.value =
    (configTo && isValidEmailForMailto(configTo) ? configTo : "") ||
    (saved && isValidEmailForMailto(saved) ? saved : "");
  emailRoutineDialog.showModal();
  emailRoutineAddress.focus();
  emailRoutineAddress.select();
}

function submitEmailRoutineFromDialog() {
  const parts = getLatestRoutineEmailParts();
  if (!parts || !emailRoutineAddress) {
    closeEmailRoutineDialog();
    return;
  }
  const to = emailRoutineAddress.value.trim();
  if (!isValidEmailForMailto(to)) {
    setEmailRoutineFormError("Please enter a valid email address.");
    emailRoutineAddress.focus();
    return;
  }
  setEmailRoutineFormError("");
  saveRoutineEmailAddressForNextTime(to);
  const url = buildMailtoUrl({ to, subject: parts.subject, body: parts.body });
  closeEmailRoutineDialog();
  window.location.assign(url);
}

function readSavedRoutineSmsPhone() {
  try {
    const v = localStorage.getItem(ROUTINE_SMS_PHONE_KEY);
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

function saveRoutineSmsPhoneForNextTime(digits) {
  try {
    localStorage.setItem(ROUTINE_SMS_PHONE_KEY, digits);
  } catch {
    /* ignore */
  }
}

function setTextRoutineFormError(message) {
  if (!textRoutineError) return;
  if (message) {
    textRoutineError.textContent = message;
    textRoutineError.hidden = false;
  } else {
    textRoutineError.textContent = "";
    textRoutineError.hidden = true;
  }
}

function closeTextRoutineDialog() {
  if (textRoutineDialog && typeof textRoutineDialog.close === "function") {
    textRoutineDialog.close();
  }
}

function openTextRoutineDialog() {
  const parts = getLatestRoutineEmailParts();
  if (!parts) {
    appendMessage(
      "assistant",
      "After the advisor's latest reply, use Text routine to enter your mobile number and open your messaging app with the routine. Send a question first and wait for the reply."
    );
    return;
  }
  if (
    !textRoutineDialog ||
    typeof textRoutineDialog.showModal !== "function" ||
    !textRoutinePhone
  ) {
    const { phoneDigits } = getRoutineSmsConfig();
    const url = buildSmsUrl({ phoneDigits: phoneDigits || "", body: parts.body });
    window.location.assign(url);
    return;
  }
  setTextRoutineFormError("");
  const configDigits = getRoutineSmsConfig().phoneDigits;
  const savedRaw = readSavedRoutineSmsPhone();
  const savedDigits = normalizePhoneDigitsForSms(savedRaw);
  const displayFromDigits = (digits) => {
    if (!digits) return "";
    if (digits.length === 11 && digits.startsWith("1")) {
      const a = digits.slice(1, 4);
      const b = digits.slice(4, 7);
      const c = digits.slice(7);
      return `(${a}) ${b}-${c}`;
    }
    return digits.startsWith("+") ? digits : `+${digits}`;
  };
  if (configDigits) {
    textRoutinePhone.value = displayFromDigits(configDigits);
  } else if (savedDigits) {
    textRoutinePhone.value = displayFromDigits(savedDigits);
  } else {
    textRoutinePhone.value = "";
  }
  textRoutineDialog.showModal();
  textRoutinePhone.focus();
  textRoutinePhone.select();
}

function submitTextRoutineFromDialog() {
  const parts = getLatestRoutineEmailParts();
  if (!parts || !textRoutinePhone) {
    closeTextRoutineDialog();
    return;
  }
  const phoneDigits = normalizePhoneDigitsForSms(textRoutinePhone.value);
  if (!phoneDigits) {
    setTextRoutineFormError(
      "Enter a valid mobile number (e.g. US 10 digits, or include country code with +)."
    );
    textRoutinePhone.focus();
    return;
  }
  setTextRoutineFormError("");
  saveRoutineSmsPhoneForNextTime(phoneDigits);
  const url = buildSmsUrl({ phoneDigits, body: parts.body });
  closeTextRoutineDialog();
  window.location.assign(url);
}

function syncEmailRoutineButtonState() {
  if (!emailRoutineBtn) return;
  emailRoutineBtn.disabled = !isLatestRoutineSharable();
}

function syncTextRoutineButtonState() {
  if (!textRoutineBtn) return;
  textRoutineBtn.disabled = !isLatestRoutineSharable();
}

function syncRoutineShareButtonsState() {
  syncEmailRoutineButtonState();
  syncTextRoutineButtonState();
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
      const historyText =
        m.role === "assistant"
          ? stripVisualsFromText(m.content)
          : m.content;
      parts.push(
        `<div class="history-turn ${roleClass}"><span class="history-turn-label">${label}</span><div class="history-turn-text">${escapeHtml(
          historyText
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

  if (role === "assistant") {
    const { displayText, cards } = assistantVisualPayload(text);
    bubble.textContent = displayText;
    stack.appendChild(label);
    stack.appendChild(bubble);
    if (cards.length > 0) {
      const wrap = document.createElement("div");
      wrap.className = "msg-visuals";
      for (const { name, imageUrl, shopUrl } of cards) {
        const fig = document.createElement("figure");
        fig.className = "msg-visual-fig";

        const link = document.createElement("a");
        link.className = "msg-visual-link";
        link.href = shopUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `${name} — shop (opens in a new tab)`);

        const img = document.createElement("img");
        img.className = "msg-visual-img";
        img.src = imageUrl;
        img.alt = `Illustration for ${name}`;
        img.loading = "lazy";
        img.decoding = "async";

        const cap = document.createElement("span");
        cap.className = "msg-visual-cap";
        cap.textContent = name;

        link.appendChild(img);
        link.appendChild(cap);
        fig.appendChild(link);
        wrap.appendChild(fig);
      }
      stack.appendChild(wrap);
    }
  } else {
    bubble.textContent = text;
    stack.appendChild(label);
    stack.appendChild(bubble);
  }

  row.appendChild(stack);

  const parent = chatMessages || chatWindow;
  parent.appendChild(row);
  scrollChatToBottom();
}

function setBusy(isBusy) {
  userInput.disabled = isBusy;
  sendBtn.disabled = isBusy;
  if (productSelect) productSelect.disabled = isBusy;
  if (productPickerDetails) {
    productPickerDetails.classList.toggle(
      "product-picker-details--disabled",
      isBusy
    );
    if (isBusy) productPickerDetails.open = false;
  }
  if (isBusy) {
    if (emailRoutineBtn) emailRoutineBtn.disabled = true;
    if (textRoutineBtn) textRoutineBtn.disabled = true;
  } else {
    syncRoutineShareButtonsState();
  }
}

function fillProductStarterQuestion(productName) {
  userInput.value = `Tell me about ${productName}. Who it's best for, key benefits, how to use it, and anything I should pair it with in a routine.`;
  userInput.focus();
}

function syncProductPickerTriggerText() {
  if (!productPickerTriggerText || !productSelect) return;
  const v = productSelect.value.trim();
  productPickerTriggerText.textContent = v || "Choose a product…";
}

function positionProductPickerPanel() {
  if (!productPickerPanel || !productPickerSummary) return;
  const r = productPickerSummary.getBoundingClientRect();
  const gap = 8;
  const margin = 12;
  const spaceRight = window.innerWidth - r.right - gap - margin;
  let w = Math.min(360, Math.max(200, spaceRight));
  let left = r.right + gap;
  if (left + w > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - margin - w);
  }
  productPickerPanel.style.left = `${left}px`;
  productPickerPanel.style.top = `${r.top}px`;
  productPickerPanel.style.width = `${w}px`;
  const maxH = Math.max(120, window.innerHeight - r.top - 16);
  productPickerPanel.style.maxHeight = `${Math.min(320, maxH)}px`;
}

function populateProductSelect() {
  if (!productSelect) return;
  for (const name of PRODUCT_CATALOG) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    productSelect.appendChild(opt);
  }

  if (productPickerPanel) {
    for (const name of PRODUCT_CATALOG) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "product-picker-option";
      btn.setAttribute("role", "option");
      btn.textContent = name;
      btn.addEventListener("click", () => {
        productSelect.value = name;
        productSelect.dispatchEvent(new Event("change", { bubbles: true }));
        if (productPickerDetails) productPickerDetails.open = false;
      });
      productPickerPanel.appendChild(btn);
    }
  }

  productSelect.addEventListener("change", () => {
    const v = productSelect.value.trim();
    if (!v) return;
    fillProductStarterQuestion(v);
    syncProductPickerTriggerText();
  });

  if (productPickerDetails && productPickerSummary) {
    productPickerSummary.setAttribute("aria-expanded", "false");
    productPickerDetails.addEventListener("toggle", () => {
      const open = productPickerDetails.open;
      productPickerSummary.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        requestAnimationFrame(() => positionProductPickerPanel());
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (!productPickerDetails?.open) return;
    if (productPickerDetails.contains(e.target)) return;
    productPickerDetails.open = false;
  });

  window.addEventListener("resize", () => {
    if (productPickerDetails?.open) positionProductPickerPanel();
  });

  chatMessages?.addEventListener("scroll", () => {
    if (productPickerDetails?.open) productPickerDetails.open = false;
  });

  syncProductPickerTriggerText();
}

function getChatApiConfig() {
  const workerUrl =
    typeof window.CHAT_API_URL === "string" ? window.CHAT_API_URL.trim() : "";
  const apiKey =
    typeof window.OPENAI_API_KEY === "string"
      ? window.OPENAI_API_KEY.trim()
      : "";
  return { workerUrl, apiKey };
}

/** Browsers usually surface blocked CORS / offline as TypeError "Failed to fetch". */
function describeFetchFailure(err) {
  const m = err instanceof Error ? err.message : String(err);
  const looksLikeNetworkBlock =
    m === "Failed to fetch" ||
    m === "Load failed" ||
    /^NetworkError when attempting to fetch/i.test(m);
  if (looksLikeNetworkBlock) {
    return (
      "Could not reach the API (often CORS or a wrong URL). Use the Worker URL from " +
      "`npm run worker:deploy` in config.js as CHAT_API_URL, add your site origin to " +
      "ALLOWED_ORIGINS on the Worker if you set it, serve the page over http(s) " +
      "(not file://), and check that you are online."
    );
  }
  return m;
}

async function fetchOpenAICompletion(workerUrl, apiKey, payloadMessages) {
  const useWorker = workerUrl.length > 0;
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
    if (Array.isArray(data)) {
      throw new Error(
        "CHAT_API_URL points to a different app (the server returned a JSON array, not OpenAI chat completions). " +
          "Deploy this repo’s Worker (`npm run worker:deploy`, RESOURCE_cloudflare-worker.js) and set CHAT_API_URL to that URL."
      );
    }
    throw new Error(
      "CHAT_API_URL must point to this project’s Cloudflare Worker (OpenAI chat completions proxy), not another app. " +
        "Run `npm run worker:deploy`, copy the printed workers.dev URL into config.js, and confirm a browser GET to that URL shows " +
        '`"service":"loreal-chatbot-api"`.'
    );
  }
  return reply;
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
  const payloadMessages = messagesForApi();

  try {
    const reply = await fetchOpenAICompletion(
      workerUrl,
      apiKey,
      payloadMessages
    );
    messages.push({ role: "assistant", content: reply });
    appendMessage("assistant", reply);
    persistSession();
  } catch (err) {
    const msg =
      err instanceof Error
        ? describeFetchFailure(err)
        : "Something went wrong. If this is a browser CORS block, use a small server proxy instead of calling the API directly from the page.";
    const shown = `Sorry — ${msg}`;
    messages.push({ role: "assistant", content: shown });
    appendMessage("assistant", shown);
    persistSession();
  } finally {
    typingEl.remove();
    setBusy(false);
    syncRoutineShareButtonsState();
    userInput.focus();
  }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = userInput.value.trim();
  if (!text) return;

  const { workerUrl, apiKey } = getChatApiConfig();

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
  syncRoutineShareButtonsState();

  await sendChatCompletion(workerUrl, apiKey);
});

if (emailRoutineBtn) {
  emailRoutineBtn.addEventListener("click", () => {
    openEmailRoutineDialog();
  });
}

if (emailRoutineForm && emailRoutineAddress) {
  emailRoutineForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitEmailRoutineFromDialog();
  });
}

if (emailRoutineCloseBtn) {
  emailRoutineCloseBtn.addEventListener("click", () => closeEmailRoutineDialog());
}
if (emailRoutineCancelBtn) {
  emailRoutineCancelBtn.addEventListener("click", () => closeEmailRoutineDialog());
}

if (emailRoutineDialog) {
  emailRoutineDialog.addEventListener("close", () => {
    setEmailRoutineFormError("");
  });
}

if (textRoutineBtn) {
  textRoutineBtn.addEventListener("click", () => {
    openTextRoutineDialog();
  });
}

if (textRoutineForm && textRoutinePhone) {
  textRoutineForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitTextRoutineFromDialog();
  });
}

if (textRoutineCloseBtn) {
  textRoutineCloseBtn.addEventListener("click", () => closeTextRoutineDialog());
}
if (textRoutineCancelBtn) {
  textRoutineCancelBtn.addEventListener("click", () => closeTextRoutineDialog());
}

if (textRoutineDialog) {
  textRoutineDialog.addEventListener("close", () => {
    setTextRoutineFormError("");
  });
}

if (historyBtn && historyDialog && historyCloseBtn) {
  historyBtn.addEventListener("click", openHistoryDialog);
  historyCloseBtn.addEventListener("click", () => historyDialog.close());
}

populateProductSelect();

const loaded = loadSession();
initMessagesFromStorage(loaded);
renderChat();
syncRoutineShareButtonsState();
