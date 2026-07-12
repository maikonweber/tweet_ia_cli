import { DEFAULT_STYLE, getMaxChars, getXTier } from "./limits.js";

function charCap(style = DEFAULT_STYLE) {
  return getMaxChars(style);
}

function tierLabel() {
  return getXTier().label;
}

function buildModeDefs(style = DEFAULT_STYLE) {
  const max = charCap(style);
  return {
    english: {
      id: "english",
      label: "English",
      aliases: ["en", "ingles", "english"],
      systemExtra: [
        "Reescreva o resultado em inglês natural (US English).",
        "Mantenha o sentido e o tom; não traduza palavra por palavra.",
        "O texto final deve estar 100% em inglês.",
        `Obrigatório: no máximo ${max} caracteres.`,
      ].join(" "),
      transformInstruction: `Rewrite the following tweet in natural US English. Keep meaning and tone. Hard limit: ${max} characters. Return only the final tweet text.`,
    },
    spelling: {
      id: "spelling",
      label: "Revisão ortográfica",
      aliases: ["ortografia", "ortho", "spelling"],
      systemExtra: [
        "Faça revisão ortográfica rigorosa (acentos, grafia, concordância básica).",
        "Não mude o sentido nem o estilo; corrija apenas erros.",
        `Não aumente o texto além de ${max} caracteres.`,
      ].join(" "),
      transformInstruction: `Corrija apenas erros ortográficos e de acentuação do tweet abaixo. Não reescreva o estilo. Máximo ${max} caracteres. Devolva somente o texto corrigido.`,
    },
    revise: {
      id: "revise",
      label: "Revisão de texto",
      aliases: ["revisao", "review", "revise", "texto"],
      systemExtra: [
        `Faça revisão de texto: clareza, fluidez, gramática e concisão para X/Twitter (${tierLabel()}).`,
        "Pode reescrever levemente, sem mudar a ideia central.",
        `Obrigatório: no máximo ${max} caracteres.`,
      ].join(" "),
      transformInstruction: `Revise o tweet abaixo para ficar mais claro, fluido e correto. Máximo ${max} caracteres. Mantenha a ideia. Devolva somente o texto final.`,
    },
  };
}

/** Presets — recalculados conforme tier/estilo. */
export const PROMPT_MODES = buildModeDefs();

export function resolveMode(name, style = DEFAULT_STYLE) {
  if (!name) return null;
  const modes = buildModeDefs(style);
  const key = String(name).trim().toLowerCase();
  for (const mode of Object.values(modes)) {
    if (mode.id === key || mode.aliases.includes(key)) return mode;
  }
  const valid = Object.values(modes)
    .map((m) => `${m.id} (${m.aliases.join(", ")})`)
    .join(", ");
  throw new Error(`Modo inválido: ${name}. Use: ${valid}`);
}

function styleRules(style = DEFAULT_STYLE) {
  const tier = getXTier();
  const hashtags = style.allowHashtags
    ? `- Hashtags permitidas: no máximo ${tier.maxHashtagsWhenEnabled}.`
    : "- NÃO use hashtags (#). Zero hashtags.";
  const emojis = style.allowEmojis
    ? `- Emojis permitidos: no máximo ${tier.maxEmojisWhenEnabled}.`
    : "- NÃO use emojis. Zero emojis.";
  return [hashtags, emojis];
}

function lengthRules(style = DEFAULT_STYLE) {
  const tier = getXTier();
  const max = charCap(style);
  if (tier.longerPosts && style.longForm) {
    return [
      `Conta X ${tier.label}: posts longos até ${max} caracteres.`,
      `Prefira até ${tier.longPreferredMaxChars} a menos que o usuário peça texto longo.`,
      "Os primeiros ~280 caracteres são o gancho (aparecem no feed antes de Show more).",
    ];
  }
  if (tier.longerPosts) {
    return [
      `Conta X ${tier.label}: teto ${max} caracteres (longer posts).`,
      `Por padrão escreva curto (ideal ${tier.preferredMinChars}–${tier.preferredMaxChars}), a menos que o tema peça mais.`,
      "Sem threads numeradas.",
    ];
  }
  return [
    `Conta X Free: máximo ${max} caracteres.`,
    `Prefira ficar entre ${tier.preferredMinChars} e ${max} caracteres.`,
  ];
}

