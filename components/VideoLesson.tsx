"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type PlayerHandle } from "./YouTubePlayer";
import Icon from "./Icon";
import { createRecogniser, hasRecognition, micError, type Recognition } from "../lib/speech";
import { clearLessonProgress, doneSentences, markSentence, readLessonProgress, readReports, reportedSentences, toggleReport } from "../lib/lessons.mjs";
import { properNouns, scoreDictation, wordShapes } from "../lib/youtube.mjs";
import { missingWords, readIpaCache, readTranslationCache, saveIpa, saveTranslation, withIpa } from "../lib/sentence-aids.mjs";
import { scoreShadowing, shadowingAdvice, paceOf } from "../lib/shadowing.mjs";
import { audioConstraint, micOptions, pickMic, readMic, saveMic } from "../lib/mic.mjs";
import { MAX_CHAIN, canChain, chainOf, clampChain } from "../lib/sentence-chain.mjs";
import { isSaved, makeSaved, readSaved, toggleSentence } from "../lib/saved-sentences.mjs";
import { aiFetch } from "../lib/supabase";

// Học trên chính video: nghe chép chính tả và nói nhại theo TỪNG CÂU.
//
// Cả hai cách luyện dùng chung một trình phát và một danh sách câu, chỉ khác phần
// làm bài bên dưới. Gộp lại vì người học hay chép xong một câu rồi muốn nhại luôn
// câu đó — tách thành hai màn hình thì phải mở lại bài và tua lại từ đầu.

type Sentence = { index: number; start: number; end: number; text: string };
export type Lesson = { id: string; videoId: string; title: string; author: string; seconds: number; sentences: Sentence[] };
type Mode = "dictation" | "shadowing";
type CoachTip = { word: string; ipa: string; how: string };

const RATES = [0.5, 0.75, 1, 1.25, 1.5];

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** Chia câu thành cụm nghĩa ngắn để người học biết chỗ lấy hơi khi shadowing. */
function senseGroups(text: string, maxWords = 5) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const groups: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    if (/[,;:—]$/.test(word) || current.length >= maxWords) {
      groups.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) groups.push(current.join(" "));
  return groups;
}

