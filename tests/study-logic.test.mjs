// Kiểm thử các hàm thuần điều khiển lịch ôn, chuỗi ngày học và câu khuyết.
// Hàm được trích thẳng từ app/page.tsx để bài kiểm thử không lệch với mã đang chạy.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `không tìm thấy hàm ${name}`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`không tìm được điểm kết thúc của ${name}`);
}

const names = ["scheduleFor", "streakFrom", "localDateString", "weekdayIndex", "clozeFor", "daysUntil"];
const stripTypes = extract.length && names.map(extract).join("\n").replace(/: ?WordCard|: ?Rating|: ?string\[\]|: ?string|: ?number|: ?Date/g, "");
const { scheduleFor, streakFrom, localDateString, clozeFor, daysUntil } = new Function(`${stripTypes}; return { ${names.join(", ")} };`)();

const dayOffset = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDateString(date);
};

test("scheduleFor: quên thì luôn ôn lại sau 1 ngày", () => {
  assert.deepEqual(scheduleFor({ box: 1, intervalDays: 1 }, "again"), { box: 1, interval: 1 });
  assert.deepEqual(scheduleFor({ box: 3, intervalDays: 7 }, "again"), { box: 1, interval: 1 });
  // Từ đã thuộc tụt về hộp 2 nhưng vẫn phải gặp lại ngay hôm sau.
  assert.deepEqual(scheduleFor({ box: 6, intervalDays: 90 }, "again"), { box: 2, interval: 1 });
});

test("scheduleFor: hộp Leitner không vượt quá 6", () => {
  assert.equal(scheduleFor({ box: 5, intervalDays: 30 }, "easy").box, 6);
  assert.equal(scheduleFor({ box: 6, intervalDays: 90 }, "easy").box, 6);
  assert.equal(scheduleFor({ box: 1, intervalDays: 1 }, "good").box, 2);
  assert.equal(scheduleFor({ box: 4, intervalDays: 14 }, "hard").box, 4);
});

test("streakFrom: chuỗi ngày học", () => {
  assert.deepEqual(streakFrom([]), { current: 0, best: 0, studiedToday: false });
  assert.equal(streakFrom([dayOffset(-2), dayOffset(-1), dayOffset(0)]).current, 3);
  // Hôm nay chưa học nhưng hôm qua có thì chuỗi vẫn đang chạy.
  assert.equal(streakFrom([dayOffset(-2), dayOffset(-1)]).current, 2);
  // Bỏ trọn một ngày thì chuỗi đứt.
  assert.equal(streakFrom([dayOffset(-5), dayOffset(-4)]).current, 0);
  assert.equal(streakFrom([dayOffset(-9), dayOffset(-8), dayOffset(-7), dayOffset(-1), dayOffset(0)]).best, 3);
});

test("clozeFor: khoét đúng từ kể cả khi từ khoá dính nhiễu OCR", () => {
  assert.equal(clozeFor("walk", "I walk to school."), "I _____ to school.");
  assert.equal(clozeFor("white (n, adj)", "She wore a white shirt."), "She wore a _____ shirt.");
  assert.equal(clozeFor("bus bicycle", "The bus is late."), "The _____ is late.");
  assert.equal(clozeFor("zzz", "Nothing here."), "Nothing here.");
});

test("daysUntil: đếm theo lịch máy, không lệch múi giờ", () => {
  assert.equal(daysUntil(dayOffset(0)), 0);
  assert.equal(daysUntil(dayOffset(1)), 1);
  assert.equal(daysUntil(dayOffset(-1)), -1);
});
