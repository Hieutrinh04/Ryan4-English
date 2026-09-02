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
  // Endpoint trả startMs/endMs thật, không phải con số nguyên giây đang vẽ ở UI.
  return { timingPrecision: "millisecond", events };
}

function secondsOf(timestamp) {
  const parts = String(timestamp ?? "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * Đọc một dòng transcript ở cả hai giao diện YouTube.
 *
 * Từ đầu 2026, YouTube dần thay `ytd-transcript-segment-renderer` bằng
 * `transcript-segment-view-model`. Tên lớp của mốc giờ và lời thoại cũng đổi
 * theo. Giữ cả hai bộ selector vì giao diện được bật theo từng tài khoản, nên
 * hai người mở cùng một video vẫn có thể nhận hai cấu trúc DOM khác nhau.
 */
function cueFromTranscriptRow(row) {
  const timestamp = row.querySelector(
    ".ytwTranscriptSegmentViewModelTimestamp, #timestamp, .segment-timestamp",
  )?.textContent;
  const text = row.querySelector(
    '.ytAttributedStringHost[role="text"], .yt-core-attributed-string[role="text"], span[role="text"], #segment-text, .segment-text',
  )?.textContent;
  return {
    start: secondsOf(timestamp),
    text: text?.replace(/\s+/g, " ").trim() ?? "",
  };
}

function transcriptFromDom() {
  const rows = [
    ...document.querySelectorAll(
      "transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost, ytd-transcript-segment-renderer",
    ),
  ];
  // Giao diện mới có lúc để cả custom element và host class lồng nhau; selector
  // trên vì thế nhìn thấy cùng một dòng hai lần. Khử trùng theo giờ + nội dung
  // trước khi gửi sang bộ chia câu.
  const seen = new Set();
  const cues = rows
    .map(cueFromTranscriptRow)
    .filter((cue) => {
      if (!cue.text) return false;
      const key = `${cue.start}\u0000${cue.text.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start);
  return {
    // Giao diện chỉ hiện 0:16, không có mili giây. Phần xử lý dùng cờ này để
    // đặt một ranh giới chung ở giữa giây cho cuối dòng trước/đầu dòng sau.
    timingPrecision: "second",
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

/**
 * Lấy phụ đề qua chính trình phát của trang.
 *
 * YouTube trả mã 200 kèm THÂN RỖNG khi địa chỉ timedtext thiếu token pot, và
 * token đó chỉ trình phát mới sinh ra được — nên gọi thẳng baseUrl thường về tay
 * không. Nhưng địa chỉ mà trình phát vừa gọi thì nằm ngay trong bảng đo hiệu
 * năng của trang, và tham số lang KHÔNG nằm trong phần được ký (sparams) nên
 * đổi được sang đúng bản phụ đề người dùng chọn.
 */
async function readViaPlayer(baseUrl) {
  const withToken = () =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      // Có phiên dùng token pot, có phiên dùng URL đã ký nhưng không có pot.
      // Cả hai đều là request thật của chính trình phát và đều đáng ưu tiên hơn
      // bảng transcript chỉ hiện timestamp làm tròn.
      .filter((name) => name.includes("/api/timedtext"))
      .pop();

  let source = withToken();
  const button = document.querySelector(".ytp-subtitles-button");
  const wasOn = button?.getAttribute("aria-pressed") === "true";
  if (!source && button instanceof HTMLElement) {
    // Buộc trình phát gọi lại file phụ đề kể cả khi CC đang bật từ trước. Sau đó
    // trả nút về đúng trạng thái ban đầu.
    if (wasOn) {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    button.click();
    for (let step = 0; step < 25 && !source; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      source = withToken();
    }
    if (!wasOn) button.click();
  }
  if (!source) return null;

  const target = new URL(source);
  const want = new URL(baseUrl, location.origin);
  target.searchParams.set("fmt", "json3");
  const lang = want.searchParams.get("lang");
  if (lang) target.searchParams.set("lang", lang);
  const kind = want.searchParams.get("kind");
  if (kind) target.searchParams.set("kind", kind);
  else target.searchParams.delete("kind");

  const body = await fetch(target, { credentials: "include" }).then((response) => response.text());
  return body.trim().startsWith("{") ? JSON.parse(body) : null;
}

/** Tải một bản phụ đề. Chỉ chạy được ở đây, không chạy được từ máy chủ. */
async function readCaptions(baseUrl, expectedSeconds = 0) {
  const candidates = [];
  const stats = (payload) => {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const textLength = events.reduce((sum, event) => sum + (event?.segs ?? []).reduce((part, seg) => part + String(seg?.utf8 ?? "").length, 0), 0);
    const lastMs = events.reduce((latest, event) => Math.max(latest, (Number(event?.tStartMs) || 0) + (Number(event?.dDurationMs) || 0)), 0);
    const timedSegments = events.reduce((sum, event) => sum + (event?.segs ?? []).filter((seg) => seg?.tOffsetMs !== undefined).length, 0);
    return { events: events.length, textLength, lastMs, timedSegments };
  };
  const score = (payload) => {
    const value = stats(payload);
    return value.textLength + value.lastMs / 100 + value.timedSegments * 2;
  };
  const best = () => candidates.sort((a, b) => score(b) - score(a))[0];
  const withTimingPrecision = (payload) => {
    if (!payload || payload.timingPrecision) return payload;
    return { ...payload, timingPrecision: stats(payload).timedSegments ? "word" : "millisecond" };
  };
  const completeEnough = (payload) => {
    const value = stats(payload);
    if (value.events < 2 || value.textLength < 40) return false;
    const durationMs = Math.max(0, Number(expectedSeconds) || 0) * 1000;
    // Outro không lời có thể chiếm một phần video, nên 65% là ngưỡng bảo thủ.
    return !durationMs || durationMs < 45000 || value.lastMs >= durationMs * 0.65;
  };
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");
    const response = await fetch(url, { credentials: "include" });
    const body = await response.text();
    if (body.trim().startsWith("{")) candidates.push(JSON.parse(body));
  } catch {
    // Thử hai đường dưới.
  }
  try {
    const viaPlayer = await readViaPlayer(baseUrl);
    if (viaPlayer?.events?.length) candidates.push(viaPlayer);
  } catch {
    // Chuyển sang endpoint Bản chép lời ở dưới.
  }
  // Hai nguồn trên đều dùng đúng track người dùng chọn và còn timestamp chi
  // tiết. Nếu đã phủ phần lớn video thì không đổi sang transcript mặc định của
  // giao diện YouTube (có thể là ngôn ngữ khác).
  if (candidates.length && completeEnough(best())) return withTimingPrecision(best());
  try {
    const panel = await readTranscriptPanel();
    if (panel?.events?.length) candidates.push(panel);
  } catch {
    // Dùng ứng viên tốt nhất đã lấy được ở hai đường trên.
  }
  if (!candidates.length) throw new Error("Không đọc được nội dung phụ đề của video.");

  // timedtext đôi khi trả 200 nhưng bị cắt giữa chừng. Khi đó so cả bản panel
  // và lấy ứng viên có nhiều chữ, mốc phủ xa hơn, ưu tiên timing từng từ.
  return withTimingPrecision(best());
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  const run = async () => {
    if (message?.type === "doc") return { ok: true, data: await readPage() };
    if (message?.type === "captions") return { ok: true, data: await readCaptions(message.baseUrl, message.seconds) };
    return { ok: false, error: "Yêu cầu không hợp lệ." };
  };
  run()
    .then(reply)
    .catch((error) => reply({ ok: false, error: String(error?.message ?? error) }));
  // Trả true để Chrome giữ kênh trả lời mở cho tới khi việc bất đồng bộ xong.
  return true;
});
