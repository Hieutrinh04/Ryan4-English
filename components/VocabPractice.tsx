"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Rating, ReviewMode, WordCard } from "../lib/types";
import { DRILL_MODES, choicesFor, deckSupports, hasIpa, isCorrect, resolveMode, seededOrder, summarise } from "../lib/vocab-drill.mjs";
import { COLLECTIONS, deckStats, progressOf, searchSets, setsFor, splitLabel } from "../lib/word-sets.mjs";
import { buildDailyQueue } from "../lib/study-queue.mjs";
import Icon, { type IconName } from "./Icon";
import BackButton from "./BackButton";

// Buổi luyện từ vựng: một bộ thẻ, sáu cách luyện, đổi qua lại bằng thanh tab mà
// không mất chỗ đang đứng.
//
// Vì sao gộp: trước đây mỗi cách luyện là một màn hình riêng, đổi cách là quay ra
// menu rồi chọn folder lại từ đầu. Người học muốn "từ này gõ thử xem" thì phải đi
// hết một vòng. Gộp lại thì đổi cách chỉ là một cú bấm.

type Mode = "card" | "type" | "listen" | "reverse" | "quiz" | "mixed";
type Result = { id: string; mode: string; correct: boolean; graded: boolean };
type WordSet = { id: string; label: string; words: WordCard[]; total: number; learned: number; due: number; fresh: number; mastered: number };
const SWIPE_THRESHOLD = 90;

const OTHER_MODES = [
  { value: "learn", icon: "pen", label: "Học tới khi thuộc", hint: "Lặp riêng những từ còn sai cho tới khi thuộc hết bộ" },
  { value: "test", icon: "target", label: "Kiểm tra chấm điểm", hint: "Làm một mạch không xem đáp án, chấm điểm ở cuối bài" },
  { value: "match", icon: "shuffle", label: "Nối cặp", hint: "Ghép từ với nghĩa nhanh nhất" },
];

