/** Limites da conta Free do X (postagem padrão no site). */
export const X_FREE_LIMITS = {
  maxChars: 280,
  /** Padrão: desligado. Com --hashtags, até este valor. */
  maxHashtagsWhenEnabled: 2,
  /** Padrão: desligado. Com --emojis, até este valor. */
  maxEmojisWhenEnabled: 2,
};

export const DEFAULT_STYLE = {
  allowHashtags: false,
  allowEmojis: false,
};

export function tweetLength(text) {
  return [...String(text ?? "")].length;
}

export function assertWithinFreeLimit(text) {
  const len = tweetLength(text);
  if (len > X_FREE_LIMITS.maxChars) {
    throw new Error(
      `Texto com ${len} caracteres (limite Free do X: ${X_FREE_LIMITS.maxChars}).`,
    );
  }
  return text;
}

export function countHashtags(text) {
  const matches = String(text).match(/#[\p{L}\p{N}_]+/gu);
  return matches ? matches.length : 0;
}

/** Remove hashtags (#palavra). */
export function stripHashtags(text) {
  return String(text)
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Remove emojis / pictografias comuns.
 * Mantém letras, números e pontuação básica.
 */
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
