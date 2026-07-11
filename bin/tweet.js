#!/usr/bin/env node
import { loadConfig, loadOpenRouterOnly } from "../src/config.js";
import { generateTweet, transformTweet } from "../src/openrouter.js";
import { PROMPT_MODES } from "../src/prompts.js";
import { clearSession, hasSession, loginX, postTweet, whoami } from "../src/twitter.js";

function usage() {
  const modes = Object.values(PROMPT_MODES)
    .map((m) => `    ${m.id.padEnd(10)} ${m.label} (aliases: ${m.aliases.join(", ")})`)
    .join("\n");

  console.log(`
tweet-ia-cli — gera com OpenRouter e publica no X via navegador (Playwright)

Uso (PowerShell):
  npm run tweet -- login
  npm run tweet -- generate "tema"
  npm run tweet -- generate "tema" --mode english
  npm run tweet -- generate "tema" --prompt "use tom sarcástico e 1 emoji"
  npm run tweet -- transform "texto" --mode spelling
  npm run tweet -- transform "texto" --mode revise
  npm run tweet -- transform "texto" --mode english
  npm run tweet -- transform "texto" --prompt "deixe mais curto"
  npm run tweet -- post "texto"
  npm run tweet -- post "texto" --mode revise
  npm run tweet -- ai-post "tema" --mode english --yes
  npm run tweet -- logout

Comandos:
  login                 Abre o navegador; você entra no X e a sessão é salva
  logout                Apaga a sessão local
  whoami                Mostra se há sessão salva
  generate <tema>       Gera tweet com IA (não publica)
  transform <texto>     Aplica modo/prompt em um texto existente (não publica)
  post <texto>          Publica no X (opcional: --mode / --prompt antes)
  ai-post <tema>        Gera com IA e publica

Opções:
  --mode <modo>         Preset de prompt (veja lista abaixo)
  --prompt <texto>      Injeta instrução extra (pode combinar com --mode)
  --tone <tom>          Tom (padrão: direto e natural) — generate/ai-post
  --lang <idioma>       Idioma base (padrão: pt-BR) — generate/ai-post
  --yes, -y             Confirma publicação sem perguntar
  -h, --help            Mostra esta ajuda

Modos (--mode):
${modes}

Nota: automação de navegador pode quebrar se o X mudar o layout.
`.trim());
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    tone: "direto e natural",
    lang: "pt-BR",
    yes: false,
    mode: null,
    prompt: "",
  };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
    } else if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
    } else if (arg === "--tone") {
      flags.tone = args[++i];
    } else if (arg === "--lang") {
      flags.lang = args[++i];
    } else if (arg === "--mode") {
      flags.mode = args[++i];
    } else if (arg === "--prompt") {
      flags.prompt = args[++i];
    } else if (arg.startsWith("--")) {
      throw new Error(`Opção desconhecida: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (flags.tone === undefined || flags.lang === undefined) {
    throw new Error("Valor ausente para --tone ou --lang");
  }
  if (flags.mode === undefined) {
    throw new Error("Informe o modo: --mode english|spelling|revise");
  }
  if (flags.prompt === undefined) {
    throw new Error('Informe o prompt: --prompt "sua instrução"');
  }

  return {
    command: positional[0],
    rest: positional.slice(1).join(" ").trim(),
    flags,
  };
}

async function confirm(question) {
  process.stdout.write(`${question} [s/N] `);
  return await new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      const answer = String(data).trim().toLowerCase();
      resolve(answer === "s" || answer === "sim" || answer === "y" || answer === "yes");
    });
  });
}

function printText(text, label = null) {
  if (label) console.log(`\n--- ${label} ---`);
  console.log(text);
  console.log(`\n(${[...text].length}/280 caracteres)`);
}

async function maybeTransform(openrouter, text, flags) {
  if (!flags.mode && !flags.prompt) return text;
  return transformTweet(openrouter, {
    text,
    mode: flags.mode,
    prompt: flags.prompt,
  });
}

async function main() {
  const { command, rest, flags } = parseArgs(process.argv);

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
      console.log("Nenhuma sessão. Rode: npm run tweet -- login");
      return;
    }
    const me = await whoami();
    console.log(me?.username ? `Sessão ativa (@${me.username})` : "Sessão ativa (usuário desconhecido)");
    return;
  }

  if (command === "generate") {
    if (!rest) throw new Error('Informe o tema: npm run tweet -- generate "seu tema"');
    const { openrouter } = loadOpenRouterOnly();
    const text = await generateTweet(openrouter, {
      topic: rest,
      tone: flags.tone,
      lang: flags.lang,
      mode: flags.mode,
      prompt: flags.prompt,
    });
    printText(text);
    return;
  }

  if (command === "transform") {
    if (!rest) {
      throw new Error('Informe o texto: npm run tweet -- transform "texto" --mode spelling');
    }
    if (!flags.mode && !flags.prompt) {
      throw new Error("Use --mode english|spelling|revise e/ou --prompt \"...\"");
    }
    const { openrouter } = loadOpenRouterOnly();
    const text = await transformTweet(openrouter, {
      text: rest,
      mode: flags.mode,
      prompt: flags.prompt,
    });
    printText(text, "Transformado");
    return;
  }

  if (command === "post") {
    if (!rest) throw new Error('Informe o texto: npm run tweet -- post "seu tweet"');
    const { openrouter } = loadOpenRouterOnly();
    let text = rest;
    if (flags.mode || flags.prompt) {
      text = await maybeTransform(openrouter, rest, flags);
      printText(text, "Prévia");
      if (!flags.yes) {
        const ok = await confirm("Publicar este texto?");
        if (!ok) {
          console.log("Cancelado.");
          return;
        }
      }
    }
    const published = await postTweet(text);
    console.log(`Publicado via navegador${published.username ? ` (@${published.username})` : ""}.`);
    console.log(published.text);
    return;
  }

  if (command === "ai-post") {
    if (!rest) throw new Error('Informe o tema: npm run tweet -- ai-post "seu tema"');
    const config = loadConfig();
    const text = await generateTweet(config.openrouter, {
      topic: rest,
      tone: flags.tone,
      lang: flags.lang,
      mode: flags.mode,
      prompt: flags.prompt,
    });

    printText(text, "Prévia");

    if (!flags.yes) {
      const ok = await confirm("Publicar este tweet no navegador?");
      if (!ok) {
        console.log("Cancelado.");
        return;
      }
    }

    const published = await postTweet(text);
    console.log(`Publicado via navegador${published.username ? ` (@${published.username})` : ""}.`);
    return;
  }

  throw new Error(`Comando desconhecido: ${command}`);
}

main().catch((err) => {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
});
