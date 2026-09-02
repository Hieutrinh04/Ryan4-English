import assert from "node:assert/strict";
import test from "node:test";
import {
  alignTranscript,
  cleanCaptionText,
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

test("cleanCaptionText: bỏ ký hiệu người nói và âm thanh, giữ nguyên lời thật", () => {
  assert.equal(cleanCaptionText("York City, >> [music] >> I just finished season 2."), "York City, I just finished season 2.");
  assert.equal(cleanCaptionText("[Music]"), "");
  assert.equal(cleanCaptionText("With season [music] 2, I felt like I really tried."), "With season 2, I felt like I really tried.");
});

test("cuesFromJson3: transcript mốc giây không cộng thêm nửa giây vào câu trước", () => {
  const cues = cuesFromJson3({
    timingPrecision: "second",
    events: [
      { tStartMs: 1000, dDurationMs: 4000, segs: [{ utf8: "Hello there. As you can see, I'm not in my usual setting." }] },
      { tStartMs: 5000, dDurationMs: 6000, segs: [{ utf8: "Today we are in New York City." }] },
    ],
  });
  assert.equal(cues[0].end, 5, "câu đầu phải dừng trước chữ Today ở giây 5");
  assert.equal(cues[1].start, 5, "câu sau bắt đầu đúng mốc YouTube hiển thị");
});

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

test("sentencesFrom: không xé New York City khi dòng trước đã chứa hai câu hoàn chỉnh", () => {
  const cues = cuesFromJson3({
    timingPrecision: "second",
    events: [
      {
        tStartMs: 1000,
        dDurationMs: 5000,
        segs: [{ utf8: "Hello there. As you can see, I'm not in my usual setting. Today we are in New" }],
      },
      {
        tStartMs: 6000,
        dDurationMs: 5000,
        segs: [{ utf8: "York City, >> [music] >> I just finished season 2 on my channel." }],
      },
    ],
  });
  const sentences = sentencesFrom(cues);
  assert.equal(sentences.length, 1);
  assert.match(sentences[0].text, /New York City/);
  assert.doesNotMatch(sentences[0].text, />>|\[music\]/i);
});

test("cuesFromJson3: bỏ cue lặp liên tiếp của phụ đề cuộn", () => {
  const cues = cuesFromJson3({ events: [
    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "Hello there." }] },
    { tStartMs: 1500, dDurationMs: 1500, segs: [{ utf8: "Hello there." }] },
    { tStartMs: 3000, dDurationMs: 1500, segs: [{ utf8: "How are you?" }] },
  ] });
  assert.deepEqual(cues.map((cue) => cue.text), ["Hello there.", "How are you?"]);
});

test("sentencesFrom: đoạn không có dấu chấm vẫn bị cắt, không thành câu dài vô tận", () => {
  const cues = Array.from({ length: 10 }, (_, i) => ({ start: i, end: i + 1, text: "word word word word word" }));
  const sentences = sentencesFrom(cues, { maxWords: 12 });
  assert.ok(sentences.length >= 4, `chỉ cắt được ${sentences.length} câu`);
  for (const sentence of sentences) assert.ok(sentence.text.split(" ").length <= 15);
});

test("sentencesFrom: không cắt ý ở dấu ba chấm trước phần bổ nghĩa tiếp theo", () => {
  const sentences = sentencesFrom([
    { start: 16, end: 17, text: '"I don\'t want to know."' },
    { start: 17, end: 18, text: "So last week," },
    { start: 18, end: 19, text: "I opened my LinkedIn and" },
    { start: 19, end: 20, text: "the first thing I see was ..." },
    { start: 20, end: 24, text: "Meta laid off 8,000 employees because of AI." },
  ]);
  assert.equal(sentences.length, 1);
  assert.match(sentences[0].text, /was \.\.\. Meta laid off/);
  assert.equal(sentences[0].start, 16);
  assert.equal(sentences[0].end, 24);
});

test("cuesFromJson3: transcript mốc tròn dùng nguyên ranh giới YouTube, không chồng hai đoạn", () => {
  const cues = cuesFromJson3({
    timingPrecision: "second",
    events: [
      { tStartMs: 16000, dDurationMs: 4550, segs: [{ utf8: "The first thing I see was ..." }] },
      { tStartMs: 20000, dDurationMs: 3550, segs: [{ utf8: "Meta laid off employees." }] },
    ],
  });
  assert.equal(cues[0].start, 16, "không cắt phần mở đầu video");
  assert.equal(cues[0].end, 20);
  assert.equal(cues[1].start, 20);
  assert.equal(cues[0].end, cues[1].start, "cuối đoạn trước và đầu đoạn sau phải là cùng một mốc");
});

