// Chạy BÊN TRONG trang YouTube.
//
// Đây là lý do tiện ích tồn tại: máy chủ không tải được phụ đề vì đường dẫn phụ đề
// có gắn địa chỉ IP và chữ ký của phiên đang xem — YouTube trả 200 kèm thân rỗng
// cho mọi yêu cầu từ nơi khác. Đoạn mã này chạy ngay trong trang, cùng địa chỉ IP
// và cùng phiên với người dùng, nên yêu cầu được phục vụ bình thường.
//
// Chỉ đọc phụ đề của video mà người dùng ĐANG mở, khi họ tự bấm nút tiện ích.

/** Cắt đúng một mảng JSON nằm sau `marker`, đếm ngoặc thay vì dùng biểu thức chính quy. */
function sliceJsonArray(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf("[", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function between(html, pattern) {
  const match = html.match(pattern);
  return match?.[1] ? match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
}

/** Giải mã một chuỗi JSON (dùng cho params của nút "Hiện bản chép lời"). */
function jsonStringValue(html, key) {
  const marker = `"${key}":`;
  const at = html.indexOf(marker);
  if (at < 0) return "";
  const start = html.indexOf('"', at + marker.length);
  if (start < 0) return "";
  let escaped = false;
  for (let i = start + 1; i < html.length; i += 1) {
    const char = html[i];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return "";
      }
    }
  }
  return "";
}

/** Tìm params của get_transcript, tránh lấy nhầm các params khác trong trang. */
function transcriptParams(html) {
  const marker = '"getTranscriptEndpoint":';
  const at = html.indexOf(marker);
  if (at < 0) return "";
  return jsonStringValue(html.slice(at, at + 3000), "params");
}

function textOf(value) {
  return value?.simpleText ?? (value?.runs ?? []).map((run) => run.text ?? "").join("");
}

/** Đổi response của endpoint Bản chép lời về json3 mà phần còn lại đang dùng. */
function json3FromTranscript(payload) {
  const groups = payload?.actions?.[0]?.updateEngagementPanelAction?.content
    ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
    ?.transcriptSegmentListRenderer?.initialSegments ?? [];
  const events = [];
  for (const item of groups) {
    const cue = item?.transcriptSegmentRenderer;
    const text = textOf(cue?.snippet).replace(/\s+/g, " ").trim();
    if (!cue || !text) continue;
    events.push({
      tStartMs: Number(cue.startMs) || 0,
      dDurationMs: Number(cue.endMs) - Number(cue.startMs) || 0,
      segs: [{ utf8: text }],
    });
  }
  return { events };
}

function secondsOf(timestamp) {
  const parts = String(timestamp ?? "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function transcriptFromDom() {
  const rows = [...document.querySelectorAll("ytd-transcript-segment-renderer")];
  const cues = rows
    .map((row) => ({
      start: secondsOf(row.querySelector(".segment-timestamp")?.textContent),
      text: row.querySelector(".segment-text")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }))
    .filter((cue) => cue.text);
  return {
    events: cues.map((cue, index) => ({
      tStartMs: cue.start * 1000,
      dDurationMs: Math.max(0, ((cues[index + 1]?.start ?? cue.start + 3) - cue.start) * 1000),
      segs: [{ utf8: cue.text }],
    })),
  };
}

function waitForTranscript(timeout = 7000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const result = transcriptFromDom();
      if (result.events.length) return resolve(result);
      if (Date.now() - started >= timeout) return reject(new Error("Không tìm thấy nội dung trong bảng Bản chép lời."));
      setTimeout(check, 200);
    };
    check();
  });
}

