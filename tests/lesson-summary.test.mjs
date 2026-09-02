import test from "node:test";
import assert from "node:assert/strict";
import { fallbackLessonSummary, fallbackPhrases, fallbackVocabulary, normalizeLessonSummary, transcriptOf } from "../lib/lesson-summary.mjs";

const sentences = [
  { text: "Artificial intelligence is changing the workplace quickly." },
  { text: "Business analysts need strong communication and problem solving skills." },
  { text: "Artificial intelligence can automate repetitive workplace tasks." },
  { text: "People should keep learning and adapting to new technology." },
];

test("lesson overview builds a continuous transcript", () => {
  assert.equal(transcriptOf(sentences), sentences.map((item) => item.text).join(" "));
});

test("fallback overview always contains useful vocabulary and phrases", () => {
  const summary = fallbackLessonSummary("AI at work", sentences);
  assert.ok(summary.summaryVi.includes("AI at work"));
  assert.ok(fallbackVocabulary(sentences).some((item) => item.term === "artificial"));
  assert.ok(fallbackPhrases(sentences).length > 0);
});

test("AI summary output is bounded and falls back when arrays are invalid", () => {
  const fallback = fallbackLessonSummary("AI", sentences);
  const summary = normalizeLessonSummary({ summaryVi: "Tóm tắt tốt", keyPoints: "bad", vocabulary: [], phrases: [] }, fallback);
  assert.equal(summary.summaryVi, "Tóm tắt tốt");
  assert.deepEqual(summary.keyPoints, fallback.keyPoints);
  assert.ok(summary.vocabulary.length > 0);
});
