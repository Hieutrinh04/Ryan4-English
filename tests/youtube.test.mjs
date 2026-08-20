import assert from "node:assert/strict";
import test from "node:test";
import {
  alignTranscript,
  cuesFromJson3,
  embedUrl,
  pickEnglishTrack,
  properNouns,
  scoreDictation,
  secondsFromIso,
  sentencesFrom,
  sliceJsonArray,
  videoIdFrom,
  wordShapes,
} from "../lib/youtube.mjs";

test("videoIdFrom: nhận mọi dạng đường dẫn YouTube thường gặp", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(videoIdFrom(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(videoIdFrom(`https://youtu.be/${id}`), id);
  assert.equal(videoIdFrom(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(videoIdFrom(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(videoIdFrom(`https://m.youtube.com/watch?v=${id}&t=90s`), id);
  assert.equal(videoIdFrom(`youtube.com/watch?v=${id}`), id);
  // Dán thẳng mã video cũng được.
  assert.equal(videoIdFrom(id), id);
});

test("videoIdFrom: đường dẫn không phải YouTube thì trả về rỗng, không đoán bừa", () => {
  assert.equal(videoIdFrom("https://vimeo.com/12345"), "");
  assert.equal(videoIdFrom("https://youtube.com.kẻ-giả-mạo.net/watch?v=dQw4w9WgXcQ"), "");
  assert.equal(videoIdFrom("https://www.youtube.com/watch?v=quá-ngắn"), "");
  assert.equal(videoIdFrom(""), "");
  assert.equal(videoIdFrom(null), "");
});

test("embedUrl: dùng tên miền không gắn cookie và mở đúng mốc thời gian", () => {
  const url = embedUrl("dQw4w9WgXcQ", { start: 42.7 });
  assert.match(url, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.match(url, /start=42/);
  assert.doesNotMatch(embedUrl("dQw4w9WgXcQ"), /start=/);
});

test("sliceJsonArray: cắt đúng mảng dù bên trong có mảng và ngoặc trong chuỗi", () => {
  const html = `xxx "captionTracks":[{"a":[1,2],"name":"có ] trong chuỗi"},{"b":3}] yyy`;
  const raw = sliceJsonArray(html, '"captionTracks":');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0].a, [1, 2]);
});

test("sliceJsonArray: không có dấu hiệu thì trả về null", () => {
  assert.equal(sliceJsonArray("không có gì", '"captionTracks":'), null);
});

test("pickEnglishTrack: ưu tiên bản người làm hơn bản máy tự nghe", () => {
  const tracks = [
    { languageCode: "vi" },
    { languageCode: "en", kind: "asr" },
    { languageCode: "en-GB" },
  ];
  assert.equal(pickEnglishTrack(tracks).languageCode, "en-GB");
  assert.equal(pickEnglishTrack([{ languageCode: "en", kind: "asr" }]).kind, "asr");
  assert.equal(pickEnglishTrack([{ languageCode: "vi" }]), null);
  assert.equal(pickEnglishTrack([]), null);
});

test("cuesFromJson3: đổi mili giây sang giây và bỏ đoạn rỗng", () => {
  const cues = cuesFromJson3({
    events: [
      { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "Hello" }, { utf8: " there" }] },
      { tStartMs: 1500, dDurationMs: 500, segs: [{ utf8: "\n" }] },
      { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: "How are you?" }] },
    ],
  });
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 0, end: 1.5, text: "Hello there" });
  assert.equal(cues[1].start, 2);
});

test("sentencesFrom: gom các dòng và hai câu ngắn thành một đoạn luyện", () => {
  // Phụ đề cắt theo dòng hiển thị, một câu hay bị xé làm đôi.
  const sentences = sentencesFrom([
    { start: 0, end: 2, text: "I usually get up" },
    { start: 2, end: 4, text: "at quarter past six." },
    { start: 4, end: 6, text: "I often have porridge." },
  ]);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, "I usually get up at quarter past six. I often have porridge.");
  assert.equal(sentences[0].start, 0);
  assert.equal(sentences[0].end, 6);
  assert.equal(sentences[0].index, 1);
});

test("sentencesFrom: đoạn không có dấu chấm vẫn bị cắt, không thành câu dài vô tận", () => {
  const cues = Array.from({ length: 10 }, (_, i) => ({ start: i, end: i + 1, text: "word word word word word" }));
  const sentences = sentencesFrom(cues, { maxWords: 12 });
  assert.ok(sentences.length >= 4, `chỉ cắt được ${sentences.length} câu`);
  for (const sentence of sentences) assert.ok(sentence.text.split(" ").length <= 15);
});

test("sentencesFrom: không có phụ đề thì trả về mảng rỗng", () => {
  assert.deepEqual(sentencesFrom([]), []);
  assert.deepEqual(sentencesFrom(null), []);
});

