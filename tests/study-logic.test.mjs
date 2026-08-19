// Kiểm thử lịch ôn Leitner, chuỗi ngày học và câu khuyết.
//
// Trước đây bài này trích hàm ra khỏi app/page.tsx bằng biểu thức chính quy rồi
// dựng lại bằng new Function(). Cách đó vừa dễ vỡ khi đổi chữ ký hàm, vừa không
// bắt được lỗi kiểu, lại buộc thuật toán phải nằm trong file giao diện. Giờ
// thuật toán ở lib/srs.mjs và bài kiểm thử import thẳng.
import assert from "node:assert/strict";
import test from "node:test";
import { BOX_INTERVALS, daysUntil, isDueForReview, localDateString, scheduleFor, streakFrom, weekdayIndex, wordState } from "../lib/srs.mjs";
import { clozeFor } from "../lib/cloze.mjs";

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

test("scheduleFor: khoảng chờ bám bảng hộp, riêng Dễ thì giãn thêm", () => {
  assert.equal(scheduleFor({ box: 1, intervalDays: 1 }, "good").interval, BOX_INTERVALS[2]);
  assert.equal(scheduleFor({ box: 2, intervalDays: 3 }, "good").interval, BOX_INTERVALS[3]);
  // Dễ nhảy hai hộp rồi nhân 1,3 lần.
  assert.equal(scheduleFor({ box: 1, intervalDays: 1 }, "easy").interval, Math.round(BOX_INTERVALS[3] * 1.3));
  // Khó giữ nguyên hộp và rút ngắn khoảng chờ cũ còn 60%, tối thiểu 1 ngày.
  assert.equal(scheduleFor({ box: 4, intervalDays: 10 }, "hard").interval, 6);
  assert.equal(scheduleFor({ box: 2, intervalDays: 1 }, "hard").interval, 1);
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

test("streakFrom: không phụ thuộc thứ tự đầu vào", () => {
  const xuoi = [dayOffset(-2), dayOffset(-1), dayOffset(0)];
  assert.deepEqual(streakFrom([...xuoi].reverse()), streakFrom(xuoi));
});

test("wordState: phân loại đúng bốn trạng thái", () => {
  assert.equal(wordState({ box: 6 }).key, "mastered");
  assert.equal(wordState({ box: 1, status: "mastered" }).key, "mastered");
  assert.equal(wordState({ box: 1, status: "new", reviewCount: 0 }).key, "new");
  assert.equal(wordState({ box: 2, reviewCount: 3, dueDate: dayOffset(-1) }).key, "due");
  assert.equal(wordState({ box: 2, reviewCount: 3, dueDate: dayOffset(3) }).key, "waiting");
  // Đến hạn đúng hôm nay vẫn phải học hôm nay.
  assert.equal(wordState({ box: 2, reviewCount: 3, dueDate: dayOffset(0) }).key, "due");
});

test("isDueForReview: lấy cả từ đến hạn lẫn từ chưa học", () => {
  assert.equal(isDueForReview({ box: 1, status: "new", reviewCount: 0 }), true);
  assert.equal(isDueForReview({ box: 2, reviewCount: 3, dueDate: dayOffset(-1) }), true);
  assert.equal(isDueForReview({ box: 2, reviewCount: 3, dueDate: dayOffset(3) }), false);
  assert.equal(isDueForReview({ box: 6 }), false);
});

test("clozeFor: khoét đúng từ kể cả khi từ khoá dính nhiễu OCR", () => {
  assert.equal(clozeFor("walk", "I walk to school."), "I _____ to school.");
  assert.equal(clozeFor("white (n, adj)", "She wore a white shirt."), "She wore a _____ shirt.");
  assert.equal(clozeFor("bus bicycle", "The bus is late."), "The _____ is late.");
  assert.equal(clozeFor("actor/ actress", "The actor forgot his lines."), "The _____ forgot his lines.");
  assert.equal(clozeFor("zzz", "Nothing here."), "Nothing here.");
});

test("daysUntil: đếm theo lịch máy, không lệch múi giờ", () => {
  assert.equal(daysUntil(dayOffset(0)), 0);
  assert.equal(daysUntil(dayOffset(1)), 1);
  assert.equal(daysUntil(dayOffset(-1)), -1);
});

test("localDateString và weekdayIndex bám lịch địa phương", () => {
  assert.equal(localDateString(new Date(2026, 0, 5)), "2026-01-05");
  // 05/01/2026 là thứ Hai → 0 theo thứ tự dayNames.
  assert.equal(weekdayIndex(new Date(2026, 0, 5)), 0);
  assert.equal(weekdayIndex(new Date(2026, 0, 11)), 6, "Chủ Nhật là 6");
});
