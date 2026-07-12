#!/usr/bin/env node
import { loadConfig, loadOpenRouterOnly } from "../src/config.js";
import { getDbPath, getPost, getStats, listPosts, markPublished, savePost } from "../src/db.js";
import { DEFAULT_STYLE, describeTier, getMaxChars, getXTier, tweetLength } from "../src/limits.js";
import { generateTweet, transformTweet } from "../src/openrouter.js";
import { cascadePriceTable, formatUsd } from "../src/pricing.js";
import { PROMPT_MODES } from "../src/prompts.js";
import { clearSession, hasSession, loginX, postTweet, whoami } from "../src/twitter.js";

const COMMAND_ALIASES = {
  p: "post",
  g: "generate",
  t: "transform",
  a: "ai-post",
  c: "costs",
  costs: "costs",
  cost: "costs",
  post: "post",
  generate: "generate",
  transform: "transform",
  "ai-post": "ai-post",
  login: "login",
  logout: "logout",
  whoami: "whoami",
  history: "history",
  h: "history",
  stats: "stats",
  s: "stats",
  limits: "limits",
  limit: "limits",
};

function usage() {
  const modes = Object.values(PROMPT_MODES)
    .map((m) => `    ${m.id.padEnd(10)} ${m.label} (aliases: ${m.aliases.join(", ")})`)
    .join("\n");

  console.log(`
tweet-ia-cli — gera com OpenRouter e publica no X via navegador (Playwright)

Atalhos:
  tweet p "texto"              # post
  tweet p "texto" -r           # post + revisão
  tweet p "texto" -e           # post + inglês
  tweet p "texto" -r -e        # post + revisado em inglês
  tweet g "tema"               # generate
  tweet t "texto" -s           # transform + ortografia
  tweet costs                  # tabela de preços da cascata
  tweet history                # últimos posts salvos no SQLite
  tweet stats                  # tokens / custo acumulado
  tweet limits                 # limite de caracteres da conta

Uso:
  tweet login
  tweet p "Casamento Sangrento é bom demais" -r -e
  tweet generate "tema" --mode english
  tweet g "tema" --long        # post longo Premium (até 25.000)
  tweet logout

Comandos:
  p | post <texto>          Publica (com -r/-e/-s revisa antes)
  g | generate <tema>       Gera e pergunta se publica
  t | transform <texto>     Só transforma (não publica)
  a | ai-post <tema>        Gera e publica
  c | costs                 Lista custo por modelo (cascata)
  h | history [n]           Histórico SQLite (padrão 20)
  s | stats                 Uso de tokens e custos
  limits                    Limite de caracteres (tier atual)
  login / logout / whoami

Opções curtas:
  -r                        Revisão de texto (--mode revise)
  -e                        Inglês (--mode english)
  -r -e                     Revisado em inglês (os dois)
  -s                        Ortografia (--mode spelling)
  -y, --yes                 Publica sem perguntar
  -h, --help                Ajuda

Opções longas:
  --mode <modo>             english | spelling | revise
  --prompt <texto>          Instrução extra
  --tone <tom>              Tom (generate/ai-post)
  --lang <idioma>           Idioma base (padrão: pt-BR)
  --hashtags                Permite hashtags (padrão: off)
  --emojis                  Permite emojis (padrão: off)
  --long, -l                Orientar post longo Premium (até 25.000)

Modos:
${modes}

Conta X (.env X_ACCOUNT_TIER=premium|free):
${describeTier()}

Por padrão: sem hashtags/emojis. Premium libera até 25k chars.
Histórico/custos: .data/tweet-ia.sqlite (tweet history | tweet stats)
`.trim());
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    tone: "direto e natural",
    lang: "pt-BR",
    yes: false,
    modes: [],
    prompt: "",
    allowHashtags: false,
    allowEmojis: false,
    longForm: false,
  };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
    } else if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
    } else if (arg === "-r") {
      flags.modes.push("revise");
    } else if (arg === "-e") {
      flags.modes.push("english");
    } else if (arg === "-s") {
      flags.modes.push("spelling");
    } else if (arg === "--hashtags") {
      flags.allowHashtags = true;
    } else if (arg === "--emojis") {
      flags.allowEmojis = true;
    } else if (arg === "--long" || arg === "-l") {
      flags.longForm = true;
    } else if (arg === "--tone") {
      flags.tone = args[++i];
    } else if (arg === "--lang") {
      flags.lang = args[++i];
    } else if (arg === "--mode") {
      flags.modes.push(args[++i]);
    } else if (arg === "--prompt") {
      flags.prompt = args[++i];
    } else if (arg.startsWith("-") && arg.length > 2 && !arg.startsWith("--")) {
      // Ex.: -re → -r -e
      for (const ch of arg.slice(1)) {
        if (ch === "r") flags.modes.push("revise");
        else if (ch === "e") flags.modes.push("english");
        else if (ch === "s") flags.modes.push("spelling");
        else if (ch === "y") flags.yes = true;
        else if (ch === "l") flags.longForm = true;
        else if (ch === "h") flags.help = true;
        else throw new Error(`Opção desconhecida: -${ch}`);
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`Opção desconhecida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (flags.tone === undefined || flags.lang === undefined) {
    throw new Error("Valor ausente para --tone ou --lang");
  }
  if (flags.modes.includes(undefined)) {
    throw new Error("Informe o modo: --mode english|spelling|revise (ou -e -r -s)");
  }
  if (flags.prompt === undefined) {
    throw new Error('Informe o prompt: --prompt "sua instrução"');
  }

  const rawCommand = positional[0];
  const command = rawCommand ? COMMAND_ALIASES[rawCommand] || rawCommand : undefined;

  return {
    command,
    rest: positional.slice(1).join(" ").trim(),
    flags,
  };
}

function styleFromFlags(flags) {
  return {
    ...DEFAULT_STYLE,
    allowHashtags: Boolean(flags.allowHashtags),
    allowEmojis: Boolean(flags.allowEmojis),
    longForm: Boolean(flags.longForm),
  };
}

function hasModesOrPrompt(flags) {
  return Boolean(flags.modes?.length || flags.prompt);
}

async function confirm(question) {
  process.stdout.write(`${question} [s/N] `);
  const answer = await new Promise((resolve) => {
    const onData = (data) => {
      cleanup();
      resolve(String(data).trim().toLowerCase());
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
      process.stdin.pause();
    };
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", onData);
  });
  return answer === "s" || answer === "sim" || answer === "y" || answer === "yes";
}

function printText(text, label = null, style = DEFAULT_STYLE) {
  const tier = getXTier();
  const max = getMaxChars(style);
  if (label) console.log(`\n--- ${label} ---`);
  console.log(text);
  console.log(
    `\n(${[...text].length}/${max} caracteres — X ${tier.label}${style.longForm ? " long-form" : ""})`,
  );
}

function printCost(meta) {
  if (!meta) return;
  const u = meta.usage || {};
  console.log("\n--- Custo OpenRouter ---");
  console.log(`Modelo: ${meta.model || "n/d"}`);
  if (meta.priceLabel) console.log(`Preço:  ${meta.priceLabel}`);
  console.log(
    `Tokens: ${u.promptTokens || 0} in + ${u.completionTokens || 0} out = ${u.totalTokens || (u.promptTokens || 0) + (u.completionTokens || 0)}`,
  );
  console.log(`Custo desta chamada: ${meta.costLabel || formatUsd(meta.costUsd)}`);
}

function printCostsTable() {
  console.log("Cascata padrão — USD por 1M tokens (prompt / completion):\n");
  for (const row of cascadePriceTable()) {
    if (row.tier === "free" || (row.prompt === 0 && row.completion === 0)) {
      console.log(`  FREE  ${row.id.padEnd(42)} $0 / $0`);
    } else {
      console.log(
        `  PAID  ${row.id.padEnd(42)} $${row.prompt} / $${row.completion}`,
      );
    }
  }
  console.log("\nFluxo: tenta FREE → se 429/falha → PAID mais barato.");
  console.log("Após cada generate/transform/post -r, o custo real da chamada é exibido.");
}

function printLimits() {
  const tier = getXTier();
  const max = getMaxChars({ ...DEFAULT_STYLE, longForm: true });
  console.log(`Conta X: ${tier.label} (X_ACCOUNT_TIER)`);
  console.log(`Limite máximo por post: ${max.toLocaleString("pt-BR")} caracteres`);
  if (tier.longerPosts) {
    console.log(`Longer posts: sim (use --long / -l para orientar a IA a escrever longo)`);
    console.log(`Sugestão curta (feed): ${tier.preferredMinChars}–${tier.preferredMaxChars} chars`);
    console.log(`Sugestão longa: até ~${tier.longPreferredMaxChars.toLocaleString("pt-BR")} chars (teto ${max.toLocaleString("pt-BR")})`);
    console.log(`Feed: posts longos aparecem com "Mostrar mais" após ~280 chars`);
  } else {
    console.log("Longer posts: não (conta free)");
  }
  console.log(`\n${describeTier()}`);
}

function printHistory(limit = 20) {
  const rows = listPosts({ limit });
  if (!rows.length) {
    console.log("Nenhum post no SQLite ainda. Gere ou publique algo primeiro.");
    console.log(`DB: ${getDbPath()}`);
    return;
  }
  console.log(`Últimos ${rows.length} registros (${getDbPath()}):\n`);
  for (const r of rows) {
    const cost = formatUsd(r.cost_usd || 0);
    const preview = String(r.preview || "").replace(/\s+/g, " ").slice(0, 90);
    console.log(
      `#${r.id}  ${r.created_at}  ${String(r.status).padEnd(11)}  ${r.char_count}c  ${r.total_tokens || 0} tok  ${cost}`,
    );
    console.log(`     ${r.command || "-"} | ${r.model || "sem modelo"} | ${preview}${preview.length >= 90 ? "…" : ""}`);
  }
}

