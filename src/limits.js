/**
 * Limites oficiais do X (help.x.com — tipos de posts / Premium).
 *
 * Free:     280 caracteres
 * Premium:  até 25.000 em "longer posts" (timeline ainda corta ~280 com "Show more")
 * Articles: formato longo separado (editor próprio) — não é o mesmo que longer post
 */

export const X_TIERS = {
  free: {
    id: "free",
    label: "Free",
    maxChars: 280,
    longerPosts: false,
    articles: false,
    maxHashtagsWhenEnabled: 2,
    maxEmojisWhenEnabled: 2,
    preferredMinChars: 120,
    preferredMaxChars: 280,
  },
  premium: {
    id: "premium",
    label: "Premium",
    maxChars: 25_000,
    longerPosts: true,
    articles: true,
    maxHashtagsWhenEnabled: 5,
    maxEmojisWhenEnabled: 5,
    // Posts curtos ainda performam melhor no feed; longos são opt-in
    preferredMinChars: 120,
    preferredMaxChars: 280,
    longPreferredMaxChars: 4_000,
  },
};

export const DEFAULT_STYLE = {
  allowHashtags: false,
  allowEmojis: false,
  /** true = pode usar até maxChars do tier (posts longos Premium) */
  longForm: false,
};

function resolveTierEnv() {
  const raw = (process.env.X_ACCOUNT_TIER || process.env.X_TIER || "premium")
    .trim()
    .toLowerCase();
  if (raw === "free" || raw === "basic") return "free";
  if (raw === "premium" || raw === "premium+" || raw === "premium_plus" || raw === "pro") {
    return "premium";
  }
  return "premium";
}

export function getXTier() {
  return X_TIERS[resolveTierEnv()] || X_TIERS.premium;
}

/** Limite efetivo de caracteres para a chamada (curto vs long-form). */
export function getMaxChars(style = DEFAULT_STYLE) {
  const tier = getXTier();
  if (tier.longerPosts && style?.longForm) return tier.maxChars;
  // Conta Premium sem --long: ainda permite até o teto, mas prompts pedem curto
  if (tier.longerPosts) return tier.maxChars;
  return tier.maxChars;
}

/** @deprecated use getXTier / getMaxChars — mantido para compat */
export const X_FREE_LIMITS = {
  get maxChars() {
    return getMaxChars();
  },
  get maxHashtagsWhenEnabled() {
    return getXTier().maxHashtagsWhenEnabled;
  },
  get maxEmojisWhenEnabled() {
    return getXTier().maxEmojisWhenEnabled;
  },
};

export function tweetLength(text) {
  return [...String(text ?? "")].length;
}

export function assertWithinLimit(text, style = DEFAULT_STYLE) {
  const max = getMaxChars(style);
  const len = tweetLength(text);
  const tier = getXTier();
  if (len > max) {
    throw new Error(
      `Texto com ${len} caracteres (limite ${tier.label} do X: ${max}).` +
        (tier.longerPosts && !style.longForm
          ? " Use --long para posts longos Premium."
          : ""),
    );
  }
  return text;
}

/** @deprecated */
export function assertWithinFreeLimit(text, style = DEFAULT_STYLE) {
  return assertWithinLimit(text, style);
}

export function countHashtags(text) {
  const matches = String(text).match(/#[\p{L}\p{N}_]+/gu);
  return matches ? matches.length : 0;
}

export function stripHashtags(text) {
  return String(text)
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function stripEmojis(text) {
  return String(text)
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function applyStyleGuards(text, style = DEFAULT_STYLE) {
  let out = text;
  if (!style.allowHashtags) out = stripHashtags(out);
  if (!style.allowEmojis) out = stripEmojis(out);
  return out.trim();
}

export function describeTier() {
  return [
    "Free:     280 caracteres | sem longer posts | sem Articles",
    "Premium:  até 25.000 (longer posts) | Articles no editor do X",
    "Feed:     timeline ainda mostra ~280 + \"Show more\" em posts longos",
  ].join("\n");
}
