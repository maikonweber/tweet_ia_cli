import {
  buildShortenMessages,
  buildSystemPrompt,
  buildTransformMessages,
  buildUserPrompt,
  resolveMode,
  resolveModes,
} from "./prompts.js";
import {
  assertWithinLimit,
  DEFAULT_STYLE,
  getMaxChars,
  tweetLength,
} from "./limits.js";
import {
  estimateCostUsd,
  formatPriceRow,
  formatUsd,
  getModelPrice,
} from "./pricing.js";
import { looksLikeSocialPost, sanitizeForX } from "./sanitize.js";

function isRetryableStatus(status) {
  return [402, 408, 429, 502, 503, 504].includes(status);
}

function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function readUsage(data) {
  return {
    promptTokens: Number(data?.usage?.prompt_tokens || 0),
    completionTokens: Number(data?.usage?.completion_tokens || 0),
    totalTokens: Number(data?.usage?.total_tokens || 0),
  };
}

function addUsage(a, b) {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

async function buildCostMeta(openrouter, modelUsed, usage) {
  const price = await getModelPrice(modelUsed, openrouter.baseUrl);
  const costUsd = estimateCostUsd({
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    price,
  });
  return {
    model: modelUsed,
    usage,
    price,
    costUsd,
    priceLabel: formatPriceRow(price.matched || modelUsed, price),
    costLabel: formatUsd(costUsd),
  };
}

async function chatCompletionOnce(openrouter, model, { system, user, temperature }) {
  const response = await fetch(`${openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouter.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/local/tweet-ia-cli",
      "X-Title": "tweet-ia-cli",
    },
    body: JSON.stringify({
      model,
      max_tokens: openrouter.maxTokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const bodyText = await response.text();
  let data = null;
  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err = new Error(`OpenRouter ${response.status}: ${bodyText.slice(0, 400)}`);
    err.status = response.status;
    err.retryable = isRetryableStatus(response.status);
    err.body = bodyText;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const err = new Error("OpenRouter não retornou texto.");
    err.retryable = true;
    throw err;
  }

  const modelUsed = data?.model || model;
  const usage = readUsage(data);
  const cost = await buildCostMeta(openrouter, modelUsed, usage);

  return {
    text: text.replace(/^["']|["']$/g, "").trim(),
    modelUsed,
    usage,
    cost,
  };
}

async function chatCompletion(openrouter, { system, user, temperature = 0.7 }) {
  const cascade = openrouter.models?.length
    ? openrouter.models
    : ["openrouter/free", "inclusionai/ling-2.6-flash"];

  let lastError;
  const attempts = [];

  // 1) Fallback nativo OpenRouter
  try {
    const response = await fetch(`${openrouter.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouter.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/local/tweet-ia-cli",
        "X-Title": "tweet-ia-cli",
      },
      body: JSON.stringify({
        models: cascade,
        route: "fallback",
        max_tokens: openrouter.maxTokens,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    const bodyText = await response.text();
    let data = null;
    try {
      data = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      data = null;
    }

    if (response.ok) {
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        const modelUsed = data?.model || cascade[0];
        const usage = readUsage(data);
        const cost = await buildCostMeta(openrouter, modelUsed, usage);
        attempts.push({ model: modelUsed, ok: true, costUsd: cost.costUsd });
        return {
          text: text.replace(/^["']|["']$/g, "").trim(),
          modelUsed,
          usage,
          cost,
          attempts,
        };
      }
    }

    lastError = new Error(`OpenRouter ${response.status}: ${bodyText.slice(0, 400)}`);
    lastError.retryable = isRetryableStatus(response.status);
    attempts.push({ model: "cascade", ok: false, error: lastError.message.slice(0, 80) });
  } catch (err) {
    lastError = err;
  }

  // 2) Manual
  for (const model of cascade) {
    try {
      const result = await chatCompletionOnce(openrouter, model, {
        system,
        user,
        temperature,
      });
      attempts.push({
        model: result.modelUsed,
        ok: true,
        costUsd: result.cost.costUsd,
        priceLabel: result.cost.priceLabel,
      });
      return { ...result, attempts };
    } catch (err) {
      lastError = err;
      attempts.push({ model, ok: false, error: err.message.slice(0, 100) });
      console.error(`Aviso: ${model} (tentando próximo) — ${err.message.slice(0, 120)}`);
      if (err.status === 401) throw err;
    }
  }

  throw lastError || new Error("Nenhum modelo OpenRouter disponível.");
}

function mergeMeta(base, extraUsage, extraCost) {
  if (!base) return extraCost;
  const usage = addUsage(base.usage || emptyUsage(), extraUsage || emptyUsage());
  const costUsd =
    (base.costUsd || 0) + (extraCost?.costUsd != null ? extraCost.costUsd : 0);
  return {
    ...extraCost,
    model: extraCost?.model || base.model,
    usage,
    costUsd,
    costLabel: formatUsd(costUsd),
    priceLabel: extraCost?.priceLabel || base.priceLabel,
    attempts: [...(base.attempts || []), ...(extraCost?.attempts || [])],
  };
}

async function enforceCharLimit(openrouter, text, style = DEFAULT_STYLE, meta = null) {
  const maxChars = getMaxChars(style);
  let current = sanitizeForX(text, style);
  let len = tweetLength(current);
  let costMeta = meta;

  // Se ainda parecer markdown/artigo, pede reescrita social
  if (!looksLikeSocialPost(current)) {
    console.error("Aviso: saída não parece post de rede social — reescrevendo para o X...");
    const result = await chatCompletion(openrouter, {
      system: [
        "Reescreva o texto abaixo como UM post pronto para a rede social X.",
        "Sem markdown, sem prefácio, sem explicação. Só o texto do post.",
        `Máximo ${maxChars} caracteres.`,
      ].join("\n"),
      user: current,
      temperature: 0.4,
    });
    current = sanitizeForX(result.text, style);
    costMeta = mergeMeta(costMeta, result.usage, {
      ...result.cost,
      attempts: result.attempts,
    });
    len = tweetLength(current);
  }

  for (let attempt = 1; attempt <= 2 && len > maxChars; attempt++) {
    console.error(
      `Aviso: ${len}/${maxChars} caracteres — encurtando (tentativa ${attempt})...`,
    );
    const { system, user } = buildShortenMessages(current, len, style);
    const result = await chatCompletion(openrouter, { system, user, temperature: 0.3 });
    current = sanitizeForX(result.text, style);
    costMeta = mergeMeta(costMeta, result.usage, {
      ...result.cost,
      attempts: result.attempts,
    });
    len = tweetLength(current);
  }

  if (len > maxChars) {
    const chars = [...current];
    let cut = chars.slice(0, maxChars).join("");
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > maxChars * 0.6) {
      cut = cut.slice(0, lastSpace).trim();
    }
    console.error(`Aviso: corte local para ${tweetLength(cut)}/${maxChars}.`);
    current = cut;
  }

  current = sanitizeForX(current, style);
  if (!current) {
    throw new Error("A IA não gerou um texto válido para publicar no X.");
  }

  return {
    text: assertWithinLimit(current, style),
    meta: costMeta,
  };
}

function toResult(text, meta) {
  return { text, meta };
}

export async function generateTweet(
  openrouter,
  {
    topic,
    tone = "direto e natural",
    lang = "pt-BR",
    mode = null,
    modes = null,
    prompt = "",
    style = DEFAULT_STYLE,
  },
) {
  const resolvedList =
    Array.isArray(modes) && modes.length
      ? resolveModes(modes, style)
      : mode
        ? [resolveMode(mode, style)]
        : [];
  const primary = resolvedList[resolvedList.length - 1] || null;
  const effectiveLang = resolvedList.some((m) => m.id === "english") ? "en" : lang;
  let effectivePrompt = prompt;
  if (resolvedList.some((m) => m.id === "revise") && resolvedList.some((m) => m.id === "english")) {
    effectivePrompt = [prompt, "Revise e escreva já em inglês natural (revisado em inglês)."]
      .filter(Boolean)
      .join(" ");
  }
  const system = buildSystemPrompt({
    tone,
    lang: effectiveLang,
    mode: primary,
    prompt: effectivePrompt,
    style,
  });
  const user = buildUserPrompt({ topic, tone, lang: effectiveLang, style });
  const result = await chatCompletion(openrouter, { system, user, temperature: 0.7 });
  const enforced = await enforceCharLimit(openrouter, result.text, style, {
    ...result.cost,
    attempts: result.attempts,
    usage: result.usage,
  });
  return toResult(enforced.text, enforced.meta);
}

export async function transformTweet(
  openrouter,
  { text, mode = null, modes = null, prompt = "", style = DEFAULT_STYLE },
) {
  if (!text?.trim()) throw new Error("Texto vazio para transformar.");
  const resolvedList =
    Array.isArray(modes) && modes.length
      ? resolveModes(modes, style)
      : mode
        ? [resolveMode(mode, style)]
        : [];
  if (!resolvedList.length && !prompt) {
    throw new Error("Informe --mode / -r / -e / -s e/ou --prompt \"...\"");
  }
  const { system, user } = buildTransformMessages({
    text: text.trim(),
    modes: resolvedList,
    prompt,
    style,
  });
  const result = await chatCompletion(openrouter, { system, user, temperature: 0.35 });
  const enforced = await enforceCharLimit(openrouter, result.text, style, {
    ...result.cost,
    attempts: result.attempts,
    usage: result.usage,
  });
  return toResult(enforced.text, enforced.meta);
}