export default function VideoLesson({ lesson, mode, close, onStudied, onMode }: { lesson: Lesson; mode: Mode; close: () => void; onStudied?: () => void; onMode?: (next: Mode) => void }) {
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
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  // Chế độ chỉ nghe: giấu khung hình đi để buộc tai làm việc, nhưng KHÔNG gỡ
  // trình phát khỏi trang — gỡ là mất luôn tiếng và phải nạp lại video từ đầu.
  const [audioOnly, setAudioOnly] = useState(false);
  const [full, setFull] = useState(false);
  // Ghép thêm mấy câu phía sau vào đoạn đang luyện. 0 nghĩa là một câu như cũ.
  const [chain, setChain] = useState(0);
  const [saved, setSaved] = useState<{ key: string }[]>([]);
  const [reports, setReports] = useState<Record<string, number[]>>({});
  const [recordUrl, setRecordUrl] = useState("");
  const [coaching, setCoaching] = useState(false);
  const [coachComment, setCoachComment] = useState("");
  const [coachError, setCoachError] = useState("");
  const [coachTips, setCoachTips] = useState<CoachTip[]>([]);

  // Ba thứ đỡ khi nghe, bật tắt riêng vì mỗi người cần mức đỡ khác nhau.
  const [showText, setShowText] = useState(true);
  // Shadowing cần nhìn thấy cách đọc và nghĩa ngay như màn luyện mẫu. Dictation
  // vẫn giấu cả hai để không vô tình lộ đáp án trước khi người học gõ.
  const [showIpa, setShowIpa] = useState(mode === "shadowing");
  const [showVi, setShowVi] = useState(mode === "shadowing");
  const [ipaCache, setIpaCache] = useState<Record<string, string>>({});
  const [viCache, setViCache] = useState<Record<string, string>>({});
  const [lookup, setLookup] = useState<{ word: string; ipa: string; meaning: string } | null>(null);
  // Chấm xong tự sang câu kế tiếp. Tắt mặc định vì người mới cần đọc lại chỗ sai.
  const [autoNext, setAutoNext] = useState(false);

  const stage = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerHandle | null>(null);
  const engine = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef(0);

  const sentence = lesson.sentences[index];
  const span = useMemo(
    () => chainOf(lesson.sentences, index, mode === "shadowing" ? chain : 0) as { text: string; start: number; end: number; count: number; words: number } | null,
    [lesson.sentences, index, chain, mode],
  );
  // Chữ và mốc thời gian của đoạn đang luyện; chưa ghép thì y hệt câu đơn.
  const target = span ?? { text: sentence?.text ?? "", start: sentence?.start ?? 0, end: sentence?.end ?? 0, count: 1, words: 0 };
  const done = useMemo(() => new Set(doneSentences(progress, lesson.id, mode) as number[]), [progress, lesson.id, mode]);
  const reported = useMemo(() => new Set(reportedSentences(reports, lesson.id) as number[]), [reports, lesson.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setProgress(readLessonProgress());
    setIpaCache(readIpaCache());
    setSaved(readSaved());
    setReports(readReports());
    setViCache(readTranslationCache());
  }, []);

  // Chỉ tra những gì CHƯA có và chỉ khi người học bật lên. Một video mười phút có
  // hàng trăm câu; tra sẵn tất cả là một trận gọi mạng vô nghĩa.
  useEffect(() => {
    if (!sentence) return;
    let alive = true;
    const jobs: Promise<void>[] = [];

    if (showIpa) {
      const need = missingWords(target.text, ipaCache) as string[];
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

    if (showVi && !viCache[target.text]) {
      jobs.push(
        fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: [target.text] }) })
          .then((response) => response.json())
          .then((data: { translations?: string[] }) => {
            const vietnamese = data.translations?.[0];
            if (alive && vietnamese) setViCache(saveTranslation(target.text, vietnamese));
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
  }, [target.text, showIpa, showVi]);

  useEffect(() => {
    if (mode === "dictation" && !checked) inputRef.current?.focus();
  }, [mode, checked, index]);

  // Phím tắt để tay không rời bàn phím: gõ xong Enter là chấm rồi Enter lần nữa
  // sang câu kế, Ctrl nghe lại mà không phải với chuột lên nút.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        playSentence();
        return;
      }
      if (event.altKey && (event.key === "h" || event.key === "H")) {
        event.preventDefault();
        setHints(1);
      }
      if (event.altKey && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        setRevealed(true);
        setChecked(true);
        finish();
      }
      // Enter khi ĐÃ chấm thì sang câu kế; lúc chưa chấm thì để form tự xử lý.
      if (event.key === "Enter" && checked) {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => () => {
    engine.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  useEffect(() => () => {
    if (recordUrl) URL.revokeObjectURL(recordUrl);
  }, [recordUrl]);

  // Bấm Esc để thoát toàn màn hình thì trình duyệt không báo cho nút của mình,
  // nên phải nghe sự kiện của trình duyệt chứ đừng tự giữ trạng thái.
  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Danh sách thiết bị thu âm. Đọc lại khi cắm hoặc rút tai nghe, nếu không thì
  // người học vừa cắm tai nghe vào vẫn chỉ thấy micro cũ trong ô chọn.
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let alive = true;
    const load = () => {
      void media
        .enumerateDevices()
        .then((devices) => {
          if (alive) setMics(devices);
        })
        .catch(() => {});
    };
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setMicId(readMic());
    media.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      media.removeEventListener?.("devicechange", load);
    };
  }, []);

  // YouTube mặc định phát liên tục hết video. Shadowing/Dictation cần một đơn vị
  // là CÂU, nên dừng player ngay khi chạm mốc cuối của câu đang chọn. Khoảng đệm
  // nhỏ tránh bỏ mất phụ âm cuối do ticker chỉ cập nhật bốn lần mỗi giây.
  useEffect(() => {
    if (!sentence || !player.current?.playing()) return;
    const stopAt = Math.max(target.start + 0.15, target.end);
    if (at >= stopAt - 0.06) player.current.pause();
  }, [at, sentence, target.start, target.end]);

  /** Phát đúng câu đang làm, từ đầu câu. */
  function playSentence() {
    if (!sentence || !player.current) return;
    player.current.rate(rate);
    player.current.seek(target.start);
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
    setChain((value) => clampChain(lesson.sentences, next, value) as number);
    setTyped("");
    setChecked(false);
    setHints(0);
    setRevealed(false);
    setHeard("");
    setMicNote("");
    setRecordUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setCoachComment("");
    setCoachError("");
    setCoachTips([]);
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
    ((showIpa && (missingWords(target.text, ipaCache) as string[]).length > 0) || (showVi && !viCache[target.text]));
  const names = useMemo(() => (sentence ? (properNouns(sentence.text) as string[]) : []), [sentence]);

  function check() {
    if (!sentence || !typed.trim() || checked) return;
    setChecked(true);
    finish();
    // Chỉ tự sang khi ĐÚNG HẾT: sai mà nhảy đi luôn thì người học không kịp
    // nhìn mình sai chỗ nào.
    if (autoNext && (scoreDictation(sentence.text, typed) as { percent: number }).percent === 100) {
      window.setTimeout(() => go(1), 700);
    }
  }

  // ── Nói nhại ──────────────────────────────────────────────────────────────
  const spoken = useMemo(
    () =>
      heard && target.text
        ? (scoreShadowing(target.text, heard) as {
            clarity: number;
            words: { word: string; status: string }[];
            marks: { word: string; status: string }[];
            missed: string[];
            swallowed: string[];
            spokenCount: number;
          })
        : null,
    [heard, target.text],
  );
  const advice = useMemo(
    () => (spoken ? (shadowingAdvice(spoken, paceOf(spoken.words.length, spokenFor)) as { kind: string; text: string }[]) : []),
    [spoken, spokenFor],
  );

  function saveThis() {
    if (!sentence) return;
    setSaved(
      toggleSentence(
        makeSaved({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          index: sentence.index,
          start: target.start,
          text: target.text,
          translation: viCache[target.text] ?? "",
        }),
      ) as { key: string }[],
    );
  }

  function reportThis() {
    if (!sentence) return;
    setReports(toggleReport(lesson.id, sentence.index) as Record<string, number[]>);
  }

  function resetProgress() {
    setProgress(clearLessonProgress(lesson.id) as Record<string, unknown>);
    setIndex(0);
    setChain(0);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.();
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint(pickMic(mics, micId)) });
      // Tên thiết bị chỉ hiện ra sau lần đầu được cấp quyền, nên đọc lại danh sách
      // ngay sau khi mở micro thành công.
      void navigator.mediaDevices.enumerateDevices().then(setMics).catch(() => {});
      const chunks: Blob[] = [];
      const next = new MediaRecorder(stream);
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!chunks.length) return;
        const url = URL.createObjectURL(new Blob(chunks, { type: next.mimeType || "audio/webm" }));
        setRecordUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return url;
        });
      };
      next.start();
      recorder.current = next;
    } catch {
      setMicNote("Trình duyệt chưa cho phép lưu bản ghi âm. Bạn vẫn có thể luyện và nhận kết quả chữ máy nghe được.");
    }
  }

  async function listen() {
    if (listening || !sentence) return;
    const recogniser = createRecogniser();
    if (!recogniser) return;
    setHeard("");
    setMicNote("");
    engine.current = recogniser;
    startedAt.current = Date.now();
    player.current?.pause();
    await startRecording();

    recogniser.onresult = (event) => {
      const transcript = Array.from(event.results, (item) => item[0]?.transcript ?? "").join(" ").trim();
      setHeard(transcript);
      setSpokenFor((Date.now() - startedAt.current) / 1000);
      finish();
    };
    recogniser.onerror = (event) => setMicNote(micError(event.error));
    recogniser.onend = () => {
      setListening(false);
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
    setListening(true);
    recogniser.start();
  }

  async function askCoach() {
    if (!sentence || !spoken || coaching) return;
    setCoaching(true);
    setCoachError("");
    setCoachComment("");
    setCoachTips([]);
    try {
      const response = await aiFetch("/api/ai/pronounce", {
        method: "POST",
        body: JSON.stringify({ sentence: target.text, heard, missed: spoken.missed, swallowed: spoken.swallowed }),
      });
      const data = (await response.json()) as { comment?: string; tips?: CoachTip[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "Chưa lấy được nhận xét phát âm.");
      if (!data.comment && !data.tips?.length) {
        setCoachComment("Máy đã nhận ra đầy đủ các từ trong câu. Hãy nghe lại bản ghi và đối chiếu nhịp điệu với câu mẫu.");
      } else {
        setCoachComment(data.comment ?? "");
        setCoachTips(data.tips ?? []);
      }
    } catch (error) {
      setCoachError(error instanceof Error ? error.message : "Chưa lấy được nhận xét phát âm.");
    } finally {
      setCoaching(false);
    }
  }

  if (!sentence)
    return (
      <div className="page">
        <button className="back" onClick={close}>← Chọn bài khác</button>
        <p className="empty">Bài này chưa có câu nào.</p>
      </div>
    );

  return (
    <div
      ref={stage}
      className={`page video-lesson video-lesson-v2 ${mode === "shadowing" ? "shadowing-layout" : "dictation-layout"}${audioOnly ? " audio-only" : ""}${full ? " full" : ""}`}
    >
      <div className="lesson-top">
        <button className="drill-icon" onClick={close} aria-label="Quay lại">←</button>
        <span className="lesson-level">B1</span>
        <div className="lesson-title">
          <b>{lesson.title}</b>
          <small>{[lesson.author, `${lesson.sentences.length} câu`].filter(Boolean).join(" · ")}</small>
        </div>
        <div className="lesson-mode-tabs" role="group" aria-label="Chế độ đang luyện">
          {/* Đổi chế độ ngay trong bài: cùng một video, chép xong câu nào thì nhại
              luôn câu đó, không phải quay ra thư viện chọn lại. */}
          <button className={mode === "shadowing" ? "active" : ""} onClick={() => onMode?.("shadowing")}>
            <Icon name="mic" size={15} /> Shadowing
          </button>
          <button className={mode === "dictation" ? "active" : ""} onClick={() => onMode?.("dictation")}>
            <Icon name="headphones" size={15} /> Dictation
          </button>
        </div>
        <div className="lesson-view-tools">
          {/* Chỉ nghe: giấu hình để tai phải tự làm việc. Người học nào quen nhìn
              khẩu hình sẽ hụt lúc nghe thật, nên cần tắt hình được. */}
          <button
            className={audioOnly ? "active" : ""}
            onClick={() => setAudioOnly((value) => !value)}
            aria-pressed={audioOnly}
            title={audioOnly ? "Đang chỉ nghe tiếng" : "Đang xem cả hình"}
          >
            <Icon name={audioOnly ? "headphones" : "play"} size={15} />
            {audioOnly ? "Âm thanh" : "Video"}
          </button>
          <button onClick={toggleFullscreen} aria-label={full ? "Thoát toàn màn hình" : "Toàn màn hình"}>
            <Icon name={full ? "stop" : "target"} size={15} />
          </button>
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

          {/* Thanh chạy cho thấy đang ở đâu trong cả video, và câu hiện tại nằm
              ở khúc nào — hai vạch khác màu. */}
          <div className="lesson-scrub" aria-hidden="true">
            <i className="played" style={{ width: `${Math.min(100, (at / Math.max(1, lesson.seconds)) * 100)}%` }} />
            <i
              className="current"
              style={{
                left: `${Math.min(100, (sentence.start / Math.max(1, lesson.seconds)) * 100)}%`,
                width: `${Math.max(0.6, ((sentence.end - sentence.start) / Math.max(1, lesson.seconds)) * 100)}%`,
              }}
            />
          </div>

          {mode === "dictation" && (
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
          )}

          <div className="panel lesson-work">
            <div className="lesson-work-head">
              <b>#{sentence.index}{mode === "shadowing" && target.count > 1 ? "–" + (sentence.index + target.count - 1) : ""}</b>
              <span>
                {mode === "shadowing"
                  ? `${target.words} từ`
                  : `${result ? result.matched + "/" + result.total : "0/" + shapes.length} từ`}
              </span>
              {mode === "shadowing" && (
                // Nói được từng câu rời không có nghĩa là nói được cả đoạn: chỗ khó
                // nằm ở mối nối, nơi phải giữ hơi và giữ nhịp.
                <button
                  className="lesson-chain"
                  onClick={() => setChain((value) => (value + 1) % (MAX_CHAIN + 1))}
                  disabled={!canChain(lesson.sentences, index, 0) && chain === 0}
                  title="Ghép thêm câu phía sau để nói liền một mạch"
                >
                  <Icon name="swap" size={13} /> Ghép câu kế tiếp ({chain}/{MAX_CHAIN})
                </button>
              )}
              {mode === "shadowing" && spoken && (
                // Gọi là "độ rõ lời" chứ không phải "độ chính xác": trình duyệt chỉ
                // cho biết máy NGHE RA chữ gì, không chấm được giọng bạn chuẩn hay chưa.
                <em className={`lesson-clarity${spoken.clarity >= 80 ? " good" : spoken.clarity >= 50 ? " fair" : " low"}`}>
                  <Icon name="chart" size={12} /> Độ rõ lời {spoken.clarity}%
                </em>
              )}
              {mode === "dictation" && <em className={result?.percent === 100 ? "good" : ""}>Khớp: {result?.percent ?? 0}%</em>}
              {mode === "dictation" && (
                <span className="lesson-keys">
                  <kbd>Enter</kbd> sang câu tiếp <kbd>Ctrl</kbd> nghe lại
                </span>
              )}
              <span className="lesson-head-switches">
                {mode === "dictation" && (
                  <button className={autoNext ? "on" : ""} onClick={() => setAutoNext((value) => !value)} aria-pressed={autoNext}>
                    <i /> Tự động tiếp
                  </button>
                )}
                {mode === "dictation" && (
                  <button className={!showVi ? "on" : ""} onClick={() => setShowVi((value) => !value)} aria-pressed={!showVi}>
                    <i /> Ẩn dịch
                  </button>
                )}
              </span>
              <span className="lesson-head-tools">
                <button
                  className={`lesson-save${isSaved(saved, lesson.id, sentence.index) ? " on" : ""}`}
                  onClick={saveThis}
                  aria-pressed={isSaved(saved, lesson.id, sentence.index) as boolean}
                >
                  <Icon name="check" size={13} /> {isSaved(saved, lesson.id, sentence.index) ? "Đã lưu" : "Lưu câu"}
                </button>
                <button
                  className={`lesson-report${reported.has(sentence.index) ? " on" : ""}`}
                  onClick={reportThis}
                  aria-pressed={reported.has(sentence.index)}
                  title="Đánh dấu câu có phụ đề sai hoặc lệch giờ"
                >
                  <Icon name="flag" size={13} /> {reported.has(sentence.index) ? "Đã báo" : "Báo cáo"}
                </button>
              </span>
            </div>

            {mode === "dictation" ? (
              <>
                {/* Ô nhập lên trước ô trống: người học gõ ngay được, ô trống chỉ
                    là thứ liếc xuống khi bí. */}
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

                {names.length > 0 && (
                  <p className="lesson-names">
                    {/* Tên riêng cho sẵn: nghe không thể đoán ra cách viết. */}
                    <Icon name="search" size={14} /> Tên riêng: {names.join(", ")}
                  </p>
                )}

                <div className="lesson-reveal-row">
                  <span>{hints > 0 || revealed ? "Đang hiện gợi ý" : "Số chấm là số chữ cái của từng từ"}</span>
                  <button onClick={() => { setRevealed(true); setChecked(true); finish(); }} disabled={revealed}>
                    Hiện tất cả
                  </button>
                </div>

                {/* Ô trống theo số chữ cái: biết câu dài bao nhiêu từ mà không lộ chữ nào. */}
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

                {showVi && <p className="lesson-vi">{viCache[sentence.text] || "Đang dịch…"}</p>}
                {checked && <p className="lesson-answer-text">{sentence.text}</p>}

                <div className="lesson-tools">
                  <button onClick={() => setHints(1)} disabled={hints > 0 || revealed}>
                    Chữ cái đầu <kbd>Alt+H</kbd>
                  </button>
                  <button onClick={() => { setRevealed(true); setChecked(true); finish(); }} disabled={revealed}>
                    Xem từ <kbd>Alt+R</kbd>
                  </button>
                  {index < lesson.sentences.length - 1 && (
                    <button className="primary lesson-next-inline" onClick={() => go(1)}>
                      Tiếp theo → <kbd>⏎</kbd>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Thẻ câu mẫu. Chữ đọc liền thành một câu, IPA thành một dòng
                    riêng bên dưới — trước đây mỗi từ là một ô có IPA xếp chồng
                    nên nhìn ra một dãy thẻ chứ không còn ra một câu. */}
                <div className="shadowing-card">
                  <div className="lesson-aid-toggles" role="group" aria-label="Hiện thêm">
                    <button className={showText ? "active" : ""} onClick={() => setShowText((value) => !value)} aria-pressed={showText}>Câu mẫu</button>
                    <button className={showIpa ? "active" : ""} onClick={() => setShowIpa((value) => !value)} aria-pressed={showIpa}>IPA</button>
                    <button className={showVi ? "active" : ""} onClick={() => setShowVi((value) => !value)} aria-pressed={showVi}>Dịch nghĩa</button>
                    {aidBusy && <span className="lesson-aid-busy">đang tra…</span>}
                  </div>

                  {showText ? (
                    <>
                      <p className="shadowing-sentence">
                        {(withIpa(target.text, ipaCache) as { word: string; ipa: string }[]).map((row, position) => (
                          <Fragment key={position}>
                            <button className="shadowing-token" onClick={() => void lookUp(row.word)} title="Bấm để tra nghĩa">
                              {row.word}
                            </button>{" "}
                          </Fragment>
                        ))}
                      </p>
                      {showIpa && (
                        <p className="shadowing-ipa">
                          {(withIpa(target.text, ipaCache) as { word: string; ipa: string }[])
                            .map((row) => row.ipa)
                            .filter(Boolean)
                            .join(" ")}
                        </p>
                      )}
                      <p className="shadowing-tap"><Icon name="book" size={13} /> Nhấn vào từ để tra nghĩa</p>
                    </>
                  ) : (
                    <p className="lesson-hidden-note">Câu mẫu đang ẩn — nghe rồi nói theo, bật lại khi cần đối chiếu.</p>
                  )}

                  {showVi && <p className="shadowing-vi">{viCache[target.text] || "Đang dịch…"}</p>}
                </div>

                {showText && (
                  <div className="shadowing-groups">
                    <span>Chia nhịp</span>
                    {senseGroups(target.text).map((group, position) => <b key={position}>{group}</b>)}
                  </div>
                )}

                {lookup && (
                  <div className="lesson-lookup">
                    <b>{lookup.word}</b>
                    {lookup.ipa && <code>{lookup.ipa}</code>}
                    <span>{lookup.meaning}</span>
                    <button onClick={() => setLookup(null)} aria-label="Đóng">×</button>
                  </div>
                )}

                <div className="shadowing-mic-head">
                  <span><Icon name="mic" size={14} /> Micro</span>
                  <select
                    className="shadowing-mic-pick"
                    value={pickMic(mics, micId) as string}
                    onChange={(event) => setMicId(saveMic(event.target.value) as string)}
                    aria-label="Chọn micro"
                  >
                    {(micOptions(mics) as { id: string; label: string }[]).map((option) => (
                      <option key={option.id || "default"} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div className="shadowing-record-stage">
                  {listening ? (
                    <button className="shadowing-record listening" onClick={() => engine.current?.stop()}>
                      <span><Icon name="stop" size={22} /></span><b>Dừng ghi âm</b><small>Đang lắng nghe giọng nói của bạn…</small>
                    </button>
                  ) : (
                    <button className="shadowing-record" onClick={listen} disabled={!hasRecognition()}>
                      <span><Icon name="mic" size={24} /></span>
                      <b>{spoken ? "Thử lại" : "Nhấn để bắt đầu ghi âm"}</b>
                      <small>{spoken ? "Ghi âm lại phát âm" : "Tối đa 30 giây"}</small>
                    </button>
                  )}
                </div>

                {!hasRecognition() && (
                  <p className="shadowing-warn">
                    Trình duyệt này không có sẵn phần nhận dạng giọng nói. Chrome hoặc Edge trên máy tính chạy đủ tính năng.
                  </p>
                )}
                {micNote && <p className="shadowing-warn">{micNote}</p>}

                {spoken ? (
                  <div className="shadowing-result">
                    <p className="shadowing-hit">
                      <Icon name="chart" size={14} /> {spoken.words.filter((mark) => mark.status === "ok").length}/{spoken.words.length} từ đúng
                    </p>

                    <div className="shadowing-said">
                      <span>Bạn đã nói:</span>
                      <q>{heard}</q>
                    </div>

                    {recordUrl && (
                      // Bản ghi của chính người học; nghe lại cạnh câu mẫu là cách
                      // đối chiếu đáng tin nhất, vì máy không chấm được giọng.
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <audio className="shadowing-audio" controls src={recordUrl} preload="metadata" />
                    )}

                    {/* Từ thừa nằm đúng chỗ nó chen vào, không dồn xuống cuối. */}
                    <div className="shadowing-chips">
                      {spoken.marks.map((mark, position) => (
                        <span key={position} className={`chip ${mark.status}`}>
                          {mark.word}
                          <i>{mark.status === "ok" ? "✓" : mark.status === "swallow" ? "⚠" : mark.status === "extra" ? "+" : "✕"}</i>
                        </span>
                      ))}
                    </div>

                    <div className="video-ai-coach">
                      <button onClick={() => void askCoach()} disabled={coaching}>
                        <Icon name="sparkles" size={16} /> {coaching ? "Đang nhờ AI phân tích…" : "Nhờ AI nhận xét phát âm"}
                      </button>
                      {coachError && <p className="shadowing-warn">{coachError}</p>}
                      {coachComment && <p className="video-ai-comment">{coachComment}</p>}
                      {coachTips.length > 0 && (
                        <ul>
                          {coachTips.map((tip) => (
                            <li key={tip.word}><b>{tip.word}</b>{tip.ipa && <code>{tip.ipa}</code>}<span>{tip.how}</span></li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <ul className="shadowing-notes">
                      {advice.map((note, position) => (
                        <li key={position} className={note.kind}>{note.text}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="shadowing-repeat">
                    <p>Nghe và lặp lại câu trên</p>
                    <div className="shadowing-word-shapes">
                      {shapes.map((shape, position) => <span key={position}>{"•".repeat(Math.max(2, shape.letters))}</span>)}
                    </div>
                  </div>
                )}

                {/* Thanh phát nằm dưới cùng, sau phần kết quả — nghe lại câu mẫu là
                    việc làm SAU khi xem mình sai chỗ nào. */}
                <div className="shadowing-repeat-controls">
                  <button onClick={() => go(-1)} disabled={index === 0} aria-label="Câu trước"><Icon name="previous" size={17} /></button>
                  <button onClick={playSentence} aria-label="Nghe lại"><Icon name="replay" size={17} /></button>
                  <button className="play" onClick={playSentence} aria-label="Phát câu mẫu"><Icon name="play" size={21} /></button>
                  <div className="shadowing-inline-rates">
                    {RATES.map((value) => (
                      <button key={value} className={value === rate ? "active" : ""} onClick={() => { setRate(value); player.current?.rate(value); }}>{value}x</button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {index < lesson.sentences.length - 1 && (
              <button className="primary lesson-next" onClick={() => go(1)}>Câu tiếp theo <Icon name="arrow" size={16} /></button>
            )}
          </div>
        </div>

        <aside className="lesson-list">
          <div className="lesson-list-tabs">
            <b className="active"><Icon name="list" size={15} /> Phụ đề</b>
          </div>

          <div className="lesson-list-head">
            <span>{done.size}/{lesson.sentences.length}</span>
            <button className="lesson-list-toggle" onClick={() => setShowText((value) => !value)} aria-pressed={showText}>
              {showText ? "Ẩn chữ" : "Hiện chữ"}
            </button>
          </div>

          <div className="lesson-list-progress">
            <span>Tiến độ</span>
            <button className="lesson-list-reset" onClick={resetProgress} disabled={done.size === 0}>
              <Icon name="replay" size={12} /> Đặt lại tiến độ
            </button>
            <b>{Math.round((done.size / lesson.sentences.length) * 100)}%</b>
          </div>
          <div className="lesson-list-bar">
            <i style={{ width: `${Math.round((done.size / lesson.sentences.length) * 100)}%` }} />
          </div>

          <ol>
            {lesson.sentences.map((item, position) => {
              // Chép chính tả thì che câu chưa làm — hiện ra là mất bài. Người học
              // vẫn tắt được chữ hẳn bằng nút "Ẩn chữ" ở trên.
              const open = mode === "shadowing" || done.has(item.index) || position === index;
              return (
                <li key={item.index}>
                  <button
                    className={`${position === index ? "active" : ""} ${done.has(item.index) ? "done" : ""}`}
                    onClick={() => {
                      go(position - index);
                      setIndex(position);
                    }}
                  >
                    <span className="lesson-list-tick" aria-hidden="true">{done.has(item.index) ? "✓" : ""}</span>
                    <span className="lesson-list-body">
                      <span className="lesson-list-meta">
                        <em>#{item.index}</em>
                        {position === index && <i className="now">ĐANG HỌC</i>}
                        <em className="at">{clock(item.start)}</em>
                      </span>
                      <span className="lesson-list-text">
                        {!showText
                          ? ""
                          : open
                            ? item.text
                            : (wordShapes(item.text) as { letters: number }[]).map((shape) => "·".repeat(shape.letters || 1)).join(" ")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </div>
  );
}
