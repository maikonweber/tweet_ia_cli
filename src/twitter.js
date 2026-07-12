import { chromium } from "playwright";
import { existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadBrowserConfig, PROJECT_ROOT } from "./config.js";
import { assertWithinLimit } from "./limits.js";

const AUTH_DIR = resolve(PROJECT_ROOT, ".auth");
const SESSION_PATH = resolve(AUTH_DIR, "x-session.json");
const META_PATH = resolve(AUTH_DIR, "x-meta.json");

const SELECTORS = {
  composer: '[data-testid="tweetTextarea_0"]',
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  sideNavPost: '[data-testid="SideNav_NewTweet_Button"]',
  mask: '[data-testid="mask"]',
  dialog: '[role="dialog"]',
};

function ensureAuthDir() {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
}

export function hasSession() {
  return existsSync(SESSION_PATH);
}

export function clearSession() {
  if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH);
  if (existsSync(META_PATH)) unlinkSync(META_PATH);
}

export function getSessionUsername() {
  if (!existsSync(META_PATH)) return null;
  try {
    return JSON.parse(readFileSync(META_PATH, "utf8"))?.username || null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function launchBrowser() {
  const { headless } = loadBrowserConfig();
  try {
    return await chromium.launch({
      headless,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch {
    return chromium.launch({
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
}

async function newContext(browser, withSession) {
  const options = {
    viewport: { width: 1365, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
  if (withSession && hasSession()) {
    options.storageState = SESSION_PATH;
  }
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context;
}

async function gotoWithRetry(page, url, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      return;
    } catch (err) {
      lastError = err;
      const msg = String(err.message || err);
      const retryable =
        msg.includes("ERR_CONNECTION_ABORTED") ||
        msg.includes("ERR_CONNECTION_RESET") ||
        msg.includes("ERR_NETWORK_CHANGED") ||
        msg.includes("Timeout") ||
        msg.includes("NS_ERROR_NET");
      if (!retryable || i === attempts) break;
      console.log(`Navegação falhou (${i}/${attempts}): tentando de novo...`);
      await sleep(1500 * i);
    }
  }
  throw lastError;
}

async function waitForLogin(page, timeoutMs = 5 * 60_000) {
  await page.waitForSelector(SELECTORS.accountSwitcher, { timeout: timeoutMs });
}

async function readUsername(page) {
  try {
    const label = await page.locator(SELECTORS.accountSwitcher).getAttribute("aria-label");
    if (label) {
      const at = label.match(/@([A-Za-z0-9_]+)/);
      if (at) return at[1];
    }
  } catch {
    // ignore
  }
  return null;
}

function assertLoggedIn(page) {
  const url = page.url();
  if (url.includes("/login") || url.includes("/i/flow/login")) {
    throw new Error("Sessão expirada. Rode: tweet login");
  }
}

async function closeBrowser(browser, context) {
  try {
    if (context) await context.close().catch(() => {});
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      try {
        browser.process()?.kill?.();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Preferir composer do modal — o da home fica atrás do mask e quebra no headless.
 */
function composerLocator(page) {
  return page
    .locator(`${SELECTORS.dialog} ${SELECTORS.composer}`)
    .or(page.locator(SELECTORS.composer))
    .last();
}

function postButtonLocator(page) {
  return page
    .locator(`${SELECTORS.dialog} [data-testid="tweetButton"]`)
    .or(page.locator('[data-testid="tweetButton"]'))
    .or(page.locator('[data-testid="tweetButtonInline"]'))
    .or(page.getByRole("button", { name: /^(Postar|Post|Tweetar|Tweet)$/i }))
    .last();
}

/** Fecha dialogs extras; se o compose já abriu, mantém. */
async function dismissBlockingLayers(page) {
  for (let i = 0; i < 3; i++) {
    const dialogComposer = page.locator(`${SELECTORS.dialog} ${SELECTORS.composer}`);
    if (await dialogComposer.isVisible().catch(() => false)) return;

    const maskVisible = await page.locator(SELECTORS.mask).first().isVisible().catch(() => false);
    if (!maskVisible) break;

    await page.keyboard.press("Escape").catch(() => {});
    await sleep(300);
  }

  // Mask órfão ainda interceptando clique (headless)
  await page
    .evaluate(() => {
      for (const el of document.querySelectorAll('[data-testid="mask"]')) {
        const dialog = document.querySelector('[role="dialog"]');
        const dialogOpen = dialog && dialog.querySelector('[data-testid="tweetTextarea_0"]');
        if (dialogOpen) {
          el.style.pointerEvents = "none";
        } else {
          el.style.display = "none";
          el.style.pointerEvents = "none";
        }
      }
    })
    .catch(() => {});
}

async function focusComposer(page) {
  const box = composerLocator(page);
  await box.waitFor({ state: "visible", timeout: 30_000 });
  await dismissBlockingLayers(page);

  try {
    await box.click({ delay: 40, timeout: 5_000 });
  } catch {
    await box.evaluate((el) => {
      el.focus();
      try {
        el.click();
      } catch {
        // ignore
      }
    });
  }
  await sleep(250);
}

async function openComposer(page) {
  await dismissBlockingLayers(page);

  if (await page.locator(`${SELECTORS.dialog} ${SELECTORS.composer}`).isVisible().catch(() => false)) {
    return;
  }

  const sideNav = page.locator(SELECTORS.sideNavPost);
  if (await sideNav.isVisible().catch(() => false)) {
    try {
      await sideNav.click({ timeout: 8_000 });
    } catch {
      await sideNav.click({ force: true });
    }
    await composerLocator(page).waitFor({ state: "visible", timeout: 20_000 });
    await dismissBlockingLayers(page);
    return;
  }

  await page.keyboard.press("n");
  try {
    await composerLocator(page).waitFor({ state: "visible", timeout: 10_000 });
    await dismissBlockingLayers(page);
    return;
  } catch {
    // continua
  }

  await gotoWithRetry(page, "https://x.com/compose/post");
  await composerLocator(page).waitFor({ state: "visible", timeout: 20_000 });
  await dismissBlockingLayers(page);
}

async function fillComposer(page, text) {
  await focusComposer(page);

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await sleep(150);

  const inserted = await page.evaluate((value) => {
    const dialog = document.querySelector('[role="dialog"]');
    const el =
      (dialog && dialog.querySelector('[data-testid="tweetTextarea_0"]')) ||
      [...document.querySelectorAll('[data-testid="tweetTextarea_0"]')].at(-1) ||
      document.querySelector('[role="textbox"][contenteditable="true"]');
    if (!el) return false;
    el.focus();
    const ok = document.execCommand("insertText", false, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    return ok || (el.innerText || "").includes(value.slice(0, Math.min(12, value.length)));
  }, text);

  if (!inserted) {
    await page.keyboard.type(text, { delay: 12 });
  }

  await sleep(400);
}

async function clickPost(page) {
  const btn = postButtonLocator(page);
  await btn.waitFor({ state: "visible", timeout: 30_000 });

  for (let i = 0; i < 20; i++) {
    const enabled = await btn
      .evaluate((el) => {
        const node = el.closest("button") || el;
        return !node.disabled && node.getAttribute("aria-disabled") !== "true";
      })
      .catch(() => false);
    if (enabled) break;
    await sleep(250);
  }

  await dismissBlockingLayers(page);

  try {
    await btn.click({ timeout: 8_000 });
  } catch {
    await btn.click({ force: true, timeout: 8_000 });
  }

  await sleep(500);
  await page.keyboard.press("Control+Enter").catch(() => {});
  await sleep(1000);
}

export async function loginX() {
  ensureAuthDir();
  let browser;
  let context;
  try {
    browser = await launchBrowser();
    context = await newContext(browser, false);
    const page = await context.newPage();

    console.log("Abrindo x.com — faça login na sua conta (até 5 minutos).");
    await gotoWithRetry(page, "https://x.com/i/flow/login");

    try {
      await waitForLogin(page);
    } catch {
      throw new Error("Tempo esgotado. Faça login e rode de novo: tweet login");
    }

    await gotoWithRetry(page, "https://x.com/home");
    await waitForLogin(page, 60_000);

    const username = await readUsername(page);
    await context.storageState({ path: SESSION_PATH });
    writeFileSync(
      META_PATH,
      JSON.stringify({ username, savedAt: new Date().toISOString() }, null, 2),
    );

    console.log(username ? `Sessão salva (@${username}).` : "Sessão salva.");
    return { username };
  } finally {
    await closeBrowser(browser, context);
  }
}

export async function postTweet(text) {
  if (!text || !text.trim()) {
    throw new Error("Texto do tweet vazio.");
  }
  assertWithinLimit(text.trim());
  if (!hasSession()) {
    throw new Error("Sem sessão. Rode antes: tweet login");
  }

  let browser;
  let context;
  try {
    browser = await launchBrowser();
    context = await newContext(browser, true);
    const page = await context.newPage();

    await gotoWithRetry(page, "https://x.com/home");
    assertLoggedIn(page);

    await page
      .locator(SELECTORS.accountSwitcher)
      .waitFor({ state: "visible", timeout: 45_000 })
      .catch(() => {
        throw new Error("Sessão inválida ou página não carregou. Rode: tweet login");
      });

    await dismissBlockingLayers(page);
    await openComposer(page);
    await fillComposer(page, text.trim());
    await clickPost(page);
    await sleep(2000);

    await context.storageState({ path: SESSION_PATH });

    return {
      ok: true,
      username: getSessionUsername(),
      text: text.trim(),
    };
  } finally {
    await closeBrowser(browser, context);
  }
}

export async function whoami() {
  if (!hasSession()) return null;
  return { username: getSessionUsername() };
}
