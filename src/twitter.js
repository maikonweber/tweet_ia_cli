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
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "https://x.com",
    });
  } catch {
    // ignore
  }
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
 * Preferir composer do modal /compose/post — nunca o inline da home.
 */
function modalComposerLocator(page) {
  return page.locator(`${SELECTORS.dialog} ${SELECTORS.composer}`).first();
}

function composerLocator(page) {
  return modalComposerLocator(page).or(page.locator(SELECTORS.composer).last());
}

function postButtonLocator(page) {
  return page
    .locator(`${SELECTORS.dialog} [data-testid="tweetButton"]`)
    .or(page.locator('[data-testid="tweetButton"]'))
    .or(page.locator('[data-testid="tweetButtonInline"]'))
    .or(page.getByRole("button", { name: /^(Postar|Post|Tweetar|Tweet)$/i }))
    .first();
}

function isComposeUrl(page) {
  return /\/compose\//i.test(page.url());
}

async function hasModalComposer(page) {
  return modalComposerLocator(page).isVisible().catch(() => false);
}

/** Fecha overlays sem Escape (Escape fecha o compose e causa o crash). */
async function dismissBlockingLayers(page) {
  // Se o compose já está aberto, só desativa o mask — nunca Escape.
  if (await hasModalComposer(page) || isComposeUrl(page)) {
    await page
      .evaluate(() => {
        for (const el of document.querySelectorAll('[data-testid="mask"]')) {
          el.style.pointerEvents = "none";
        }
      })
      .catch(() => {});
    return;
  }

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
      // Cookie / consent banners comuns
      for (const btn of document.querySelectorAll('[data-testid="sheetDialog"] [role="button"], [aria-label*="Close" i], [aria-label*="Fechar" i]')) {
        const t = (btn.innerText || btn.getAttribute("aria-label") || "").toLowerCase();
        if (/aceitar|accept|close|fechar|dismiss|got it/i.test(t)) {
          try {
            btn.click();
          } catch {
            // ignore
          }
        }
      }
    })
    .catch(() => {});
}

function contentEditableLocator(page) {
  // Preferir SEMPRE o do dialog — .last() caía no composer da home
  return page
    .locator(`${SELECTORS.dialog} ${SELECTORS.composer}[contenteditable="true"]`)
    .or(page.locator(`${SELECTORS.dialog} ${SELECTORS.composer} [contenteditable="true"]`))
    .or(page.locator(`${SELECTORS.dialog} ${SELECTORS.composer}`))
    .first();
}

async function focusComposer(page) {
  await ensureComposerOpen(page);
  const box = contentEditableLocator(page);
  await box.waitFor({ state: "visible", timeout: 30_000 });
  await dismissBlockingLayers(page);

  try {
    await box.click({ delay: 50, timeout: 8_000 });
  } catch {
    await box.click({ force: true, timeout: 5_000 }).catch(async () => {
      await box.evaluate((el) => el.focus());
    });
  }
  await sleep(350);
}

async function openComposer(page) {
  await dismissBlockingLayers(page);

  if (await hasModalComposer(page)) return;

  // Ir direto ao compose — mais confiável que home + atalho
  await gotoWithRetry(page, "https://x.com/compose/post");
  await sleep(800);
  await dismissBlockingLayers(page);

  try {
    await modalComposerLocator(page).waitFor({ state: "visible", timeout: 25_000 });
    await dismissBlockingLayers(page);
    return;
  } catch {
    console.error("Aviso: /compose/post sem dialog — tentando botão Postar / tecla n…");
  }

  // Fallback: home + abrir modal
  await gotoWithRetry(page, "https://x.com/home");
  await page.locator(SELECTORS.accountSwitcher).waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
  await dismissBlockingLayers(page);

  const sideNav = page.locator(SELECTORS.sideNavPost);
  if (await sideNav.isVisible().catch(() => false)) {
    try {
      await sideNav.click({ timeout: 8_000 });
    } catch {
      await sideNav.click({ force: true });
    }
  } else {
    await page.keyboard.press("n");
  }

  await modalComposerLocator(page).waitFor({ state: "visible", timeout: 25_000 });
  await dismissBlockingLayers(page);
}

async function ensureComposerOpen(page) {
  if (await hasModalComposer(page)) {
    await dismissBlockingLayers(page);
    return;
  }
  console.error("Aviso: modal fechou — reabrindo /compose/post…");
  await openComposer(page);
  if (!(await hasModalComposer(page))) {
    throw new Error(
      "Composer modal não está aberto. Posts longos no composer da home falham no Draft.js.",
    );
  }
}

async function assertModalComposer(page) {
  await ensureComposerOpen(page);
}

