// Bản chép cho tiện ích phải cắt câu y hệt bản trong app.
//
// Nếu hai bên lệch nhau thì bài lấy từ tiện ích sẽ khác bài tạo trong app, mà lỗi
// kiểu đó rất khó nhận ra: câu vẫn hiện, chỉ là cắt sai chỗ.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

import * as app from "../lib/youtube.mjs";
const copyPath = new URL("../extension/youtube.js", import.meta.url);

test("bản chép cho tiện ích đã được sinh ra", () => {
  assert.ok(existsSync(copyPath), "thiếu extension/youtube.js — chạy npm run build:extension");
});

test("bản chép xuất đúng những hàm tiện ích cần", async () => {
  const copy = await import(copyPath.href);
  for (const name of ["sliceJsonArray", "pickEnglishTrack", "cuesFromJson3", "sentencesFrom"]) {
    assert.equal(typeof copy[name], "function", `bản chép thiếu ${name}`);
  }
});

test("hai bản cắt câu ra kết quả giống hệt nhau", async () => {
  const copy = await import(copyPath.href);
  const payload = {
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "I usually get up" }] },
      { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: "at quarter past six." }] },
      { tStartMs: 4000, dDurationMs: 500, segs: [{ utf8: "\n" }] },
      { tStartMs: 4500, dDurationMs: 2000, segs: [{ utf8: "I often have porridge" }, { utf8: " for breakfast." }] },
    ],
  };
  assert.deepEqual(copy.cuesFromJson3(payload), app.cuesFromJson3(payload));
  assert.deepEqual(copy.sentencesFrom(copy.cuesFromJson3(payload)), app.sentencesFrom(app.cuesFromJson3(payload)));
});

test("hai bản chọn cùng một bản phụ đề", async () => {
  const copy = await import(copyPath.href);
  const tracks = [{ languageCode: "vi" }, { languageCode: "en", kind: "asr" }, { languageCode: "en-GB" }];
  assert.deepEqual(copy.pickEnglishTrack(tracks), app.pickEnglishTrack(tracks));
});

test("hai bản cắt mảng JSON giống nhau", async () => {
  const copy = await import(copyPath.href);
  const html = `x "captionTracks":[{"a":[1,2],"n":"có ] trong chuỗi"},{"b":3}] y`;
  assert.equal(copy.sliceJsonArray(html, '"captionTracks":'), app.sliceJsonArray(html, '"captionTracks":'));
});

test("bản chép ghi rõ là tệp sinh tự động, để không ai sửa tay", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(copyPath, "utf8");
  assert.match(text, /ĐƯỢC SINH RA TỰ ĐỘNG/);
  assert.match(text, /npm run build:extension/);
});
