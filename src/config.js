import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModelCascade,
  DEFAULT_FREE_MODELS,
  DEFAULT_PAID_FALLBACK_MODELS,
  parseModelList,
} from "./models.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Raiz do pacote (onde ficam .env e .auth), independente do cwd. */
export const PROJECT_ROOT = resolve(__dirname, "..");

dotenv.config({ path: resolve(PROJECT_ROOT, ".env") });

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
  const preferred = optional("OPENROUTER_MODEL", "");
  const skipFree = ["1", "true", "yes"].includes(
    optional("OPENROUTER_SKIP_FREE", "false").toLowerCase(),
  );
  const freeModels =
    parseModelList(optional("OPENROUTER_FREE_MODELS", "")) || DEFAULT_FREE_MODELS;
  const paidModels =
    parseModelList(optional("OPENROUTER_PAID_FALLBACK_MODELS", "")) ||
    DEFAULT_PAID_FALLBACK_MODELS;

  const models = buildModelCascade({
    preferredModel: preferred,
    freeModels: freeModels.length ? freeModels : DEFAULT_FREE_MODELS,
    paidModels: paidModels.length ? paidModels : DEFAULT_PAID_FALLBACK_MODELS,
    skipFree,
  });

  return {
    openrouter: {
      apiKey: required("OPENROUTER_API_KEY"),
      baseUrl: optional("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      /** Cascata: free primeiro, depois pago barato */
      models,
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
