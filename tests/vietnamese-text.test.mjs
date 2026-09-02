import test from "node:test";
import assert from "node:assert/strict";
import { cleanStudyVietnamese } from "../lib/vietnamese-text.mjs";

test("giữ khoảng trắng trước từ tiếng Việt bắt đầu bằng phụ âm", () => {
  assert.equal(
    cleanStudyVietnamese("Trong khu vườn nhỏ của bất ngờ, vô số loài côn trùng sinh sống."),
    "Trong khu vườn nhỏ của bất ngờ, vô số loài côn trùng sinh sống.",
  );
});

test("nối phụ âm cuối thật sự bị PDF tách thành token riêng", () => {
  assert.equal(cleanStudyVietnamese("Một chuyế n đi rấ t vui."), "Một chuyến đi rất vui.");
});

test("chuẩn hóa khoảng trắng trước dấu câu và khoảng trắng lặp", () => {
  assert.equal(cleanStudyVietnamese("Xin  chào , bạn !"), "Xin chào, bạn!");
});
