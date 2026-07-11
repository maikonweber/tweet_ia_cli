import {
  buildShortenMessages,
  buildSystemPrompt,
  buildTransformMessages,
  buildUserPrompt,
  resolveMode,
} from "./prompts.js";
import {
  applyStyleGuards,
  assertWithinFreeLimit,
  DEFAULT_STYLE,
  tweetLength,
  X_FREE_LIMITS,
} from "./limits.js";

async function chatCompletion(openrouter, { system, user, temperature = 0.7 }) {
  const response = await fetch(`${openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouter.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/local/tweet-ia-cli",
      "X-Title": "tweet-ia-cli",
    },
    body: JSON.stringify({
      model: openrouter.model,
      max_tokens: openrouter.maxTokens,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenRouter não retornou texto.");
  }

  return text.replace(/^["']|["']$/g, "").trim();
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
    prompt = "",
    style = DEFAULT_STYLE,
  },
) {
  const resolved = mode ? resolveMode(mode) : null;
  const system = buildSystemPrompt({ tone, lang, mode: resolved, prompt, style });
  const user = buildUserPrompt({ topic, tone, lang, style });
  const draft = await chatCompletion(openrouter, { system, user, temperature: 0.7 });
  return enforceFreeLimit(openrouter, draft, style);
}

/** Transforma um texto existente (tradução, ortografia, revisão ou prompt livre). */
export async function transformTweet(
  openrouter,
  { text, mode = null, prompt = "", style = DEFAULT_STYLE },
) {
  if (!text?.trim()) throw new Error("Texto vazio para transformar.");
  const resolved = mode ? resolveMode(mode) : null;
  if (!resolved && !prompt) {
    throw new Error("Informe --mode ou --prompt para transformar o texto.");
  }
  const { system, user } = buildTransformMessages({
    text: text.trim(),
    mode: resolved,
    prompt,
    style,
  });
  const draft = await chatCompletion(openrouter, { system, user, temperature: 0.35 });
  return enforceFreeLimit(openrouter, draft, style);
}
