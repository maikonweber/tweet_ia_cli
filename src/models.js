/**
 * Cascata de modelos OpenRouter (jul/2026 — preços oficiais /api/v1/models):
 *
 * Gratuitos ($0 / token):
 *   openrouter/free                         — router automático entre free
 *   meta-llama/llama-3.2-3b-instruct:free
 *   openai/gpt-oss-20b:free
 *   meta-llama/llama-3.3-70b-instruct:free
 *
 * Pagos mais baratos (USD / 1M tokens prompt|completion):
 *   inclusionai/ling-2.6-flash              — $0.01 / $0.03
 *   meta-llama/llama-3.1-8b-instruct        — $0.02 / $0.03
 *   mistralai/mistral-nemo                  — $0.02 / $0.03
 *
 * Referência do modelo antigo:
 *   openai/gpt-4o-mini                      — $0.15 / $0.60  (~20x mais caro)
 */

export const DEFAULT_FREE_MODELS = [
  "openrouter/free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "openai/gpt-oss-20b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

export const DEFAULT_PAID_FALLBACK_MODELS = [
  "inclusionai/ling-2.6-flash",
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/mistral-nemo",
];

export function buildModelCascade({
  preferredModel = "",
  freeModels = DEFAULT_FREE_MODELS,
  paidModels = DEFAULT_PAID_FALLBACK_MODELS,
  skipFree = false,
} = {}) {
  const list = [];
  const push = (id) => {
    const model = String(id || "").trim();
    if (model && !list.includes(model)) list.push(model);
  };

  if (preferredModel && !String(preferredModel).includes("gpt-4o-mini")) {
    push(preferredModel);
  }

  if (!skipFree) {
    for (const m of freeModels) push(m);
  }
  for (const m of paidModels) push(m);

  // Último recurso se alguém forçou só um modelo inválido
  if (!list.length) {
    for (const m of DEFAULT_FREE_MODELS) push(m);
    for (const m of DEFAULT_PAID_FALLBACK_MODELS) push(m);
  }

  return list;
}

export function parseModelList(value) {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
