import assert from "node:assert/strict";
import test from "node:test";

import { OTHER_TOPIC, TOPICS, topicById, topicOf, topicShelves, videosInTopic } from "../lib/topics.mjs";

test("mỗi chủ đề đều có đủ thông tin để dựng thẻ", () => {
  for (const topic of TOPICS) {
    assert.ok(topic.id, "thiếu mã");
    assert.ok(topic.name, `${topic.id} thiếu tên`);
    assert.ok(topic.blurb, `${topic.id} thiếu mô tả`);
    assert.ok(topic.levels, `${topic.id} thiếu cấp độ`);
    assert.ok(topic.channels.length, `${topic.id} không có kênh nào để nạp`);
    assert.ok(topic.match.length, `${topic.id} không có cách nhận ra video của mình`);
  }
});

test("mã chủ đề không trùng nhau", () => {
  const ids = TOPICS.map((topic) => topic.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("mọi handle kênh viết đúng dạng @tên", () => {
  // Handle sai thì API trả rỗng mà không báo lỗi — sai ở đây là màn hình chết.
  for (const topic of TOPICS) {
    for (const handle of topic.channels) assert.match(handle, /^@[\w.-]+$/, `${topic.id}: handle lạ "${handle}"`);
  }
});

test("chủ đề 'Video của bạn' không được trùng mã với chủ đề thật", () => {
  assert.equal(topicById(OTHER_TOPIC.id), null);
});

test("topicOf: nhận ra chủ đề qua tên kênh", () => {
  assert.equal(topicOf({ channel: "BBC Learning English" }), "daily");
  assert.equal(topicOf({ channel: "VOA Learning English" }), "news");
  assert.equal(topicOf({ channel: "TED-Ed" }), "ted");
  assert.equal(topicOf({ channel: "StorylineOnline" }), "stories");
  assert.equal(topicOf({ channel: "Learn Easy English" }), "easy");
  assert.equal(topicOf({ channel: "Easy British English" }), "conversations");
});

test("topicOf: không phân biệt hoa thường và khoảng trắng thừa", () => {
  assert.equal(topicOf({ channel: "  bbc   LEARNING english " }), "daily");
});

test("topicOf: chủ đề đã lưu trên video thì ưu tiên hơn tên kênh", () => {
  // Người dùng tự thêm video BBC vào chủ đề IELTS thì phải tôn trọng lựa chọn đó.
  assert.equal(topicOf({ topic: "ielts", channel: "BBC Learning English" }), "ielts");
});

test("topicOf: chủ đề đã lưu nhưng không còn tồn tại thì quay về đoán theo kênh", () => {
  assert.equal(topicOf({ topic: "chu-de-da-xoa", channel: "TED-Ed" }), "ted");
});

test("topicOf: kênh lạ hoặc thiếu dữ liệu thì vào 'Video của bạn'", () => {
  assert.equal(topicOf({ channel: "Kênh nào đó" }), OTHER_TOPIC.id);
  assert.equal(topicOf({}), OTHER_TOPIC.id);
  assert.equal(topicOf(null), OTHER_TOPIC.id);
});

test("topicShelves: đếm số video và số bài đã có phụ đề", () => {
  const videos = [
    { videoId: "a", channel: "BBC Learning English" },
    { videoId: "b", channel: "BBC Learning English" },
    { videoId: "c", channel: "TED-Ed" },
  ];
  const shelves = topicShelves(videos, [{ videoId: "a" }]);
  const daily = shelves.find((s) => s.id === "daily");
  assert.equal(daily.count, 2);
  assert.equal(daily.ready, 1, "chỉ video đã lấy được phụ đề mới tính là sẵn sàng");
  assert.equal(shelves.find((s) => s.id === "ted").count, 1);
});

test("topicShelves: chủ đề chưa có video vẫn hiện, để người học biết mà nạp", () => {
  const shelves = topicShelves([], []);
  assert.equal(shelves.length, TOPICS.length);
  for (const shelf of shelves) assert.equal(shelf.count, 0);
});

test("topicShelves: 'Video của bạn' chỉ hiện khi thật sự có video lạc", () => {
  assert.equal(topicShelves([{ videoId: "a", channel: "TED-Ed" }], []).some((s) => s.id === OTHER_TOPIC.id), false);
  const co = topicShelves([{ videoId: "z", channel: "Kênh lạ" }], []);
  assert.equal(co.find((s) => s.id === OTHER_TOPIC.id).count, 1);
});

test("topicShelves: dữ liệu sai kiểu thì không nổ", () => {
  assert.equal(topicShelves(null, null).length, TOPICS.length);
});

test("videosInTopic: lấy đúng video của một chủ đề", () => {
  const videos = [
    { videoId: "a", channel: "BBC Learning English" },
    { videoId: "b", channel: "TED-Ed" },
  ];
  assert.deepEqual(videosInTopic(videos, "daily").map((v) => v.videoId), ["a"]);
  assert.deepEqual(videosInTopic(videos, "khong-co"), []);
});

test("tên kênh na ná nhau không rơi nhầm chủ đề", () => {
  // "Learn Easy English" và "Easy British English" chỉ khác vài chữ, mà một cái
  // là chủ đề dễ nghe còn cái kia là hội thoại. Thứ tự trong TOPICS quyết định
  // ai bắt trước, nên phải chốt lại kẻo đảo thứ tự là lệch hết.
  assert.equal(topicOf({ channel: "Learn Easy English" }), "easy");
  assert.equal(topicOf({ channel: "Easy British English" }), "conversations");
  assert.equal(topicOf({ channel: "BBC Learning English" }), "daily");
  assert.equal(topicOf({ channel: "VOA Learning English" }), "news");
});
