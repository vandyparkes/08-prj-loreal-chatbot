/* L'Oréal-only advisor — sent as the API system message */
const LOREAL_SYSTEM_PROMPT = `You are the L'Oréal Smart Product Advisor for this demo chat.

In scope (answer helpfully): L'Oréal and L'Oréal Group brands, products, shades and product types, high-level ingredient education, skincare and haircare routines, makeup application tips, how to choose products for concerns (dryness, frizz, uneven tone, etc.), and recommendations that stay within L'Oréal's beauty universe.

Out of scope (do not fulfill the request): Anything not tied to L'Oréal beauty—general knowledge, homework, coding, sports, politics, religion, gossip, other companies' products as the main topic, legal or financial advice, or personal topics unrelated to beauty. Never give a medical diagnosis or replace a clinician; you may share general skincare or haircare guidance only.

Follow-up chats (after a personalized routine): The user may ask follow-up questions in the same conversation. Answer when the question is about the routine they already received (order of steps, timing, how to layer, swaps among their selected products, etc.) or about in-scope beauty topics: skincare, haircare, makeup, fragrance, nails, sun care, and similar L'Oréal-relevant care—not unrelated life topics.

Polite refusal (required for off-topic messages): Do not answer the off-topic part, even partially. Respond warmly in one short paragraph: thank the user, say you are here only for L'Oréal products and beauty routines, and invite them to ask about a product, concern, or routine. Keep the tone professional and kind, never curt.

Conversation memory: You receive the full thread. Use earlier turns for follow-ups (e.g. "that serum", "the same concern", "step 2 in my routine"). If the user shared their name, use it naturally when it fits; do not overuse it.

Style: Clear, friendly, concise. Do not claim to be an official L'Oréal representative. If unsure about a specific product name, shade, price, or availability, say so and suggest they check packaging, a retailer, or L'Oréal's official sites.

Live web search: You can search the web for current L'Oréal Group product information, launches, how-to articles, and reputable retail or brand pages. Use search when the user asks for anything time-sensitive, regional, or not fully covered by the demo catalog (still stay in scope—L'Oréal beauty only). Ground claims in what you find; the app will show the source links users can open.

Email / text routine: When you give steps, order of use, or a routine the user may want to keep, briefly mention they can use "Email routine" or "Text routine" in the chat header — they enter their email or phone, then their own email or messaging app opens with your advice and shop links for recommended products (when shown).

Product pictures (required when you discuss or recommend any item from the demo product list the app knows about): After your normal answer, add a separate block so the UI can show photos. Use this exact format, with one catalog line per product (copy the full line including the em dash, no extra characters):
[[VISUALS]]
(full catalog product line 1)
(full catalog product line 2)
[[/VISUALS]]
Include at most three products in the block, only when they are genuinely part of your advice. For short off-topic refusals, omit the block.`;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
/** Same family as the Worker: Chat Completions + built-in web search (OpenAI search preview model). */
const CHAT_MODEL = "gpt-4o-mini-search-preview";

const STORAGE_KEY = "lorealAdvisorSession";
const SELECTED_PRODUCTS_STORAGE_KEY = "lorealAdvisorSelectedProducts";
const ROUTINE_EMAIL_ADDRESS_KEY = "lorealAdvisorRoutineEmailTo";
const ROUTINE_SMS_PHONE_KEY = "lorealAdvisorRoutineSmsPhone";
/** Max user + assistant messages kept when calling the API (worker allows 48 messages total with 2 system lines). */
const MAX_TRANSCRIPT_MESSAGES = 44;

const DEFAULT_GREETING = "👋 Hello! How can I help you today?";

/** System prompt for one-shot routine generation from selected catalog JSON. */
const ROUTINE_FROM_SELECTION_SYSTEM = `You are the L'Oréal Smart Product Advisor (student demo). The user selected specific products from the catalog. You receive structured JSON for each item: name, brand, category, and description.

Write a personalized beauty routine that uses only those selected products. You may add minimal non-product steps only when essential (for example: rinse shampoo, pat skin dry, let layers absorb)—do not recommend additional retail products not in their selection.

Order steps logically (cleansing before treatment, day vs night when relevant, SPF last in the morning when sunscreen is in the set). Keep the tone warm, clear, and concise. If something is typically incompatible, note it briefly.

When photos should appear, after your main answer add a separate block using this exact format with one full catalog line per selected product (copy each line verbatim from the list under "catalogLines", including the em dash):
[[VISUALS]]
(line 1)
(line 2)
[[/VISUALS]]
Include every selected catalog line in the block when it fits the routine. For a very short reply only, you may omit the block.

End with one brief sentence inviting them to use the chat box for follow-ups about this routine or related skincare, haircare, makeup, or fragrance questions—you will see the full conversation next time.

Do not claim to be an official L'Oréal representative. Never give a medical diagnosis.`;

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

/**
 * Short demo summaries for the catalog grid (keyed by exact PRODUCT_CATALOG strings).
 * @type {Record<string, string>}
 */
