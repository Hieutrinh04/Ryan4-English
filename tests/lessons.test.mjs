// Bài đi vào app qua địa chỉ nên KHÔNG được tin. Các test dưới đây chủ yếu kiểm
// phần làm sạch dữ liệu, vì đó là chỗ duy nhất chặn được bài hỏng lọt vào kho.
import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { MAX_SENTENCES, lessonFromHash, lessonsKey, readLessonProgress, readLessons, removeLesson, sanitiseLesson, saveLesson, sentenceAt } =
  await import("../lib/lessons.mjs");

const good = () => ({
  videoId: "arj7oStGLkU",
  title: "  Một bài   nói  ",
  author: "TED",
  seconds: 844.4,
  source: "extension",
  sentences: [
    { index: 1, start: 0, end: 2.5, text: "Hello there." },
    { index: 2, start: 2.5, end: 5, text: "How are you?" },
  ],
});

test("bài hợp lệ được làm sạch và giữ đủ trường", () => {
  const lesson = sanitiseLesson(good());
  assert.equal(lesson.videoId, "arj7oStGLkU");
  assert.equal(lesson.id, "yt-arj7oStGLkU");
  // Khoảng trắng thừa bị gom lại, không để tiêu đề lộn xộn.
  assert.equal(lesson.title, "Một bài nói");
  assert.equal(lesson.seconds, 844);
  assert.equal(lesson.source, "extension");
  assert.ok(lesson.sentences.length >= 1);
  // Mốc giờ phải trùm từ đầu câu đầu tới cuối câu cuối, kể cả khi có gộp.
  assert.equal(lesson.sentences[0].start, 0);
  assert.equal(lesson.sentences.at(-1).end, 5);
});

test("hai mẩu quá ngắn được gộp thành một câu để luyện", () => {
  // Phụ đề hay cắt "Hello there." và "How are you?" thành hai dòng riêng. Chép
  // chính tả từng mẩu ba chữ thì không luyện được gì, nên gộp lại.
  const lesson = sanitiseLesson(good());
  assert.equal(lesson.sentences.length, 1);
  assert.match(lesson.sentences[0].text, /Hello there./);
  assert.match(lesson.sentences[0].text, /How are you?/);
});

test("câu đã đủ dài thì KHÔNG bị gộp với câu sau", () => {
  const long = "I usually get up at quarter past six and have porridge for breakfast every single morning.";
  const lesson = sanitiseLesson({
    ...good(),
    sentences: [
      { start: 0, end: 6, text: long },
      { start: 6, end: 12, text: long },
    ],
  });
  assert.equal(lesson.sentences.length, 2);
});

test("mã video sai thì loại thẳng, không cố đoán", () => {
  assert.equal(sanitiseLesson({ ...good(), videoId: "quá-ngắn" }), null);
  assert.equal(sanitiseLesson({ ...good(), videoId: "" }), null);
  assert.equal(sanitiseLesson(null), null);
});

test("không có câu nào thì không phải là bài", () => {
  assert.equal(sanitiseLesson({ ...good(), sentences: [] }), null);
  assert.equal(sanitiseLesson({ ...good(), sentences: "không phải mảng" }), null);
  assert.equal(sanitiseLesson({ ...good(), sentences: [{ text: "   " }] }), null);
});

test("mốc giờ hỏng bị đưa về 0 thay vì thành NaN", () => {
  const lesson = sanitiseLesson({ ...good(), sentences: [{ start: "abc", end: -5, text: "Hi." }] });
  assert.equal(lesson.sentences[0].start, 0);
  assert.equal(lesson.sentences[0].end, 0);
});

test("số câu và độ dài câu bị chặn, tránh nhồi dữ liệu khổng lồ", () => {
  const many = Array.from({ length: MAX_SENTENCES + 500 }, () => ({ start: 0, end: 1, text: "Hi." }));
  // Sau khi gộp thì còn ít hơn, nhưng điều cần giữ là KHÔNG vượt trần.
  assert.ok(sanitiseLesson({ ...good(), sentences: many }).sentences.length <= MAX_SENTENCES);
  const long = sanitiseLesson({ ...good(), sentences: [{ start: 0, end: 1, text: "a".repeat(9000) }] });
  assert.ok(long.sentences[0].text.length <= 400);
});

test("nguồn lạ bị quy về 'paste', không tin giá trị gửi tới", () => {
  assert.equal(sanitiseLesson({ ...good(), source: "chỗ nào đó" }).source, "paste");
});

test("số thứ tự câu được đánh lại, không tin số gửi tới", () => {
  const long = "I usually get up at quarter past six and have porridge for breakfast every single morning.";
  const lesson = sanitiseLesson({
    ...good(),
    sentences: [
      { index: 99, start: 0, end: 6, text: long },
      { index: 99, start: 6, end: 12, text: long },
    ],
  });
  assert.deepEqual(lesson.sentences.map((s) => s.index), [1, 2]);
});

