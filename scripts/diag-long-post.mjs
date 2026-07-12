/**
 * Diagnóstico long-post Premium (após fix do Draft.js).
 * node scripts/diag-long-post.mjs
 * node scripts/diag-long-post.mjs --no-publish
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env") });

const session = resolve(root, ".auth/x-session.json");
const outDir = resolve(root, ".debug", `long-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const publish = !process.argv.includes("--no-publish");
if (!existsSync(session)) throw new Error("Sem sessão. Rode: tweet login");

const marker = `DIAG${Date.now()}`;
const sample = [
  `Marcador ${marker} — início do diagnóstico de post longo Premium.`,
  "",
  "Aos poucos, com a experiência, percebi que muitos dos problemas que vi nas empresas tinham raiz em falhas de observabilidade.",
  "",
  "Apesar de ferramentas específicas existirem, muitos ainda ignoram logs, filas de banco, métricas e telemetria. Sem isso, qualquer sistema vira um caos quando algo dá errado — e a equipe perde horas caçando sintomas em vez de causas.",
  "",
  "Três lições que aprendi na prática:",
  "",
  "1. Crie código pensando em observabilidade. Instrumente desde o início, não depois do incidente.",
  "",
  "2. Trate logs como um produto. Estruture-os com clareza, contexto e propósito. Log sem correlação é ruído.",
  "",
  "3. Invista em cultura, não só em ferramentas. Treine a equipe a ler dashboards e a escrever alertas acionáveis.",
  "",
  "Observabilidade não é luxo de big tech. É o mínimo para operar software com responsabilidade. Se você não consegue responder “o que quebrou, onde e por quê” em minutos, você não tem observabilidade — tem sorte.",
  "",
  "Ferramentas ajudam. Cultura sustenta. Métricas sem dono viram decoração. Traces sem sampling inteligente viram custo. Logs sem retenção viram amnésia.",
  "",
  `Marcador ${marker} — fim do texto. Se isto aparecer no post publicado, o corpo longo chegou intacto.`,
].join("\n");

console.log("expected chars", [...sample].length);
console.log("marker", marker);
console.log("publish", publish);
console.log("shots ->", outDir);

const launchArgs = ["--disable-blink-features=AutomationControlled"];
let browser;
try {
  browser = await chromium.launch({ headless: false, args: launchArgs });
} catch {
  console.warn("Usando channel:chrome");
  browser = await chromium.launch({ headless: false, channel: "chrome", args: launchArgs });
}

const context = await browser.newContext({
  storageState: session,
  locale: "pt-BR",
  viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();

const networkLog = [];
page.on("request", (req) => {
  const url = req.url();
  if (!/CreateTweet|CreateNoteTweet/i.test(url)) return;
  let postData = req.postData() || "";
  try {
    const parsed = JSON.parse(postData);
    const tweetText =
      parsed?.variables?.tweet_text ||
      parsed?.variables?.note_tweet?.text ||
      null;
    const dump = {
      url: url.slice(0, 180),
      tweet_text_len: tweetText ? [...String(tweetText)].length : null,
      head: tweetText?.slice?.(0, 120) || null,
      tail: tweetText?.slice?.(-120) || null,
      keys: parsed?.variables ? Object.keys(parsed.variables) : null,
      raw: postData.slice(0, 3000),
    };
    networkLog.push({ type: "request", ...dump });
    writeFileSync(resolve(outDir, "create-tweet-request.json"), JSON.stringify(dump, null, 2));
    console.log("CreateTweet len:", dump.tweet_text_len);
  } catch {
    writeFileSync(resolve(outDir, "create-tweet-request-raw.txt"), postData.slice(0, 8000));
  }
});

async function shot(name) {
  await page.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: false });
  console.log("shot", name);
}

async function dumpComposer() {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const root = dialog && dialog.querySelector('[data-testid="tweetTextarea_0"]');
    const text = root?.innerText || "";
    const progress = [...document.querySelectorAll('[role="progressbar"]')].map((el) => ({
      max: el.getAttribute("aria-valuemax"),
      now: el.getAttribute("aria-valuenow"),
    }));
    const buttons = [
      ...document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'),
    ].map((b) => ({
      testid: b.getAttribute("data-testid"),
      disabled: b.hasAttribute("disabled") || b.getAttribute("aria-disabled"),
      text: (b.innerText || "").slice(0, 40),
    }));
    return {
      composerLen: [...text].length,
      head: text.slice(0, 140),
      tail: text.slice(-140),
      hasStart: /início do diagnóstico/.test(text),
      hasEnd: /fim do texto/.test(text),
      progress,
      buttons,
      url: location.href,
      dialogOpen: Boolean(dialog && root),
    };
  });
}

/** Mesmo método do twitter.js — linhas + insertParagraph */
async function fillParagraphs(value) {
  return page.evaluate((text) => {
    const dialog = document.querySelector('[role="dialog"]');
    const root = dialog && dialog.querySelector('[data-testid="tweetTextarea_0"]');
    if (!root) return { ok: false, len: 0 };
    root.focus();
    document.execCommand("selectAll", false);
    document.execCommand("delete", false);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        document.execCommand("insertParagraph", false) ||
          document.execCommand("insertHTML", false, "<br>") ||
          document.execCommand("insertText", false, "\n");
      }
      if (lines[i].length) document.execCommand("insertText", false, lines[i]);
    }
    return { ok: true, len: [...(root.innerText || "")].length };
  }, value);
}

