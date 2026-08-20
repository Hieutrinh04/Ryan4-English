// Bộ đếm thời gian luyện theo kỹ năng. Module đọc localStorage nên cần một bản
// giả — môi trường Node không có sẵn.
import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { SKILLS, logPractice, minutesBySkill, minutesInRange, minutesPerDay, practiceKey, practiceMigratedKey, readPractice, totalTime } =
  await import("../lib/practice-log.mjs");
const { speakingKey } = await import("../lib/speaking-log.mjs");
const { localDateString } = await import("../lib/srs.mjs");

const NOW = new Date("2026-08-20T10:00:00");
const day = (offset, from = NOW) => {
  const date = new Date(from);
  date.setDate(date.getDate() - offset);
  return localDateString(date);
};

function reset() {
  store.clear();
  // Đánh dấu đã chuyển dữ liệu cũ, để các test không liên quan khỏi bị ảnh hưởng.
  store.set(practiceMigratedKey, "xong");
}

test("chưa luyện lần nào thì trả về bảng rỗng, không phải NaN", () => {
  reset();
  assert.deepEqual(readPractice(), {});
  assert.equal(minutesInRange({}, 7), 0);
  assert.deepEqual(totalTime({}), { minutes: 0, hours: 0, rest: 0 });
});

test("cộng dồn theo đúng kỹ năng và đúng ngày", () => {
  reset();
  logPractice("shadowing", 60);
  logPractice("shadowing", 30);
  const after = logPractice("vocab", 120);
  assert.deepEqual(after[localDateString()], { shadowing: 90, vocab: 120 });
});

test("kỹ năng lạ hoặc số giây vô lý thì bỏ qua, không ghi rác", () => {
  reset();
  logPractice("vocab", 60);
  logPractice("khong-co-that", 999);
  logPractice("vocab", 0);
  logPractice("vocab", -10);
  logPractice("vocab", Number.NaN);
  assert.deepEqual(readPractice()[localDateString()], { vocab: 60 });
});

test("dữ liệu hỏng trong localStorage không làm sập phần đọc", () => {
  reset();
  store.set(practiceKey, "{không phải JSON");
  assert.deepEqual(readPractice(), {});
  store.set(practiceKey, JSON.stringify({ "không-phải-ngày": { vocab: 60 }, "2026-08-20": { vocab: "nhiều", khac: 5 } }));
  // Ngày sai định dạng bị loại; kỹ năng lạ và giá trị không phải số cũng vậy.
  assert.deepEqual(readPractice(), {});
});

test("minutesInRange: lọc đúng khoảng, và lọc được theo kỹ năng", () => {
  const data = {
    [day(0)]: { vocab: 120, shadowing: 60 },
    [day(3)]: { vocab: 180 },
    [day(10)]: { writing: 600 },
  };
  assert.equal(minutesInRange(data, 1, undefined, NOW), 3);
  assert.equal(minutesInRange(data, 7, undefined, NOW), 6);
  assert.equal(minutesInRange(data, 30, undefined, NOW), 16);
  assert.equal(minutesInRange(data, 7, "vocab", NOW), 5);
  assert.equal(minutesInRange(data, 7, "writing", NOW), 0);
});

test("minutesPerDay: luôn đủ số điểm, ngày không học là 0", () => {
  const data = { [day(0)]: { vocab: 120 }, [day(2)]: { vocab: 60 } };
  const rows = minutesPerDay(data, 5, "vocab", NOW);
  assert.equal(rows.length, 5);
  // Ngày trống phải có mặt với giá trị 0, nếu không đường biểu đồ nối tắt qua nó.
  assert.deepEqual(rows.map((row) => row.minutes), [0, 0, 1, 0, 2]);
  assert.equal(rows.at(-1).day, localDateString(NOW));
});

test("minutesBySkill: xếp kỹ năng nhiều giờ lên trước", () => {
  const data = { [day(0)]: { vocab: 60, shadowing: 300, writing: 120 } };
  const rows = minutesBySkill(data, 7, NOW);
  assert.equal(rows[0].key, "shadowing");
  assert.equal(rows[0].minutes, 5);
  assert.equal(rows[1].key, "writing");
  // Mọi kỹ năng đều có mặt, kể cả khi chưa luyện — biểu đồ cần đủ tab.
  assert.equal(rows.length, SKILLS.length);
});

test("totalTime: quy ra giờ và phút", () => {
  assert.deepEqual(totalTime({ [day(0)]: { vocab: 3600 }, [day(1)]: { shadowing: 1800 } }), { minutes: 90, hours: 1, rest: 30 });
});

test("dữ liệu thời gian nói cũ được chuyển sang kỹ năng nói nhại, đúng một lần", () => {
  store.clear();
  store.set(speakingKey, JSON.stringify({ "2026-08-19": 240, "2026-08-20": 120 }));
  const first = readPractice();
  assert.deepEqual(first["2026-08-19"], { shadowing: 240 });
  assert.deepEqual(first["2026-08-20"], { shadowing: 120 });
  // Đọc lại không được cộng thêm lần nữa.
  assert.deepEqual(readPractice()["2026-08-19"], { shadowing: 240 });
  // Khoá cũ vẫn còn: bản mới hỏng thì dữ liệu gốc chưa mất.
  assert.ok(store.get(speakingKey));
});

test("chuyển dữ liệu cũ không đè lên số liệu mới cùng ngày", () => {
  store.clear();
  store.set(practiceKey, JSON.stringify({ "2026-08-19": { vocab: 60, shadowing: 60 } }));
  store.set(speakingKey, JSON.stringify({ "2026-08-19": 240 }));
  const merged = readPractice();
  assert.deepEqual(merged["2026-08-19"], { vocab: 60, shadowing: 300 });
});
