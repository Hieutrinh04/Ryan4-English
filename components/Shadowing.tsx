"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { aiFetch } from "../lib/supabase";
import { dictationLessons, dictationLevels, dictationTopics, type DictationLevel } from "../lib/dictation-lessons";
import { buildShadowingLessons, minutesOf, paceOf, scoreShadowing, shadowingAdvice } from "../lib/shadowing.mjs";

// Luyện nói nhại: nghe câu mẫu, nói đuổi theo, đối chiếu chữ máy nghe được với câu
// mẫu rồi chỉ ra chỗ chệch.
//
// Cách đo: dùng SpeechRecognition sẵn có của trình duyệt. Nó KHÔNG chấm giọng —
// nó chỉ cho biết máy nghe ra chữ gì. Toàn bộ giao diện dưới đây gọi đúng tên con
// số đó là "độ rõ lời", và luôn hiện câu nhắc về giới hạn này. Xem lib/shadowing.mjs.

type Line = { id: string; text: string };
type Lesson = { id: string; topic: string; title: string; level: DictationLevel; lines: Line[]; sourceName?: string; sourceUrl?: string; license?: string };
type WordMark = { word: string; heard?: string; status: "ok" | "swallow" | "missed" };
type Result = { clarity: number; words: WordMark[]; missed: string[]; swallowed: string[]; extra: string[]; spokenCount: number };
type Note = { kind: string; text: string };
type Tip = { word: string; ipa: string; how: string };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

let supportCache: boolean | undefined;

/** Trình duyệt có sẵn phần nhận dạng giọng nói hay không. Nhớ lại để khỏi dựng đi dựng lại. */
function hasRecognition() {
  if (supportCache === undefined) {
    const holder = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    supportCache = Boolean(holder.SpeechRecognition ?? holder.webkitSpeechRecognition);
  }
  return supportCache;
}

const NEVER_CHANGES = () => () => {};

function recogniser(): Recognition | null {
  const holder = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Engine = holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
  if (!Engine) return null;
  const engine = new Engine();
  engine.lang = "en-US";
  engine.continuous = false;
  engine.interimResults = false;
  engine.maxAlternatives = 1;
  return engine;
}

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "Trình duyệt chưa được cấp quyền dùng micro. Bấm biểu tượng khoá trên thanh địa chỉ để bật.",
  "service-not-allowed": "Trình duyệt chưa được cấp quyền dùng micro.",
  "no-speech": "Không nghe thấy tiếng nói. Nói to hơn hoặc lại gần micro rồi thử lại.",
  "audio-capture": "Không tìm thấy micro nào đang hoạt động.",
  network: "Mất kết nối tới dịch vụ nhận dạng giọng nói của trình duyệt.",
};

