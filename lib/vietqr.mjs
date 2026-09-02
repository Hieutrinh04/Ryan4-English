// Mã QR chuyển khoản (VietQR) + đối chiếu giao dịch báo về từ webhook ngân hàng.
//
// Không cần khoá API: ảnh QR lấy từ img.vietqr.io theo đúng chuẩn Napas, người
// dùng quét bằng app ngân hàng bất kỳ. Việc XÁC NHẬN đã trả tiền do dịch vụ đọc
// biến động số dư (SePay / Casso…) gọi webhook về — khớp theo nội dung + số tiền.
//
// Hàm thuần, không đọc env, không gọi mạng.

const DIACRITICS = /[̀-ͯ]/g;

/**
 * URL ảnh QR chuyển khoản.
 * @param {{ bankCode: string, accountNumber: string, accountName?: string, amountVnd?: number, content?: string, template?: string }} input
 *   bankCode: mã ngân hàng ngắn (MB, VCB, TCB…) hoặc BIN 6 số (970422).
 */
export function bankQrUrl(input) {
  const template = input.template || "compact2";
  const base = `https://img.vietqr.io/image/${encodeURIComponent(input.bankCode)}-${encodeURIComponent(input.accountNumber)}-${template}.png`;
  const params = new URLSearchParams();
  const amount = Math.round(Number(input.amountVnd) || 0);
  if (amount > 0) params.set("amount", String(amount));
  if (input.content) params.set("addInfo", input.content);
  if (input.accountName) params.set("accountName", input.accountName);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Bỏ dấu, viết hoa, chỉ giữ chữ và số — để so nội dung chuyển khoản. */
function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Một giao dịch ngân hàng có khớp đơn hàng đang chờ không.
 * @param {{ id: string, amount_vnd: number }} order
 * @param {Record<string, unknown>} tx - payload webhook (SePay / Casso / tự build)
 */
export function transferMatchesOrder(order, tx) {
  if (!order || !tx) return false;

  const direction = String(tx.transferType ?? tx.type ?? "in").toLowerCase();
  if (direction && direction !== "in") return false;

  const amount = Math.round(Number(tx.transferAmount ?? tx.amount ?? tx.amountIn ?? 0));
  if (amount <= 0 || amount < Math.round(Number(order.amount_vnd) || 0)) return false;

  const haystack = normalize(`${tx.content ?? ""} ${tx.description ?? ""}`);
  const needle = normalize(order.id);
  return needle.length >= 4 && haystack.includes(needle);
}