export function buildSystemPrompt({ tone, lang, mode, prompt, style = DEFAULT_STYLE }) {
  const tier = getXTier();
  const lines = [
    `Você escreve posts prontos para publicar no X/Twitter (conta ${tier.label}).`,
    "Regras OBRIGATÓRIAS:",
    ...lengthRules(style).map((l) => `- ${l}`),
    ...styleRules(style),
    "- Sem aspas envolvendo o post inteiro.",
    "- Sem numeração tipo 1/2; não explique — devolva SOMENTE o texto.",
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
  const tier = getXTier();
  const max = charCap(style);
  return [
    `Tema: ${topic}`,
    `Tom: ${tone}`,
    `Idioma: ${lang}`,
    `Limite: ${max} caracteres (X ${tier.label}${style.longForm ? ", long-form" : ""}).`,
    `Hashtags: ${style.allowHashtags ? `até ${tier.maxHashtagsWhenEnabled}` : "proibidas"}`,
    `Emojis: ${style.allowEmojis ? `até ${tier.maxEmojisWhenEnabled}` : "proibidos"}`,
  ].join("\n");
}

export function buildTransformMessages({ text, mode, modes, prompt, style = DEFAULT_STYLE }) {
  const resolvedList =
    Array.isArray(modes) && modes.length
      ? modes
      : mode
        ? [mode]
        : [];
  const max = charCap(style);
  const tier = getXTier();

  const parts = [];
  if (resolvedList.length > 1) {
    parts.push(buildCombinedTransformInstruction(resolvedList, style));
  } else if (resolvedList[0]?.transformInstruction) {
    parts.push(resolvedList[0].transformInstruction);
  }
  if (prompt) parts.push(prompt);
  if (!parts.length) {
    parts.push(
      `Melhore o post abaixo mantendo a ideia. Devolva somente o texto final (máx. ${max} caracteres, X ${tier.label}).`,
    );
  }

  return {
    system: [
      `Você edita textos para X/Twitter (conta ${tier.label}).`,
      `Limite rígido: ${max} caracteres.`,
      ...styleRules(style),
      "Não explique: devolva somente o texto final.",
      "Sem aspas envolvendo o texto inteiro.",
    ].join("\n"),
    user: `${parts.join("\n\n")}\n\nTexto:\n${text}`,
  };
}

export function buildShortenMessages(text, currentLen, style = DEFAULT_STYLE) {
  const max = charCap(style);
  const tier = getXTier();
  return {
    system: [
      `Você encurta posts para caber no limite ${tier.label} do X.`,
      `Limite rígido: ${max} caracteres.`,
      "Preserve a ideia principal.",
      ...styleRules(style),
      "Devolva SOMENTE o texto final, sem aspas e sem explicação.",
    ].join("\n"),
    user: [
      `O texto tem ${currentLen} caracteres e precisa ter no máximo ${max}.`,
      "Encurte sem perder o sentido:",
      "",
      text,
    ].join("\n"),
  };
}

export function buildCombinedTransformInstruction(modes, style = DEFAULT_STYLE) {
  const max = charCap(style);
  const ids = modes.map((m) => m.id);
  if (ids.includes("revise") && ids.includes("english")) {
    return [
      "Revise o texto (clareza e gramática) e reescreva em inglês natural (US).",
      'Resultado: "revisado em inglês".',
      `Máximo ${max} caracteres.`,
      "Devolva somente o texto final.",
    ].join(" ");
  }
  if (ids.includes("spelling") && ids.includes("english")) {
    return [
      "Corrija ortografia se necessário e reescreva em inglês natural (US).",
      `Máximo ${max} caracteres.`,
      "Devolva somente o texto final.",
    ].join(" ");
  }
  return modes.map((m) => m.transformInstruction).join(" ");
}

export function resolveModes(modeNames = [], style = DEFAULT_STYLE) {
  const unique = [];
  const seen = new Set();
  for (const name of modeNames) {
    if (!name) continue;
    const mode = resolveMode(name, style);
    if (!seen.has(mode.id)) {
      seen.add(mode.id);
      unique.push(mode);
    }
  }
  return unique;
}
