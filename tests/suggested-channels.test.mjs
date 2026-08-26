import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CHANNEL, SUGGESTED_CHANNELS, alreadyAdded, channelUrl } from "../lib/suggested-channels.mjs";
import { channelRefFrom } from "../lib/youtube-list.mjs";

test("mọi kênh gợi ý có đủ trường cần để hiện và để gọi API", () => {
  for (const channel of SUGGESTED_CHANNELS) {
    assert.ok(channel.name, `thiếu tên: ${channel.handle}`);
    assert.ok(channel.blurb, `thiếu mô tả: ${channel.handle}`);
    assert.ok(channel.levels, `thiếu trình độ: ${channel.handle}`);
    // Handle sai thì API trả rỗng mà không báo lỗi — ship ra là một màn hình chết.
    assert.match(channel.handle, /^@[\w.-]{2,}$/, `handle sai dạng: ${channel.handle}`);
  }
});

test("handle của kênh gợi ý đều được bộ đọc link nhận ra", () => {
  for (const channel of SUGGESTED_CHANNELS) {
    const ref = channelRefFrom(channelUrl(channel.handle));
    assert.deepEqual(ref, { handle: channel.handle }, `không đọc được: ${channel.handle}`);
  }
});

test("không có kênh trùng nhau trong danh sách", () => {
  const handles = SUGGESTED_CHANNELS.map((channel) => channel.handle.toLowerCase());
  assert.equal(new Set(handles).size, handles.length);
});

test("kênh nạp sẵn lần đầu nằm trong danh sách gợi ý", () => {
  assert.ok(SUGGESTED_CHANNELS.includes(DEFAULT_CHANNEL));
});

test("channelUrl: chỉ dựng link cho handle hợp lệ", () => {
  assert.equal(channelUrl("@bbclearningenglish"), "https://www.youtube.com/@bbclearningenglish");
  assert.equal(channelUrl("bbclearningenglish"), "");
  assert.equal(channelUrl(""), "");
  assert.equal(channelUrl(null), "");
});

test("alreadyAdded: đánh dấu kênh đã có video trong danh mục", () => {
  const marked = alreadyAdded(SUGGESTED_CHANNELS, [{ channel: "BBC Learning English" }, { channel: "ted-ed" }]);
  const byName = Object.fromEntries(marked.map((channel) => [channel.name, channel.added]));
  assert.equal(byName["BBC Learning English"], true);
  // So không phân biệt hoa thường: YouTube trả tên kênh không cố định kiểu chữ.
  assert.equal(byName["TED-Ed"], true);
  assert.equal(byName["Kurzgesagt – In a Nutshell"], false);
});

test("alreadyAdded: danh mục rỗng hoặc sai kiểu thì không kênh nào bị đánh dấu", () => {
  for (const input of [[], null, undefined]) {
    assert.ok(alreadyAdded(SUGGESTED_CHANNELS, input).every((channel) => !channel.added));
  }
  assert.deepEqual(alreadyAdded(null, []), []);
});
