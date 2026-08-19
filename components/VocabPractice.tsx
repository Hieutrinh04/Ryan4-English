"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WordCard } from "../lib/types";
import { DRILL_MODES, choicesFor, clozeOf, hasIpa, isCorrect, modeForCard, seededOrder, summarise, supportsMode } from "../lib/vocab-drill.mjs";

// Buổi luyện từ vựng: một bộ thẻ, sáu cách luyện, đổi qua lại bằng thanh tab mà
// không mất chỗ đang đứng.
//
// Vì sao gộp: trước đây mỗi cách luyện là một màn hình riêng, đổi cách là quay ra
// menu rồi chọn folder lại từ đầu. Người học muốn "từ này gõ thử xem" thì phải đi
// hết một vòng. Gộp lại thì đổi cách chỉ là một cú bấm.

type Mode = "card" | "type" | "listen" | "reverse" | "cloze" | "mixed";
type Result = { id: string; mode: string; correct: boolean };

const MODE_HINT: Record<string, string> = {
  type: "Đọc nghĩa tiếng Việt rồi gõ lại từ tiếng Anh.",
  listen: "Nghe phát âm rồi gõ lại từ. Bấm loa để nghe lại.",
  reverse: "Đọc nghĩa tiếng Việt rồi chọn từ tiếng Anh đúng.",
  cloze: "Điền từ còn thiếu vào chỗ trống trong câu.",
};

/** Giọng đọc theo vùng. Máy không có giọng đó thì trả về undefined và đọc giọng mặc định. */
function voiceFor(region: "US" | "UK") {
  const lang = region === "US" ? "en-US" : "en-GB";
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return voices.find((voice) => voice.lang.replace("_", "-") === lang) ?? voices.find((voice) => voice.lang.startsWith("en"));
}

function speak(text: string, region: "US" | "UK" = "US", rate = 1) {
  if (!text) return;
  window.speechSynthesis?.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = region === "US" ? "en-US" : "en-GB";
  utterance.rate = rate;
  const voice = voiceFor(region);
  if (voice) utterance.voice = voice;
  window.speechSynthesis?.speak(utterance);
}

