import { CAPTION_VERSION, cuesFromJson3, pickEnglishTrack, sentencesFrom } from "./youtube.js";

const YOUTUBE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;

function waitForComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const finish = (error) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (changedId, info) => {
      if (changedId === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    timer = setTimeout(() => finish(new Error("YouTube tải quá lâu. Hãy kiểm tra kết nối mạng.")), timeoutMs);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === "complete") finish();
    });
  });
}

async function ask(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function importUrl(url) {
  if (!YOUTUBE.test(url)) throw new Error("Đường dẫn YouTube không hợp lệ.");
  let tabId = 0;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id ?? 0;
    if (!tabId) throw new Error("Không mở được video YouTube.");
    await waitForComplete(tabId);

    const documentResult = await ask(tabId, { type: "doc" });
    if (!documentResult?.ok) throw new Error(documentResult?.error ?? "Không đọc được video YouTube.");
    const page = documentResult.data;
    const track = pickEnglishTrack(page?.tracks ?? []);
    if (!track?.baseUrl) throw new Error("Video này không có phụ đề tiếng Anh.");

    const captionsResult = await ask(tabId, { type: "captions", baseUrl: track.baseUrl, seconds: page.seconds || 0 });
    if (!captionsResult?.ok) throw new Error(captionsResult?.error ?? "Không tải được phụ đề.");
    const sentences = sentencesFrom(cuesFromJson3(captionsResult.data));
    if (!sentences.length) throw new Error("Phụ đề tiếng Anh của video đang rỗng.");

    return {
      ok: true,
      lesson: {
        videoId: page.videoId,
        title: page.title || "Video YouTube",
        author: page.author || "",
        seconds: page.seconds || 0,
        thumbnail: `https://i.ytimg.com/vi/${page.videoId}/hqdefault.jpg`,
        source: "extension",
        captionVersion: CAPTION_VERSION,
        timingPrecision: captionsResult.data?.timingPrecision || "millisecond",
        sentences,
      },
    };
  } finally {
    if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== "import-url") return false;
  importUrl(String(message.url ?? ""))
    .then(reply)
    .catch((error) => reply({ ok: false, error: String(error?.message ?? error) }));
  return true;
});
