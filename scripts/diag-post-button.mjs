/**
 * Inspeciona botões do compose após fill (não publica).
 * node scripts/diag-post-button.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env") });
const session = resolve(root, ".auth/x-session.json");
const out = resolve(root, ".debug", `btn-${Date.now()}`);
mkdirSync(out, { recursive: true });
if (!existsSync(session)) throw new Error("Sem sessão");

const text =
  "Diagnostico botao Postar " +
  Date.now() +
  ". Texto curto para achar o seletor certo do botao de publicar no X.";

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

try {
  await page.goto("https://x.com/compose/post", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  const box = page.locator('[role="dialog"] [data-testid="tweetTextarea_0"]').first();
  await box.waitFor({ state: "visible", timeout: 25_000 });
  await box.click({ force: true });
  await page.keyboard.insertText(text);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(out, "01-filled.png") });

  const info = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const all = [...document.querySelectorAll("button, div[role='button'], a[role='button']")];
    const candidates = all
      .map((el) => {
        const text = (el.innerText || el.getAttribute("aria-label") || "").trim();
        const testid = el.getAttribute("data-testid");
        const inDialog = Boolean(dialog && dialog.contains(el));
        const disabled =
          el.hasAttribute("disabled") ||
          el.getAttribute("aria-disabled") === "true" ||
          el.getAttribute("tabindex") === "-1";
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          testid,
          text: text.slice(0, 60),
          aria: (el.getAttribute("aria-label") || "").slice(0, 80),
          inDialog,
          disabled,
          visible: rect.width > 0 && rect.height > 0,
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      })
      .filter(
        (b) =>
          /postar|post|tweet|publicar/i.test(b.text + " " + b.aria + " " + (b.testid || "")) ||
          /tweetButton/i.test(b.testid || ""),
      );

    const testids = [...document.querySelectorAll("[data-testid]")].map((el) =>
      el.getAttribute("data-testid"),
    );
    const uniqueTestids = [...new Set(testids)].filter((t) =>
      /tweet|post|composer|toolBar|button/i.test(t || ""),
    );

    return {
      url: location.href,
      dialogOpen: Boolean(dialog),
      composerLen: [...(dialog?.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || "")].length,
      candidates,
      uniqueTestids,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  writeFileSync(resolve(out, "buttons.json"), JSON.stringify(info, null, 2));

  // Tenta vários seletores
  const tries = [
    '[role="dialog"] [data-testid="tweetButton"]',
    '[data-testid="tweetButton"]',
    '[role="dialog"] [data-testid="tweetButtonInline"]',
    '[data-testid="tweetButtonInline"]',
    '[role="dialog"] button:has-text("Postar")',
    '[role="dialog"] div[role="button"]:has-text("Postar")',
    '[role="dialog"] [data-testid="toolBar"] [role="button"]',
  ];
  for (const sel of tries) {
    const loc = page.locator(sel).first();
    const count = await page.locator(sel).count();
    const vis = await loc.isVisible().catch(() => false);
    const en = await loc
      .evaluate((el) => {
        const n = el.closest("button") || el;
        return {
          disabled: n.disabled || n.getAttribute("aria-disabled"),
          text: (n.innerText || "").slice(0, 40),
          testid: n.getAttribute("data-testid"),
        };
      })
      .catch(() => null);
    console.log("SEL", sel, { count, vis, en });
  }

  await page.screenshot({ path: resolve(out, "02-final.png") });
  console.log("shots", out);
} catch (err) {
  console.error(err);
  await page.screenshot({ path: resolve(out, "99-error.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