const PRODUCT_DESCRIPTION_MAP = {
  "L'Oréal Paris — Revitalift Triple Power Anti-Aging Serum":
    "A serum-style treatment aimed at fine lines and loss of firmness, with a lightweight feel for layering under moisturizer. Best for evening routines after cleansing; follow with SPF in the morning if you use it during the day.",
  "L'Oréal Paris — Elvive Total Repair 5 Shampoo":
    "Everyday shampoo focused on damage, dryness, and rough feel so hair looks smoother and easier to comb. Work into wet hair and scalp, rinse well, then pair with a matching conditioner for very dry or processed lengths.",
  "L'Oréal Paris — Infallible Fresh Wear Foundation":
    "Medium-buildable coverage with a natural-skin finish and transfer resistance for long days. Apply after primer; blend with a sponge or brush and set lightly if you want extra staying power in humid weather.",
  "L'Oréal Paris — Voluminous Lash Paradise Mascara":
    "Volumizing mascara that builds fullness along the lash line for a soft, fluttery look. Wiggle from roots to tips; let dry between coats to avoid clumps and remove gently with a dedicated eye makeup remover.",
  "Maybelline New York — Fit Me Matte + Poreless Foundation":
    "Matte finish foundation that helps skin look less shiny and pores appear softer. Suited to normal-to-oily skin; moisturize first on dry patches so the formula sits evenly.",
  "Maybelline New York — Sky High Mascara":
    "Flexible brush and lengthening formula for lift and separation from root to tip. Ideal if you want defined length without heavy thickness; build slowly for a more dramatic effect.",
  "NYX Professional Makeup — Butter Gloss":
    "Cushiony lip gloss with sheer-to-medium color and a comfortable, non-sticky feel. Wear alone or over liner or lipstick; reapply as needed like any gloss.",
  "Garnier — Micellar Cleansing Water":
    "No-rinse cleanser that lifts makeup, sunscreen, and daily grime with a cotton pad. Good as a first step or quick refresh; follow with a regular cleanser if you prefer a full double-cleanse.",
  "Garnier — Fructis Sleek & Shine Shampoo":
    "Smoothing shampoo for frizz-prone hair, helping strands feel softer and more controlled. Use with cool rinse water and a conditioner on mid-lengths to ends for best slip and shine.",
  "Lancôme — Advanced Génifique Youth Activating Serum":
    "Silky face serum for radiance, fine lines, and overall skin resilience with a fast-absorbing texture. Apply after toner or essence and before cream; always finish daytime routines with sunscreen.",
  "Kiehl's — Ultra Facial Cream":
    "Daily moisturizer that balances lasting hydration with a lighter feel on the skin. Works across many skin types; pat on after serums and before SPF in the morning.",
  "CeraVe — Hydrating Facial Cleanser":
    "Creamy, non-foaming cleanser that supports the skin barrier while removing dirt without stripping. Massage onto damp skin, rinse, then continue with treatment and moisturizer.",
  "La Roche-Posay — Anthelios Melt-In Milk Sunscreen SPF 60":
    "Broad-spectrum SPF with a melt-in texture for face and body. Apply generously as the last step in the morning and reapply every two hours outdoors or after swimming and sweating.",
  "Yves Saint Laurent Beauté — Rouge Pur Couture Lipstick":
    "Satin-finish lipstick with rich color payoff in a single swipe. Use a liner for crisp edges or blur with a fingertip for a softer stain effect.",
  "IT Cosmetics — CC+ Cream with SPF 50+":
    "Color-correcting cream with coverage plus high SPF for a one-step daytime base on many skin tones. Blend outward from the center of the face and set if you want a more matte look.",
  "Urban Decay — Naked3 Eyeshadow Palette":
    "Rose-toned neutrals from light shimmer to deeper mattes for everyday and evening looks. Tap off excess powder and build color in thin layers for easier blending.",
  "Essie — Gel Couture Longwear Nail Polish":
    "Two-step system polish with a glossy, longer-wearing finish when paired with its top coat. Prep nails with oil-free cleanser so color adheres evenly.",
  "Matrix — Total Results Brass Off Shampoo":
    "Blue-toned shampoo that helps neutralize brassy warmth on lightened or gray hair. Use sparingly and alternate with a hydrating shampoo so hair does not feel dry.",
  "Redken — Acidic Bonding Concentrate Leave-In Treatment":
    "Leave-in conditioner that helps detangle, protect from heat, and support damaged hair between washes. Spray or distribute on damp hair before blow-drying or air-drying.",
  "Kérastase — Nutritive 8H Magic Night Hair Serum":
    "Overnight hair serum for dry hair that absorbs while you sleep so lengths feel softer by morning. Apply to dry or towel-dried mid-lengths and ends; avoid heavy application at the roots.",
};

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

const CATALOG_LINE_SEP = " — ";

/**
 * @param {string} catalogName — exact PRODUCT_CATALOG entry
 * @returns {{ brand: string, name: string }}
 */
function parseBrandAndProductName(catalogName) {
  const i = catalogName.indexOf(CATALOG_LINE_SEP);
  if (i === -1) {
    return { brand: "L'Oréal Group", name: catalogName.trim() };
  }
  return {
    brand: catalogName.slice(0, i).trim(),
    name: catalogName.slice(i + CATALOG_LINE_SEP.length).trim(),
  };
}

/**
 * Broad category for routine JSON (demo heuristic).
 * @param {string} catalogName
 */
function inferProductCategory(catalogName) {
  const lower = catalogName.toLowerCase();
  if (
    /\b(shampoo|conditioner|elvive|fructis|matrix|redken|kérastase|kerastase|hair serum|leave-in|sleek|brass|bonding|8h magic|nutritive)\b/i.test(
      catalogName
    )
  ) {
    return "Hair care";
  }
  if (/\b(sunscreen|anthelios)\b/i.test(lower) || /\bspf\s*\d+/i.test(catalogName)) {
    return "Sun care";
  }
  if (
    /\b(foundation|mascara|gloss|lipstick|palette|nail polish|cc\+ cream|eyeshadow)\b/i.test(
      lower
    )
  ) {
    return "Makeup";
  }
  if (
    /\b(serum|cleanser|micellar|cream|revitalift|génifique|genifique|kiehl|cerave)\b/i.test(
      lower
    )
  ) {
    return "Skin care";
  }
  return "Beauty";
}

