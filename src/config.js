import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optional(name, fallback = "") {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function loadOpenRouterOnly() {
  return {
    openrouter: {
      apiKey: required("OPENROUTER_API_KEY"),
      baseUrl: optional("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      model: optional("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
      maxTokens: Number(optional("OPENROUTER_MAX_TOKENS", "280")),
    },
  };
}

export function loadBrowserConfig() {
  const headless = optional("X_HEADLESS", "false").toLowerCase();
  return {
    headless: headless === "true" || headless === "1",
  };
}

export function loadConfig() {
  return {
    ...loadOpenRouterOnly(),
    browser: loadBrowserConfig(),
  };
}
