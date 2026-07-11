import {
  buildSystemPrompt,
  buildTransformMessages,
  buildUserPrompt,
  resolveMode,
} from "./prompts.js";

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

export async function generateTweet(
  openrouter,
  { topic, tone = "direto e natural", lang = "pt-BR", mode = null, prompt = "" },
) {
  const resolved = mode ? resolveMode(mode) : null;
  const system = buildSystemPrompt({ tone, lang, mode: resolved, prompt });
  const user = buildUserPrompt({ topic, tone, lang });
  return chatCompletion(openrouter, { system, user, temperature: 0.7 });
}

/** Transforma um texto existente (tradução, ortografia, revisão ou prompt livre). */
export async function transformTweet(
  openrouter,
  { text, mode = null, prompt = "" },
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
  });
  return chatCompletion(openrouter, { system, user, temperature: 0.35 });
}
