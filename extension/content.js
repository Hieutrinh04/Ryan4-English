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
  const response = await fetch(`${baseUrl}&fmt=json3`, { credentials: "include" });
  const body = await response.text();
  if (!body.trim().startsWith("{")) throw new Error("YouTube không trả phụ đề cho video này.");
  return JSON.parse(body);
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
