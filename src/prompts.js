import { DEFAULT_STYLE, X_FREE_LIMITS } from "./limits.js";

/** Presets de prompt para geração/transformação de tweets. */
export const PROMPT_MODES = {
  english: {
    id: "english",
    label: "English",
    aliases: ["en", "ingles", "english"],
    systemExtra: [
      "Reescreva o resultado em inglês natural (US English).",
      "Mantenha o sentido e o tom; não traduza palavra por palavra.",
      "O texto final deve estar 100% em inglês.",
      `Obrigatório: no máximo ${X_FREE_LIMITS.maxChars} caracteres.`,
    ].join(" "),
    transformInstruction: `Rewrite the following tweet in natural US English. Keep meaning and tone. Hard limit: ${X_FREE_LIMITS.maxChars} characters. Return only the final tweet text.`,
  },
  spelling: {
    id: "spelling",
    label: "Revisão ortográfica",
    aliases: ["ortografia", "ortho", "spelling"],
    systemExtra: [
      "Faça revisão ortográfica rigorosa (acentos, grafia, concordância básica).",
      "Não mude o sentido nem o estilo; corrija apenas erros.",
      `Não aumente o texto além de ${X_FREE_LIMITS.maxChars} caracteres.`,
    ].join(" "),
    transformInstruction: `Corrija apenas erros ortográficos e de acentuação do tweet abaixo. Não reescreva o estilo. Máximo ${X_FREE_LIMITS.maxChars} caracteres. Devolva somente o texto corrigido.`,
  },
  revise: {
    id: "revise",
    label: "Revisão de texto",
    aliases: ["revisao", "review", "revise", "texto"],
    systemExtra: [
      "Faça revisão de texto: clareza, fluidez, gramática e concisão para X/Twitter Free.",
      "Pode reescrever levemente, sem mudar a ideia central.",
      `Obrigatório: no máximo ${X_FREE_LIMITS.maxChars} caracteres.`,
    ].join(" "),
    transformInstruction: `Revise o tweet abaixo para ficar mais claro, fluido e correto. Máximo ${X_FREE_LIMITS.maxChars} caracteres. Mantenha a ideia. Devolva somente o texto final.`,
  },
};

export function resolveMode(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  for (const mode of Object.values(PROMPT_MODES)) {
    if (mode.id === key || mode.aliases.includes(key)) return mode;
  }
  const valid = Object.values(PROMPT_MODES)
    .map((m) => `${m.id} (${m.aliases.join(", ")})`)
    .join(", ");
  throw new Error(`Modo inválido: ${name}. Use: ${valid}`);
}

function styleRules(style = DEFAULT_STYLE) {
  const hashtags = style.allowHashtags
    ? `- Hashtags permitidas: no máximo ${X_FREE_LIMITS.maxHashtagsWhenEnabled}.`
    : "- NÃO use hashtags (#). Zero hashtags.";
  const emojis = style.allowEmojis
    ? `- Emojis permitidos: no máximo ${X_FREE_LIMITS.maxEmojisWhenEnabled}.`
    : "- NÃO use emojis. Zero emojis.";
  return [hashtags, emojis];
}

export function buildSystemPrompt({ tone, lang, mode, prompt, style = DEFAULT_STYLE }) {
  const lines = [
    "Você escreve tweets prontos para publicar no X/Twitter (conta Free).",
    "Regras OBRIGATÓRIAS (conta Free):",
    `- No máximo ${X_FREE_LIMITS.maxChars} caracteres no texto final.`,
    `- Prefira ficar entre 180 e ${X_FREE_LIMITS.maxChars} caracteres; se precisar, corte ideias secundárias.`,
    ...styleRules(style),
    "- Sem aspas envolvendo o tweet inteiro.",
    "- Sem threads, sem numeração 1/2, sem explicações.",
    "- Não explique: devolva SOMENTE o texto do tweet.",
    `Tom padrão: ${tone}.`,
    `Idioma padrão: ${lang}.`,
  ];

  if (mode?.systemExtra) {
    lines.push("", `Modo (${mode.label}): ${mode.systemExtra}`);
  }
  if (prompt) {
    lines.push("", `Instrução extra do usuário: ${prompt}`);
  }

  return lines.join("\n");
}