test("cuesFromJson3: mốc mili-giây theo dòng không phát lấn câu kế tiếp", () => {
  const cues = cuesFromJson3({
    timingPrecision: "millisecond",
    events: [
      { tStartMs: 27000, dDurationMs: 4100, segs: [{ utf8: "compliments ever. So, thank you." }] },
      { tStartMs: 30000, dDurationMs: 4000, segs: [{ utf8: "So today let's talk about filming." }] },
    ],
  });
  assert.equal(cues[0].end, 30, "mốc của cả dòng phải dừng tại đầu dòng kế tiếp");
  assert.equal(cues[1].start, 30);
});

test("cuesFromJson3: timestamp từng từ được giữ phần chồng nhỏ", () => {
  const cues = cuesFromJson3({
    timingPrecision: "word",
    events: [
      { tStartMs: 27000, dDurationMs: 4100, segs: [{ utf8: "compliments ever. So, thank you.", tOffsetMs: 0 }] },
      { tStartMs: 30000, dDurationMs: 4000, segs: [{ utf8: "So today let's talk about filming.", tOffsetMs: 0 }] },
    ],
  });
  assert.equal(cues[0].end, 31.1);
});

test("cuesFromJson3: dùng tOffsetMs để giữ timestamp theo từng từ", () => {
  const cues = cuesFromJson3({
    events: [
      {
        tStartMs: 16000,
        dDurationMs: 8500,
        segs: [
          { utf8: "So last week, ", tOffsetMs: 0 },
          { utf8: "I opened my LinkedIn ", tOffsetMs: 1200 },
          { utf8: "and the first thing I see was ... ", tOffsetMs: 3500 },
          { utf8: "Meta laid off 8,000 employees because of AI.", tOffsetMs: 6200 },
        ],
      },
      {
        tStartMs: 24500,
        dDurationMs: 3500,
        segs: [{ utf8: "And immediately, all my friends were freaking out.", tOffsetMs: 0 }],
      },
    ],
  });
  assert.deepEqual(cues.map((cue) => cue.start), [16, 17.2, 19.5, 22.2, 24.5]);
  assert.equal(cues[3].end, 24.5);
  assert.equal(cues[3].end, cues[4].start, "từ cuối đoạn 5 không được phát lại ở đầu đoạn 6");

  const sentences = sentencesFrom(cues);
  assert.equal(sentences[0].end, 24.5);
  assert.equal(sentences[1].start, 24.5);
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

test("sentencesFrom: hội thoại câu ngắn được gộp cho đủ dài, không chia vụn", () => {
  // "Hi Neil. How are you?" đã là hai câu nhưng chỉ năm chữ. Đóng đoạn ngay ở đó
  // thì nhại xong chưa kịp vào nhịp đã hết.
  const cues = [
    { start: 0, end: 1.4, text: "Hi Neil. How are you?" },
    { start: 1.4, end: 3.6, text: "I'm very well thank you, Georgie." },
    { start: 3.6, end: 5.2, text: "Are you enjoying your coffee?" },
    { start: 5.2, end: 8.1, text: "I am, but it's got a bit cool now." },
  ];
  const cau = sentencesFrom(cues);
  assert.ok(cau[0].text.split(/\s+/).length >= 10, `đoạn đầu chỉ ${cau[0].text.split(/\s+/).length} chữ, vẫn còn vụn`);
  // Gộp rồi thì mốc vẫn phải là mốc thật của dòng phụ đề.
  const that = new Set(cues.flatMap((c) => [c.start, c.end]));
  for (const s of cau) assert.ok(that.has(s.start) && that.has(s.end));
});

test("sentencesFrom: đoạn cuối ngắn thì chấp nhận, không có gì để gộp thêm", () => {
  const cau = sentencesFrom([{ start: 0, end: 2, text: "Oh, that's a shame." }]);
  assert.equal(cau.length, 1);
  assert.equal(cau[0].end, 2);
});

test("sentencesFrom: minWords không được phá trần maxWords", () => {
  const cues = Array.from({ length: 8 }, (_, i) => ({
    start: i * 2, end: i * 2 + 2,
    text: "One two three four five six seven eight.",
  }));
  for (const s of sentencesFrom(cues, { maxWords: 20, minWords: 18 })) {
    assert.ok(s.text.split(/\s+/).length <= 20, `đoạn ${s.text.split(/\s+/).length} chữ vượt trần 20`);
  }
});