/** Category chip order in the browser toolbar (subset may appear). */
const CATALOG_CATEGORY_CHIP_ORDER = [
  "Hair care",
  "Skin care",
  "Makeup",
  "Sun care",
  "Beauty",
];

function catalogUiCategoriesForToolbar() {
  const set = new Set(PRODUCT_CATALOG.map(inferProductCategory));
  const ordered = CATALOG_CATEGORY_CHIP_ORDER.filter((c) => set.has(c));
  const rest = [...set]
    .filter((c) => !CATALOG_CATEGORY_CHIP_ORDER.includes(c))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest];
}

/**
 * @param {string} catalogName — exact PRODUCT_CATALOG key
 * @returns {{ name: string, brand: string, category: string, description: string }}
 */
function productToRoutineJson(catalogName) {
  const { brand, name } = parseBrandAndProductName(catalogName);
  return {
    name,
    brand,
    category: inferProductCategory(catalogName),
    description:
      PRODUCT_DESCRIPTION_MAP[catalogName] ||
      "Short summary not available for this demo listing.",
  };
}

/** @returns {{ name: string, brand: string, category: string, description: string }[]} */
function buildSelectedProductsRoutinePayload() {
  return selectedProductsOrder.map((catalogName) =>
    productToRoutineJson(catalogName)
  );
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
const phoneEmailRoutineBtn = document.getElementById("phoneEmailRoutineBtn");
const phoneTextRoutineBtn = document.getElementById("phoneTextRoutineBtn");
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
const productCatalogGrid = document.getElementById("productCatalogGrid");
const productCatalogMarqueeTrack = document.getElementById(
  "productCatalogMarqueeTrack"
);
const productCatalogGridWrap = document.querySelector(".product-catalog-grid-wrap");
const productCatalogSearch = document.getElementById("productCatalogSearch");
const productCatalogCategoryGroup = document.getElementById(
  "productCatalogCategoryGroup"
);
const productCatalogEmpty = document.getElementById("productCatalogEmpty");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedProductsEmpty = document.getElementById("selectedProductsEmpty");
const generateRoutineBtn = document.getElementById("generateRoutineBtn");
const clearSelectedProductsBtn = document.getElementById("clearSelectedProductsBtn");
const layoutDirToggleBtn = document.getElementById("layoutDirToggleBtn");
const layoutDirToggleIcon = document.querySelector(".layout-dir-icon");

/** Session override for layout direction (takes precedence over `window.APP_DIR`). */
const UI_DIR_STORAGE_KEY = "lorealAdvisorUiDir";

/** Catalog names the user selected, in click order. */
const selectedProductsOrder = [];
/** @type {Map<string, HTMLButtonElement>} */
const catalogCardByName = new Map();
/** @type {Map<string, HTMLElement>} */
const catalogCellByName = new Map();

/** "All" shows every category; otherwise must match `inferProductCategory`. */
let catalogCategoryFilter = "All";

let userName = null;
/** Exact catalog lines from the last successful "Generate routine" run (for API memory). */
let lastRoutineCatalogLines = null;
/** [base system, memory system, ...user/assistant transcript] */
let messages = [];

function buildMemorySystemContent(name, routineCatalogLines) {
  const lines = Array.isArray(routineCatalogLines)
    ? routineCatalogLines.filter((s) => typeof s === "string" && s.trim())
    : [];
  const routineBlock =
    lines.length > 0
      ? ` Their latest personalized routine was built only from these catalog products (in order): ${lines.join(
          "; "
        )}. Use the advisor's routine reply in this thread for step-by-step detail when they ask follow-ups about order, timing, layering, or those products. They may also ask new questions about skincare, haircare, makeup, fragrance, and other in-scope beauty topics—stay within the main advisor rules for refusals.`
      : "";

  if (name) {
    return `Session memory: The user's name is ${name}. Address them by name when it feels natural (not every sentence). Use prior messages in this chat—including products or concerns they already mentioned—when answering new questions or follow-ups.${routineBlock}`;
  }
  return `Session memory: The user has not shared their name yet. If they introduce themselves, treat that as their name for the rest of the chat. Use prior messages in this chat when they refer to something without repeating details.${routineBlock}`;
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
    content: buildMemorySystemContent(userName, lastRoutineCatalogLines),
  };
}

function messagesForApi() {
  const head = messages.slice(0, 2);
  const body = messages.slice(2);
  const tail =
    body.length > MAX_TRANSCRIPT_MESSAGES
      ? body.slice(-MAX_TRANSCRIPT_MESSAGES)
      : body;
  const sanitized = tail.map((m) => ({ role: m.role, content: m.content }));
  return [...head, ...sanitized];
}

