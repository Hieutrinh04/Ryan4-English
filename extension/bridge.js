// Cầu nối rất hẹp giữa trang Lexilo cục bộ và tiện ích Chrome.
//
// Trang web không gọi được chrome.runtime trực tiếp. Content script này chỉ
// nhận đúng một loại yêu cầu lấy video YouTube, chuyển nó cho service worker và
// trả kết quả về cùng trang. Không đọc DOM, cookie hay dữ liệu nào khác.

const REQUEST = "LEXILO_IMPORT_YOUTUBE";
const RESPONSE = "LEXILO_IMPORT_YOUTUBE_RESULT";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (message?.source !== "lexilo-web" || message?.type !== REQUEST) return;
  const requestId = String(message.requestId ?? "");
  const url = String(message.url ?? "");
  if (!requestId || !/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(url)) return;

  window.postMessage(
    { source: "lexilo-extension", type: "LEXILO_IMPORT_YOUTUBE_ACK", requestId },
    window.location.origin,
  );

  chrome.runtime.sendMessage({ type: "import-url", requestId, url }, (result) => {
    const runtimeError = chrome.runtime.lastError?.message;
    window.postMessage(
      {
        source: "lexilo-extension",
        type: RESPONSE,
        requestId,
        result: runtimeError ? { ok: false, error: runtimeError } : result,
      },
      window.location.origin,
    );
  });
});

// Báo sẵn để giao diện biết tiện ích đã được cài và đã nạp bridge phiên bản mới.
window.postMessage({ source: "lexilo-extension", type: "LEXILO_EXTENSION_READY" }, window.location.origin);