export function buildUserPrompt({ topic, tone, lang, style = DEFAULT_STYLE }) {
  return [
    `Tema: ${topic}`,
    `Tom: ${tone}`,
    `Idioma: ${lang}`,
    `Limite rígido: ${X_FREE_LIMITS.maxChars} caracteres (X Free).`,
    `Hashtags: ${style.allowHashtags ? `até ${X_FREE_LIMITS.maxHashtagsWhenEnabled}` : "proibidas"}`,
    `Emojis: ${style.allowEmojis ? `até ${X_FREE_LIMITS.maxEmojisWhenEnabled}` : "proibidos"}`,
  ].join("\n");
}

export function buildTransformMessages({ text, mode, modes, prompt, style = DEFAULT_STYLE }) {
  const resolvedList =
    Array.isArray(modes) && modes.length
      ? modes
      : mode
        ? [mode]
        : [];

  const parts = [];
  if (resolvedList.length > 1) {
    parts.push(buildCombinedTransformInstruction(resolvedList));
  } else if (resolvedList[0]?.transformInstruction) {
    parts.push(resolvedList[0].transformInstruction);
  }
  if (prompt) parts.push(prompt);
  if (!parts.length) {
    parts.push(
      `Melhore o tweet abaixo mantendo a ideia. Devolva somente o texto final (máx. ${X_FREE_LIMITS.maxChars} caracteres, conta Free do X).`,
    );
  }

  return {
    system: [
      "Você edita textos curtos para X/Twitter (conta Free).",
      `Limite rígido: ${X_FREE_LIMITS.maxChars} caracteres.`,
      ...styleRules(style),
      "Não explique: devolva somente o texto final.",
      "Sem aspas envolvendo o texto inteiro.",
    ].join("\n"),
    user: `${parts.join("\n\n")}\n\nTexto:\n${text}`,
  };
}

export function buildShortenMessages(text, currentLen, style = DEFAULT_STYLE) {
  return {
    system: [
      "Você encurta tweets para caber no limite Free do X.",
      `Limite rígido: ${X_FREE_LIMITS.maxChars} caracteres.`,
      "Preserve a ideia principal.",
      ...styleRules(style),
      "Devolva SOMENTE o texto final, sem aspas e sem explicação.",
    ].join("\n"),
    user: [
      `O texto tem ${currentLen} caracteres e precisa ter no máximo ${X_FREE_LIMITS.maxChars}.`,
      "Encurte sem perder o sentido:",
      "",
      text,
    ].join("\n"),
  };
}

/** Combina modos curtos (-r -e) em uma instrução só. */
export function buildCombinedTransformInstruction(modes) {
  const ids = modes.map((m) => m.id);
  if (ids.includes("revise") && ids.includes("english")) {
    return [
      "Revise o texto (clareza e gramática) e reescreva em inglês natural (US).",
      'Resultado: "revisado em inglês".',
      `Máximo ${X_FREE_LIMITS.maxChars} caracteres.`,
      "Devolva somente o texto final.",
    ].join(" ");
  }
  if (ids.includes("spelling") && ids.includes("english")) {
    return [
      "Corrija ortografia se necessário e reescreva em inglês natural (US).",
      `Máximo ${X_FREE_LIMITS.maxChars} caracteres.`,
      "Devolva somente o texto final.",
    ].join(" ");
  }
  return modes.map((m) => m.transformInstruction).join(" ");
}

export function resolveModes(modeNames = []) {
  const unique = [];
  const seen = new Set();
  for (const name of modeNames) {
    if (!name) continue;
    const mode = resolveMode(name);
    if (!seen.has(mode.id)) {
      seen.add(mode.id);
      unique.push(mode);
    }
  }
  return unique;
}
