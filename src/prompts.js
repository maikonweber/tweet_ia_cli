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
    ].join(" "),
    transformInstruction:
      "Rewrite the following tweet in natural US English. Keep meaning and tone. Return only the final tweet text.",
  },
  spelling: {
    id: "spelling",
    label: "Revisão ortográfica",
    aliases: ["ortografia", "ortho", "spelling"],
    systemExtra: [
      "Faça revisão ortográfica rigorosa (acentos, grafia, concordância básica).",
      "Não mude o sentido nem o estilo; corrija apenas erros.",
    ].join(" "),
    transformInstruction:
      "Corrija apenas erros ortográficos e de acentuação do tweet abaixo. Não reescreva o estilo. Devolva somente o texto corrigido.",
  },
  revise: {
    id: "revise",
    label: "Revisão de texto",
    aliases: ["revisao", "review", "revise", "texto"],
    systemExtra: [
      "Faça revisão de texto: clareza, fluidez, gramática e concisão para X/Twitter.",
      "Pode reescrever levemente, sem mudar a ideia central.",
    ].join(" "),
    transformInstruction:
      "Revise o tweet abaixo para ficar mais claro, fluido e correto (gramática + estilo). Mantenha a ideia. Devolva somente o texto final.",
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

export function buildSystemPrompt({ tone, lang, mode, prompt }) {
  const lines = [
    "Você escreve tweets prontos para publicar no X/Twitter.",
    "Regras:",
    "- Máximo 280 caracteres.",
    "- Sem aspas envolvendo o tweet inteiro.",
    "- Sem hashtags em excesso (no máximo 2).",
    "- Sem emojis em excesso.",
    "- Não explique: devolva somente o texto do tweet.",
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

export function buildUserPrompt({ topic, tone, lang }) {
  return `Tema: ${topic}\nTom: ${tone}\nIdioma: ${lang}`;
}

export function buildTransformMessages({ text, mode, prompt }) {
  const parts = [];
  if (mode?.transformInstruction) parts.push(mode.transformInstruction);
  if (prompt) parts.push(prompt);
  if (!parts.length) {
    parts.push("Melhore o tweet abaixo mantendo a ideia. Devolva somente o texto final (máx. 280 caracteres).");
  }

  return {
    system: [
      "Você edita textos curtos para X/Twitter.",
      "Máximo 280 caracteres.",
      "Não explique: devolva somente o texto final.",
      "Sem aspas envolvendo o texto inteiro.",
    ].join("\n"),
    user: `${parts.join("\n\n")}\n\nTexto:\n${text}`,
  };
}
