const { test, expect, chromium } = require("@playwright/test");
const path = require("path");
const http = require("http");

const EXTENSION_PATH = path.resolve(__dirname, "..", "tab-aura-extension");
const BADGE = "🟥 ";

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/favicon-original.png") {
      const buf = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB" +
        "Nl7BcQAAAABJRU5ErkJggg==",
        "base64"
      );
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(buf);
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const title = decodeURIComponent(url.pathname.slice(1)) || "Test Page";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<html><head><title>${title}</title>` +
      `<link rel="icon" href="/favicon-original.png">` +
      `</head><body><h1>${title}</h1></body></html>`
    );
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function launchWithExtension() {
  return chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
    ],
  });
}

async function setStorageViaWorker(context, values) {
  const workers = context.serviceWorkers();
  let sw = workers.find((w) => w.url().includes("background.js"));
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", {
      predicate: (w) => w.url().includes("background.js"),
      timeout: 5000,
    });
  }
  await sw.evaluate((vals) => {
    return new Promise((resolve) => chrome.storage.sync.set(vals, resolve));
  }, values);
}

test.describe("Tab Aura", () => {
  let context;
  let server;
  let baseUrl;

  test.beforeAll(async () => {
    const { server: s, port } = await startServer();
    server = s;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test.beforeEach(async () => {
    context = await launchWithExtension();
    await setStorageViaWorker(context, { enabled: true });
  });

  test.afterEach(async () => {
    await context.close();
  });

  test("アクティブタブのタイトルに🟥バッジがつく", async () => {
    const page1 = await context.newPage();
    await page1.goto(`${baseUrl}/Page%20One`);
    await page1.waitForTimeout(500);

    const page2 = await context.newPage();
    await page2.goto(`${baseUrl}/Page%20Two`);
    await page2.waitForTimeout(500);

    await page1.bringToFront();
    await page1.waitForTimeout(400);
    await page2.bringToFront();
    await page2.waitForTimeout(400);

    const title = await page2.title();
    expect(title).toMatch(new RegExp(`^${BADGE}`));
  });

  test("タブ切り替え後にタイトルが復元される", async () => {
    const page1 = await context.newPage();
    await page1.goto(`${baseUrl}/Page%20One`);
    await page1.waitForTimeout(500);

    const page2 = await context.newPage();
    await page2.goto(`${baseUrl}/Page%20Two`);
    await page2.waitForTimeout(500);

    await page1.bringToFront();
    await page1.waitForTimeout(400);
    await page2.bringToFront();
    await page2.waitForTimeout(400);
    await page1.bringToFront();
    await page1.waitForTimeout(500);

    const title = await page2.title();
    expect(title).toBe("Page Two");
  });

  test("タブが1つしかない場合はバッジがつかない", async () => {
    const page1 = await context.newPage();
    await page1.goto(`${baseUrl}/Only%20Tab`);
    await page1.waitForTimeout(500);

    // 他のタブ（about:blank）を閉じる
    const pages = context.pages();
    for (const p of pages) {
      if (p !== page1) {
        await p.close();
      }
    }
    await page1.waitForTimeout(500);

    const title = await page1.title();
    expect(title).not.toMatch(new RegExp(`^${BADGE}`));
  });

  test("10回切り替えてもバッジが重複しない", async () => {
    const page1 = await context.newPage();
    await page1.goto(`${baseUrl}/Tab%20A`);
    await page1.waitForTimeout(500);

    const page2 = await context.newPage();
    await page2.goto(`${baseUrl}/Tab%20B`);
    await page2.waitForTimeout(500);

    for (let i = 0; i < 10; i++) {
      await page1.bringToFront();
      await page1.waitForTimeout(250);
      await page2.bringToFront();
      await page2.waitForTimeout(250);
    }

    const title = await page2.title();
    // バッジが1つだけついていること
    expect(title).toBe(BADGE + "Tab B");
  });
});