function printStats() {
  const { posts, usage, byModel, dbPath } = getStats();
  console.log(`SQLite: ${dbPath}\n`);
  console.log("--- Posts ---");
  console.log(`Total registros: ${posts.total_posts || 0}`);
  console.log(`Publicados:      ${posts.published || 0}`);
  console.log(`Não publicados:  ${posts.drafts || 0}`);
  console.log(`Chars somados:   ${posts.chars_total || 0}`);
  console.log("\n--- Tokens / custo (posts) ---");
  console.log(
    `Tokens: ${(posts.prompt_tokens || 0)} in + ${(posts.completion_tokens || 0)} out = ${posts.total_tokens || 0}`,
  );
  console.log(`Custo:  ${formatUsd(posts.cost_usd || 0)}`);
  console.log("\n--- Chamadas LLM (usage_events) ---");
  console.log(`Chamadas: ${usage.calls || 0}`);
  console.log(
    `Tokens:   ${(usage.prompt_tokens || 0)} in + ${(usage.completion_tokens || 0)} out = ${usage.total_tokens || 0}`,
  );
  console.log(`Custo:    ${formatUsd(usage.cost_usd || 0)}`);
  if (byModel?.length) {
    console.log("\n--- Por modelo ---");
    for (const m of byModel) {
      console.log(
        `  ${(m.model || "?").padEnd(48)} ${String(m.calls).padStart(3)} calls  ${String(m.total_tokens || 0).padStart(6)} tok  ${formatUsd(m.cost_usd || 0)}`,
      );
    }
  }
}