try {
  await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]').waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await shot("01-compose-empty");

  await page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]').click({ force: true });
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(150);
  await page.keyboard.insertText(sample);
  console.log("fill via keyboard.insertText");
  await page.waitForTimeout(1500); // settle Draft.js
  await shot("02-after-fill-settled");

  let info = await dumpComposer();
  console.log("dump", JSON.stringify(info, null, 2));
  writeFileSync(resolve(outDir, "dump-after-fill.json"), JSON.stringify(info, null, 2));

  if (!info.dialogOpen || !info.hasStart || !info.hasEnd || info.composerLen < [...sample].length * 0.85) {
    throw new Error(
      `Fill incompleto após settle: ${info.composerLen} start=${info.hasStart} end=${info.hasEnd} dialog=${info.dialogOpen}`,
    );
  }
  const btnDisabled = info.buttons.find((b) => b.testid === "tweetButton")?.disabled;
  if (btnDisabled === true || btnDisabled === "true") {
    throw new Error("Postar ainda desabilitado após fill — Draft.js não registrou o texto.");
  }

  await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]');
    if (root) root.scrollTop = root.scrollHeight;
  });
  await shot("03-scrolled-end");

  if (!publish) {
    console.log("--no-publish");
  } else {
    const btn = page.locator('[role="dialog"] [data-testid="tweetButton"]');
    await btn.click({ timeout: 15_000 });
    await page.waitForTimeout(2000);
    await shot("04-after-post-click");

    if (await page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]').isVisible().catch(() => false)) {
      await page.keyboard.press("Control+Enter");
      await page.waitForTimeout(2500);
      await shot("05-after-ctrl-enter");
    }

    writeFileSync(resolve(outDir, "network.json"), JSON.stringify(networkLog, null, 2));

    await page.goto(`https://x.com/MaikonWeber1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    await shot("06-profile");

    const found = await page.evaluate((m) => {
      for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
        const t = a.innerText || "";
        if (t.includes(m)) {
          return {
            found: true,
            len: [...t].length,
            hasEnd: /fim do texto/.test(t),
            hasShowMore: /mostrar mais|show more/i.test(t),
            head: t.slice(0, 180),
            tail: t.slice(-180),
          };
        }
      }
      return { found: false };
    }, marker);
    console.log("profile lookup", found);
    writeFileSync(resolve(outDir, "profile-lookup.json"), JSON.stringify(found, null, 2));
    if (found.found) await shot("07-tweet-found");
  }

  console.log("OK expected", [...sample].length, "got", info.composerLen);
  console.log("outdir", outDir);
} catch (err) {
  console.error("DIAG FAIL", err);
  await shot("99-error").catch(() => {});
  writeFileSync(resolve(outDir, "error.txt"), String(err?.stack || err));
  process.exitCode = 1;
} finally {
  await browser.close();
  console.log("done", outDir);
}