export default function ShadowingPractice({ close, onPractised }: { close: () => void; onPractised?: (seconds: number) => void }) {
  const lessons = useMemo(() => buildShadowingLessons(dictationLessons) as Lesson[], []);
  const [topic, setTopic] = useState(dictationTopics[0]);
  const [level, setLevel] = useState<DictationLevel>("A1");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lineIndex, setLineIndex] = useState(0);
  const [rate, setRate] = useState(0.85);

  const supported = useSyncExternalStore<boolean | null>(NEVER_CHANGES, hasRecognition, () => null);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [micError, setMicError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const [tips, setTips] = useState<Tip[]>([]);
  const [coachComment, setCoachComment] = useState("");
  const [coaching, setCoaching] = useState(false);
  const [coachError, setCoachError] = useState("");

  const [recordUrl, setRecordUrl] = useState("");
  const [practisedSeconds, setPractisedSeconds] = useState(0);
  const [doneLines, setDoneLines] = useState<string[]>([]);

  const engineRef = useRef<Recognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAtRef = useRef(0);

  // Bản ghi âm là blob URL, phải thu hồi khi thay bản khác nếu không sẽ rò bộ nhớ.
  useEffect(() => () => {
    if (recordUrl) URL.revokeObjectURL(recordUrl);
  }, [recordUrl]);

  useEffect(() => () => {
    engineRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    window.speechSynthesis?.cancel();
  }, []);

  const line = lesson?.lines[lineIndex];
  const advice: Note[] = useMemo(
    () => (result ? (shadowingAdvice(result, paceOf(result.words.length, seconds)) as Note[]) : []),
    [result, seconds],
  );
  const pace = result ? paceOf(result.words.length, seconds) : null;

  function speak(speed = rate, text = line?.text) {
    if (!text) return;
    window.speechSynthesis?.cancel();
    const voice = new SpeechSynthesisUtterance(text);
    voice.lang = "en-US";
    voice.rate = speed;
    window.speechSynthesis?.speak(voice);
  }

  function resetLine() {
    setHeard("");
    setResult(null);
    setTips([]);
    setCoachComment("");
    setCoachError("");
    setMicError("");
    setSeconds(0);
    if (recordUrl) URL.revokeObjectURL(recordUrl);
    setRecordUrl("");
  }

  async function startRecording() {
    // Ghi âm là phần tách rời: từ chối quyền ghi âm thì vẫn nhận dạng giọng nói
    // bình thường, chỉ mất phần nghe lại chính mình.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (chunks.length) setRecordUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })));
      };
      recorder.start();
      recorderRef.current = recorder;
    } catch {
      recorderRef.current = null;
    }
  }

  async function listen() {
    if (!line || listening) return;
    const engine = recogniser();
    if (!engine) return;
    const target = line;
    resetLine();
    engineRef.current = engine;
    startedAtRef.current = Date.now();
    await startRecording();

    engine.onresult = (event) => {
      const transcript = Array.from(event.results, (item) => item[0]?.transcript ?? "").join(" ").trim();
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setHeard(transcript);
      setSeconds(elapsed);
      setResult(scoreShadowing(target.text, transcript) as Result);
      setPractisedSeconds((total) => total + elapsed);
      setDoneLines((list) => (list.includes(target.id) ? list : [...list, target.id]));
      onPractised?.(elapsed);
    };
    engine.onerror = (event) => setMicError(ERROR_TEXT[event.error] ?? `Không thu được giọng nói (${event.error}).`);
    engine.onend = () => {
      setListening(false);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    };

    setListening(true);
    engine.start();
  }

  async function askCoach() {
    if (!line || !result) return;
    setCoaching(true);
    setCoachError("");
    try {
      const response = await aiFetch("/api/ai/pronounce", {
        method: "POST",
        body: JSON.stringify({ sentence: line.text, heard, missed: result.missed, swallowed: result.swallowed }),
      });
      const data = (await response.json()) as { comment?: string; tips?: Tip[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "Chưa lấy được hướng dẫn phát âm.");
      setTips(data.tips ?? []);
      setCoachComment(data.comment ?? "");
      if (!data.tips?.length && !data.comment) setCoachError("Chưa lấy được hướng dẫn cho câu này.");
    } catch (error) {
      setCoachError(error instanceof Error ? error.message : "Chưa lấy được hướng dẫn phát âm.");
    } finally {
      setCoaching(false);
    }
  }

  function goToLine(next: number) {
    resetLine();
    setLineIndex(next);
  }

  if (!lesson) {
    const visible = lessons.filter((item) => item.topic === topic && item.level === level);
    return (
      <div className="page shadowing-library">
        <button className="back" onClick={close}>← Chọn chức năng khác</button>
        <div className="eyebrow">LUYỆN NÓI</div>
        <h1>Nói nhại theo câu mẫu</h1>
        <p className="page-sub">
          Nghe câu mẫu, nói đuổi theo, rồi xem máy nghe ra được bao nhiêu phần lời của bạn. Cần Chrome hoặc Edge và một chiếc micro.
        </p>

        <div className="dictation-topics">
          {dictationTopics.map((name) => (
            <button key={name} className={name === topic ? "active" : ""} onClick={() => setTopic(name)}>{name}</button>
          ))}
        </div>
        <div className="shadowing-levels">
          {dictationLevels.map((value) => (
            <button key={value} className={value === level ? "active" : ""} onClick={() => setLevel(value as DictationLevel)}>{value}</button>
          ))}
        </div>

        {supported === false && (
          <p className="shadowing-warn">
            Trình duyệt này không có sẵn phần nhận dạng giọng nói nên chưa chấm được lời bạn nói. Bạn vẫn nghe được câu mẫu và ghi âm để tự đối chiếu. Chrome hoặc Edge trên máy tính chạy đủ tính năng.
          </p>
        )}

        {visible.length === 0 ? (
          <p className="empty">Chưa có bài nào ở chủ đề và trình độ này. Thử trình độ khác xem sao.</p>
        ) : (
          <div className="shadowing-list">
            {visible.map((item) => (
              <button key={item.id} className="shadowing-card" onClick={() => { setLesson(item); setLineIndex(0); resetLine(); }}>
                <b>{item.title}</b>
                <small>{item.lines.length} câu · {item.level}</small>
                <span>{item.lines[0]?.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page shadowing-page">
      <button className="back" onClick={() => { setLesson(null); resetLine(); }}>← Chọn bài khác</button>

      <div className="shadowing-head">
        <div>
          <div className="eyebrow">{lesson.topic} · {lesson.level}</div>
          <h1>{lesson.title}</h1>
          {lesson.sourceName && (
            <p className="dictation-source">
              Nguồn: {lesson.sourceUrl ? <a href={lesson.sourceUrl} target="_blank" rel="noreferrer">{lesson.sourceName}</a> : lesson.sourceName}
              {lesson.license ? ` · ${lesson.license}` : ""}
            </p>
          )}
        </div>
        <div className="shadowing-progress">
          <b>{doneLines.length}/{lesson.lines.length}</b>
          <small>câu đã nói</small>
        </div>
      </div>

      <div className="shadowing-lines">
        {lesson.lines.map((item, position) => (
          <button
            key={item.id}
            className={`shadowing-chip${position === lineIndex ? " active" : ""}${doneLines.includes(item.id) ? " done" : ""}`}
            onClick={() => goToLine(position)}
          >
            {position + 1}
          </button>
        ))}
      </div>

      <div className="panel shadowing-stage">
        <p className="shadowing-target">{line?.text}</p>

        <div className="shadowing-speeds">
          <span>Nghe mẫu:</span>
          {[0.6, 0.85, 1].map((speed) => (
            <button key={speed} onClick={() => { setRate(speed); speak(speed); }} className={speed === rate ? "active" : ""}>
              {speed === 1 ? "Bình thường" : speed === 0.85 ? "Chậm" : "Rất chậm"}
            </button>
          ))}
        </div>

        <div className="shadowing-actions">
          {listening ? (
            <button className="primary listening" onClick={() => engineRef.current?.stop()}>■ Dừng nói</button>
          ) : (
            <button className="primary" onClick={listen} disabled={supported === false}>◉ Nói theo</button>
          )}
          {result && <button onClick={resetLine}>Nói lại</button>}
        </div>

        {listening && <p className="shadowing-hint">Đang nghe… nói cả câu rồi bấm dừng, hoặc im lặng một chút để máy tự dừng.</p>}
        {micError && <p className="shadowing-warn">{micError}</p>}

        {recordUrl && (
          <div className="shadowing-playback">
            <span>Bản ghi của bạn:</span>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- giọng người học vừa thu, không có phụ đề */}
            <audio controls src={recordUrl} />
            <button onClick={() => speak(rate)}>Nghe lại câu mẫu để so</button>
          </div>
        )}
      </div>

      {result && (
        <div className="panel shadowing-result">
          <div className="shadowing-score">
            <div>
              <b>{result.clarity}%</b>
              <small>độ rõ lời</small>
            </div>
            {pace && pace.wpm > 0 && (
              <div>
                <b>{pace.wpm}</b>
                <small>từ mỗi phút</small>
              </div>
            )}
          </div>

          <p className="shadowing-marks">
            {result.words.map((mark, position) => (
              <span key={`${mark.word}-${position}`} className={`mark ${mark.status}`} title={mark.heard ? `máy nghe ra: ${mark.heard}` : undefined}>
                {mark.word}
              </span>
            ))}
          </p>
          <p className="shadowing-legend">
            <span className="mark ok">nghe ra đúng</span>
            <span className="mark swallow">chệch đuôi</span>
            <span className="mark missed">chưa nghe ra</span>
          </p>

          <details className="shadowing-raw">
            <summary>Máy nghe được gì</summary>
            <p>{heard || "(không thu được chữ nào)"}</p>
            {result.extra.length > 0 && <p className="muted">Chữ máy nghe thêm ngoài câu mẫu: {result.extra.join(", ")}</p>}
          </details>

          <ul className="shadowing-notes">
            {advice.map((note, position) => (
              <li key={position} className={note.kind}>{note.text}</li>
            ))}
          </ul>

          {(result.missed.length > 0 || result.swallowed.length > 0) && (
            <div className="shadowing-coach">
              <button onClick={askCoach} disabled={coaching}>
                {coaching ? "Đang lấy hướng dẫn…" : "Hướng dẫn khẩu hình cho những từ bị chệch"}
              </button>
              {coachError && <p className="shadowing-warn">{coachError}</p>}
              {coachComment && <p className="shadowing-comment">{coachComment}</p>}
              {tips.length > 0 && (
                <ul className="shadowing-tips">
                  {tips.map((tip) => (
                    <li key={tip.word}>
                      <b>{tip.word}</b>
                      {tip.ipa && <code>{tip.ipa}</code>}
                      <button className="listen-inline" onClick={() => speak(0.7, tip.word)} aria-label={`Nghe từ ${tip.word}`}>◖))</button>
                      <span>{tip.how}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {lineIndex < lesson.lines.length - 1 && (
            <button className="primary" onClick={() => goToLine(lineIndex + 1)}>Câu tiếp theo →</button>
          )}
        </div>
      )}

      {practisedSeconds > 0 && (
        <p className="shadowing-total">Phiên này bạn đã nói {minutesOf(practisedSeconds)} phút.</p>
      )}
    </div>
  );
}
