import { applyStyleGuards, DEFAULT_STYLE, tweetLength } from "./limits.js";

const PREAMBLE_RE =
  /^(aqui est[aá]( o)? (o )?(tweet|post|texto)[:\s-]*|sure[,!]?\s*|here('s| is) (your )?(tweet|post)[:\s-]*|claro[,!]?\s*|segue( o texto)?[:\s-]*)/i;

/**
 * Garante saída pronta para publicar no X (rede social), não artigo/markdown/ChatGPT.
 */
export function sanitizeForX(raw, style = DEFAULT_STYLE) {
  let text = String(raw ?? "").replace(/\r\n/g, "\n").trim();

  // Remove cercas de código / markdown pesado
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/_([^_]+)_/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^>\s+/gm, "");
  text = text.replace(/^[-*]\s+/gm, "• ");
  text = text.replace(/^\d+\.\s+/gm, (m, offset, str) => {
    // Mantém listas numeradas simples (ok no X); só limpa markdown excessivo
    return m;
  });

  // Remove aspas envolvendo o post inteiro
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("“") && text.endsWith("”"))
  ) {
    text = text.slice(1, -1).trim();
  }

  // Remove preâmbulos típicos de LLM
  const lines = text.split("\n");
  if (lines.length && PREAMBLE_RE.test(lines[0].trim())) {
    lines.shift();
    text = lines.join("\n").trim();
  }

  // Remove linhas de meta ("(120 caracteres)", "Espero que ajude")
  text = text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^\(?\d+\s*\/?\s*\d*\s*caracteres?\)?\.?$/i.test(t)) return false;
      if (/^(espero que ajude|let me know|posso ajudar)/i.test(t)) return false;
      if (/^-{3,}$/.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();

  // Colapsa espaços excessivos, preserva quebras de parágrafo
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");

  text = applyStyleGuards(text, style);

  return text.trim();
}

export function looksLikeSocialPost(text) {
  if (!text || !tweetLength(text)) return false;
  // Rejeita se ainda parecer markdown/código
  if (/```/.test(text)) return false;
  if (/^#{1,6}\s/m.test(text)) return false;
  if (/^\s*\|.+\|/m.test(text)) return false; // tabela markdown
  return true;
}
