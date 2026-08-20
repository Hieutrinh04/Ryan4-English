"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type PlayerHandle } from "./YouTubePlayer";
import Icon from "./Icon";
import { createRecogniser, hasRecognition, micError, type Recognition } from "../lib/speech";
import { doneSentences, markSentence, readLessonProgress } from "../lib/lessons.mjs";
import { properNouns, scoreDictation, wordShapes } from "../lib/youtube.mjs";
import { missingWords, readIpaCache, readTranslationCache, saveIpa, saveTranslation, withIpa } from "../lib/sentence-aids.mjs";
import { scoreShadowing, shadowingAdvice, paceOf } from "../lib/shadowing.mjs";

// Học trên chính video: nghe chép chính tả và nói nhại theo TỪNG CÂU.
//
// Cả hai cách luyện dùng chung một trình phát và một danh sách câu, chỉ khác phần
// làm bài bên dưới. Gộp lại vì người học hay chép xong một câu rồi muốn nhại luôn
// câu đó — tách thành hai màn hình thì phải mở lại bài và tua lại từ đầu.

type Sentence = { index: number; start: number; end: number; text: string };
export type Lesson = { id: string; videoId: string; title: string; author: string; seconds: number; sentences: Sentence[] };
type Mode = "dictation" | "shadowing";

