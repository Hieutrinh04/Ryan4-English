import assert from "node:assert/strict";
import test from "node:test";

import { analyseWaveform, expectedProsody, refToExpected, rhythmGroups, scoreProsody } from "../lib/prosody.mjs";

test("rhythmGroups: chia theo ý, không kết cụm bằng từ chức năng", () => {
  const groups = rhythmGroups('I opened my LinkedIn and the first thing I see was Meta laid off 8,000 employees because of AI.');
  assert.ok(groups.length >= 3);
  for (const group of groups) {
    assert.ok(group.words.length <= 7, `cụm quá dài: ${group.text}`);
    assert.doesNotMatch(group.text, /\b(?:and|the|to|of|because)$/i, `cụm kết yếu: ${group.text}`);
  }
});

test("rhythmGroups: mỗi cụm có đúng một trọng âm chính ở từ nội dung", () => {
  const groups = rhythmGroups('"I don\'t want to know." So last week, I opened my LinkedIn.');
  for (const group of groups) {
    const stressed = group.words.filter((word) => word.stressed);
    assert.equal(stressed.length, 1);
    assert.equal(stressed[0].text, group.stress);
  }
  assert.ok(groups.some((group) => /know/i.test(group.stress)));
  assert.ok(groups.some((group) => /week/i.test(group.stress)));
  assert.ok(groups.some((group) => /LinkedIn/i.test(group.stress)));
});

test("rhythmGroups: dữ liệu rỗng không tạo cụm giả", () => {
  assert.deepEqual(rhythmGroups(""), []);
  assert.deepEqual(rhythmGroups(null), []);
});

test("expectedProsody: câu kể xuống giọng, câu hỏi Yes/No lên giọng, câu hỏi Wh- xuống", () => {
  assert.equal(expectedProsody("I do all the house chores.").finalContour, "fall");
  assert.equal(expectedProsody("Do they sound familiar to you?").finalContour, "rise");
  assert.equal(expectedProsody("Where do you live?").finalContour, "fall");
  assert.ok(expectedProsody("I do all the house chores.").groupCount >= 1);
});