/** Raiz do editor só dentro do dialog (nunca home). */
async function readComposerText(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const root =
      (dialog && dialog.querySelector('[data-testid="tweetTextarea_0"]')) ||
      (dialog && dialog.querySelector('[data-testid^="tweetTextarea_"]'));
    if (!root) return "";
    const editable =
      root.getAttribute?.("contenteditable") === "true"
        ? root
        : root.querySelector?.('[contenteditable="true"]') || root;
    return (editable.innerText || editable.textContent || "").replace(/\n$/, "");
  });
}

async function fillViaExecCommand(page, text) {
  return page.evaluate((value) => {
    const dialog = document.querySelector('[role="dialog"]');
    const root =
      (dialog && dialog.querySelector('[data-testid="tweetTextarea_0"]')) ||
      (dialog && dialog.querySelector('[data-testid^="tweetTextarea_"]'));
    if (!root) return { ok: false, len: 0, reason: "no-modal" };
    root.focus();
    document.execCommand("selectAll", false);
    const ok = document.execCommand("insertText", false, value);
    return { ok, len: [...(root.innerText || "")].length };
  }, text);
}

async function clearComposer(page) {
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await sleep(150);
}

/**
 * Playwright keyboard.insertText usa InputEvent/CDP — Draft.js registra o estado
 * e habilita o botão Postar. execCommand sozinho preenche o DOM mas deixa Postar disabled.
 */
async function fillViaKeyboardInsert(page, text) {
  await focusComposer(page);
  await clearComposer(page);
  await page.keyboard.insertText(text);
  return { ok: true };
}

async function fillViaClipboardPaste(page, text) {
  await focusComposer(page);
  await clearComposer(page);
  const written = await page
    .evaluate(async (value) => {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        return false;
      }
    }, text)
    .catch(() => false);
  if (!written) {
    // fallback CDP sem permissão de clipboard
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "https://x.com",
    }).catch(() => {});
    await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value);
    }, text);
  }
  await page.keyboard.press("Control+V");
  return { ok: true };
}

/**
 * InsertText de um bloco longo com \\n via execCommand costuma colapsar no Draft.js
 * OU deixar o botão Postar desabilitado (DOM visual sem ContentState).
 */
async function fillViaParagraphs(page, text) {
  return page.evaluate((value) => {
    const dialog = document.querySelector('[role="dialog"]');
    const root =
      (dialog && dialog.querySelector('[data-testid="tweetTextarea_0"]')) ||
      (dialog && dialog.querySelector('[data-testid^="tweetTextarea_"]'));
    if (!root) return { ok: false, len: 0, reason: "no-modal" };
    root.focus();
    document.execCommand("selectAll", false);
    document.execCommand("delete", false);

    const lines = value.replace(/\r\n/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        document.execCommand("insertParagraph", false) ||
          document.execCommand("insertHTML", false, "<br>") ||
          document.execCommand("insertText", false, "\n");
      }
      if (lines[i].length) {
        document.execCommand("insertText", false, lines[i]);
      }
    }
    return { ok: true, len: [...(root.innerText || "")].length };
  }, text);
}

async function settledComposerLen(page, expectedLen) {
  // Draft.js reconcilia depois do insert — ler cedo demais dá falso positivo.
  let len = 0;
  for (let i = 0; i < 5; i++) {
    await sleep(350);
    len = [...(await readComposerText(page))].length;
    if (len >= Math.floor(expectedLen * 0.85)) return len;
  }
  return len;
}

async function isPostButtonEnabled(page) {
  const locators = [
    page.locator(`${SELECTORS.dialog} [data-testid="tweetButton"]`).first(),
    page.locator('[data-testid="tweetButton"]').first(),
  ];
  for (const loc of locators) {
    const enabled = await loc
      .evaluate((el) => {
        const node = el.closest("button") || el;
        return !node.disabled && node.getAttribute("aria-disabled") !== "true";
      })
      .catch(() => null);
    if (enabled === true) return true;
    if (enabled === false) return false;
  }
  return false;
}

/**
 * Longer posts Premium: prefer keyboard.insertText / clipboard (habilitam Postar).
 * Sempre no modal /compose/post; validar head+tail após settle.
 */