/** Mở bảng transcript như người dùng bấm trên trang rồi đọc các dòng đã render. */
async function readTranscriptDom() {
  const existing = transcriptFromDom();
  if (existing.events.length) return existing;

  // Nút transcript thường nằm trong phần mô tả đã mở rộng.
  const expand = document.querySelector("ytd-text-inline-expander #expand, #description-inline-expander #expand");
  if (expand instanceof HTMLElement) expand.click();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const candidates = [...document.querySelectorAll("button, tp-yt-paper-button, yt-button-shape")];
  const trigger = candidates.find((element) => {
    const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`;
    return /(?:show|open).{0,20}transcript|transcript|bản chép lời/i.test(label);
  });
  if (!(trigger instanceof HTMLElement)) throw new Error("Không tìm thấy nút Hiện bản chép lời trên trang YouTube.");
  const clickable = trigger.matches("button, tp-yt-paper-button") ? trigger : trigger.querySelector("button") ?? trigger;
  clickable.click();
  return waitForTranscript();
}

/** Dùng đúng endpoint mà bảng "Hiện bản chép lời" của YouTube gọi. */
async function readTranscriptPanel() {
  const html = await fetch(location.href, { credentials: "include" }).then((response) => response.text());
  const params = transcriptParams(html);
  if (!params) return readTranscriptDom();

  const apiKey = jsonStringValue(html, "INNERTUBE_API_KEY");
  const clientVersion = jsonStringValue(html, "INNERTUBE_CLIENT_VERSION");
  if (!apiKey || !clientVersion) return readTranscriptDom();

  try {
    const response = await fetch(`/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion, hl: "en" } },
        params,
      }),
    });
    if (response.ok) {
      const result = json3FromTranscript(await response.json());
      if (result.events.length) return result;
    }
  } catch {
    // Một số phiên YouTube chặn endpoint này; đọc bảng transcript trong DOM.
  }
  return readTranscriptDom();
}

function videoIdOf() {
  const url = new URL(location.href);
  if (url.pathname === "/watch") return url.searchParams.get("v") ?? "";
  const match = url.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/);
  return match ? match[2] : "";
}

/** Lấy danh sách bản phụ đề và thông tin video từ chính trang đang mở. */
async function readPage() {
  // Lấy lại HTML thay vì đọc biến trong trang: mã tiện ích chạy ở thế giới riêng,
  // không thấy được biến JavaScript của trang.
  const html = await fetch(location.href, { credentials: "include" }).then((response) => response.text());
  const raw = sliceJsonArray(html, '"captionTracks":');
  let tracks = [];
  try {
    tracks = raw ? JSON.parse(raw) : [];
  } catch {
    tracks = [];
  }
  return {
    videoId: videoIdOf(),
    title: between(html, /<meta name="title" content="([^"]*)"/),
    author: between(html, /"ownerChannelName":"([^"]*)"/),
    seconds: Number(between(html, /"lengthSeconds":"(\d+)"/)) || 0,
    tracks: tracks.map((track) => ({
      languageCode: track.languageCode,
      kind: track.kind,
      baseUrl: track.baseUrl,
      name: track.name?.simpleText ?? track.name?.runs?.[0]?.text ?? "",
    })),
  };
}

/** Tải một bản phụ đề. Chỉ chạy được ở đây, không chạy được từ máy chủ. */
async function readCaptions(baseUrl) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");
    const response = await fetch(url, { credentials: "include" });
    const body = await response.text();
    if (body.trim().startsWith("{")) return JSON.parse(body);
  } catch {
    // Chuyển sang endpoint Bản chép lời ở dưới.
  }
  return readTranscriptPanel();
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  const run = async () => {
    if (message?.type === "doc") return { ok: true, data: await readPage() };
    if (message?.type === "captions") return { ok: true, data: await readCaptions(message.baseUrl) };
    return { ok: false, error: "Yêu cầu không hợp lệ." };
  };
  run()
    .then(reply)
    .catch((error) => reply({ ok: false, error: String(error?.message ?? error) }));
  // Trả true để Chrome giữ kênh trả lời mở cho tới khi việc bất đồng bộ xong.
  return true;
});