// Dựng dạng sóng giả: các "âm tiết" là cụm sin biên độ khác nhau, xen khoảng lặng.
function fakeUtterance({ sampleRate = 16000, syllables, gapMs = 60, f0 = 140, f0End = f0 } = {}) {
  const out = [];
  const gap = Math.round((gapMs / 1000) * sampleRate);
  syllables.forEach((syl, index) => {
    const len = Math.round((syl.ms / 1000) * sampleRate);
    const freq = f0 + ((f0End - f0) * index) / Math.max(1, syllables.length - 1);
    for (let i = 0; i < len; i += 1) {
      out.push(syl.amp * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    }
    if (index < syllables.length - 1) for (let i = 0; i < gap; i += 1) out.push(0);
  });
  return Float32Array.from(out);
}

test("analyseWaveform: đọc ra đường bao RMS và cao độ gần đúng", () => {
  const samples = fakeUtterance({ syllables: [{ ms: 200, amp: 0.5 }, { ms: 200, amp: 0.5 }], f0: 150 });
  const { rms, f0, hopMs } = analyseWaveform(samples, 16000, { hopMs: 20 });
  assert.ok(rms.length > 10);
  assert.equal(hopMs, 20);
  const voiced = f0.filter((value) => value > 0);
  assert.ok(voiced.length > 5, "phải dò được khung hữu thanh");
  const avg = voiced.reduce((sum, value) => sum + value, 0) / voiced.length;
  assert.ok(Math.abs(avg - 150) < 25, `cao độ lệch nhiều: ${avg}`);
});

test("scoreProsody: đọc đều một mạch bị điểm thấp hơn đọc có nhấn và ngắt", () => {
  const expected = expectedProsody("When it comes to household chores, jobs like cleaning, washing clothes or looking after the kids.");

  const flat = analyseWaveform(
    fakeUtterance({ syllables: Array.from({ length: 8 }, () => ({ ms: 130, amp: 0.4 })), gapMs: 0, f0: 130, f0End: 130 }),
    16000,
  );
  const shaped = analyseWaveform(
    fakeUtterance({
      syllables: [
        { ms: 90, amp: 0.15 }, { ms: 150, amp: 0.6 }, { ms: 90, amp: 0.15 },
        { ms: 150, amp: 0.62 }, { ms: 90, amp: 0.15 }, { ms: 150, amp: 0.6 },
      ],
      gapMs: 200,
      f0: 170,
      f0End: 120,
    }),
    16000,
  );

  const flatScore = scoreProsody(flat, expected);
  const shapedScore = scoreProsody(shaped, expected);
  assert.ok(flatScore.usable && shapedScore.usable);
  assert.ok(shapedScore.score > flatScore.score, `nhấn+ngắt (${shapedScore.score}) phải hơn đọc đều (${flatScore.score})`);
  assert.ok(shapedScore.stress > flatScore.stress);
});

test("scoreProsody: bản ghi rỗng thì không dùng được", () => {
  const result = scoreProsody({ rms: [], f0: [], hopMs: 20 }, expectedProsody("Hello there."));
  assert.equal(result.usable, false);
  assert.equal(result.score, 0);
});

test("analyseWaveform: câu dài 15s vẫn phân tích xong nhanh, không treo", () => {
  const rate = 16000;
  const long = new Float32Array(rate * 15);
  for (let i = 0; i < long.length; i += 1) long[i] = 0.3 * Math.sin((2 * Math.PI * 150 * i) / rate);
  const started = Date.now();
  const { rms } = analyseWaveform(long, rate, { hopMs: 20 });
  assert.ok(rms.length > 100);
  assert.ok(Date.now() - started < 1500, `phân tích quá lâu: ${Date.now() - started}ms`);
});

test("scoreProsody: bản ghi chỉ có nhiễu nền (không nói gì) không cho ra điểm", () => {
  // 2 giây "im lặng": nhiễu nền biên độ ~0.006, không đều.
  const rate = 16000;
  const noise = Float32Array.from({ length: rate * 2 }, () => (Math.random() - 0.5) * 0.012);
  const measured = analyseWaveform(noise, rate, { hopMs: 20 });
  const result = scoreProsody(measured, expectedProsody("I do all the house chores."));
  assert.equal(result.usable, false, `nhiễu nền vẫn ra điểm: ${result.score}`);
  assert.equal(result.score, 0);
});

test("refToExpected: dùng phân tích người trong video khi có, không thì lùi về văn bản", () => {
  const text = "Do they sound familiar to you?";
  const fromText = refToExpected(null, text);
  assert.equal(fromText.source, "text");
  assert.equal(fromText.finalContour, "rise");

  const fromModel = refToExpected(
    { stressedWords: ["sound", "familiar"], pauseAfter: ["familiar"], finalPitch: "rise", pitchRange: "wide" },
    text,
  );
  assert.equal(fromModel.source, "model");
  assert.equal(fromModel.stressCount, 2);
  assert.equal(fromModel.pauseCount, 1);
  assert.equal(fromModel.pitchRange, "wide");
  assert.equal(fromModel.finalContour, "rise");
});

test("scoreProsody: theo hình mẫu video, số đỉnh nhấn khớp thì ăn điểm nhấn cao hơn", () => {
  const three = analyseWaveform(
    fakeUtterance({
      syllables: [
        { ms: 80, amp: 0.12 }, { ms: 150, amp: 0.6 },
        { ms: 80, amp: 0.12 }, { ms: 150, amp: 0.6 },
        { ms: 80, amp: 0.12 }, { ms: 150, amp: 0.6 },
      ],
      gapMs: 40,
    }),
    16000,
  );
  const matches = scoreProsody(three, { groupCount: 3, finalContour: "fall", stressCount: 3, pauseCount: 2, pitchRange: "medium" });
  const mismatch = scoreProsody(three, { groupCount: 8, finalContour: "fall", stressCount: 8, pauseCount: 7, pitchRange: "medium" });
  assert.ok(matches.stress >= mismatch.stress, `khớp (${matches.stress}) phải ≥ lệch (${mismatch.stress})`);
});
