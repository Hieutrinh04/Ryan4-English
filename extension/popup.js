// Điều phối: hỏi trang YouTube lấy phụ đề, cắt thành câu, rồi giao cho Lexilo.
//
// Phần cắt câu dùng chung một bản mã với app (extension/youtube.js được sinh ra từ
// lib/youtube.mjs bằng `npm run build:extension`), để hai bên không bao giờ cắt câu
// khác nhau.

import { cuesFromJson3, pickEnglishTrack, sentencesFrom } from "./youtube.js";

const DEFAULT_LEXILO = "http://localhost:3000";

const el = {
  video: document.getElementById("video"),
  title: document.getElementById("title"),
  meta: document.getElementById("meta"),
  track: document.getElementById("track"),
  send: document.getElementById("send"),
  note: document.getElementById("note"),
  settings: document.getElementById("settings"),
};

function say(text, kind = "") {
  el.note.textContent = text;
  el.note.className = `note ${kind}`;
}

function minutes(seconds) {
  if (!seconds) return "";
  return `${Math.floor(seconds / 60)} phút ${String(seconds % 60).padStart(2, "0")} giây`;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Gọi vào trang. Trang chưa nạp mã tiện ích thì nạp rồi gọi lại. */
async function ask(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

let page = null;
let tabId = 0;

async function load() {
  const tab = await activeTab();
  tabId = tab?.id ?? 0;
  if (!tab?.url || !/^https:\/\/(www|m)\.youtube\.com\//.test(tab.url)) {
    say("Mở một video trên YouTube rồi bấm lại nút này.", "bad");
    el.track.innerHTML = "<option>Không phải trang YouTube</option>";
    return;
  }

  const response = await ask(tabId, { type: "doc" });
  if (!response?.ok) {
    say(response?.error ?? "Không đọc được trang.", "bad");
    return;
  }
  page = response.data;

  if (!page.videoId) {
    say("Trang này không phải một video. Mở đúng trang xem video rồi thử lại.", "bad");
    return;
  }

  el.video.hidden = false;
  el.title.textContent = page.title || "(không đọc được tiêu đề)";
  el.meta.textContent = [page.author, minutes(page.seconds)].filter(Boolean).join(" · ");

  if (!page.tracks.length) {
    el.track.innerHTML = "<option>Video này không có phụ đề</option>";
    say("Video không có phụ đề nào. Chọn video khác, hoặc dán lời thoại thẳng trong Lexilo.", "bad");
    return;
  }

  // Ưu tiên bản tiếng Anh do người thật làm, nhưng vẫn cho chọn bản khác.
  const preferred = pickEnglishTrack(page.tracks);
  el.track.innerHTML = "";
  for (const track of page.tracks) {
    const option = document.createElement("option");
    option.value = track.baseUrl;
    const kind = track.kind === "asr" ? " · máy tự nghe" : "";
    option.textContent = `${track.name || track.languageCode}${kind}`;
    if (preferred && track.baseUrl === preferred.baseUrl) option.selected = true;
    el.track.append(option);
  }
  el.track.disabled = false;
  el.send.disabled = false;
  say(`Tìm thấy ${page.tracks.length} bản phụ đề.`);
}

async function send() {
  el.send.disabled = true;
  say("Đang tải phụ đề…");
  try {
    const response = await ask(tabId, { type: "captions", baseUrl: el.track.value });
    if (!response?.ok) throw new Error(response?.error ?? "Không tải được phụ đề.");

    const sentences = sentencesFrom(cuesFromJson3(response.data));
    if (!sentences.length) throw new Error("Phụ đề rỗng, không cắt được câu nào.");

    const lesson = {
      videoId: page.videoId,
      title: page.title,
      author: page.author,
      seconds: page.seconds,
      source: "extension",
      sentences,
    };

    const { lexiloUrl } = await chrome.storage.sync.get({ lexiloUrl: DEFAULT_LEXILO });
    // Đưa bài qua phần neo của địa chỉ: không cần máy chủ giữ trạng thái, và dữ
    // liệu không đi qua bên thứ ba nào.
    const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(lesson))));
    await chrome.tabs.create({ url: `${lexiloUrl.replace(/\/$/, "")}/#lesson=${encodeURIComponent(payload)}` });
    say(`Đã gửi ${sentences.length} câu sang Lexilo.`, "good");
  } catch (error) {
    say(String(error?.message ?? error), "bad");
    el.send.disabled = false;
  }
}

el.send.addEventListener("click", () => void send());
el.settings.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
void load();
