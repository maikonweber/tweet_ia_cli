/**
 * Preços de referência (USD / 1M tokens) — OpenRouter /api/v1/models (jul/2026).
 * IDs com sufixo de data (ex.: ...-20260421) usam o match por prefixo.
 */
export const KNOWN_PRICES = {
  "openrouter/free": { prompt: 0, completion: 0, tier: "free" },
  "meta-llama/llama-3.2-3b-instruct:free": { prompt: 0, completion: 0, tier: "free" },
  "openai/gpt-oss-20b:free": { prompt: 0, completion: 0, tier: "free" },
  "meta-llama/llama-3.3-70b-instruct:free": { prompt: 0, completion: 0, tier: "free" },
  "inclusionai/ling-2.6-flash": { prompt: 0.01, completion: 0.03, tier: "paid" },
  "meta-llama/llama-3.1-8b-instruct": { prompt: 0.02, completion: 0.03, tier: "paid" },
  "mistralai/mistral-nemo": { prompt: 0.02, completion: 0.03, tier: "paid" },
  "openai/gpt-4o-mini": { prompt: 0.15, completion: 0.6, tier: "paid" },
};

let priceCache = null;
let priceCacheAt = 0;
const CACHE_MS = 60 * 60 * 1000;

export function isFreeModelId(modelId) {
  const id = String(modelId || "");
  return id === "openrouter/free" || id.endsWith(":free") || id.includes(":free");
}

export function normalizeModelId(modelId) {
  return String(modelId || "").trim();
}

/** Resolve preço por id exato, :free, ou prefixo (sem data). */
export function lookupKnownPrice(modelId) {
  const id = normalizeModelId(modelId);
  if (!id) return null;
  if (isFreeModelId(id)) return { prompt: 0, completion: 0, tier: "free", matched: id };
  if (KNOWN_PRICES[id]) return { ...KNOWN_PRICES[id], matched: id };

  // inclusionai/ling-2.6-flash-20260421 → inclusionai/ling-2.6-flash
  for (const [key, price] of Object.entries(KNOWN_PRICES)) {
    if (id === key || id.startsWith(`${key}-`) || id.startsWith(`${key}:`)) {
      return { ...price, matched: key };
    }
  }
  return null;
}

export async function loadOpenRouterPrices(baseUrl = "https://openrouter.ai/api/v1") {
  if (priceCache && Date.now() - priceCacheAt < CACHE_MS) return priceCache;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`);
    if (!res.ok) throw new Error(`models ${res.status}`);
    const data = await res.json();
    const map = new Map();
    for (const m of data.data || []) {
      const prompt = Number(m.pricing?.prompt || 0) * 1e6; // API is $/token → $/1M
      const completion = Number(m.pricing?.completion || 0) * 1e6;
      map.set(m.id, {
        prompt,
        completion,
        tier: prompt === 0 && completion === 0 ? "free" : "paid",
      });
    }
    priceCache = map;
    priceCacheAt = Date.now();
    return map;
  } catch {
    return priceCache || new Map();
  }
}

export async function getModelPrice(modelId, baseUrl) {
  const id = normalizeModelId(modelId);
  if (!id) {
    return { prompt: null, completion: null, tier: "unknown", matched: id, source: "unknown" };
  }

  // Variante free sempre $0 (mesmo se o catálogo tiver irmão pago com prefixo parecido)
  if (isFreeModelId(id)) {
    return { prompt: 0, completion: 0, tier: "free", matched: id, source: "free-suffix" };
  }

  const live = await loadOpenRouterPrices(baseUrl);

  if (live.has(id)) {
    const p = live.get(id);
    return { ...p, matched: id, source: "api" };
  }

  // prefix match no catálogo live
  for (const [key, p] of live.entries()) {
    if (id.startsWith(`${key}-`) || key.startsWith(`${id}-`)) {
      return { ...p, matched: key, source: "api-prefix" };
    }
  }

  const known = lookupKnownPrice(id);
  if (known) return { ...known, source: "known" };

  return { prompt: null, completion: null, tier: "unknown", matched: id, source: "unknown" };
}

export function estimateCostUsd({ promptTokens = 0, completionTokens = 0, price }) {
  if (!price || price.prompt == null || price.completion == null) {
    return null;
  }
  // price is USD per 1M tokens
  return (promptTokens * price.prompt + completionTokens * price.completion) / 1e6;
}

export function formatUsd(amount) {
  if (amount == null || Number.isNaN(amount)) return "n/d";
  if (amount === 0) return "$0.00 (free)";
  if (amount < 0.000001) return `$${amount.toExponential(2)}`;
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(4)}`;
}

export function formatPriceRow(modelId, price) {
  if (!price || price.prompt == null) return `${modelId} — preço n/d`;
  if (price.tier === "free" || (price.prompt === 0 && price.completion === 0)) {
    return `${modelId} — FREE ($0 / $0 por 1M tokens)`;
  }
  return `${modelId} — $${price.prompt}/M in · $${price.completion}/M out`;
}

/** Tabela estática da cascata padrão (para --help / README). */
export function cascadePriceTable() {
  return [
    ...Object.entries(KNOWN_PRICES).map(([id, p]) => ({ id, ...p })),
  ];
}