const MODE_HINT: Record<string, string> = {
  type: "Đọc nghĩa tiếng Việt rồi gõ lại từ tiếng Anh.",
  listen: "Nghe phát âm rồi gõ lại từ. Bấm loa để nghe lại.",
  reverse: "Xem từ tiếng Anh rồi nhớ lại nghĩa tiếng Việt.",
  quiz: "Chọn đúng nghĩa tiếng Việt của từ tiếng Anh.",
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

export default function VocabPractice({ words, close, onStudied, onResult, onToggleStar, onPickOther, onStartReview }: { words: WordCard[]; close: () => void; onStudied?: () => void; onResult?: (id: string, rating: Rating) => void; onToggleStar?: (id: string) => void; onPickOther?: (mode: string) => void; onStartReview?: (words: WordCard[], mode: ReviewMode) => void }) {
  // Cùng mặc định với các lối vào từ Trang chủ/folder: luôn bắt đầu bằng kiểu
  // tổng hợp, không âm thầm giữ lại kiểu của phiên trước.
  const [mode, setMode] = useState<Mode>("mixed");
  // Chọn bộ từ trước, rồi mới tới cách luyện. null nghĩa là đang ở màn thư viện.
  const [chosen, setChosen] = useState<WordSet | null>(null);
  const [collection, setCollection] = useState("all");
  const [query, setQuery] = useState("");
  // Chọn cách luyện trước rồi mới vào buổi học, thay vì đổ thẳng người học vào một
  // chế độ mặc định rồi để họ tự tìm thanh tab.
  const [started, setStarted] = useState(false);
  const [seed, setSeed] = useState(1);
  const [shuffled, setShuffled] = useState(false);
  // Chỉ luyện lại những thẻ vừa sai; null nghĩa là cả bộ.
  const [focusIds, setFocusIds] = useState<string[] | null>(null);

  // Số liệu tính trên cả kho, không theo bộ đang chọn: ba thẻ đầu màn là bức
  // tranh chung, còn tiến độ từng bộ đã nằm trên thẻ bộ rồi.
  const allStats = useMemo(() => deckStats(words) as { total: number; learned: number; due: number; fresh: number; mastered: number }, [words]);
  const sets = useMemo(() => setsFor(words, collection) as WordSet[], [words, collection]);
  const dailySet = useMemo(() => {
    const queue = buildDailyQueue(words) as WordCard[];
    return queue.length ? ({ id: "daily-review", label: "Ôn tập hằng ngày", words: queue, ...deckStats(queue) } as WordSet) : null;
  }, [words]);
  const visibleSets = useMemo(() => {
    const librarySets = collection === "all" && dailySet ? [dailySet, ...sets] : sets;
    return searchSets(librarySets, query) as WordSet[];
  }, [sets, query, collection, dailySet]);

  // Tab "Tất cả" chỉ có vài thẻ bắt đầu nhanh. Để chúng trong lưới bốn cột thì
  // hai thẻ con con nằm nép một góc, nhìn như màn hình bị lỗi — ít thẻ thì cho
  // thẻ rộng ra cho kín hàng.
  const sparseGrid = visibleSets.length <= 2;

  // Kết quả luyện cập nhật state ở trang cha. Đồng bộ lại bản ghi trong bộ đang
  // mở để hộp Leitner, gắn sao và thống kê không giữ ảnh chụp cũ của đầu phiên.
  useEffect(() => {
    setChosen((current) => {
      if (!current) return current;
      const ids = new Set(current.words.map((word) => word.id));
      const latest = words.filter((word) => ids.has(word.id));
      return { ...current, words: latest, ...deckStats(latest) } as WordSet;
    });
  }, [words]);

  const pool = chosen?.words ?? words;
  const deck: WordCard[] = useMemo(() => {
    const base = focusIds ? pool.filter((word) => focusIds.includes(word.id)) : pool;
    return shuffled ? (seededOrder(base, seed) as WordCard[]) : base;
  }, [pool, focusIds, shuffled, seed]);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [tracking, setTracking] = useState(true);
  const [region, setRegion] = useState<"US" | "UK">("US");
  const [done, setDone] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<number | null>(null);
  const swipeMovedRef = useRef(false);
  const swipeXRef = useRef(0);
  const [swipeX, setSwipeX] = useState(0);

  const card = deck[index];
  const active = resolveMode(card, mode, index, seed) as Mode;
  // Cả bộ không có thẻ nào hợp chế độ này thì nói thẳng, thay vì lặng lẽ hiện thẻ
  // flashcard khiến người học tưởng bấm nhầm.
  const modeUsable = deckSupports(deck, mode);
  const choices: WordCard[] = useMemo(
    () => (active === "quiz" && card ? (choicesFor(card, deck, index + seed) as WordCard[]) : []),
    [active, card, deck, index, seed],
  );
  const summary = useMemo(() => summarise(results), [results]);
  const progress = deck.length ? Math.round(((index + (checked || flipped ? 1 : 0)) / deck.length) * 100) : 0;

  // Mỗi thẻ mới luôn bắt đầu ở mặt tiếng Anh. Điều này cũng chặn cú click được
  // trình duyệt phát sinh sau khi thả một thao tác kéo khỏi lật nhầm thẻ kế tiếp.
  useEffect(() => {
    setFlipped(false);
    swipeXRef.current = 0;
    setSwipeX(0);
  }, [card?.id]);

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

  function record(correct: boolean, graded = true) {
    if (!card) return;
    // Luyện tập không đụng hộp Leitner, nhưng vẫn là có học: không tính vào chuỗi
    // ngày học thì một buổi luyện cả tiếng vẫn làm đứt chuỗi.
    onStudied?.();
    if (graded) onResult?.(card.id, correct ? "good" : "again");
    setResults((list) => [...list.filter((item) => item.id !== card.id), { id: card.id, mode: active, correct, graded }]);
  }

  /** Tự đánh giá ở chế độ thẻ, rồi sang thẻ kế tiếp — thay cho chế độ Thẻ ghi nhớ cũ. */
  function selfCheck(known: boolean) {
    record(known);
    resetCard();
    if (index >= deck.length - 1) setDone(true);
    else setIndex((value) => value + 1);
  }

  function beginSwipe(event: ReactPointerEvent<HTMLButtonElement>) {
    if (active !== "card" || !tracking || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".drill-speaker")) return;
    swipeStartRef.current = event.clientX;
    swipeMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSwipe(event: ReactPointerEvent<HTMLButtonElement>) {
    if (swipeStartRef.current === null || active !== "card" || !tracking) return;
    const distance = event.clientX - swipeStartRef.current;
    if (Math.abs(distance) > 12) swipeMovedRef.current = true;
    swipeXRef.current = distance;
    setSwipeX(distance);
  }

  function endSwipe() {
    if (swipeStartRef.current === null) return;
    swipeStartRef.current = null;
    const distance = swipeXRef.current;
    swipeXRef.current = 0;
    setSwipeX(0);
    if (Math.abs(distance) > SWIPE_THRESHOLD) selfCheck(distance > 0);
  }

  function clickFlip(next: boolean) {
    if (!swipeMovedRef.current) setFlipped(next);
    swipeMovedRef.current = false;
  }

  function check() {
    if (!card || checked || !typed.trim()) return;
    setChecked(true);
    record(isCorrect(typed, card.term));
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
    // Lật qua mà không tự đánh giá thì chỉ ghi là đã xem, không tính vào tỉ lệ đúng.
    if (active === "card" && !results.some((item) => item.id === card.id)) record(false, false);
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

  // ── Thư viện bộ từ ────────────────────────────────────────────────────────
  if (!chosen)
    return (
      <div className="page vocab-library">
        <BackButton destination="Từ vựng" onClick={close} />

        <header className="writing-hero">
          <span className="writing-hero-icon"><Icon name="book" size={20} /></span>
          <div>
            <h1>Luyện từ vựng</h1>
            <p>Dùng chung bộ từ, lịch Leitner và tiến độ với Ôn tập hằng ngày.</p>
          </div>
        </header>

        <div className="vocab-stats">
          <div className="vocab-stat">
            <span className="vocab-stat-icon"><Icon name="book" size={18} /></span>
            <b>{allStats.learned}</b>
            <small>Từ đã học</small>
          </div>
          <div className="vocab-stat due">
            <span className="vocab-stat-icon"><Icon name="clock" size={18} /></span>
            <b>{allStats.due > 0 ? allStats.due : allStats.fresh}</b>
            <small>{allStats.due > 0 ? "Cần ôn hôm nay" : "Chưa học"}</small>
          </div>
          <div className="vocab-stat mastered">
            <span className="vocab-stat-icon"><Icon name="check" size={18} /></span>
            <b>{allStats.mastered}</b>
            <small>Đã thuộc</small>
          </div>
        </div>

        <div className="vocab-filter">
          <div className="vocab-tabs" role="tablist" aria-label="Cách gom bộ từ">
            {(COLLECTIONS as { id: string; label: string }[]).map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={collection === item.id}
                className={collection === item.id ? "active" : ""}
                onClick={() => { setCollection(item.id); setQuery(""); }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <input
            className="vocab-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm bộ từ…"
            aria-label="Tìm bộ từ"
          />
        </div>

        {visibleSets.length === 0 ? (
          <p className="empty">
            {query ? `Không có bộ nào khớp "${query}".` : "Chưa có bộ từ nào ở cách gom này."}
          </p>
        ) : (
          <div className={sparseGrid ? "vocab-set-grid few" : "vocab-set-grid"}>
            {visibleSets.map((set) => {
              const name = splitLabel(set.label) as { main: string; sub: string };
              const percent = progressOf(set) as number;
              return (
                <button key={set.id} className="vocab-set" onClick={() => setChosen(set)}>
                  <span className="vocab-set-cover" aria-hidden="true">
                    <b>{set.total}</b>
                    <small>từ</small>
                  </span>
                  <span className="vocab-set-body">
                    <b>{name.main}</b>
                    {name.sub && <small>{name.sub}</small>}
                    <span className="vocab-set-bar"><i style={{ width: `${percent}%` }} /></span>
                    <em>
                      {set.id === "daily-review" ? "Cùng hàng đợi Ôn tập hằng ngày" : `${percent}% đã học`}
                      {set.due > 0 && <span className="vocab-set-due"> · {set.due} cần ôn</span>}
                      {set.due === 0 && set.fresh > 0 && <span> · {set.fresh} chưa học</span>}
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );

  if (!started)
    return (
      <div className="page vocab-drill">
        <BackButton destination="chọn bộ từ" onClick={() => setChosen(null)} />
        <div className="mode-picker">
          <h1>{chosen.label}</h1>
          <p className="page-sub">Chọn cách bạn muốn luyện {deck.length} từ trong bộ này</p>

          <div className="mode-options" role="radiogroup" aria-label="Chế độ luyện tập">
            {DRILL_MODES.map((item: { value: string; label: string; icon: string; hint: string; badge?: string }) => (
              <button
                key={item.value}
                role="radio"
                aria-checked={mode === item.value}
                className={mode === item.value ? "mode-option active" : "mode-option"}
                onClick={() => setMode(item.value as Mode)}
                disabled={!deckSupports(deck, item.value)}
              >
                <span className="mode-option-icon"><Icon name={item.icon as IconName} size={18} /></span>
                <span className="mode-option-text">
                  <b>{item.label}</b>
                  <small>{deckSupports(deck, item.value) ? item.hint : "Bộ từ này chưa đủ dữ liệu cho cách luyện đó"}</small>
                </span>
                {item.badge && <em className="mode-option-badge">{item.badge}</em>}
                <i className="mode-option-dot" />
              </button>
            ))}
          </div>

          <button
            className="primary mode-start"
            onClick={() => {
              // Sáu chế độ cơ bản dùng nguyên phiên Ôn tập làm nguồn duy nhất.
              // Màn này chỉ chịu trách nhiệm chọn bộ và chọn cách luyện; nhờ vậy
              // kéo/lật thẻ, phím tắt, chấm Leitner và giao diện không thể lệch.
              const reviewMode: Record<Mode, ReviewMode> = {
                card: "card",
                type: "vi_en",
                listen: "listen",
                reverse: "en_vi",
                quiz: "quiz",
                mixed: "mixed",
              };
              if (onStartReview) onStartReview(deck, reviewMode[mode]);
              else setStarted(true);
            }}
            disabled={!deck.length}
          >
            Bắt đầu học
          </button>

          {onPickOther && (
            <div className="mode-more">
              <span className="mode-more-title">Hoặc luyện cả bộ theo cách khác</span>
              {OTHER_MODES.map((item) => (
                <button key={item.value} className="mode-option" onClick={() => onPickOther(item.value)}>
                  <span className="mode-option-icon"><Icon name={item.icon as IconName} size={18} /></span>
                  <span className="mode-option-text">
                    <b>{item.label}</b>
                    <small>{item.hint}</small>
                  </span>
                  <i className="mode-option-arrow">→</i>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );

  if (!deck.length)
    return (
      <div className="page vocab-drill">
        <BackButton destination="Từ vựng" onClick={close} />
        <p className="empty">Bộ này chưa có từ nào để luyện.</p>
      </div>
    );

  if (done)
    return (
      <div className="page vocab-drill">
        <BackButton destination="chọn chế độ" onClick={() => setStarted(false)} />
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
    <div className="page vocab-drill review-synced" ref={stageRef}>
      <div className="drill-top">
        <button className="drill-icon round" onClick={() => setStarted(false)} aria-label="Đổi chế độ luyện">×</button>
        <div className="drill-top-progress">
          <span><b>{index + 1} / {deck.length}</b><b>{progress}%</b></span>
          <div className="drill-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến trình buổi luyện">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
        <button
          className={`drill-icon round ${card.starred ? "starred" : ""}`}
          onClick={() => {
            onToggleStar?.(card.id);
            setChosen((current) => current ? { ...current, words: current.words.map((word) => word.id === card.id ? { ...word, starred: !word.starred } : word) } : current);
          }}
          aria-label="Gắn sao"
        >{card.starred ? "★" : "☆"}</button>
      </div>

      <div className="drill-tabs" role="group" aria-label="Cách luyện">
        {DRILL_MODES.map((item: { value: string; label: string; icon: string }) => (
          <button
            key={item.value}
            className={mode === item.value ? "active" : ""}
            onClick={() => { setMode(item.value as Mode); resetCard(); }}
          >
            <span><Icon name={item.icon as IconName} size={16} /></span>
            {item.label}
          </button>
        ))}
      </div>

      <div
        className={`panel drill-card ${active === "card" && tracking ? "swipe-enabled" : ""} ${swipeX ? "is-dragging" : ""} ${swipeX > SWIPE_THRESHOLD ? "swipe-known" : swipeX < -SWIPE_THRESHOLD ? "swipe-learning" : ""}`}
        style={active === "card" && swipeX ? { transform: `translateX(${swipeX}px) rotate(${swipeX / 26}deg)` } : undefined}
      >
        {!modeUsable ? (
          <div className="drill-face">
            <p className="drill-empty">
              Bộ từ này chưa đủ dữ liệu cho cách luyện đó. Chọn cách khác nhé.
            </p>
          </div>
        ) : active === "card" ? (
          <div className="drill-face">
            {flipped ? (
              <>
                <button className="drill-flip" onClick={() => clickFlip(false)} onPointerDown={beginSwipe} onPointerMove={moveSwipe} onPointerUp={endSwipe} onPointerCancel={endSwipe}>
                  <small className="drill-side-label">TIẾNG VIỆT</small>
                  <b className="drill-meaning">{card.meaning}</b>
                  {card.exampleVi && <p className="drill-example">{card.exampleVi}</p>}
                  <i>Nhấn để lật lại</i>
                </button>
              </>
            ) : (
              <>
                <button className="drill-speaker" onClick={() => speak(card.term, region)} aria-label={`Phát âm ${card.term}`}><Icon name="volume" size={16} /></button>
                <button className="drill-flip" onClick={() => clickFlip(true)} onPointerDown={beginSwipe} onPointerMove={moveSwipe} onPointerUp={endSwipe} onPointerCancel={endSwipe}>
                  <small className="drill-side-label">TIẾNG ANH</small>
                  <b className="drill-term">{card.term}</b>
                  {hasIpa(card.ipa) && <em className="drill-ipa">{card.ipa}</em>}
                  {card.example && <p className="drill-example">{card.example}</p>}
                  <i>Nhấn để lật thẻ</i>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="drill-face drill-quiz">
            <p className="drill-hint">{MODE_HINT[active]}</p>

            {active === "listen" ? (
              <button className="drill-listen" onClick={() => speak(card.term, region)} aria-label="Nghe lại"><Icon name="volume" size={16} /></button>
            ) : active === "quiz" || active === "reverse" ? (
              <>
                <b className="drill-term">{card.term}</b>
                {hasIpa(card.ipa) && <em className="drill-ipa">{card.ipa}</em>}
              </>
            ) : (
              <b className="drill-meaning">{card.meaning}</b>
            )}

            {active === "quiz" ? (
              <div className="drill-choices">
                {choices.map((choice) => (
                  <button
                    key={choice.id}
                    disabled={Boolean(picked)}
                    className={picked ? (choice.id === card.id ? "right" : choice.id === picked ? "wrong" : "") : ""}
                    onClick={() => pick(choice)}
                  >
                    {choice.meaning}
                  </button>
                ))}
              </div>
            ) : active === "reverse" ? (
              <div className="drill-reverse-answer">
                {!checked ? (
                  <button className="secondary" onClick={() => setChecked(true)}>Xem nghĩa</button>
                ) : (
                  <>
                    <b>{card.meaning}</b>
                    {card.exampleVi && <p>{card.exampleVi}</p>}
                    <span className="drill-selfcheck">
                      <button className="wrong" onClick={() => selfCheck(false)}>Đang học</button>
                      <button className="right" onClick={() => selfCheck(true)}>Đã biết</button>
                    </span>
                  </>
                )}
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

            {checked && active !== "reverse" && (
              <div className={`drill-verdict ${results.find((item) => item.id === card.id)?.correct ? "right" : "wrong"}`}>
                {results.find((item) => item.id === card.id)?.correct ? (
                  <b>✓ Chính xác</b>
                ) : (
                  <>
                    <b>✗ Đáp án: {card.term}</b>
                    {hasIpa(card.ipa) && <em>{card.ipa}</em>}
                  </>
                )}
                <button className="drill-replay" onClick={() => speak(card.term, region)} aria-label={`Nghe từ ${card.term}`}><Icon name="volume" size={16} /></button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="drill-footer">
        <label className="track-toggle">
          <input type="checkbox" checked={tracking} onChange={(event) => setTracking(event.target.checked)} />
          <span /> Theo dõi tiến độ
        </label>
        {tracking && active === "card" ? (
          <div className="track-actions">
            <button className="track-learning-btn" onClick={() => selfCheck(false)}>Đang học</button>
            <b>{index + 1} / {deck.length}</b>
            <button className="track-known-btn" onClick={() => selfCheck(true)}>Đã biết</button>
          </div>
        ) : (
          <div className="drill-nav compact">
            <button onClick={back} disabled={index === 0} aria-label="Thẻ trước">←</button>
            <b>{index + 1} / {deck.length}</b>
            <button onClick={next} aria-label={index >= deck.length - 1 ? "Kết thúc" : "Thẻ tiếp"}>{"→"}</button>
          </div>
        )}
        <div className="drill-options">
          <button className={autoSpeak ? "active" : ""} onClick={() => setAutoSpeak((value) => !value)} aria-label="Tự động phát">{autoSpeak ? "❚❚" : "▶"}</button>
          <button onClick={() => { setShuffled((value) => !value); setIndex(0); resetCard(); }} className={shuffled ? "active" : ""} aria-label="Xáo trộn">⇄</button>
          <button onClick={fullscreen} aria-label="Toàn màn hình"><Icon name="target" size={15} /></button>
          {/* Giọng đọc: state region có từ đầu và được truyền vào speak(), nhưng
              chưa từng có nút nào đổi nó, nên mọi thẻ đều đọc giọng Mỹ. Màn Từ
              điển AI đã cho chọn US/UK rồi, chỗ này để lệch là vô lý. */}
          <button
            className="drill-accent"
            onClick={() => setRegion((value) => (value === "US" ? "UK" : "US"))}
            aria-label={region === "US" ? "Đang đọc giọng Mỹ, đổi sang giọng Anh" : "Đang đọc giọng Anh, đổi sang giọng Mỹ"}
            title="Đổi giọng đọc"
          >
            {region}
          </button>
        </div>
      </div>
      {active === "card" && tracking && <p className="drill-swipe-hint">Kéo sang trái nếu còn đang học · Kéo sang phải nếu đã biết · Nhấn Space để lật thẻ</p>}
    </div>
  );
}
