/**
 * Valida abertura do modal + fill (NÃO publica).
 * node scripts/diag-modal-fill.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env") });
const session = resolve(root, ".auth/x-session.json");
const out = resolve(root, ".debug", `fix-modal-${Date.now()}`);
mkdirSync(out, { recursive: true });

if (!existsSync(session)) throw new Error("Sem sessão. Rode: tweet login");

const text =
  "Teste fix modal " +
  Date.now() +
  ". Observabilidade: escreva codigo pensando nela desde o inicio. Monitore causa, nao so sintoma. Transforme dados em acao.";

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--disable-blink-features=AutomationControlled"],
}).catch(() => chromium.launch({ headless: false }));

const ctx = await browser.newContext({
  storageState: session,
  locale: "pt-BR",
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();

async function dismiss() {
  const has = await page
    .locator('[role="dialog"] [data-testid="tweetTextarea_0"]')
    .isVisible()
    .catch(() => false);
  const compose = page.url().includes("/compose/");
  if (has || compose) {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-testid="mask"]')) {
        el.style.pointerEvents = "none";
      }
    });
  }
}

try {
  await page.goto("https://x.com/compose/post", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await dismiss();
  await page
    .locator('[role="dialog"] [data-testid="tweetTextarea_0"]')
    .waitFor({ state: "visible", timeout: 25_000 });
  await page.screenshot({ path: resolve(out, "01-open.png") });

  const dialogOpen = await page
    .locator('[role="dialog"] [data-testid="tweetTextarea_0"]')
    .isVisible();
  console.log("dialogOpen", dialogOpen, "url", page.url());

  await page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]').click({ force: true });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(text);
  await page.waitForTimeout(1000);

  const dump = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]');
    const b = document.querySelector('[role="dialog"] [data-testid="tweetButton"]');
    const t = root?.innerText || "";
    return {
      len: [...t].length,
      btnDisabled: !!(b?.disabled || b?.getAttribute("aria-disabled") === "true"),
      head: t.slice(0, 80),
    };
  });
  console.log("fill", dump);
  await page.screenshot({ path: resolve(out, "02-filled.png") });

  // Simula o bug antigo: Escape com mask
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const afterEsc = await page
    .locator('[role="dialog"] [data-testid="tweetTextarea_0"]')
    .isVisible()
    .catch(() => false);
  console.log("after Escape (should close):", afterEsc);
  await page.screenshot({ path: resolve(out, "03-after-escape.png") });

  if (!dialogOpen || dump.len < 50 || dump.btnDisabled) {
    console.error("FAIL");
    process.exitCode = 1;
  } else {
    console.log("PASS modal+fill (Escape fecha o modal — por isso removemos Escape do dismiss)");
  }
} catch (err) {
  console.error("DIAG FAIL", err);
  await page.screenshot({ path: resolve(out, "99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  console.log("shots", out);
}
