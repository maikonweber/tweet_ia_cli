import {
  buildShortenMessages,
  buildSystemPrompt,
  buildTransformMessages,
  buildUserPrompt,
  resolveMode,
  resolveModes,
} from "./prompts.js";
import {
  applyStyleGuards,
  assertWithinFreeLimit,
  DEFAULT_STYLE,
  tweetLength,
  X_FREE_LIMITS,
} from "./limits.js";

function isRetryableStatus(status) {
  return [402, 408, 429, 502, 503, 504].includes(status);
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

  return {
    text: text.replace(/^["']|["']$/g, "").trim(),
    modelUsed: data?.model || model,
  };
}

/**
 * Tenta free → free → ... → pago barato.
 * Também envia `models` (fallback nativo OpenRouter) na 1ª tentativa.
 */
async function chatCompletion(openrouter, { system, user, temperature = 0.7 }) {
  const cascade = openrouter.models?.length
    ? openrouter.models
    : ["openrouter/free", "inclusionai/ling-2.6-flash"];

  let lastError;

  // 1) Uma chamada com lista nativa de fallbacks (OpenRouter escolhe o próximo)
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
        if (process.env.OPENROUTER_VERBOSE === "true") {
          console.error(`Modelo: ${modelUsed}`);
        }
        return text.replace(/^["']|["']$/g, "").trim();
      }
    }

    lastError = new Error(`OpenRouter ${response.status}: ${bodyText.slice(0, 400)}`);
    lastError.retryable = isRetryableStatus(response.status);
  } catch (err) {
    lastError = err;
  }

  // 2) Fallback manual modelo a modelo
  for (const model of cascade) {
    try {
      const { text, modelUsed } = await chatCompletionOnce(openrouter, model, {
        system,
        user,
        temperature,
      });
      console.error(`Modelo usado: ${modelUsed}`);
      return text;
    } catch (err) {
      lastError = err;
      const hint = err.retryable ? "tentando próximo" : "falhou";
      console.error(`Aviso: ${model} (${hint}) — ${err.message.slice(0, 120)}`);
      if (!err.retryable && err.status && err.status < 500 && err.status !== 402 && err.status !== 429) {
        // erro de auth/validação: não adianta continuar todos
        if (err.status === 401) throw err;
      }
    }
  }

  throw lastError || new Error("Nenhum modelo OpenRouter disponível.");
}

async function enforceFreeLimit(openrouter, text, style = DEFAULT_STYLE) {
  let current = applyStyleGuards(text, style);
  let len = tweetLength(current);

  for (let attempt = 1; attempt <= 2 && len > X_FREE_LIMITS.maxChars; attempt++) {
    console.error(
      `Aviso: ${len}/${X_FREE_LIMITS.maxChars} caracteres — encurtando para o limite Free do X (tentativa ${attempt})...`,
    );
    const { system, user } = buildShortenMessages(current, len, style);
    current = applyStyleGuards(
      await chatCompletion(openrouter, { system, user, temperature: 0.3 }),
      style,
    );
    len = tweetLength(current);
  }

  if (len > X_FREE_LIMITS.maxChars) {
    const chars = [...current];
    let cut = chars.slice(0, X_FREE_LIMITS.maxChars).join("");
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > X_FREE_LIMITS.maxChars * 0.6) {
      cut = cut.slice(0, lastSpace).trim();
    }
    console.error(
      `Aviso: corte local para ${tweetLength(cut)}/${X_FREE_LIMITS.maxChars} caracteres.`,
    );
    current = cut;
  }

  return assertWithinFreeLimit(current);
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
      ? resolveModes(modes)
      : mode
        ? [resolveMode(mode)]
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
  const draft = await chatCompletion(openrouter, { system, user, temperature: 0.7 });
  return enforceFreeLimit(openrouter, draft, style);
}

export async function transformTweet(
  openrouter,
  { text, mode = null, modes = null, prompt = "", style = DEFAULT_STYLE },
) {
  if (!text?.trim()) throw new Error("Texto vazio para transformar.");
  const resolvedList =
    Array.isArray(modes) && modes.length
      ? resolveModes(modes)
      : mode
        ? [resolveMode(mode)]
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
  const draft = await chatCompletion(openrouter, { system, user, temperature: 0.35 });
  return enforceFreeLimit(openrouter, draft, style);
}
