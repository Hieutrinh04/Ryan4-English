import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_WORDS_PER_SECOND,
  TAIL_PAD,
  isSoundLabel,
  segmentPlaybackEnd,
  spokenEnd,
  trimSilentTails,
  usesLegacyHalfSecondBoundaries,
} from "../lib/caption-timing.mjs";

// Mười từ ở tốc độ chậm nhất còn coi là nói: 10 / 1.2 + 0.6 = 8.93 giây.
const tranMuoiTu = 10 / MIN_WORDS_PER_SECOND + TAIL_PAD;

test("mốc phụ đề bình thường thì giữ nguyên", () => {
  // Nói 10 từ trong 3,5 giây là tốc độ thật, không có gì để cắt.
  const text = "one two three four five six seven eight nine ten";
  assert.equal(spokenEnd(10, 13.5, text), 13.5);
});

test("mốc kết thúc hợp lệ không bị tốc độ nói ước lượng cắt hụt", () => {
  // Người nói có thể nói chậm hoặc ngắt nhịp; đã có endMs thật thì phải tin nó.
  const text = "one two three four five six seven eight nine ten";
  assert.equal(spokenEnd(10, 40, text), 40);
});

test("không bao giờ lấn sang đoạn kế tiếp", () => {
  const text = "one two three four five six seven eight nine ten";
  // Phụ đề khai tới 20 nhưng đoạn sau đã bắt đầu ở 14.
  assert.equal(spokenEnd(10, 20, text, 14), 14);
});

test("khoảng trống trước đoạn sau thì không kéo dài ra cho đầy", () => {
  // Chỉ rút ngắn, không bao giờ kéo dài: 13.5 vẫn là 13.5 dù đoạn sau mãi 25 mới tới.
  const text = "one two three four five six seven eight nine ten";
  assert.equal(spokenEnd(10, 13.5, text, 25), 13.5);
});

test("dòng nhạc nền một chữ chỉ được giữ rất ngắn", () => {
  // "[Music]" bám màn hình 40 giây là chuyện thường của phụ đề YouTube.
  const end = spokenEnd(100, 140, "[Music]");
  assert.ok(end - 100 < 2, `giữ ${(end - 100).toFixed(2)} giây, quá dài cho một chữ`);
});

test("đoạn không lời vẫn còn một khoảnh khắc nghe được", () => {
  // Không chữ nào thì chỉ còn phần chừa cho phụ âm cuối.
  assert.equal(+spokenEnd(5, 5, "").toFixed(2), +(5 + TAIL_PAD).toFixed(2));
  assert.ok(spokenEnd(5, 5, "") > 5, "không được trả về đúng mốc bắt đầu");
});

test("mốc kết thúc nằm trước mốc bắt đầu thì xử như thiếu", () => {
  // Dữ liệu hỏng thì suy từ tốc độ nói, đừng cụt về mức tối thiểu.
  assert.equal(+spokenEnd(5, 4, "gì đó").toFixed(2), +(5 + 2 / MIN_WORDS_PER_SECOND + TAIL_PAD).toFixed(2));
});

test("thiếu mốc kết thúc thì suy ra từ tốc độ nói", () => {
  const text = "one two three four five six seven eight nine ten";
  assert.equal(+spokenEnd(0, undefined, text).toFixed(2), +tranMuoiTu.toFixed(2));
  assert.equal(+spokenEnd(0, null, text).toFixed(2), +tranMuoiTu.toFixed(2));
});

test("trimSilentTails: cắt cả dãy, mỗi đoạn nhìn sang đoạn kế tiếp", () => {
  const cat = trimSilentTails([
    { start: 0, end: 30, text: "Hello and welcome to the programme" },
    { start: 6, end: 60, text: "Today we talk about sleep" },
  ]);
  // Mốc đoạn kế tiếp là hàng rào chắc chắn; không suy đoán theo số từ nữa.
  assert.equal(cat[0].end, 6);
  assert.ok(cat[0].end <= 6, "không bao giờ chạm vào đoạn sau");
  assert.equal(cat[1].end, 60, "đoạn cuối giữ nguyên mốc phụ đề đã khai");
  assert.equal(cat[1].text, "Today we talk about sleep", "không đụng tới nội dung");
});

test("cue có endMs thật được phép chồng nhẹ để không mất từ cuối", () => {
  const [first] = trimSilentTails([
    { start: 27, end: 31.1, text: "compliments ever. So, thank you." },
    { start: 30, end: 34, text: "So today let's talk about filming." },
  ], { nextStartPad: 1.2 });
  assert.equal(first.end, 31.1);
  assert.equal(segmentPlaybackEnd(27, 31.1, 30, false, 1.2), 31.1);
  assert.equal(segmentPlaybackEnd(27, 31.1, 30), 30, "mốc tròn giây vẫn dùng ranh giới cứng");
});

test("trimSilentTails: dãy rỗng hoặc sai kiểu thì không nổ", () => {
  assert.deepEqual(trimSilentTails([]), []);
  assert.deepEqual(trimSilentTails(null), []);
});

test("trimSilentTails: giữ nguyên các trường khác của đoạn", () => {
  const [item] = trimSilentTails([{ index: 3, start: 0, end: 2, text: "Hi there", ghiChu: "giữ lại" }]);
  assert.equal(item.index, 3);
  assert.equal(item.ghiChu, "giữ lại");
});

test("isSoundLabel: nhận ra dòng chỉ mô tả âm thanh", () => {
  assert.equal(isSoundLabel("[Music]"), true);
  assert.equal(isSoundLabel("[APPLAUSE]"), true);
  assert.equal(isSoundLabel("(laughs)"), true);
  assert.equal(isSoundLabel("♪♪"), true);
  assert.equal(isSoundLabel("   "), true);
});

test("isSoundLabel: nhãn nằm giữa câu thật thì vẫn giữ nguyên câu", () => {
  // Bỏ cả dòng này là mất chữ, không phải mất tiếng nhạc.
  assert.equal(isSoundLabel("Well (laughs) that was close."), false);
  assert.equal(isSoundLabel("The music was lovely."), false);
  assert.equal(isSoundLabel("[Music] starts the show."), false);
});

test("bài DOM bản 8 dừng bù lại nửa giây cũ, không phát sang câu kế", () => {
  const sentences = [
    { start: 1, end: 5.5, text: "Hello there. As you can see, I'm not in my usual setting." },
    { start: 5.5, end: 11.5, text: "Today we are in New York City." },
    { start: 11.5, end: 19.5, text: "I just finished season 2." },
  ];
  assert.equal(usesLegacyHalfSecondBoundaries(sentences, 8), true);
  assert.equal(segmentPlaybackEnd(1, 5.5, 5.5, true), 5);
  assert.equal(usesLegacyHalfSecondBoundaries(sentences, 9), false, "bản mới không được tự trừ nửa giây");
});
