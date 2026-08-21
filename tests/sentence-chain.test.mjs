import assert from "node:assert/strict";
import test from "node:test";

import { MAX_CHAIN, canChain, chainOf, clampChain, countWords } from "../lib/sentence-chain.mjs";


const bai = [
  { index: 1, start: 0, end: 3, text: "How are you today, Neil?" },
  { index: 2, start: 3, end: 6, text: "I'm very well, Georgie." },
  { index: 3, start: 6, end: 9, text: "I'm pretty good, thank you." },
  { index: 4, start: 9, end: 13, text: "What are we talking about?" },
];

test("canChain: còn câu phía sau và chưa chạm mức tối đa", () => {
  assert.equal(canChain(bai, 0, 0), true);
  assert.equal(canChain(bai, 0, 1), true);
  // Ghép quá hai câu thì thành đọc diễn văn, phần nhận dạng giọng nói cũng rơi rụng.
  assert.equal(canChain(bai, 0, MAX_CHAIN), false);
  // Câu cuối không còn gì để ghép.
  assert.equal(canChain(bai, 3, 0), false);
  assert.equal(canChain(bai, 2, 1), false);
});

test("canChain: dữ liệu sai kiểu không làm sập", () => {
  assert.equal(canChain(null, 0, 0), false);
  assert.equal(canChain([], 0, 0), false);
  assert.equal(canChain(bai, "abc", "abc"), true);
});

test("chainOf: chưa ghép thì y như một câu đơn", () => {
  const doan = chainOf(bai, 0, 0);
  assert.equal(doan.count, 1);
  assert.equal(doan.text, "How are you today, Neil?");
  assert.equal(doan.start, 0);
  assert.equal(doan.end, 3);
});

test("chainOf: ghép nối chữ và kéo dài mốc kết thúc", () => {
  const doan = chainOf(bai, 0, 2);
  assert.equal(doan.count, 3);
  assert.equal(doan.text, "How are you today, Neil? I'm very well, Georgie. I'm pretty good, thank you.");
  // Mốc phát: từ đầu câu đầu tới hết câu cuối của đoạn.
  assert.equal(doan.start, 0);
  assert.equal(doan.end, 9);
});

test("chainOf: xin ghép nhiều hơn số câu còn lại thì lấy hết phần còn lại", () => {
  const doan = chainOf(bai, 3, 2);
  assert.equal(doan.count, 1);
  assert.equal(doan.text, "What are we talking about?");
  assert.equal(doan.end, 13);
});

test("chainOf: mức ghép âm hoặc quá lớn bị kéo về khoảng cho phép", () => {
  assert.equal(chainOf(bai, 0, -5).count, 1);
  assert.equal(chainOf(bai, 0, 99).count, MAX_CHAIN + 1);
});

test("chainOf: không có câu nào thì trả về null chứ không dựng đoạn rỗng", () => {
  assert.equal(chainOf(bai, 9, 0), null);
  assert.equal(chainOf([], 0, 0), null);
  assert.equal(chainOf(null, 0, 0), null);
});

test("clampChain: nhảy về cuối bài thì mức ghép tụt theo", () => {
  // Đang ghép 2 câu rồi nhảy tới câu áp chót thì chỉ còn ghép được 1.
  assert.equal(clampChain(bai, 2, 2), 1);
  assert.equal(clampChain(bai, 3, 2), 0);
  assert.equal(clampChain(bai, 0, 2), 2);
  assert.equal(clampChain(bai, 0, 0), 0);
});

test("clampChain: dữ liệu sai kiểu trả về 0", () => {
  assert.equal(clampChain(null, 0, 2), 0);
  assert.equal(clampChain([], 0, 2), 0);
});

test("countWords: đếm theo khoảng trắng, không đếm theo chữ cái", () => {
  // Từng có lúc biểu thức bị rụng dấu gạch chéo thành /s+/ nên câu 12 từ đếm ra 1.
  assert.equal(countWords("How are you today, Neil?"), 5);
  assert.equal(countWords("  hai   khoảng   trắng  "), 3);
  assert.equal(countWords("Nghỉ\nxuống dòng"), 3);
  assert.equal(countWords(""), 0);
  assert.equal(countWords(null), 0);
});

test("chainOf: kèm sẵn số từ của cả đoạn", () => {
  assert.equal(chainOf(bai, 0, 0).words, 5);
  assert.equal(chainOf(bai, 0, 1).words, 9);
});
