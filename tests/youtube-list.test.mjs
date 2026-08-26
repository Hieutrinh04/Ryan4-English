import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogueEntry,
  channelRefFrom,
  groupByChannel,
  playlistIdFrom,
  readableLength,
  uploadsPlaylistId,
  usableForPractice,
} from "../lib/youtube-list.mjs";

test("playlistIdFrom: đọc được mã từ link xem và link playlist", () => {
  assert.equal(playlistIdFrom("https://www.youtube.com/playlist?list=PLcetZ6gSk96_l0mbjLQEmXbSGKMCVAxtq"), "PLcetZ6gSk96_l0mbjLQEmXbSGKMCVAxtq");
  assert.equal(playlistIdFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLcetZ6gSk96_l0mbjLQEmXbSGKMCVAxtq"), "PLcetZ6gSk96_l0mbjLQEmXbSGKMCVAxtq");
  // Dán thẳng mã cũng nhận.
  assert.equal(playlistIdFrom("PLcetZ6gSk96_l0mbjLQEmXbSGKMCVAxtq"), "PLcetZ6gSk96_l0mbjLQEmXbSGKMCVAxtq");
});

test("playlistIdFrom: link không phải YouTube hoặc không có playlist thì trả rỗng", () => {
  assert.equal(playlistIdFrom("https://vimeo.com/playlist?list=PL123456789012"), "");
  assert.equal(playlistIdFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "");
  assert.equal(playlistIdFrom(""), "");
  assert.equal(playlistIdFrom(null), "");
});

test("channelRefFrom: tách riêng dạng @tên và dạng mã UC", () => {
  // Hai dạng gọi API khác nhau, đoán nhầm thì API trả rỗng mà không báo lỗi.
  assert.deepEqual(channelRefFrom("https://www.youtube.com/@bbclearningenglish"), { handle: "@bbclearningenglish" });
  assert.deepEqual(channelRefFrom("@bbclearningenglish"), { handle: "@bbclearningenglish" });
  assert.deepEqual(channelRefFrom("https://www.youtube.com/channel/UCHaHD477h-FeBbVh9Sh7syA"), { channelId: "UCHaHD477h-FeBbVh9Sh7syA" });
  assert.deepEqual(channelRefFrom("UCHaHD477h-FeBbVh9Sh7syA"), { channelId: "UCHaHD477h-FeBbVh9Sh7syA" });
});

test("channelRefFrom: không phải kênh thì trả null", () => {
  assert.equal(channelRefFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(channelRefFrom("https://example.com/@ai-do"), null);
  assert.equal(channelRefFrom(""), null);
});

test("uploadsPlaylistId: đổi UC thành UU theo quy ước của YouTube", () => {
  assert.equal(uploadsPlaylistId("UCHaHD477h-FeBbVh9Sh7syA"), "UUHaHD477h-FeBbVh9Sh7syA");
  assert.equal(uploadsPlaylistId("không phải mã kênh"), "");
  assert.equal(uploadsPlaylistId(""), "");
});

test("catalogueEntry: dựng thẻ video, ảnh bìa lấy theo mã chứ không lưu về", () => {
  const entry = catalogueEntry({ videoId: "dQw4w9WgXcQ", title: "  Talking   about films ", channel: "BBC", seconds: 372.6 });
  assert.equal(entry.title, "Talking about films");
  assert.equal(entry.seconds, 373);
  assert.equal(entry.thumbnail, "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  assert.ok(entry.addedAt);
});

test("catalogueEntry: bỏ video riêng tư, đã xoá, hoặc mã sai", () => {
  assert.equal(catalogueEntry({ videoId: "dQw4w9WgXcQ", title: "Private video" }), null);
  assert.equal(catalogueEntry({ videoId: "dQw4w9WgXcQ", title: "Deleted video" }), null);
  assert.equal(catalogueEntry({ videoId: "quá-ngắn", title: "Gì đó" }), null);
  assert.equal(catalogueEntry({ videoId: "dQw4w9WgXcQ", title: "   " }), null);
  assert.equal(catalogueEntry(null), null);
});

test("usableForPractice: bỏ video quá ngắn và quá dài", () => {
  assert.equal(usableForPractice({ seconds: 372 }), true);
  assert.equal(usableForPractice({ seconds: 12 }), false);
  assert.equal(usableForPractice({ seconds: 7200 }), false);
  // Thời lượng 0 là chưa đọc được, không phải là ngắn — vẫn giữ.
  assert.equal(usableForPractice({ seconds: 0 }), true);
});

test("groupByChannel: gom theo kênh, kênh nhiều video đứng trước", () => {
  const groups = groupByChannel([
    { videoId: "a".repeat(11), channel: "BBC" },
    { videoId: "b".repeat(11), channel: "TED" },
    { videoId: "c".repeat(11), channel: "BBC" },
    { videoId: "d".repeat(11) },
  ]);
  assert.deepEqual(groups.map((g) => g.channel), ["BBC", "TED", "Khác"]);
  assert.equal(groups[0].videos.length, 2);
});

test("readableLength: đọc thời lượng cho người xem", () => {
  assert.equal(readableLength(372), "6 phút");
  assert.equal(readableLength(30), "1 phút");
  assert.equal(readableLength(4320), "1 giờ 12 phút");
  assert.equal(readableLength(3600), "1 giờ");
  assert.equal(readableLength(0), "");
});