export default function VocabPractice({ words, close }: { words: WordCard[]; close: () => void }) {
  const [mode, setMode] = useState<Mode>("card");
  const [seed, setSeed] = useState(1);
  const [shuffled, setShuffled] = useState(false);
  // Chỉ luyện lại những thẻ vừa sai; null nghĩa là cả bộ.
  const [focusIds, setFocusIds] = useState<string[] | null>(null);

  const deck: WordCard[] = useMemo(() => {
    const base = focusIds ? words.filter((word) => focusIds.includes(word.id)) : words;
    return shuffled ? (seededOrder(base, seed) as WordCard[]) : base;
  }, [words, focusIds, shuffled, seed]);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [region, setRegion] = useState<"US" | "UK">("US");
  const [done, setDone] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const card = deck[index];
  // Thẻ thiếu dữ liệu cho chế độ đang chọn thì lùi về thẻ flashcard, chứ không hiện
  // một ô trống không có đáp án.
  const wanted = modeForCard(mode, index, seed) as Mode;
  const active: Mode = supportsMode(card, wanted) ? wanted : "card";
  const choices: WordCard[] = useMemo(
    () => (active === "reverse" && card ? (choicesFor(card, deck, index + seed) as WordCard[]) : []),
    [active, card, deck, index, seed],
  );
  const summary = useMemo(() => summarise(results), [results]);
  const progress = deck.length ? Math.round(((index + (checked || flipped ? 1 : 0)) / deck.length) * 100) : 0;

  useEffect(() => {
    if (!card || !autoSpeak) return;
    // Chế độ nghe thì tiếng nói CHÍNH LÀ đề bài, nên luôn đọc. Các chế độ khác chỉ
    // đọc khi từ đang hiện ra — đọc trước là lộ đáp án.
    if (active === "listen" || active === "card") speak(card.term, region);
  }, [card, active, autoSpeak, region]);

  useEffect(() => {
    if (active !== "card" && !checked) inputRef.current?.focus();
  }, [active, checked, index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.code === "Space" && active === "card" && !typing) {
        event.preventDefault();
        setFlipped((value) => !value);
      }
      if (event.key === "ArrowRight" && !typing) next();
      if (event.key === "ArrowLeft" && !typing) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function record(correct: boolean) {
    if (!card) return;
    setResults((list) => [...list.filter((item) => item.id !== card.id), { id: card.id, mode: active, correct }]);
  }

  function check() {
    if (!card || checked || !typed.trim()) return;
    setChecked(true);
    // Bài điền chỗ trống chấp nhận cả biến thể: chỗ trống có thể nằm ở "rescued".
    record(isCorrect(typed, card.term, active === "cloze"));
  }

  function pick(choice: WordCard) {
    if (!card || picked) return;
    setPicked(choice.id);
    setChecked(true);
    record(choice.id === card.id);
  }

  function resetCard() {
    setTyped("");
    setChecked(false);
    setPicked(null);
    setFlipped(false);
  }

  function next() {
    if (!card) return;
    // Thẻ flashcard không chấm được nên chỉ ghi là đã xem, để đếm tiến trình.
    if (active === "card" && !results.some((item) => item.id === card.id)) record(false);
    resetCard();
    if (index >= deck.length - 1) setDone(true);
    else setIndex((value) => value + 1);
  }

  function back() {
    resetCard();
    setIndex((value) => Math.max(0, value - 1));
  }

  function restart(onlyWrong: boolean) {
    setFocusIds(onlyWrong && summary.wrongCards.length ? summary.wrongCards : null);
    setResults([]);
    setIndex(0);
    setDone(false);
    resetCard();
    if (onlyWrong) setSeed((value) => value + 1);
  }

  function fullscreen() {
    const element = stageRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen?.();
  }

  if (!deck.length)
    return (
      <div className="page vocab-drill">
        <button className="back" onClick={close}>← Chọn chức năng khác</button>
        <p className="empty">Bộ này chưa có từ nào để luyện.</p>
      </div>
    );

  if (done)
    return (
      <div className="page vocab-drill">
        <button className="back" onClick={close}>← Chọn chức năng khác</button>
        <div className="panel drill-summary">
          <span className="summary-mark">✓</span>
          <h2>Xong {deck.length} thẻ{focusIds ? " · phần làm sai" : ""}</h2>
          {summary.answered > 0 ? (
            <p className="page-sub">
              Đúng {summary.correct}/{summary.answered} câu có chấm điểm ({summary.accuracy}%).
              {summary.total > summary.answered ? ` ${summary.total - summary.answered} thẻ chỉ xem, không chấm.` : ""}
            </p>
          ) : (
            <p className="page-sub">Lượt này bạn chỉ xem thẻ, chưa có câu nào được chấm.</p>
          )}
          <div className="summary-actions">
            <button onClick={() => restart(false)}>Luyện lại cả bộ</button>
            <button className="primary" disabled={!summary.wrongCards.length} onClick={() => restart(true)}>
              Luyện lại {summary.wrongCards.length} thẻ sai
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page vocab-drill" ref={stageRef}>
      <div className="drill-top">
        <button className="drill-icon" onClick={close} aria-label="Quay lại">←</button>
        <b>{index + 1} / {deck.length}</b>
        <button className="drill-icon" onClick={fullscreen} aria-label="Toàn màn hình">⤢</button>
      </div>

      <div className="drill-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến trình buổi luyện">
        <i style={{ width: `${progress}%` }} />
      </div>

      <div className="drill-tabs" role="group" aria-label="Cách luyện">
        {DRILL_MODES.map((item: { value: string; label: string; icon: string }) => (
          <button
            key={item.value}
            className={mode === item.value ? "active" : ""}
            onClick={() => { setMode(item.value as Mode); resetCard(); }}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      <div className="panel drill-card">
        {active === "card" ? (
          <div className="drill-face">
            {flipped ? (
              <button className="drill-flip" onClick={() => setFlipped(false)}>
                <b className="drill-meaning">{card.meaning}</b>
                {card.exampleVi && <p className="drill-example">{card.exampleVi}</p>}
                <i>Nhấn để lật lại <kbd>Space</kbd></i>
              </button>
            ) : (
              <>
                <button className="drill-flip" onClick={() => setFlipped(true)}>
                  <b className="drill-term">{card.term}</b>
                  {hasIpa(card.ipa) && <em className="drill-ipa">{card.ipa}</em>}
                </button>
                {/* Nút chọn giọng phải nằm NGOÀI nút lật thẻ: nút lồng nút là HTML
                    không hợp lệ và gây lỗi hydrate. */}
                <span className="drill-voices">
                  <button onClick={() => { setRegion("US"); speak(card.term, "US"); }} className={region === "US" ? "active" : ""}>◖)) US</button>
                  <button onClick={() => { setRegion("UK"); speak(card.term, "UK"); }} className={region === "UK" ? "active" : ""}>◖)) UK</button>
                  <button onClick={() => setAutoSpeak((value) => !value)} className={autoSpeak ? "active" : ""} aria-pressed={autoSpeak}>◖)) Tự động</button>
                </span>
                {card.partOfSpeech && <span className="drill-pos">{card.partOfSpeech}</span>}
                <button className="drill-flip drill-flip-hint" onClick={() => setFlipped(true)}>
                  <i>Nhấn để xem nghĩa <kbd>Space</kbd></i>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="drill-face drill-quiz">
            <p className="drill-hint">{MODE_HINT[active]}</p>

            {active === "listen" ? (
              <button className="drill-listen" onClick={() => speak(card.term, region)} aria-label="Nghe lại">◖))</button>
            ) : active === "cloze" ? (
              <p className="drill-sentence">{clozeOf(card)}</p>
            ) : (
              <b className="drill-meaning">{card.meaning}</b>
            )}

            {active === "reverse" ? (
              <div className="drill-choices">
                {choices.map((choice) => (
                  <button
                    key={choice.id}
                    disabled={Boolean(picked)}
                    className={picked ? (choice.id === card.id ? "right" : choice.id === picked ? "wrong" : "") : ""}
                    onClick={() => pick(choice)}
                  >
                    {choice.term}
                  </button>
                ))}
              </div>
            ) : (
              <form className="drill-answer" onSubmit={(event) => { event.preventDefault(); check(); }}>
                <input
                  ref={inputRef}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder="Gõ từ tiếng Anh"
                  disabled={checked}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Câu trả lời"
                />
                {!checked && <button type="submit" className="primary" disabled={!typed.trim()}>Kiểm tra</button>}
              </form>
            )}

            {checked && (
              <div className={`drill-verdict ${results.find((item) => item.id === card.id)?.correct ? "right" : "wrong"}`}>
                {results.find((item) => item.id === card.id)?.correct ? (
                  <b>✓ Chính xác</b>
                ) : (
                  <>
                    <b>✗ Đáp án: {card.term}</b>
                    {hasIpa(card.ipa) && <em>{card.ipa}</em>}
                  </>
                )}
                <button className="drill-replay" onClick={() => speak(card.term, region)} aria-label={`Nghe từ ${card.term}`}>◖))</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="drill-nav">
        <button onClick={back} disabled={index === 0}>← Thẻ trước</button>
        <button onClick={() => { setShuffled((value) => !value); setIndex(0); resetCard(); }} className={shuffled ? "active" : ""}>
          ⤨ {shuffled ? "Đang xáo" : "Xáo trộn"}
        </button>
        <button className="primary" onClick={next}>
          {index >= deck.length - 1 ? "Kết thúc →" : "Thẻ tiếp →"}
        </button>
      </div>
    </div>
  );
}
