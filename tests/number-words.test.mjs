import assert from "node:assert/strict";
import test from "node:test";

import { hasDigit, numberToWords, readNumber, spellOut } from "../lib/number-words.mjs";

test("numberToWords: số nhỏ", () => {
  assert.deepEqual(numberToWords(0), ["zero"]);
  assert.deepEqual(numberToWords(6), ["six"]);
  assert.deepEqual(numberToWords(13), ["thirteen"]);
  assert.deepEqual(numberToWords(21), ["twenty", "one"]);
  assert.deepEqual(numberToWords(90), ["ninety"]);
});

test("numberToWords: hàng trăm và hàng nghìn", () => {
  assert.deepEqual(numberToWords(100), ["one", "hundred"]);
  assert.deepEqual(numberToWords(305), ["three", "hundred", "five"]);
  assert.deepEqual(numberToWords(1500), ["one", "thousand", "five", "hundred"]);
  assert.deepEqual(numberToWords(2_000_400), ["two", "million", "four", "hundred"]);
});

test("numberToWords: số vô lý trả về rỗng chứ không đoán bừa", () => {
  for (const bad of [-1, 1.5, "abc", null, undefined, 1e9]) {
    assert.deepEqual(numberToWords(bad), [], `sai ở ${bad}`);
  }
});

test("readNumber: năm bốn chữ số đọc theo cặp", () => {
  // Không ai đọc 1990 là "one thousand nine hundred ninety".
  assert.deepEqual(readNumber("1990"), ["nineteen", "ninety"]);
  assert.deepEqual(readNumber("1975"), ["nineteen", "seventy", "five"]);
  assert.deepEqual(readNumber("1900"), ["nineteen", "hundred"]);
  assert.deepEqual(readNumber("1905"), ["nineteen", "oh", "five"]);
  assert.deepEqual(readNumber("2019"), ["twenty", "nineteen"]);
});

test("readNumber: các năm 2000–2009 đọc trọn, không đọc theo cặp", () => {
  assert.deepEqual(readNumber("2005"), ["two", "thousand", "five"]);
  assert.deepEqual(readNumber("2000"), ["two", "thousand"]);
  // Từ 2010 trở đi lại quay về đọc cặp.
  assert.deepEqual(readNumber("2010"), ["twenty", "ten"]);
});

test("readNumber: số ngoài khoảng năm thì đọc như số thường", () => {
  assert.deepEqual(readNumber("3500"), ["three", "thousand", "five", "hundred"]);
  assert.deepEqual(readNumber("6"), ["six"]);
  // Dấu phẩy ngăn nghìn không làm hỏng.
  assert.deepEqual(readNumber("1,500"), ["one", "thousand", "five", "hundred"]);
});

test("readNumber: không phải số thì trả về rỗng", () => {
  assert.deepEqual(readNumber("abc"), []);
  assert.deepEqual(readNumber(""), []);
  assert.deepEqual(readNumber("3.5"), []);
});

test("spellOut: tách chữ lẫn số", () => {
  assert.deepEqual(spellOut("6"), ["six"]);
  assert.deepEqual(spellOut("7:30"), ["seven", "thirty"]);
  assert.deepEqual(spellOut("COVID-19"), ["covid", "nineteen"]);
  assert.deepEqual(spellOut("3rd"), ["three", "rd"]);
});

test("spellOut: chữ thuần trả về chính nó, viết thường", () => {
  assert.deepEqual(spellOut("Pippa"), ["pippa"]);
  assert.deepEqual(spellOut("don't"), ["don't"]);
  assert.deepEqual(spellOut(""), []);
  assert.deepEqual(spellOut("!!"), []);
});

test("hasDigit: nhận ra chữ có số bên trong", () => {
  assert.equal(hasDigit("6"), true);
  assert.equal(hasDigit("COVID-19"), true);
  assert.equal(hasDigit("Pippa"), false);
  assert.equal(hasDigit(""), false);
});
