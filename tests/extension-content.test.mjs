import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");

function element(values) {
  return {
    querySelector(selector) {
      for (const [needle, textContent] of Object.entries(values)) {
        if (selector.includes(needle)) return { textContent };
      }
      return null;
    },
  };
}

function loadContentScript(rows) {
  const context = {
    URL,
    console,
    document: {
      querySelectorAll(selector) {
        assert.match(selector, /transcript-segment-view-model/);
        assert.match(selector, /ytd-transcript-segment-renderer/);
        return rows;
      },
    },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test("tiện ích đọc được transcript theo giao diện YouTube mới", () => {
  const context = loadContentScript([
    element({
      ".ytwTranscriptSegmentViewModelTimestamp": "0:34",
      '.ytAttributedStringHost[role="text"]': "  OpenAI offers   office food. ",
    }),
    element({
      ".ytwTranscriptSegmentViewModelTimestamp": "1:02",
      '.ytAttributedStringHost[role="text"]': "The second perk is massage.",
    }),
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(context.transcriptFromDom())), {
    timingPrecision: "second",
    events: [
      { tStartMs: 34000, dDurationMs: 28000, segs: [{ utf8: "OpenAI offers office food." }] },
      { tStartMs: 62000, dDurationMs: 3000, segs: [{ utf8: "The second perk is massage." }] },
    ],
  });
});

test("tiện ích vẫn đọc được transcript theo giao diện YouTube cũ", () => {
  const context = loadContentScript([
    element({ ".segment-timestamp": "1:02:03", ".segment-text": "Legacy transcript line." }),
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(context.transcriptFromDom())), {
    timingPrecision: "second",
    events: [{ tStartMs: 3723000, dDurationMs: 3000, segs: [{ utf8: "Legacy transcript line." }] }],
  });
});

test("tiện ích loại dòng transcript bị selector giao diện mới đọc trùng", () => {
  const duplicate = element({
    ".ytwTranscriptSegmentViewModelTimestamp": "0:34",
    '.ytAttributedStringHost[role="text"]': "OpenAI offers office food.",
  });
  const context = loadContentScript([duplicate, duplicate]);
  assert.equal(context.transcriptFromDom().events.length, 1);
});

test("endpoint transcript giữ mốc mili-giây để không cắt mất cuối câu", () => {
  const context = loadContentScript([]);
  const payload = {
    actions: [{ updateEngagementPanelAction: { content: { transcriptRenderer: { content: {
      transcriptSearchPanelRenderer: { body: { transcriptSegmentListRenderer: { initialSegments: [
        { transcriptSegmentRenderer: { startMs: "27040", endMs: "31120", snippet: { runs: [{ text: "compliments ever. So, thank you." }] } } },
      ] } } },
    } } } } }],
  };
  const result = JSON.parse(JSON.stringify(context.json3FromTranscript(payload)));
  assert.equal(result.timingPrecision, "millisecond");
  assert.equal(result.events[0].tStartMs, 27040);
  assert.equal(result.events[0].dDurationMs, 4080);
});