test("wordShapes: đếm đúng số chữ cái, bỏ dấu câu", () => {
  const shapes = wordShapes("How often do you...?");
  assert.deepEqual(shapes.map((s) => s.letters), [3, 5, 2, 3]);
});

test("properNouns: chỉ lấy tên riêng giữa câu, không lấy từ đầu câu", () => {
  // Từ đầu câu viết hoa vì luật chính tả, không phải vì là tên riêng.
  assert.deepEqual(properNouns("How about you, Buli? What is your daily routine?"), ["Buli"]);
  assert.deepEqual(properNouns("Hello there."), []);
});

test("scoreDictation: đếm số từ khớp và ra phần trăm", () => {
  const result = scoreDictation("I never go skateboarding", "I never go");
  assert.equal(result.total, 4);
  assert.equal(result.matched, 3);
  assert.equal(result.percent, 75);
  assert.deepEqual(result.words.map((w) => w.ok), [true, true, true, false]);
});

test("scoreDictation: bỏ qua chữ hoa và dấu câu", () => {
  assert.equal(scoreDictation("How are you?", "how are you").percent, 100);
});

test("scoreDictation: thiếu từ ở đầu không làm cả câu thành sai", () => {
  // So theo tập hợp từ, không theo vị trí: nghe đúng gần hết thì phải được ghi nhận.
  assert.equal(scoreDictation("Do you go skateboarding often", "you go skateboarding often").percent, 80);
});

test("scoreDictation: chưa gõ gì thì 0%, không phải NaN", () => {
  assert.equal(scoreDictation("Hello there", "").percent, 0);
  assert.equal(scoreDictation("", "gì đó").percent, 0);
});

test("scoreDictation: gõ lặp một từ không ăn gian được điểm", () => {
  // "the the the" không được tính là khớp ba từ khác nhau.
  const result = scoreDictation("the cat sat", "the the the");
  assert.equal(result.matched, 1);
});

test("alignTranscript: cắt câu và ước lượng mốc giờ trải đều hết video", async () => {
  const { alignTranscript } = await import("../lib/youtube.mjs");
  const rows = alignTranscript("Hello there. How are you today? I am fine.", 60);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].start, 0);
  // Câu cuối phải kết thúc đúng ở cuối video, không hụt và không vượt.
  assert.ok(Math.abs(rows.at(-1).end - 60) < 0.1, `kết thúc ở ${rows.at(-1).end}`);
  // Mốc giờ phải tăng dần, không được chồng lên nhau.
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i].start >= rows[i - 1].start);
});

test("alignTranscript: luôn đánh dấu là ước lượng", () => {
  // Không được để người học tưởng đây là phụ đề có mốc giờ thật.
  const rows = alignTranscript("Một câu. Hai câu.", 30);
  for (const row of rows) assert.equal(row.estimated, true);
});

test("alignTranscript: bỏ qua đoạn nhạc hiệu đầu video", () => {
  const rows = alignTranscript("Hello there. How are you?", 60, { leadIn: 10 });
  assert.equal(rows[0].start, 10);
  assert.ok(Math.abs(rows.at(-1).end - 60) < 0.1);
});

test("alignTranscript: câu dài không dấu chấm vẫn bị cắt nhỏ", () => {
  const rows = alignTranscript(Array.from({ length: 80 }, () => "word").join(" "), 60, { maxWords: 20 });
  assert.equal(rows.length, 4);
});

test("alignTranscript: lời thoại rỗng thì trả về mảng rỗng", () => {
  assert.deepEqual(alignTranscript("", 60), []);
  assert.deepEqual(alignTranscript(null, 60), []);
});

test("alignTranscript: không biết thời lượng thì mốc giờ về 0, không ra NaN", () => {
  const rows = alignTranscript("Hello there. How are you?", 0);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(Number.isFinite(row.start) && Number.isFinite(row.end));
    assert.equal(row.start, 0);
  }
});

test("secondsFromIso: đọc đúng mọi dạng thời lượng của YouTube", async () => {
  const { secondsFromIso } = await import("../lib/youtube.mjs");
  assert.equal(secondsFromIso("PT14M4S"), 844);
  assert.equal(secondsFromIso("PT1H2M3S"), 3723);
  assert.equal(secondsFromIso("PT45S"), 45);
  assert.equal(secondsFromIso("PT3M"), 180);
  assert.equal(secondsFromIso("P1DT2H"), 93600);
});

test("secondsFromIso: giá trị hỏng thì trả 0, không ra NaN", () => {
  assert.equal(secondsFromIso("linh tinh"), 0);
  assert.equal(secondsFromIso(""), 0);
  assert.equal(secondsFromIso(null), 0);
});
