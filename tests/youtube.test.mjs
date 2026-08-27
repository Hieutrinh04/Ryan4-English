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

test("sentencesFrom: mốc cắt bám giờ thật của dòng phụ đề, không trải đều trên cụm", () => {
  // Hai dòng cùng 10 từ nhưng nhịp khác hẳn: dòng đầu đọc nhanh trong 1 giây,
  // dòng sau đọc chậm trong 10 giây.
  const cues = [
    { start: 0, end: 1, text: "Alpha bravo charlie delta echo foxtrot golf hotel india juliet." },
    { start: 1, end: 11, text: "Kilo lima mike november oscar papa quebec romeo sierra tango." },
  ];
  const [dau, sau] = sentencesFrom(cues, { maxWords: 12, maxSentences: 2 });
  // Trải đều số từ trên cả cụm sẽ ra 5.5 — tức là câu đầu còn chạy thêm 4,5 giây
  // sang tận giữa câu sau, đúng cái lỗi "nhảy qua đầu câu hai".
  assert.equal(dau.end, 1, "câu đầu phải dứt đúng chỗ dòng phụ đề đầu dứt");
  assert.equal(sau.start, 1, "câu sau phải bắt đầu đúng chỗ dòng phụ đề sau bắt đầu");
  assert.equal(sau.end, 11);
});

test("sentencesFrom: không cắt giữa một dòng phụ đề, dù câu dứt ở giữa dòng", () => {
  // Dòng thứ hai chứa cuối câu một VÀ đầu câu hai — chuyện thường của phụ đề.
  // Cắt ở đó thì mốc chỉ là số chia đều theo từ, nghe ra đoạn hụt mấy chữ cuối.
  // Thà đoạn dài hơn một chút nhưng mốc là giờ thật.
  const cues = [
    { start: 0, end: 2, text: "Hello, this is 6 Minute English" },
    { start: 2, end: 6, text: "from BBC Learning English. I'm Phil." },
  ];
  const cau = sentencesFrom(cues, { maxWords: 30, maxSentences: 1 });
  assert.equal(cau.length, 1);
  assert.equal(cau[0].end, 6, "phải dứt đúng chỗ dòng phụ đề dứt");
  assert.match(cau[0].text, /I'm Phil\./, "không được bỏ rơi phần cuối của dòng");
});

test("sentencesFrom: mọi mốc đều là giờ có thật của phụ đề", () => {
  const cues = [
    { start: 18.24, end: 21.68, text: "One of the most controversial technologies of recent years" },
    { start: 21.68, end: 26.32, text: "is driverless cars, also known as self-driving cars," },
    { start: 26.32, end: 29.32, text: "autonomous cars or robotaxis." },
    { start: 29.32, end: 34.16, text: "Many people say they wouldn't feel safe in a car without a human driver," },
    { start: 34.16, end: 37.44, text: "but there are concerns from other road users too –" },
    { start: 37.44, end: 40.2, text: "pedestrians, runners and cyclists." },
  ];
  const that = new Set(cues.flatMap((c) => [c.start, c.end]));
  for (const cau of sentencesFrom(cues)) {
    assert.ok(that.has(cau.start), `mốc bắt đầu ${cau.start} không có trong phụ đề`);
    assert.ok(that.has(cau.end), `mốc kết thúc ${cau.end} không có trong phụ đề`);
  }
});

test("sentencesFrom: dừng ở chỗ câu vừa dứt thay vì nuốt luôn dòng sau", () => {
  // Không nhìn trước một dòng thì cụm ôm thêm cả câu kế tiếp rồi mới chịu dừng,
  // và đoạn luyện dài gấp đôi mức cần.
  const cues = [
    { start: 0, end: 3, text: "One of the most controversial technologies of recent years" },
    { start: 3, end: 6, text: "is driverless cars, also known as robotaxis." },
    { start: 6, end: 10, text: "Many people say they wouldn't feel safe in a car without a human driver here," },
  ];
  const cau = sentencesFrom(cues, { maxWords: 30, maxSentences: 2 });
  assert.equal(cau[0].end, 6, "phải dừng ngay sau câu vừa dứt");
  assert.match(cau[0].text, /robotaxis\.$/);
});

test("sentencesFrom: một dòng dài quá trần từ thì vẫn phải cắt bên trong nó", () => {
  // Phụ đề máy tự nghe hay cho ra một dòng dài không có dấu chấm nào. Không cắt
  // thì sinh ra một câu không ai chép nổi.
  const dai = Array.from({ length: 40 }, (_, i) => `word${i + 1}`).join(" ");
  const cau = sentencesFrom([{ start: 0, end: 20, text: dai }], { maxWords: 12, maxSentences: 2 });
  assert.ok(cau.length > 1, "dòng quá dài phải được cắt nhỏ");
  assert.equal(cau[0].start, 0);
  assert.equal(cau[cau.length - 1].end, 20, "cắt xong vẫn phủ trọn dòng");
});
