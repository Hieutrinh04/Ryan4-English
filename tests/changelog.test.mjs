import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CHANGE_LABEL, RELEASES, hasUnseenRelease, latestRelease } from "../lib/changelog.mjs";

// Nhật ký cập nhật hiện ở cuối Trang chủ và là thứ người dùng đọc trực tiếp,
// nên sai định dạng ở đây là sai ngay trên mặt sản phẩm.

test("mỗi bản phát hành đủ trường và đúng định dạng", () => {
  assert.ok(RELEASES.length > 0);
  for (const release of RELEASES) {
    assert.match(release.version, /^\d+\.\d+\.\d+$/, `phiên bản sai: ${release.version}`);
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/, `ngày sai ở v${release.version}`);
    assert.ok(release.title.length > 5, `v${release.version} thiếu tiêu đề`);
    assert.ok(release.items.length > 0, `v${release.version} không có mục nào`);
    for (const item of release.items) {
      assert.ok(item.kind in CHANGE_LABEL, `loại lạ: ${item.kind}`);
      // Một câu quá ngắn thì không nói được app đã thay đổi gì cho người dùng.
      assert.ok(item.text.length > 20, `mục quá ngắn ở v${release.version}: ${item.text}`);
    }
  }
});

test("bản mới nhất đứng đầu danh sách", () => {
  const dates = RELEASES.map((release) => release.date);
  const sorted = [...dates].sort().reverse();
  assert.deepEqual(dates, sorted, "danh sách phải xếp từ mới tới cũ");
  assert.equal(latestRelease().version, RELEASES[0].version);
});

test("không có hai bản trùng số hiệu", () => {
  const versions = RELEASES.map((release) => release.version);
  assert.equal(new Set(versions).size, versions.length);
});

test("dấu có gì mới chỉ tắt khi đã xem đúng bản mới nhất", () => {
  // Người dùng mới (chưa lưu gì) phải thấy dấu.
  assert.equal(hasUnseenRelease(""), true);
  // Đã xem một bản cũ vẫn thấy dấu.
  assert.equal(hasUnseenRelease("0.0.1"), true);
  assert.equal(hasUnseenRelease(latestRelease().version), false);
});

test("Trang chủ dựng nhật ký và mở được lối góp ý", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const home = page.slice(page.indexOf("function Dashboard("), page.indexOf("function LearningPlan("));
  assert.match(home, /<Changelog openFeedback=/);
  // Nút Góp ý phải có ở thanh trên cùng nữa, không chỉ nằm dưới đáy Trang chủ.
  assert.match(page, /setShowFeedback\(true\)/);
  assert.match(page, /<FeedbackModal/);
});