function showPostDetail(id) {
  const row = getPost(id);
  if (!row) {
    console.log(`Post #${id} não encontrado.`);
    return;
  }
  console.log(`#${row.id}  ${row.created_at}  ${row.status}  ${row.command || "-"}`);
  console.log(`Modelo: ${row.model || "n/d"} | ${row.char_count} chars | ${row.total_tokens} tok | ${formatUsd(row.cost_usd)}`);
  if (row.username) console.log(`@${row.username}${row.published_at ? ` · publicado ${row.published_at}` : ""}`);
  console.log("\n" + row.text);
}


async function maybeTransform(openrouter, text, flags) {
  if (!hasModesOrPrompt(flags)) return { text, meta: null };
  return transformTweet(openrouter, {
    text,
    modes: flags.modes,
    prompt: flags.prompt,
    style: styleFromFlags(flags),
  });
}

async function main() {
  const { command, rest, flags } = parseArgs(process.argv);
  const style = styleFromFlags(flags);

  if (!command || flags.help) {
    usage();
    process.exit(command ? 0 : 1);
  }

  if (command === "login") {
    await loginX();
    return;
  }

  if (command === "logout") {
    clearSession();
    console.log("Sessão removida.");
    return;
  }

  if (command === "whoami") {
    if (!hasSession()) {
      console.log("Nenhuma sessão. Rode: tweet login");
      return;
    }
    const me = await whoami();
    console.log(me?.username ? `Sessão ativa (@${me.username})` : "Sessão ativa (usuário desconhecido)");
    return;
  }

  if (command === "costs") {
    printCostsTable();
    return;
  }

  if (command === "limits") {
    printLimits();
    return;
  }

  if (command === "history") {
    if (rest && /^\d+$/.test(rest.trim())) {
      const idOrLimit = Number(rest.trim());
      // tweet history 5 → limit; tweet history #12 or detail if asking show?
      // Convention: history [limit] ; history show <id> via rest "show 3"
      printHistory(idOrLimit);
      return;
    }
    if (rest?.startsWith("show ")) {
      showPostDetail(rest.slice(5).trim());
      return;
    }
    if (rest && /^#?\d+$/.test(rest.trim())) {
      showPostDetail(rest.replace("#", "").trim());
      return;
    }
    printHistory(20);
    return;
  }

  if (command === "stats") {
    printStats();
    return;
  }

  if (command === "generate") {
    if (!rest) throw new Error('Informe o tema: tweet g "seu tema"');
    const { openrouter } = loadOpenRouterOnly();
    const { text, meta } = await generateTweet(openrouter, {
      topic: rest,
      tone: flags.tone,
      lang: flags.lang,
      modes: flags.modes,
      prompt: flags.prompt,
      style,
    });
    printText(text, "Prévia", style);
    printCost(meta);

    const postId = savePost({
      command: "generate",
      status: "generated",
      text,
      meta,
      topic: rest,
      lang: flags.lang,
      tone: flags.tone,
      modes: flags.modes,
      longForm: flags.longForm,
      purpose: "generate",
    });
    console.log(`Salvo no SQLite (#${postId}).`);

    if (flags.yes) {
      const published = await postTweet(text);
      markPublished(postId, { username: published.username });
      console.log(`Publicado via navegador${published.username ? ` (@${published.username})` : ""}.`);
      return;
    }

    const ok = await confirm("Publicar este tweet no X?");
    if (!ok) {
      console.log("Não publicado. Texto mantido acima.");
      return;
    }

    const published = await postTweet(text);
    markPublished(postId, { username: published.username });
    console.log(`Publicado via navegador${published.username ? ` (@${published.username})` : ""}.`);
    return;
  }

  if (command === "transform") {
    if (!rest) {
      throw new Error('Informe o texto: tweet t "texto" -r');
    }
    if (!hasModesOrPrompt(flags)) {
      throw new Error("Use -r / -e / -s / --mode e/ou --prompt \"...\"");
    }
    const { openrouter } = loadOpenRouterOnly();
    const { text, meta } = await transformTweet(openrouter, {
      text: rest,
      modes: flags.modes,
      prompt: flags.prompt,
      style,
    });
    printText(text, "Transformado", style);
    printCost(meta);
    const postId = savePost({
      command: "transform",
      status: "transformed",
      text,
      meta,
      modes: flags.modes,
      longForm: flags.longForm,
      purpose: "transform",
    });
    console.log(`Salvo no SQLite (#${postId}).`);
    return;
  }

  if (command === "post") {
    if (!rest) throw new Error('Informe o texto: tweet p "seu tweet"');
    const { openrouter } = loadOpenRouterOnly();
    let text = rest;
    let meta = null;
    let postId = null;
    if (hasModesOrPrompt(flags)) {
      const result = await maybeTransform(openrouter, rest, flags);
      text = result.text;
      meta = result.meta;
      printText(text, "Prévia", style);
      printCost(meta);
      postId = savePost({
        command: "post",
        status: "generated",
        text,
        meta,
        modes: flags.modes,
        longForm: flags.longForm,
        purpose: "transform",
      });
      console.log(`Salvo no SQLite (#${postId}).`);
      if (!flags.yes) {
        const ok = await confirm("Publicar este texto?");
        if (!ok) {
          console.log("Cancelado.");
          return;
        }
      }
    }
    const published = await postTweet(text);
    if (postId) {
      markPublished(postId, { username: published.username });
    } else {
      postId = savePost({
        command: "post",
        status: "published",
        text,
        username: published.username,
        longForm: flags.longForm || tweetLength(text) > 280,
      });
    }
    console.log(`Publicado via navegador${published.username ? ` (@${published.username})` : ""}.`);
    console.log(`SQLite #${postId}`);
    console.log(published.text);
    return;
  }

  if (command === "ai-post") {
    if (!rest) throw new Error('Informe o tema: tweet a "seu tema"');
    const config = loadConfig();
    const { text, meta } = await generateTweet(config.openrouter, {
      topic: rest,
      tone: flags.tone,
      lang: flags.lang,
      modes: flags.modes,
      prompt: flags.prompt,
      style,
    });

    printText(text, "Prévia", style);
    printCost(meta);

    const postId = savePost({
      command: "ai-post",
      status: "generated",
      text,
      meta,
      topic: rest,
      lang: flags.lang,
      tone: flags.tone,
      modes: flags.modes,
      longForm: flags.longForm,
      purpose: "generate",
    });
    console.log(`Salvo no SQLite (#${postId}).`);

    if (!flags.yes) {
      const ok = await confirm("Publicar este tweet no navegador?");
      if (!ok) {
        console.log("Cancelado.");
        return;
      }
    }

    const published = await postTweet(text);
    markPublished(postId, { username: published.username });
    console.log(`Publicado via navegador${published.username ? ` (@${published.username})` : ""}.`);
    return;
  }

  throw new Error(`Comando desconhecido: ${command}. Use tweet --help`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  });