const RATES = [0.5, 0.75, 1, 1.25, 1.5];

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export default function VideoLesson({ lesson, mode, close, onStudied }: { lesson: Lesson; mode: Mode; close: () => void; onStudied?: () => void }) {
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState(1);
  const [at, setAt] = useState(0);
  const [progress, setProgress] = useState<Record<string, unknown>>({});

  // Chép chính tả
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [hints, setHints] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Nói nhại
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [spokenFor, setSpokenFor] = useState(0);
  const [micNote, setMicNote] = useState("");

  // Ba thứ đỡ khi nghe, bật tắt riêng vì mỗi người cần mức đỡ khác nhau.
  const [showText, setShowText] = useState(true);
  const [showIpa, setShowIpa] = useState(false);
  const [showVi, setShowVi] = useState(false);
  const [ipaCache, setIpaCache] = useState<Record<string, string>>({});
  const [viCache, setViCache] = useState<Record<string, string>>({});
  const [lookup, setLookup] = useState<{ word: string; ipa: string; meaning: string } | null>(null);

  const player = useRef<PlayerHandle | null>(null);
  const engine = useRef<Recognition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef(0);

  const sentence = lesson.sentences[index];
  const done = useMemo(() => new Set(doneSentences(progress, lesson.id, mode) as number[]), [progress, lesson.id, mode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setProgress(readLessonProgress());
    setIpaCache(readIpaCache());
    setViCache(readTranslationCache());
  }, []);

  // Chỉ tra những gì CHƯA có và chỉ khi người học bật lên. Một video mười phút có
  // hàng trăm câu; tra sẵn tất cả là một trận gọi mạng vô nghĩa.
  useEffect(() => {
    if (!sentence) return;
    let alive = true;
    const jobs: Promise<void>[] = [];

    if (showIpa) {
      const need = missingWords(sentence.text, ipaCache) as string[];
      if (need.length) {
        jobs.push(
          fetch("/api/ipa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ words: need }) })
            .then((response) => response.json())
            .then((data: { ipa?: Record<string, string> }) => {
              if (alive && data.ipa) setIpaCache(saveIpa(data.ipa));
            })
            .catch(() => {}),
        );
      }
    }

    if (showVi && !viCache[sentence.text]) {
      jobs.push(
        fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: [sentence.text] }) })
          .then((response) => response.json())
          .then((data: { translations?: string[] }) => {
            const vietnamese = data.translations?.[0];
            if (alive && vietnamese) setViCache(saveTranslation(sentence.text, vietnamese));
          })
          .catch(() => {}),
      );
    }

    if (!jobs.length) return;
    return () => {
      alive = false;
    };
    // ipaCache và viCache cố tình không nằm trong danh sách: chúng thay đổi CHÍNH
    // VÌ hiệu ứng này chạy, đưa vào là thành vòng lặp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence?.text, showIpa, showVi]);

  useEffect(() => {
    if (mode === "dictation" && !checked) inputRef.current?.focus();
  }, [mode, checked, index]);

  useEffect(() => () => engine.current?.stop(), []);

  /** Phát đúng câu đang làm, từ đầu câu. */
  function playSentence() {
    if (!sentence || !player.current) return;
    player.current.rate(rate);
    player.current.seek(sentence.start);
    player.current.play();
  }

  async function lookUp(token: string) {
    const word = token.toLowerCase().replace(/[^a-z'-]/g, "");
    if (!word) return;
    setLookup({ word, ipa: ipaCache[word] ?? "", meaning: "Đang tra…" });
    try {
      const response = await fetch(`/api/ai/glance?q=${encodeURIComponent(word)}`);
      const data = (await response.json()) as { ipa?: string; meaningVi?: string; senses?: { definition?: string }[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "không tra được");
      setLookup({ word, ipa: data.ipa || ipaCache[word] || "", meaning: data.meaningVi || data.senses?.[0]?.definition || "Không tra được nghĩa." });
    } catch {
      setLookup({ word, ipa: ipaCache[word] ?? "", meaning: "Không tra được từ này." });
    }
  }

  function go(step: number) {
    const next = Math.min(lesson.sentences.length - 1, Math.max(0, index + step));
    setIndex(next);
    setTyped("");
    setChecked(false);
    setHints(0);
    setRevealed(false);
    setHeard("");
    setMicNote("");
    setLookup(null);
    player.current?.pause();
  }

  function finish() {
    if (!sentence) return;
    setProgress(markSentence(lesson.id, mode, sentence.index));
    onStudied?.();
  }

  // ── Chép chính tả ─────────────────────────────────────────────────────────
  const result = useMemo(
    () => (checked && sentence ? (scoreDictation(sentence.text, typed) as { percent: number; matched: number; total: number; words: { word: string; ok: boolean }[] }) : null),
    [checked, sentence, typed],
  );
  const shapes = useMemo(() => (sentence ? (wordShapes(sentence.text) as { word: string; letters: number }[]) : []), [sentence]);
  // Còn thiếu thứ đang bật thì tức là đang tra. Suy ra thay vì giữ state riêng:
  // state riêng sẽ kẹt ở "đang tra" mãi nếu lượt gọi mạng hỏng giữa chừng.
  const aidBusy =
    Boolean(sentence) &&
    ((showIpa && (missingWords(sentence.text, ipaCache) as string[]).length > 0) || (showVi && !viCache[sentence.text]));
  const names = useMemo(() => (sentence ? (properNouns(sentence.text) as string[]) : []), [sentence]);

  function check() {
    if (!sentence || !typed.trim() || checked) return;
    setChecked(true);
    finish();
  }

  // ── Nói nhại ──────────────────────────────────────────────────────────────
  const spoken = useMemo(
    () =>
      heard && sentence
        ? (scoreShadowing(sentence.text, heard) as { clarity: number; words: { word: string; status: string }[]; missed: string[]; swallowed: string[]; spokenCount: number })
        : null,
    [heard, sentence],
  );
  const advice = useMemo(
    () => (spoken ? (shadowingAdvice(spoken, paceOf(spoken.words.length, spokenFor)) as { kind: string; text: string }[]) : []),
    [spoken, spokenFor],
  );

  function listen() {
    if (listening || !sentence) return;
    const recogniser = createRecogniser();
    if (!recogniser) return;
    setHeard("");
    setMicNote("");
    engine.current = recogniser;
    startedAt.current = Date.now();
    player.current?.pause();

    recogniser.onresult = (event) => {
      const transcript = Array.from(event.results, (item) => item[0]?.transcript ?? "").join(" ").trim();
      setHeard(transcript);
      setSpokenFor((Date.now() - startedAt.current) / 1000);
      finish();
    };
    recogniser.onerror = (event) => setMicNote(micError(event.error));
    recogniser.onend = () => setListening(false);
    setListening(true);
    recogniser.start();
  }

  if (!sentence)
    return (
      <div className="page">
        <button className="back" onClick={close}>← Chọn bài khác</button>
        <p className="empty">Bài này chưa có câu nào.</p>
      </div>
    );

  return (
    <div className="page video-lesson">
      <div className="lesson-top">
        <button className="drill-icon" onClick={close} aria-label="Quay lại">←</button>
        <div className="lesson-title">
          <b>{lesson.title}</b>
          <small>{[lesson.author, `${lesson.sentences.length} câu`].filter(Boolean).join(" · ")}</small>
        </div>
        <span className="lesson-count">
          {done.size}/{lesson.sentences.length}
        </span>
      </div>

      <div className="lesson-body">
        <div className="lesson-main">
          <YouTubePlayer
            videoId={lesson.videoId}
            onReady={(handle) => {
              player.current = handle;
            }}
            onTime={setAt}
          />

          <div className="lesson-controls">
            <span className="lesson-time">{clock(at)} / {clock(lesson.seconds)}</span>
            <div className="lesson-transport">
              <button onClick={() => go(-1)} disabled={index === 0} aria-label="Câu trước">⏮</button>
              <button onClick={playSentence} aria-label="Nghe lại câu này">↺</button>
              <button className="primary" onClick={playSentence} aria-label="Phát">▶</button>
              <button onClick={() => go(1)} disabled={index >= lesson.sentences.length - 1} aria-label="Câu sau">⏭</button>
            </div>
            <div className="lesson-rates">
              {RATES.map((value) => (
                <button
                  key={value}
                  className={value === rate ? "active" : ""}
                  onClick={() => {
                    setRate(value);
                    player.current?.rate(value);
                  }}
                >
                  {value}x
                </button>
              ))}
            </div>
          </div>

          <div className="panel lesson-work">
            <div className="lesson-work-head">
              <b>#{sentence.index}</b>
              <span>{shapes.length} từ</span>
              {result && <em className={result.percent === 100 ? "good" : ""}>Khớp: {result.percent}%</em>}
            </div>

            {mode === "dictation" ? (
              <>
                {/* Ô trống theo số chữ cái: người học biết câu dài bao nhiêu từ mà
                    không bị lộ chữ nào. */}
                <div className="lesson-shapes">
                  {shapes.map((shape, position) => (
                    <span key={position} className={result?.words[position]?.ok ? "ok" : checked ? "miss" : ""}>
                      {revealed || (checked && result?.words[position]?.ok)
                        ? shape.word
                        : hints > 0
                          ? `${shape.word.slice(0, 1)}${"·".repeat(Math.max(0, shape.letters - 1))}`
                          : "·".repeat(shape.letters || 1)}
                    </span>
                  ))}
                </div>

                {names.length > 0 && (
                  <p className="lesson-names">
                    {/* Tên riêng cho sẵn: nghe không thể đoán ra cách viết. */}
                    <Icon name="search" size={14} /> Tên riêng: {names.join(", ")}
                  </p>
                )}

                <form
                  className="lesson-answer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    check();
                  }}
                >
                  <input
                    ref={inputRef}
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder="Điền câu đã nghe…"
                    disabled={checked}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Câu đã nghe"
                  />
                  {!checked && <button className="primary" type="submit" disabled={!typed.trim()}>Kiểm tra</button>}
                </form>

                <div className="lesson-tools">
                  <button onClick={() => setHints(1)} disabled={hints > 0 || revealed}>Gợi ý chữ cái đầu</button>
                  <button onClick={() => { setRevealed(true); setChecked(true); finish(); }} disabled={revealed}>Xem đáp án</button>
                </div>

                {/* Bản dịch ở đây là GỢI Ý, không phải đáp án: nó cho biết câu nói
                    về chuyện gì mà không lộ chữ nào. Mặc định tắt. */}
                <div className="lesson-aid-toggles" role="group" aria-label="Hiện thêm">
                  <button className={showVi ? "active" : ""} onClick={() => setShowVi((value) => !value)} aria-pressed={showVi}>Dịch nghĩa</button>
                  {aidBusy && <span className="lesson-aid-busy">đang dịch…</span>}
                </div>
                {showVi && <p className="lesson-vi">{viCache[sentence.text] || "Đang dịch…"}</p>}

                {checked && <p className="lesson-answer-text">{sentence.text}</p>}
              </>
            ) : (
              <>
                <div className="lesson-aid-toggles" role="group" aria-label="Hiện thêm">
                  <button className={showText ? "active" : ""} onClick={() => setShowText((value) => !value)} aria-pressed={showText}>Câu mẫu</button>
                  <button className={showIpa ? "active" : ""} onClick={() => setShowIpa((value) => !value)} aria-pressed={showIpa}>IPA</button>
                  <button className={showVi ? "active" : ""} onClick={() => setShowVi((value) => !value)} aria-pressed={showVi}>Dịch nghĩa</button>
                  {aidBusy && <span className="lesson-aid-busy">đang tra…</span>}
                </div>

                {showText ? (
                  <p className={showIpa ? "lesson-sentence with-ipa" : "lesson-sentence"}>
                    {(withIpa(sentence.text, ipaCache) as { word: string; ipa: string }[]).map((row, position) => (
                      <button key={position} className="lesson-word" onClick={() => void lookUp(row.word)} title="Bấm để tra nghĩa">
                        <span>{row.word}</span>
                        {showIpa && <em>{row.ipa}</em>}
                      </button>
                    ))}
                  </p>
                ) : (
                  <p className="lesson-hidden-note">Câu mẫu đang ẩn — nghe rồi nói theo, bật lại khi cần đối chiếu.</p>
                )}

                {showVi && <p className="lesson-vi">{viCache[sentence.text] || "Đang dịch…"}</p>}

                {lookup && (
                  <div className="lesson-lookup">
                    <b>{lookup.word}</b>
                    {lookup.ipa && <code>{lookup.ipa}</code>}
                    <span>{lookup.meaning}</span>
                    <button onClick={() => setLookup(null)} aria-label="Đóng">×</button>
                  </div>
                )}

                <div className="lesson-tools">
                  {listening ? (
                    <button className="primary listening" onClick={() => engine.current?.stop()}>■ Dừng ghi âm</button>
                  ) : (
                    <button className="primary" onClick={listen} disabled={!hasRecognition()}>◉ Nhấn để ghi âm</button>
                  )}
                  <button onClick={playSentence}>↺ Nghe câu mẫu</button>
                </div>

                {!hasRecognition() && (
                  <p className="shadowing-warn">
                    Trình duyệt này không có sẵn phần nhận dạng giọng nói. Chrome hoặc Edge trên máy tính chạy đủ tính năng.
                  </p>
                )}
                {micNote && <p className="shadowing-warn">{micNote}</p>}

                {spoken && (
                  <>
                    <div className="shadowing-score">
                      <div>
                        <b>{spoken.clarity}%</b>
                        <small>độ rõ lời</small>
                      </div>
                    </div>
                    <p className="shadowing-marks">
                      {spoken.words.map((mark, position) => (
                        <span key={position} className={`mark ${mark.status}`}>{mark.word}</span>
                      ))}
                    </p>
                    <ul className="shadowing-notes">
                      {advice.map((note, position) => (
                        <li key={position} className={note.kind}>{note.text}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {index < lesson.sentences.length - 1 && (
              <button className="primary lesson-next" onClick={() => go(1)}>Câu tiếp theo →</button>
            )}
          </div>
        </div>

        <aside className="lesson-list">
          <div className="lesson-list-head">
            <b>Phụ đề</b>
            <span>{done.size}/{lesson.sentences.length}</span>
          </div>
          <div className="lesson-list-bar">
            <i style={{ width: `${Math.round((done.size / lesson.sentences.length) * 100)}%` }} />
          </div>
          <ol>
            {lesson.sentences.map((item, position) => (
              <li key={item.index}>
                <button
                  className={`${position === index ? "active" : ""} ${done.has(item.index) ? "done" : ""}`}
                  onClick={() => {
                    go(position - index);
                    setIndex(position);
                  }}
                >
                  <span className="lesson-list-no">#{item.index}</span>
                  {/* Chép chính tả thì che câu chưa làm — hiện ra là mất bài. */}
                  <span className="lesson-list-text">
                    {mode === "shadowing" || done.has(item.index) || position === index
                      ? item.text
                      : (wordShapes(item.text) as { letters: number }[]).map((shape) => "·".repeat(shape.letters || 1)).join(" ")}
                  </span>
                  <em>{clock(item.start)}</em>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