test("lessonFromHash: đọc được bài từ phần neo địa chỉ", () => {
  const json = JSON.stringify(good());
  const encoded = encodeURIComponent(Buffer.from(json, "utf8").toString("base64"));
  const decode = (value) => Buffer.from(value, "base64").toString("utf8");
  const lesson = lessonFromHash(`#lesson=${encoded}`, decode);
  assert.equal(lesson.videoId, "arj7oStGLkU");
});

test("lessonFromHash: neo hỏng hoặc không có thì trả null, không ném lỗi", () => {
  const decode = (value) => Buffer.from(value, "base64").toString("utf8");
  assert.equal(lessonFromHash("#lesson=không-phải-base64!!!", decode), null);
  assert.equal(lessonFromHash("#gì-đó-khác", decode), null);
  assert.equal(lessonFromHash("", decode), null);
  assert.equal(lessonFromHash(null, decode), null);
});

test("lưu bài, và lấy lại cùng video thì THAY chứ không thêm bản trùng", () => {
  store.clear();
  saveLesson(good());
  saveLesson({ ...good(), title: "Bản phụ đề tốt hơn" });
  const all = readLessons();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, "Bản phụ đề tốt hơn");
});

test("bài hỏng không được lưu vào kho", () => {
  store.clear();
  saveLesson(good());
  saveLesson({ videoId: "hỏng" });
  assert.equal(readLessons().length, 1);
});

test("dữ liệu hỏng trong localStorage không làm sập phần đọc", () => {
  store.clear();
  store.set(lessonsKey, "{không phải JSON");
  assert.deepEqual(readLessons(), []);
});

test("xoá được một bài", () => {
  store.clear();
  saveLesson(good());
  assert.equal(removeLesson("yt-arj7oStGLkU").length, 0);
});

test("sentenceAt: tìm đúng câu đang phát", () => {
  const sentences = good().sentences;
  assert.equal(sentenceAt(sentences, 0).index, 1);
  assert.equal(sentenceAt(sentences, 2.4).index, 1);
  assert.equal(sentenceAt(sentences, 3).index, 2);
  // Trước câu đầu thì vẫn trả câu đầu, không trả null làm hỏng giao diện.
  assert.equal(sentenceAt(sentences, -5).index, 1);
  assert.equal(sentenceAt([], 0), null);
});

test("đánh dấu câu đã làm, tách riêng theo cách luyện", async () => {
  const { doneSentences, markSentence, readLessonProgress } = await import("../lib/lessons.mjs");
  store.clear();
  markSentence("yt-abc", "dictation", 1);
  markSentence("yt-abc", "dictation", 3);
  // Chép chính tả xong không có nghĩa là đã nói nhại được câu đó.
  markSentence("yt-abc", "shadowing", 1);
  const progress = readLessonProgress();
  assert.deepEqual(doneSentences(progress, "yt-abc", "dictation"), [1, 3]);
  assert.deepEqual(doneSentences(progress, "yt-abc", "shadowing"), [1]);
});

test("đánh dấu lại cùng một câu không tạo bản trùng", async () => {
  const { doneSentences, markSentence } = await import("../lib/lessons.mjs");
  store.clear();
  markSentence("yt-abc", "dictation", 2);
  const progress = markSentence("yt-abc", "dictation", 2);
  assert.deepEqual(doneSentences(progress, "yt-abc", "dictation"), [2]);
});

test("số câu vô lý bị bỏ qua, không ghi rác", async () => {
  const { doneSentences, markSentence } = await import("../lib/lessons.mjs");
  store.clear();
  markSentence("yt-abc", "dictation", 0);
  markSentence("yt-abc", "dictation", -1);
  markSentence("yt-abc", "dictation", 1.5);
  markSentence("", "dictation", 1);
  assert.deepEqual(doneSentences(readLessonProgress(), "yt-abc", "dictation"), []);
});

test("tiến độ hỏng trong localStorage không làm sập phần đọc", async () => {
  const { lessonProgressKey, readLessonProgress } = await import("../lib/lessons.mjs");
  store.clear();
  store.set(lessonProgressKey, "[1,2,3]");
  assert.deepEqual(readLessonProgress(), {});
});

test("xoá tiến độ của một bài không đụng bài khác", async () => {
  const { clearLessonProgress, doneSentences, markSentence } = await import("../lib/lessons.mjs");
  store.clear();
  markSentence("yt-abc", "dictation", 1);
  markSentence("yt-xyz", "dictation", 1);
  const after = clearLessonProgress("yt-abc");
  assert.deepEqual(doneSentences(after, "yt-abc", "dictation"), []);
  assert.deepEqual(doneSentences(after, "yt-xyz", "dictation"), [1]);
});