function persistSession() {
  try {
    const transcript = messages.slice(2).filter((m) => {
      if (m.role !== "user" && m.role !== "assistant") return false;
      if (typeof m.content !== "string") return false;
      return true;
    });
    const payload = { v: 2, userName, transcript };
    const routineLines =
      Array.isArray(lastRoutineCatalogLines) &&
      lastRoutineCatalogLines.some((s) => typeof s === "string" && s.trim())
        ? lastRoutineCatalogLines.filter((s) => typeof s === "string" && s.trim())
        : null;
    if (routineLines && routineLines.length > 0) {
      payload.lastRoutineCatalogLines = routineLines;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

function loadSelectedProductsFromStorage() {
  try {
    const raw = localStorage.getItem(SELECTED_PRODUCTS_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const catalogSet = new Set(PRODUCT_CATALOG);
    const seen = new Set();
    const out = [];
    for (const item of data) {
      if (typeof item !== "string" || !catalogSet.has(item) || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}

function persistSelectedProducts() {
  try {
    if (selectedProductsOrder.length === 0) {
      localStorage.removeItem(SELECTED_PRODUCTS_STORAGE_KEY);
    } else {
      localStorage.setItem(
        SELECTED_PRODUCTS_STORAGE_KEY,
        JSON.stringify(selectedProductsOrder)
      );
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function restoreSelectedProductsFromStorage() {
  selectedProductsOrder.length = 0;
  for (const name of loadSelectedProductsFromStorage()) {
    selectedProductsOrder.push(name);
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if ((data.v !== 1 && data.v !== 2) || !Array.isArray(data.transcript)) return null;
    const transcript = data.transcript.filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    );
    const rawRoutine = data.lastRoutineCatalogLines;
    const lastRoutineCatalogLines =
      Array.isArray(rawRoutine) && rawRoutine.length > 0
        ? rawRoutine.filter((s) => typeof s === "string" && s.trim())
        : null;
    return {
      userName: typeof data.userName === "string" ? data.userName : null,
      transcript,
      lastRoutineCatalogLines,
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
    {
      role: "system",
      content: buildMemorySystemContent(userName, lastRoutineCatalogLines),
    },
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
      else if (m.role === "assistant")
        appendMessage("assistant", m.content, { citations: m.citations });
    }
    return;
  }
  chatMessages.innerHTML = "";
  for (const m of messages.slice(2)) {
    if (m.role === "user") appendMessage("user", m.content);
    else if (m.role === "assistant")
      appendMessage("assistant", m.content, { citations: m.citations });
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;");
}

function safeHttpUrlForHref(url) {
  try {
    const u = new URL(String(url || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Dedupe web citations by URL (OpenAI may repeat the same source).
 * @param {{ url: string, title?: string }[]} list
 * @returns {{ url: string, title: string }[]}
 */
function dedupeWebCitations(list) {
  const seen = new Set();
  const out = [];
  for (const c of list || []) {
    const url = typeof c?.url === "string" ? c.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title =
      typeof c?.title === "string" && c.title.trim() ? c.title.trim() : url;
    out.push({ url, title });
  }
  return out;
}

/**
 * @param {object | null | undefined} message — OpenAI chat.completion `choices[0].message`
 * @returns {{ url: string, title: string }[]}
 */
function parseWebCitationsFromAssistantMessage(message) {
  const raw = message?.annotations;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    if (a.type === "url_citation" && a.url_citation && typeof a.url_citation.url === "string") {
      const u = a.url_citation;
      out.push({
        url: u.url,
        title: typeof u.title === "string" ? u.title : u.url,
      });
    } else if (a.type === "url_citation" && typeof a.url === "string") {
      out.push({
        url: a.url,
        title: typeof a.title === "string" ? a.title : a.url,
      });
    }
  }
  return dedupeWebCitations(out);
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
 * @param {{ url: string, title: string }[] | undefined} webCitations
 */
function buildRoutineEmailBody(payload, webCitations) {
  const lines = [payload.displayText.trim()];
  if (payload.cards.length > 0) {
    lines.push("", "— Product links —");
    for (const { name, shopUrl } of payload.cards) {
      lines.push("", name, shopUrl);
    }
  }
  const cites = dedupeWebCitations(webCitations);
  if (cites.length > 0) {
    lines.push("", "— Web sources —");
    for (const { title, url } of cites) {
      lines.push("", title, url);
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

/** Last assistant turn citations (for email/SMS and UI). */
function getLatestAssistantWebCitations() {
  for (let i = messages.length - 1; i >= 2; i--) {
    if (messages[i].role === "assistant" && Array.isArray(messages[i].citations)) {
      return dedupeWebCitations(messages[i].citations);
    }
  }
  return [];
}

/** @returns {{ body: string, subject: string } | null} */
function getLatestRoutineEmailParts() {
  if (!isLatestRoutineSharable()) return null;
  const raw = getLatestAssistantRawContent();
  if (!raw) return null;
  const payload = assistantVisualPayload(raw);
  return {
    body: buildRoutineEmailBody(payload, getLatestAssistantWebCitations()),
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
  const sharable = isLatestRoutineSharable();
  if (emailRoutineBtn) emailRoutineBtn.disabled = !sharable;
  if (phoneEmailRoutineBtn) phoneEmailRoutineBtn.disabled = !sharable;
}

function syncTextRoutineButtonState() {
  const sharable = isLatestRoutineSharable();
  if (textRoutineBtn) textRoutineBtn.disabled = !sharable;
  if (phoneTextRoutineBtn) phoneTextRoutineBtn.disabled = !sharable;
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
      const citeLines =
        m.role === "assistant" && Array.isArray(m.citations) && m.citations.length > 0
          ? dedupeWebCitations(m.citations)
              .map((c) => {
                const href = safeHttpUrlForHref(c.url);
                if (!href) {
                  return `<li>${escapeHtml(c.title)}</li>`;
                }
                return `<li><a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                  c.title
                )}</a></li>`;
              })
              .join("")
          : "";
      const citesBlock =
        citeLines.length > 0
          ? `<p class="history-web-sources-label">Web sources</p><ul class="history-web-sources-list">${citeLines}</ul>`
          : "";
      parts.push(
        `<div class="history-turn ${roleClass}"><span class="history-turn-label">${label}</span><div class="history-turn-text">${escapeHtml(
          historyText
        )}</div>${citesBlock}</div>`
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

/**
 * @param {"user" | "assistant"} role
 * @param {string} text
 * @param {{ citations?: { url: string, title: string }[] }} [opts]
 */
function appendMessage(role, text, opts = {}) {
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
    const webCites = dedupeWebCitations(opts.citations);
    if (webCites.length > 0) {
      const aside = document.createElement("aside");
      aside.className = "msg-web-sources";
      aside.setAttribute("aria-label", "Web sources");

      const head = document.createElement("p");
      head.className = "msg-web-sources-title";
      head.textContent = "Web sources";

      const ul = document.createElement("ul");
      ul.className = "msg-web-sources-list";
      for (const { url, title } of webCites) {
        const li = document.createElement("li");
        const safeHref = safeHttpUrlForHref(url);
        if (!safeHref) {
          li.textContent = title;
        } else {
          const a = document.createElement("a");
          a.href = safeHref;
          a.textContent = title;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          li.appendChild(a);
        }
        ul.appendChild(li);
      }
      aside.appendChild(head);
      aside.appendChild(ul);
      stack.appendChild(aside);
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
  if (productCatalogSearch) {
    productCatalogSearch.disabled = isBusy;
  }
  for (const el of document.querySelectorAll(".product-catalog-category-btn")) {
    if (el instanceof HTMLButtonElement) el.disabled = isBusy;
  }
  for (const el of document.querySelectorAll(
    ".product-catalog-card-toggle, .selected-products-remove, #clearSelectedProductsBtn"
  )) {
    if (el instanceof HTMLButtonElement) el.disabled = isBusy;
  }
  if (productCatalogGridWrap) {
    productCatalogGridWrap.classList.toggle(
      "product-catalog-grid-wrap--busy",
      isBusy
    );
  }
  if (generateRoutineBtn) {
    generateRoutineBtn.disabled =
      isBusy || selectedProductsOrder.length === 0;
  }
  if (clearSelectedProductsBtn) {
    clearSelectedProductsBtn.disabled =
      isBusy || selectedProductsOrder.length === 0;
  }
  if (isBusy) {
    if (emailRoutineBtn) emailRoutineBtn.disabled = true;
    if (textRoutineBtn) textRoutineBtn.disabled = true;
    if (phoneEmailRoutineBtn) phoneEmailRoutineBtn.disabled = true;
    if (phoneTextRoutineBtn) phoneTextRoutineBtn.disabled = true;
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

function isDocumentRtl() {
  return document.documentElement.getAttribute("dir") === "rtl";
}

function getResolvedDocumentDir() {
  if (window.APP_DIR === "rtl" || window.APP_DIR === "ltr") return window.APP_DIR;
  try {
    const stored = sessionStorage.getItem(UI_DIR_STORAGE_KEY);
    if (stored === "rtl" || stored === "ltr") return stored;
  } catch {
    /* private mode */
  }
  const lang = (navigator.language || "").toLowerCase();
  if (/^(ar|he|iw|fa|ur)/.test(lang)) return "rtl";
  return "ltr";
}

function initDocumentDirection() {
  document.documentElement.setAttribute("dir", getResolvedDocumentDir());
  syncLayoutDirToggleUi();
}

function syncLayoutDirToggleUi() {
  if (!layoutDirToggleBtn) return;
  const rtl = isDocumentRtl();
  layoutDirToggleBtn.setAttribute("aria-pressed", rtl ? "true" : "false");
  layoutDirToggleBtn.setAttribute(
    "aria-label",
    rtl ? "Switch layout to left-to-right" : "Switch layout to right-to-left"
  );
  if (layoutDirToggleIcon) {
    layoutDirToggleIcon.textContent = rtl
      ? "format_textdirection_l_to_r"
      : "format_textdirection_r_to_l";
  }
}

function positionProductPickerPanel() {
  if (!productPickerPanel || !productPickerSummary) return;
  const r = productPickerSummary.getBoundingClientRect();
  const gap = 8;
  const margin = 12;
  const maxH = Math.max(120, window.innerHeight - r.top - 16);
  productPickerPanel.style.top = `${r.top}px`;
  productPickerPanel.style.maxHeight = `${Math.min(320, maxH)}px`;

  if (isDocumentRtl()) {
    productPickerPanel.style.left = "auto";
    const spaceLeft = r.left - gap - margin;
    let w = Math.min(360, Math.max(200, spaceLeft));
    let right = window.innerWidth - r.left + gap;
    const panelLeft = window.innerWidth - right - w;
    if (panelLeft < margin) {
      right = window.innerWidth - margin - w;
    }
    productPickerPanel.style.right = `${right}px`;
    productPickerPanel.style.width = `${w}px`;
  } else {
    productPickerPanel.style.right = "auto";
    const spaceRight = window.innerWidth - r.right - gap - margin;
    let w = Math.min(360, Math.max(200, spaceRight));
    let left = r.right + gap;
    if (left + w > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - w);
    }
    productPickerPanel.style.left = `${left}px`;
    productPickerPanel.style.width = `${w}px`;
  }
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

function updateCatalogCardAria(toggleBtn, name) {
  const on = selectedProductsOrder.includes(name);
  toggleBtn.setAttribute(
    "aria-label",
    on
      ? `${name}. Selected. Click to remove from selection.`
      : `${name}. Not selected. Click to add to selection.`
  );
}

function syncCatalogCardState(name) {
  const root = catalogCardByName.get(name);
  if (!root) return;
  const toggle = root.querySelector(".product-catalog-card-toggle");
  if (!(toggle instanceof HTMLButtonElement)) return;
  const on = selectedProductsOrder.includes(name);
  root.classList.toggle("product-catalog-card--selected", on);
  toggle.setAttribute("aria-pressed", on ? "true" : "false");
  updateCatalogCardAria(toggle, name);
}

function renderSelectedProductsSection() {
  if (!selectedProductsList || !selectedProductsEmpty) return;
  const empty = selectedProductsOrder.length === 0;
  selectedProductsEmpty.hidden = !empty;
  selectedProductsList.hidden = empty;
  if (clearSelectedProductsBtn) {
    clearSelectedProductsBtn.hidden = empty;
    if (!empty) {
      clearSelectedProductsBtn.disabled = Boolean(userInput?.disabled);
    }
  }
  selectedProductsList.innerHTML = "";
  if (generateRoutineBtn) {
    generateRoutineBtn.disabled =
      userInput?.disabled || selectedProductsOrder.length === 0;
  }
  for (const name of selectedProductsOrder) {
    const li = document.createElement("li");
    li.className = "selected-products-item";

    const label = document.createElement("span");
    label.className = "selected-products-item-label";
    label.textContent = name;

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "selected-products-remove";
    rm.setAttribute("aria-label", `Remove ${name} from selected products`);
    const icon = document.createElement("span");
    icon.className = "material-icons";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "close";
    rm.appendChild(icon);
    rm.addEventListener("click", () => {
      removeSelectedProduct(name);
    });

    li.appendChild(label);
    li.appendChild(rm);
    selectedProductsList.appendChild(li);
  }
}

function toggleCatalogProduct(name) {
  const i = selectedProductsOrder.indexOf(name);
  if (i === -1) {
    selectedProductsOrder.push(name);
  } else {
    selectedProductsOrder.splice(i, 1);
  }
  syncCatalogCardState(name);
  renderSelectedProductsSection();
  persistSelectedProducts();
}

function removeSelectedProduct(name) {
  const i = selectedProductsOrder.indexOf(name);
  if (i === -1) return;
  selectedProductsOrder.splice(i, 1);
  syncCatalogCardState(name);
  renderSelectedProductsSection();
  persistSelectedProducts();
}

function clearAllSelectedProducts() {
  if (selectedProductsOrder.length === 0) return;
  const names = selectedProductsOrder.slice();
  selectedProductsOrder.length = 0;
  for (const name of names) {
    syncCatalogCardState(name);
  }
  renderSelectedProductsSection();
  persistSelectedProducts();
}

function syncCatalogCategoryButtons() {
  if (!productCatalogCategoryGroup) return;
  for (const btn of productCatalogCategoryGroup.querySelectorAll(
    ".product-catalog-category-btn"
  )) {
    if (!(btn instanceof HTMLButtonElement)) continue;
    const v = btn.dataset.categoryFilter || "All";
    btn.setAttribute("aria-pressed", v === catalogCategoryFilter ? "true" : "false");
  }
}

function setCatalogCategoryFilter(cat) {
  catalogCategoryFilter = cat;
  syncCatalogCategoryButtons();
  applyProductCatalogFilters();
}

const MARQUEE_MIRROR_ID_SUFFIX = "-marquee-dup";

function syncProductCatalogMarqueeMirrorFromMain() {
  const mirror = productCatalogMarqueeTrack?.querySelector(
    ".product-catalog-grid--marquee-mirror"
  );
  if (!mirror || !productCatalogGrid) return;
  mirror.innerHTML = productCatalogGrid.innerHTML;
  const sfx = MARQUEE_MIRROR_ID_SUFFIX;
  for (const el of mirror.querySelectorAll("[id]")) {
    if (el.id) el.id = `${el.id}${sfx}`;
  }
  for (const el of mirror.querySelectorAll("[aria-controls]")) {
    const v = el.getAttribute("aria-controls");
    if (v && !v.endsWith(sfx)) el.setAttribute("aria-controls", `${v}${sfx}`);
  }
  for (const el of mirror.querySelectorAll("[aria-labelledby]")) {
    const v = el.getAttribute("aria-labelledby");
    if (v && !v.endsWith(sfx)) el.setAttribute("aria-labelledby", `${v}${sfx}`);
  }
  for (const el of mirror.querySelectorAll(
    "button, a[href], input, select, textarea"
  )) {
    el.tabIndex = -1;
  }
  const mainCells = productCatalogGrid.children;
  const mirCells = mirror.children;
  for (let i = 0; i < mainCells.length; i += 1) {
    if (mirCells[i]) mirCells[i].hidden = mainCells[i].hidden;
  }
}

function syncProductCatalogMarqueeMirrorVisibilityOnly() {
  const mirror = productCatalogMarqueeTrack?.querySelector(
    ".product-catalog-grid--marquee-mirror"
  );
  if (!mirror || !productCatalogGrid) return;
  if (mirror.children.length !== productCatalogGrid.children.length) {
    syncProductCatalogMarqueeMirrorFromMain();
    return;
  }
  const mainCells = productCatalogGrid.children;
  const mirCells = mirror.children;
  for (let i = 0; i < mainCells.length; i += 1) {
    if (mirCells[i]) mirCells[i].hidden = mainCells[i].hidden;
  }
}

function updateProductCatalogMarqueeTiming() {
  const track = productCatalogMarqueeTrack;
  if (!track || !productCatalogGrid) return;
  const cs = getComputedStyle(track);
  const betweenGrids =
    parseFloat(cs.columnGap || cs.gap) || 0;
  const loopPx = productCatalogGrid.scrollWidth + betweenGrids;
  if (!Number.isFinite(loopPx) || loopPx < 12) {
    track.style.removeProperty("--marquee-duration");
    track.style.removeProperty("--marquee-loop-px");
    return;
  }
  track.style.setProperty("--marquee-loop-px", `-${loopPx}px`);
  /* Slightly slower strip so pack shots are easier to see on the infinite loop */
  const pxPerSec = 34;
  track.style.setProperty(
    "--marquee-duration",
    `${Math.max(24, loopPx / pxPerSec)}s`
  );
}

/**
 * Shows or hides catalog cells from category + search (name and description text).
 */
function applyProductCatalogFilters() {
  if (!productCatalogGrid) return;
  const raw = (productCatalogSearch && productCatalogSearch.value) || "";
  const q = raw.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  let visible = 0;

  for (const name of PRODUCT_CATALOG) {
    const cell = catalogCellByName.get(name);
    if (!cell) continue;
    const category = inferProductCategory(name);
    const categoryOk =
      catalogCategoryFilter === "All" || category === catalogCategoryFilter;
    const desc = (PRODUCT_DESCRIPTION_MAP[name] || "").toLowerCase();
    const haystack = `${name.toLowerCase()} ${desc}`;
    const searchOk =
      tokens.length === 0 || tokens.every((tok) => haystack.includes(tok));
    const show = categoryOk && searchOk;
    cell.hidden = !show;
    if (show) visible += 1;
  }

  if (productCatalogEmpty) {
    productCatalogEmpty.hidden = visible > 0;
  }

  if (productCatalogGridWrap) {
    productCatalogGridWrap.classList.toggle(
      "product-catalog-grid-wrap--marquee-paused",
      visible === 0
    );
  }
  syncProductCatalogMarqueeMirrorVisibilityOnly();
  updateProductCatalogMarqueeTiming();
}

function bindProductCatalogMarqueeInteractions() {
  const track = productCatalogMarqueeTrack || productCatalogGrid;
  if (!track || track.dataset.marqueeClicksBound === "1") return;
  track.dataset.marqueeClicksBound = "1";
  track.addEventListener("click", (e) => {
    if (e.target.closest("a.product-catalog-card-shop-link")) return;
    const card = e.target.closest(".product-catalog-card[data-product-name]");
    if (card && track.contains(card)) {
      toggleCatalogProduct(card.dataset.productName);
    }
  });
}

function initProductCatalogToolbar() {
  if (!productCatalogCategoryGroup || !productCatalogSearch) return;
  if (productCatalogCategoryGroup.dataset.initialized === "1") return;
  productCatalogCategoryGroup.dataset.initialized = "1";

  const addChip = (label, value) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "product-catalog-category-btn";
    btn.dataset.categoryFilter = value;
    btn.textContent = label;
    btn.setAttribute("aria-pressed", value === catalogCategoryFilter ? "true" : "false");
    btn.addEventListener("click", () => setCatalogCategoryFilter(value));
    productCatalogCategoryGroup.appendChild(btn);
  };

  addChip("All", "All");
  for (const c of catalogUiCategoriesForToolbar()) {
    addChip(c, c);
  }

  productCatalogSearch.addEventListener("input", () => {
    applyProductCatalogFilters();
  });
  productCatalogSearch.addEventListener("search", () => {
    applyProductCatalogFilters();
  });
}

function initProductCatalogGrid() {
  if (!productCatalogGrid) return;
  productCatalogGrid.innerHTML = "";
  catalogCardByName.clear();
  catalogCellByName.clear();

  PRODUCT_CATALOG.forEach((name) => {
    const imageUrl = PRODUCT_IMAGE_MAP[name];
    const description =
      PRODUCT_DESCRIPTION_MAP[name] ||
      "Short summary not available for this demo listing.";

    const cell = document.createElement("div");
    cell.className = "product-catalog-cell";

    const root = document.createElement("div");
    root.className = "product-catalog-card";
    root.dataset.productName = name;

    const shopHref = safeHttpUrlForHref(purchaseUrlForProduct(name));

    if (imageUrl && shopHref) {
      const shopLink = document.createElement("a");
      shopLink.className =
        "product-catalog-card-media product-catalog-card-shop-link";
      shopLink.href = shopHref;
      shopLink.target = "_blank";
      shopLink.rel = "noopener noreferrer";
      shopLink.setAttribute(
        "aria-label",
        `Buy ${name} (opens in new tab)`
      );
      const img = document.createElement("img");
      img.className = "product-catalog-card-img";
      img.src = imageUrl;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      shopLink.appendChild(img);
      root.appendChild(shopLink);
    } else if (imageUrl) {
      const media = document.createElement("span");
      media.className = "product-catalog-card-media";
      const img = document.createElement("img");
      img.className = "product-catalog-card-img";
      img.src = imageUrl;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      media.appendChild(img);
      root.appendChild(media);
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "product-catalog-card-toggle";
    toggle.setAttribute("aria-pressed", "false");

    const cap = document.createElement("span");
    cap.className = "product-catalog-card-cap";
    cap.textContent = name;

    const blurb = document.createElement("span");
    blurb.className = "product-catalog-card-blurb";
    blurb.textContent = description;

    toggle.appendChild(cap);
    toggle.appendChild(blurb);
    root.appendChild(toggle);
    catalogCardByName.set(name, root);
    updateCatalogCardAria(toggle, name);

    cell.appendChild(root);
    productCatalogGrid.appendChild(cell);
    catalogCellByName.set(name, cell);
  });

  for (const name of selectedProductsOrder) {
    syncCatalogCardState(name);
  }
  renderSelectedProductsSection();
  applyProductCatalogFilters();
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
            max_completion_tokens: 2048,
            web_search_options: {
              search_context_size: "medium",
            },
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

  const msg = data.choices?.[0]?.message;
  const reply = typeof msg?.content === "string" ? msg.content.trim() : "";
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
  const citations = parseWebCitationsFromAssistantMessage(msg);
  return { content: reply, citations };
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
    const { content: reply, citations } = await fetchOpenAICompletion(
      workerUrl,
      apiKey,
      payloadMessages
    );
    const assistantTurn = { role: "assistant", content: reply };
    if (citations.length > 0) assistantTurn.citations = citations;
    messages.push(assistantTurn);
    appendMessage("assistant", reply, { citations });
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

/**
 * Calls OpenAI with selected-product JSON only (not the full chat transcript).
 * Appends a short user line plus the assistant routine to the chat.
 */
async function generatePersonalizedRoutine() {
  if (selectedProductsOrder.length === 0) {
    appendMessage(
      "assistant",
      "Select one or more products from the catalog above, then tap Generate routine again."
    );
    return;
  }

  const { workerUrl, apiKey } = getChatApiConfig();
  if (!workerUrl && !apiKey) {
    appendMessage(
      "assistant",
      "Set window.CHAT_API_URL in config.js to your Cloudflare Worker URL (recommended), or window.OPENAI_API_KEY there for local-only testing."
    );
    return;
  }

  const productsJson = buildSelectedProductsRoutinePayload();
  const catalogLines = selectedProductsOrder.slice();
  const userApiContent = [
    "catalogLines (verbatim lines for [[VISUALS]] only):",
    ...catalogLines.map((line) => `- ${line}`),
    "",
    "selectedProducts JSON:",
    JSON.stringify(productsJson, null, 2),
    "",
    "Generate a personalized routine using these selected products only.",
  ].join("\n");

  const routineMessages = [
    { role: "system", content: ROUTINE_FROM_SELECTION_SYSTEM },
    { role: "user", content: userApiContent },
  ];

  const displayUserLine =
    "Generate a personalized routine from my selected products.";

  const typingEl = showTypingIndicator();
  setBusy(true);

  try {
    const { content: reply, citations } = await fetchOpenAICompletion(
      workerUrl,
      apiKey,
      routineMessages
    );
    lastRoutineCatalogLines = selectedProductsOrder.slice();
    syncMemorySystemMessage();
    messages.push({ role: "user", content: displayUserLine });
    const assistantTurn = { role: "assistant", content: reply };
    if (citations.length > 0) assistantTurn.citations = citations;
    messages.push(assistantTurn);
    appendMessage("user", displayUserLine);
    appendMessage("assistant", reply, { citations });
    persistSession();
  } catch (err) {
    const msg =
      err instanceof Error
        ? describeFetchFailure(err)
        : "Something went wrong calling the routine generator.";
    const shown = `Sorry — ${msg}`;
    messages.push({ role: "user", content: displayUserLine });
    messages.push({ role: "assistant", content: shown });
    appendMessage("user", displayUserLine);
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

if (phoneEmailRoutineBtn) {
  phoneEmailRoutineBtn.addEventListener("click", () => {
    openEmailRoutineDialog();
  });
}

if (phoneTextRoutineBtn) {
  phoneTextRoutineBtn.addEventListener("click", () => {
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

if (generateRoutineBtn) {
  generateRoutineBtn.addEventListener("click", () => {
    void generatePersonalizedRoutine();
  });
}

initDocumentDirection();

if (layoutDirToggleBtn) {
  layoutDirToggleBtn.addEventListener("click", () => {
    const next = isDocumentRtl() ? "ltr" : "rtl";
    try {
      sessionStorage.setItem(UI_DIR_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute("dir", next);
    syncLayoutDirToggleUi();
    if (productPickerDetails?.open) positionProductPickerPanel();
  });
}

populateProductSelect();
restoreSelectedProductsFromStorage();
initProductCatalogToolbar();
bindProductCatalogMarqueeInteractions();
initProductCatalogGrid();

if (productCatalogMarqueeTrack && typeof ResizeObserver !== "undefined") {
  const ro = new ResizeObserver(() => {
    updateProductCatalogMarqueeTiming();
  });
  ro.observe(productCatalogMarqueeTrack);
}

if (clearSelectedProductsBtn) {
  clearSelectedProductsBtn.addEventListener("click", () => {
    clearAllSelectedProducts();
  });
}

const loaded = loadSession();
lastRoutineCatalogLines = loaded?.lastRoutineCatalogLines ?? null;
initMessagesFromStorage(loaded);
renderChat();
syncRoutineShareButtonsState();
