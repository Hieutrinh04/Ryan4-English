import assert from "node:assert/strict";
import test from "node:test";

import { bankQrUrl, transferMatchesOrder } from "../lib/vietqr.mjs";

test("bankQrUrl: đúng định dạng img.vietqr.io kèm số tiền và nội dung", () => {
  const url = bankQrUrl({ bankCode: "MB", accountNumber: "0011002233", accountName: "NGUYEN VAN A", amountVnd: 100_000, content: "LXABC123" });
  assert.match(url, /^https:\/\/img\.vietqr\.io\/image\/MB-0011002233-compact2\.png\?/);
  const params = new URL(url).searchParams;
  assert.equal(params.get("amount"), "100000");
  assert.equal(params.get("addInfo"), "LXABC123");
  assert.equal(params.get("accountName"), "NGUYEN VAN A");
});

test("transferMatchesOrder: khớp khi đủ tiền và nội dung chứa mã đơn", () => {
  const order = { id: "LXABC123", amount_vnd: 100_000 };
  assert.equal(transferMatchesOrder(order, { transferType: "in", transferAmount: 100_000, content: "CT DEN:001 LXABC123" }), true);
  // chuyển dư tiền vẫn tính là đã trả
  assert.equal(transferMatchesOrder(order, { transferType: "in", transferAmount: 120_000, content: "chuyen tien lxabc123" }), true);
  // dấu tiếng Việt trong nội dung không cản việc khớp
  assert.equal(transferMatchesOrder(order, { transferType: "in", transferAmount: 100_000, content: "nạp premium LXABC123 nhé" }), true);
});

test("transferMatchesOrder: không khớp khi thiếu tiền, sai chiều, hoặc không có mã", () => {
  const order = { id: "LXABC123", amount_vnd: 100_000 };
  assert.equal(transferMatchesOrder(order, { transferType: "in", transferAmount: 90_000, content: "LXABC123" }), false);
  assert.equal(transferMatchesOrder(order, { transferType: "out", transferAmount: 100_000, content: "LXABC123" }), false);
  assert.equal(transferMatchesOrder(order, { transferType: "in", transferAmount: 100_000, content: "chuyen tien mua sach" }), false);
});
