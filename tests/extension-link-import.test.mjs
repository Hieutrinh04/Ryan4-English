import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const bridgeSource = await readFile(new URL("../extension/bridge.js", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("tiện ích 0.2.4 nạp cầu nối trên localhost và service worker", () => {
  assert.equal(manifest.version, "0.2.4");
  assert.equal(manifest.background?.service_worker, "background.js");
  assert.ok(manifest.content_scripts?.some((item) => item.js?.includes("bridge.js") && item.matches?.includes("http://localhost:3000/*")));
  assert.ok(manifest.host_permissions.includes("https://www.youtube.com/*"));
  assert.ok(manifest.permissions.includes("tabs"));
});

test("bridge chỉ chuyển yêu cầu YouTube hợp lệ và trả đúng requestId", () => {
  const listeners = new Map();
  const posted = [];
  const sent = [];
  const windowObject = {
    location: { origin: "http://localhost:3000" },
    addEventListener(type, listener) { listeners.set(type, listener); },
    postMessage(message) { posted.push(message); },
  };
  const context = {
    window: windowObject,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sent.push(message);
          callback({ ok: true, lesson: { videoId: "MhWG-slwG_8" } });
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(bridgeSource, context);

  listeners.get("message")({
    source: windowObject,
    data: { source: "lexilo-web", type: "LEXILO_IMPORT_YOUTUBE", requestId: "req-1", url: "https://www.youtube.com/watch?v=MhWG-slwG_8" },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "import-url");
  assert.ok(posted.some((item) => item.type === "LEXILO_IMPORT_YOUTUBE_ACK" && item.requestId === "req-1"));
  assert.ok(posted.some((item) => item.type === "LEXILO_IMPORT_YOUTUBE_RESULT" && item.requestId === "req-1" && item.result?.ok));

  listeners.get("message")({
    source: windowObject,
    data: { source: "lexilo-web", type: "LEXILO_IMPORT_YOUTUBE", requestId: "bad", url: "https://example.com/video" },
  });
  assert.equal(sent.length, 1, "không được chuyển link ngoài YouTube cho service worker");
});

test("service worker luôn đóng tab YouTube tạm sau khi lấy bài", () => {
  assert.match(backgroundSource, /chrome\.tabs\.create\(\{ url, active: false \}\)/);
  assert.match(backgroundSource, /finally\s*\{[\s\S]*chrome\.tabs\.remove\(tabId\)/);
  assert.match(backgroundSource, /captionVersion:\s*CAPTION_VERSION/);
  assert.match(backgroundSource, /sentencesFrom\(cuesFromJson3\(captionsResult\.data\)\)/);
});

test("tab Lexilo đang mở xử lý cả bài thường lẫn bài cần AI nghe", () => {
  const start = pageSource.indexOf("const takeIncoming");
  const end = pageSource.indexOf("return () => window.removeEventListener", start);
  const handler = pageSource.slice(start, end);
  assert.match(handler, /takeTranscribe\(\)/);
  assert.match(handler, /if \(!done\) take\(\)/);
  assert.match(pageSource, /addEventListener\("hashchange", takeIncoming\)/);
  assert.match(pageSource, /className="import-open"/);
});

test("service worker hoàn tất luồng mở tab, lấy bài rồi đóng tab", async () => {
  let listener;
  const removed = [];
  const messages = [];
  const context = {
    CAPTION_VERSION: 11,
    cuesFromJson3(payload) { return payload.events; },
    pickEnglishTrack(tracks) { return tracks[0] ?? null; },
    sentencesFrom(cues) { return cues; },
    setTimeout,
    clearTimeout,
    Error,
    String,
    chrome: {
      runtime: { onMessage: { addListener(value) { listener = value; } }, lastError: null },
      scripting: { async executeScript() {} },
      tabs: {
        onUpdated: { addListener() {}, removeListener() {} },
        async create() { return { id: 42 }; },
        get(_id, callback) { callback({ status: "complete" }); },
        async sendMessage(_id, message) {
          messages.push(message.type);
          if (message.type === "doc") return { ok: true, data: { videoId: "MhWG-slwG_8", title: "Sample", author: "Lillian", seconds: 680, tracks: [{ baseUrl: "captions", languageCode: "en" }] } };
          return { ok: true, data: { events: [{ index: 1, start: 1.2, end: 2.8, text: "Hello there." }] } };
        },
        async remove(id) { removed.push(id); },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(backgroundSource.replace(/^import .*$/m, ""), context);

  const result = await new Promise((resolve) => {
    assert.equal(listener({ type: "import-url", url: "https://www.youtube.com/watch?v=MhWG-slwG_8" }, {}, resolve), true);
  });
  assert.equal(result.ok, true);
  assert.equal(result.lesson.captionVersion, 11);
  assert.equal(result.lesson.timingPrecision, "millisecond");
  assert.equal(result.lesson.sentences[0].text, "Hello there.");
  assert.deepEqual(messages, ["doc", "captions"]);
  assert.deepEqual(removed, [42]);
});