async function fillComposer(page, text) {
  const expected = text.replace(/\r\n/g, "\n").trim();
  const expectedLen = [...expected].length;
  const expectedHead = expected.slice(0, 48);
  const expectedTail = expected.slice(-48);

  await assertModalComposer(page);
  await focusComposer(page);
  await sleep(200);

  const tryMethods = [
    {
      name: "keyboard-insertText",
      run: async () => {
        await fillViaKeyboardInsert(page, expected);
        return settledComposerLen(page, expectedLen);
      },
    },
    {
      name: "clipboard-CtrlV",
      run: async () => {
        await fillViaClipboardPaste(page, expected);
        return settledComposerLen(page, expectedLen);
      },
    },
    {
      name: "paragraphs-insertText",
      run: async () => {
        await focusComposer(page);
        await fillViaParagraphs(page, expected);
        return settledComposerLen(page, expectedLen);
      },
    },
    {
      name: "execCommand-bulk",
      run: async () => {
        await focusComposer(page);
        await clearComposer(page);
        await fillViaExecCommand(page, expected);
        return settledComposerLen(page, expectedLen);
      },
    },
  ];

  let ok = false;
  let methodUsed = "";
  let finalLen = 0;

  for (const method of tryMethods) {
    try {
      await assertModalComposer(page);
      const len = await method.run();
      finalLen = len;
      const body = await readComposerText(page);
      const hasHead = body.includes(expectedHead.slice(0, 32));
      const hasTail = body.includes(expectedTail.slice(-32));
      const btnOk = await isPostButtonEnabled(page);
      if (len >= Math.floor(expectedLen * 0.85) && hasHead && hasTail && btnOk) {
        ok = true;
        methodUsed = method.name;
        break;
      }
      // Se texto ok mas botão disabled, tenta nudge leve
      if (len >= Math.floor(expectedLen * 0.85) && hasHead && hasTail && !btnOk) {
        await page.keyboard.type(".");
        await page.keyboard.press("Backspace");
        await sleep(400);
        if (await isPostButtonEnabled(page)) {
          ok = true;
          methodUsed = `${method.name}+nudge`;
          break;
        }
      }
      console.error(
        `Aviso: ${method.name} → ${len}/${expectedLen} (head=${hasHead} tail=${hasTail} btn=${btnOk}).`,
      );
    } catch (err) {
      console.error(
        `Aviso: método ${method.name} falhou — ${String(err.message || err).slice(0, 120)}`,
      );
    }
  }

  finalLen = [...(await readComposerText(page))].length;
  const body = await readComposerText(page);
  const hasHead = body.includes(expectedHead.slice(0, 32));
  const hasTail = body.includes(expectedTail.slice(-32));
  const btnOk = await isPostButtonEnabled(page);
  if (!ok || finalLen < Math.floor(expectedLen * 0.85) || !hasHead || !hasTail || !btnOk) {
    throw new Error(
      `Falha ao preencher o composer: foram ${finalLen}/${expectedLen} caracteres` +
        ` (head=${hasHead} tail=${hasTail} btn=${btnOk}). ` +
        "Tente de novo com X_HEADLESS=false para inspecionar.",
    );
  }

  console.error(`Composer OK via ${methodUsed}: ${finalLen}/${expectedLen} caracteres.`);
  await sleep(300);
}

async function clickPost(page) {
  const btn = postButtonLocator(page);
  await btn.waitFor({ state: "visible", timeout: 30_000 });

  for (let i = 0; i < 24; i++) {
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
  // Garante foco no composer cheio antes de enviar
  await composerLocator(page).click({ force: true, timeout: 5_000 }).catch(() => {});
  await sleep(200);

  try {
    await btn.click({ timeout: 8_000 });
  } catch {
    await btn.click({ force: true, timeout: 8_000 });
  }

  // Só Ctrl+Enter se o modal ainda estiver aberto (envio pode ter falhado)
  await sleep(1200);
  const dialogStillOpen = await page
    .locator(`${SELECTORS.dialog} ${SELECTORS.composer}`)
    .isVisible()
    .catch(() => false);
  if (dialogStillOpen) {
    await page.keyboard.press("Control+Enter").catch(() => {});
    await sleep(1500);
  }
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

export async function postTweet(text, { dryRun = false } = {}) {
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

    // Vai direto ao compose (evita Escape na home fechar o modal)
    await openComposer(page);
    assertLoggedIn(page);
    if (!(await hasModalComposer(page))) {
      // Confirma sessão na home se compose falhou
      await gotoWithRetry(page, "https://x.com/home");
      await page
        .locator(SELECTORS.accountSwitcher)
        .waitFor({ state: "visible", timeout: 45_000 })
        .catch(() => {
          throw new Error("Sessão inválida ou página não carregou. Rode: tweet login");
        });
      await openComposer(page);
    }
    await ensureComposerOpen(page);
    await contentEditableLocator(page).waitFor({ state: "visible", timeout: 20_000 });
    await fillComposer(page, text.trim());
    await ensureComposerOpen(page);

    if (dryRun) {
      const filled = await readComposerText(page);
      await context.storageState({ path: SESSION_PATH });
      return {
        ok: true,
        dryRun: true,
        username: getSessionUsername(),
        text: text.trim(),
        filledLen: [...filled].length,
      };
    }

    await clickPost(page);
    await sleep(2500);

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
