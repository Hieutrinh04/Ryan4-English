// Bộ đếm thời gian luyện nói. Module đọc localStorage nên cần một bản giả —
// môi trường Node không có sẵn.
import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { logSpeaking, readSpeaking, speakingKey, speakingMinutes } = await import("../lib/speaking-log.mjs");
const { localDateString } = await import("../lib/srs.mjs");

function reset() {
  store.clear();
}

test("chưa nói lần nào thì trả về bảng rỗng", () => {
  reset();
  assert.deepEqual(readSpeaking(), {});
  assert.equal(speakingMinutes({}, 7), 0);
});

test("cộng dồn nhiều lượt trong cùng một ngày", () => {
  reset();
  logSpeaking(30);
  const after = logSpeaking(45);
  assert.equal(after[localDateString()], 75);
});

test("bỏ qua số giây không hợp lệ thay vì ghi rác", () => {
  reset();
  logSpeaking(20);
  logSpeaking(0);
  logSpeaking(-5);
  logSpeaking(Number.NaN);
  assert.deepEqual(readSpeaking(), { [localDateString()]: 20 });
});

test("dữ liệu hỏng trong localStorage không làm sập phần đọc", () => {
  reset();
  store.set(speakingKey, "{không phải JSON");
  assert.deepEqual(readSpeaking(), {});
  store.set(speakingKey, JSON.stringify({ "2026-08-19": "nhiều" }));
  assert.deepEqual(readSpeaking(), {});
});

test("speakingMinutes chỉ cộng những ngày trong khoảng đang xét", () => {
  const day = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return localDateString(date);
  };
  const data = { [day(0)]: 120, [day(3)]: 180, [day(10)]: 600 };
  assert.equal(speakingMinutes(data, 1), 2);
  assert.equal(speakingMinutes(data, 7), 5);
  assert.equal(speakingMinutes(data, 30), 15);
});
