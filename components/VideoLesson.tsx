"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type PlayerHandle } from "./YouTubePlayer";
import Icon from "./Icon";
import BackButton from "./BackButton";
import WordListPicker from "./WordListPicker";
import { createRecogniser, hasRecognition, micError, type Recognition } from "../lib/speech";
import { clearLessonProgress, doneSentences, needsRecapture, markSentence, readLessonProgress, readReports, reportedSentences, toggleReport } from "../lib/lessons.mjs";
import { properNouns, scoreDictation, wordShapes } from "../lib/youtube.mjs";
import { fetchGlance, translatePhrase } from "../lib/glance.mjs";
import { missingWords, readIpaCache, readTranslationCache, saveIpa, saveTranslation, withIpa } from "../lib/sentence-aids.mjs";
import { scoreShadowing } from "../lib/shadowing.mjs";
import { analyseWaveform, expectedProsody, refToExpected, scoreProsody } from "../lib/prosody.mjs";
import { fetchProsodyRef } from "../lib/prosody-ref.mjs";

type ProsodyRef = { stressedWords: string[]; pauseAfter: string[]; finalPitch: string; pitchRange: string; pace: string; summary: string };
type ProsodyScore = ReturnType<typeof scoreProsody> & { comparedToVideo?: boolean; modelRef?: ProsodyRef | null };
import { audioConstraint, micOptions, pickMic, readMic, saveMic } from "../lib/mic.mjs";
import { MAX_CHAIN, canChain, chainOf, clampChain } from "../lib/sentence-chain.mjs";
import { isSaved, makeSaved, readSaved, toggleSentence } from "../lib/saved-sentences.mjs";
import { foldersOf } from "../lib/folders.mjs";
import { aiFetch } from "../lib/supabase";
import { fallbackLessonSummary, normalizeLessonSummary } from "../lib/lesson-summary.mjs";
import { MAX_CUE_OVERLAP, segmentPlaybackEnd, usesLegacyHalfSecondBoundaries } from "../lib/caption-timing.mjs";
import { canReplay, LISTENING_MODES, replayLimit } from "../lib/listening-mode.mjs";
import { logAttempt, makeAttempt } from "../lib/error-log.mjs";
import type { NewWord } from "./Dictionary";

type FolderStore = Parameters<typeof foldersOf>[0];

/** Cầu nối tới kho từ vựng + danh sách từ cho ô tra nghĩa (nút ☆ và 📖). */
export type LookupVocab = {
  folders: FolderStore;
  updateFolders: (next: FolderStore) => void;
  legacyCollections: boolean;
  /** Mã của từ trong kho nếu đã lưu, chưa lưu thì null. */
  wordId: (term: string) => string | null;
  /** Bộ sưu tập gốc mà từ đang thuộc trong Kho từ vựng. */
  collectionOf: (term: string) => "mine" | "pdf";
  /** Thư mục theo thứ hiện tại của từ cá nhân. */
  studyDayOf: (term: string) => number | null;
  /** Chọn hoặc bỏ lịch học theo thứ cho từ cá nhân. */
  setStudyDay: (wordId: string, day: number | null) => void;
  /** Lưu từ vào kho, trả về mã từ (đã có thì trả mã cũ). */
  saveWord: (found: NewWord) => string;
  /** Mở trang Từ điển AI với từ này. */
  openDictionary: (term: string) => void;
};

// Học trên chính video: nghe chép chính tả và nói nhại theo TỪNG CÂU.
//
// Cả hai cách luyện dùng chung một trình phát và một danh sách câu, chỉ khác phần
// làm bài bên dưới. Gộp lại vì người học hay chép xong một câu rồi muốn nhại luôn
// câu đó — tách thành hai màn hình thì phải mở lại bài và tua lại từ đầu.

type Sentence = { index: number; start: number; end: number; text: string };
export type Lesson = { id: string; videoId: string; title: string; author: string; seconds: number; captionVersion?: number; timingPrecision?: "second" | "millisecond" | "word"; sentences: Sentence[] };
type Mode = "dictation" | "shadowing";
type ListeningMode = "easy" | "normal" | "exam";
type ShadowStage = "listen" | "shadow" | "retell" | "free" | "feedback";
type CoachTip = { word: string; ipa: string; how: string };
type CoachLink = { pair: string; rule: string; blend: string; how: string };
type LessonSummary = ReturnType<typeof fallbackLessonSummary>;

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

export default function VideoLesson({ lesson, mode, close, onStudied, onMode, vocab }: { lesson: Lesson; mode: Mode; close: () => void; onStudied?: () => void; onMode?: (next: Mode) => void; vocab?: LookupVocab }) {
  const [lessonView, setLessonView] = useState<"practice" | "overview">("practice");
  const [summary, setSummary] = useState<LessonSummary>(() => fallbackLessonSummary(lesson.title, lesson.sentences));
  const [summaryFor, setSummaryFor] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryWarning, setSummaryWarning] = useState("");
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState(1);
  const [at, setAt] = useState(0);
  const [progress, setProgress] = useState<Record<string, unknown>>({});

  // Chép chính tả
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [hints, setHints] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // Bấm riêng từng ô để lộ một từ (kèm tra nghĩa), không phải lộ cả câu.
  const [peeked, setPeeked] = useState<Set<number>>(() => new Set());

  // Nói nhại
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [micNote, setMicNote] = useState("");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  // Chế độ chỉ nghe: giấu khung hình đi để buộc tai làm việc, nhưng KHÔNG gỡ
  // trình phát khỏi trang — gỡ là mất luôn tiếng và phải nạp lại video từ đầu.
  const [audioOnly, setAudioOnly] = useState(false);
  // Trình phát YouTube không báo sự kiện play/pause, nên tự hỏi định kỳ để nút
  // phát ở chế độ Âm thanh hiện đúng biểu tượng.
  const [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(false);
  // Ghép thêm mấy câu phía sau vào đoạn đang luyện. 0 nghĩa là một câu như cũ.
  const [chain, setChain] = useState(0);
  const [saved, setSaved] = useState<{ key: string }[]>([]);
  const [reports, setReports] = useState<Record<string, number[]>>({});
  const [recordUrl, setRecordUrl] = useState("");
  // Phân biệt "chưa ghi âm" với "đã ghi nhưng máy không nghe được chữ nào".
  // Cả hai cùng có heard="", nhưng trường hợp sau phải hiện toàn bộ từ là sai.
  const [recordingAttempted, setRecordingAttempted] = useState(false);
  const [coaching, setCoaching] = useState(false);
  const [coachComment, setCoachComment] = useState("");
  const [coachError, setCoachError] = useState("");
  const [coachTips, setCoachTips] = useState<CoachTip[]>([]);
  const [coachLinks, setCoachLinks] = useState<CoachLink[]>([]);
  const [coachOpen, setCoachOpen] = useState(false);

  // Ba thứ đỡ khi nghe, bật tắt riêng vì mỗi người cần mức đỡ khác nhau.
  const [showText, setShowText] = useState(true);
  // Nghe chép: xem trước toàn bộ lời thoại trong danh sách bên phải để đọc lướt
  // trước khi nghe. Tắt mặc định để không lộ đáp án.
  const [previewAll, setPreviewAll] = useState(false);
  // Shadowing cần nhìn thấy cách đọc và nghĩa ngay như màn luyện mẫu. Dictation
  // vẫn giấu cả hai để không vô tình lộ đáp án trước khi người học gõ.
  const [showIpa, setShowIpa] = useState(mode === "shadowing");
  const [showVi, setShowVi] = useState(mode === "shadowing");
  const [ipaCache, setIpaCache] = useState<Record<string, string>>({});
  const [viCache, setViCache] = useState<Record<string, string>>({});
  const [lookup, setLookup] = useState<{
    word: string;
    ipa: string;
    meaning: string;
    parts?: string[];
    senses?: { part: string; meaningVi: string; definition: string; synonyms: string[] }[];
    x: number;
    y: number;
  } | null>(null);
  // Bôi đen một cụm trong câu để dịch cả cụm / lưu cả cụm vào kho.
  const [phrase, setPhrase] = useState<{ text: string; x: number; y: number; vi?: string; loading?: boolean; saved?: boolean } | null>(null);
  // Trạng thái cho nút ☆ (lưu từ + xếp vào danh sách) trong ô tra nghĩa.
  const [savedWordId, setSavedWordId] = useState<string | null>(null);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  // Điểm ngữ điệu (ước lượng) đo từ bản ghi của người học — xem lib/prosody.mjs.
  const [prosody, setProsody] = useState<ProsodyScore | null>(null);
  // Chấm xong tự sang câu kế tiếp. Tắt mặc định vì người mới cần đọc lại chỗ sai.
  const [autoNext, setAutoNext] = useState(false);
  const [listeningMode, setListeningMode] = useState<ListeningMode>("normal");
  const [replays, setReplays] = useState<Record<number, number>>({});
  const [examPhase, setExamPhase] = useState<"ready" | "playing" | "answering" | "checked">("ready");
  const [examAnswer, setExamAnswer] = useState("");
  const [missedSaved, setMissedSaved] = useState<Set<string>>(() => new Set());
  const [shadowStage, setShadowStage] = useState<ShadowStage>("listen");
  const [shadowResponse, setShadowResponse] = useState("");
  const [shadowFeedback, setShadowFeedback] = useState<{ reply: string; correction?: { type?: string; wrong?: string; right?: string; why?: string; rule?: string; example?: string } | null } | null>(null);
  const [shadowChecking, setShadowChecking] = useState(false);

  const stage = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerHandle | null>(null);
  const engine = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingActive = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeCaptionRef = useRef<HTMLButtonElement | null>(null);
  const startedAt = useRef(0);
  // Câu đang nhại lúc bắt đầu ghi — dùng để chấm ngữ điệu khi bản ghi dừng, vì
  // lúc đó người học có thể đã bấm sang câu khác.
  const scoringRef = useRef<{ text: string; index: number; start: number; end: number }>({ text: "", index: 0, start: 0, end: 0 });

  const sentence = lesson.sentences[index];
  const span = useMemo(
    () => chainOf(lesson.sentences, index, mode === "shadowing" ? chain : 0) as { text: string; start: number; end: number; count: number; words: number } | null,
    [lesson.sentences, index, chain, mode],
  );
  // Chữ và mốc thời gian của đoạn đang luyện; chưa ghép thì y hệt câu đơn.
  const target = span ?? { text: sentence?.text ?? "", start: sentence?.start ?? 0, end: sentence?.end ?? 0, count: 1, words: 0 };
  const legacyHalfSecond = useMemo(
    () => usesLegacyHalfSecondBoundaries(lesson.sentences, lesson.captionVersion),
    [lesson.sentences, lesson.captionVersion],
  );
  const nextSentenceStart = lesson.sentences[index + target.count]?.start;
  // Chỉ timestamp từng từ mới đủ chính xác để giữ phần chồng. `millisecond`
  // ở đây có thể là mốc của cả dòng transcript; thêm 1,2 giây sẽ lọt 2–3 từ
  // của câu kế tiếp như video Life Of Riza.
  const preciseOverlap = lesson.timingPrecision === "word" ? MAX_CUE_OVERLAP : 0;
  const playbackEnd = segmentPlaybackEnd(target.start, target.end, nextSentenceStart, legacyHalfSecond, preciseOverlap);
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

  // Giữ câu đang học trong vùng nhìn thấy của danh sách phụ đề. Dùng `nearest`
  // để chỉ cuộn khung danh sách, không kéo giật toàn bộ trang.
  useEffect(() => {
    activeCaptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [index, lesson.id]);

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
            .then((data: { ipa?: Record<string, string>; missing?: string[]; estimated?: Record<string, string> }) => {
              if (alive && (data.ipa || data.missing || data.estimated)) {
                setIpaCache(saveIpa(data.ipa ?? {}, data.missing ?? [], data.estimated ?? {}));
              }
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

  // Đồng bộ trạng thái phát/dừng cho nút lớn ở chế độ Âm thanh.
  useEffect(() => {
    if (!audioOnly) return;
    const timer = window.setInterval(() => setPlaying(Boolean(player.current?.playing())), 300);
    return () => window.clearInterval(timer);
  }, [audioOnly]);

  // Bấm ra ngoài thanh "Dịch cụm" thì đóng nó lại.
  useEffect(() => {
    if (!phrase) return;
    const onDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement)?.closest?.(".phrase-bar")) setPhrase(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [phrase]);

  // Phím tắt để tay không rời bàn phím: gõ xong Enter là chấm rồi Enter lần nữa
  // sang câu kế, Ctrl nghe lại mà không phải với chuột lên nút.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Exam chỉ cho nghe một lượt liên tục. Phím tắt không được trở thành đường
      // vòng để nghe lại, lộ đáp án hoặc chấm khi audio chưa kết thúc.
      if (mode === "dictation" && listeningMode === "exam" && examPhase !== "checked") return;
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
    recordingActive.current = false;
    engine.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  useEffect(() => () => {
    if (recordUrl) URL.revokeObjectURL(recordUrl);
  }, [recordUrl]);

  // Người học có thể chủ động dừng bất kỳ lúc nào; 30 giây là giới hạn an toàn
  // giống màn Shadowing mẫu.
  useEffect(() => {
    if (!listening) return;
    const tick = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt.current) / 1000;
      if (elapsed < 30) {
        setRecordingSeconds(elapsed);
        return;
      }
      setRecordingSeconds(30);
      setRecordingAttempted(true);
      recordingActive.current = false;
      try { engine.current?.stop(); } catch { /* engine đã tự kết thúc */ }
      setListening(false);
      if (recorder.current?.state === "recording") recorder.current.stop();
    }, 200);
    return () => window.clearInterval(tick);
  }, [listening]);

  useEffect(() => {
    if (!coachOpen) return;
    const closeCoach = (event: KeyboardEvent) => { if (event.key === "Escape") setCoachOpen(false); };
    window.addEventListener("keydown", closeCoach);
    return () => window.removeEventListener("keydown", closeCoach);
  }, [coachOpen]);

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
  // là CÂU, nên dừng player ngay khi chạm mốc cuối của câu đang chọn. Ticker đã
  // chạy 40 lần/giây nên không cần trừ sớm 60ms; trừ sớm chính là đủ để nuốt
  // phụ âm cuối ở các từ ngắn như "it", "did", "thank".
  useEffect(() => {
    if (lessonView === "overview" || !sentence || !player.current?.playing() || (listeningMode === "exam" && examPhase === "playing")) return;
    if (at >= playbackEnd) player.current.pause();
  }, [at, sentence, playbackEnd, lessonView, listeningMode, examPhase]);

  useEffect(() => {
    if (listeningMode !== "exam" || examPhase !== "playing") return;
    const active = lesson.sentences.findIndex((item, position) => at >= item.start && at < (lesson.sentences[position + 1]?.start ?? item.end));
    if (active >= 0 && active !== index) setIndex(active);
    if (at >= lesson.seconds - 0.35) {
      player.current?.pause();
      setExamPhase("answering");
      setPlaying(false);
    }
  }, [at, examPhase, listeningMode, lesson.sentences, lesson.seconds, index]);

  /** Phát đúng câu đang làm, từ đầu câu. */
  function playSentence() {
    if (!sentence || !player.current) return;
    if (mode === "dictation") {
      if (listeningMode === "exam") return;
      const used = replays[sentence.index] ?? 0;
      if (!canReplay(listeningMode, used)) return;
      setReplays((current) => ({ ...current, [sentence.index]: used + 1 }));
    }
    player.current.rate(rate);
    player.current.seek(target.start);
    player.current.play();
    setPlaying(true);
  }

  function startExam() {
    if (!player.current || examPhase !== "ready") return;
    setIndex(0);
    setExamAnswer("");
    setExamPhase("playing");
    player.current.rate(1);
    player.current.seek(lesson.sentences[0]?.start ?? 0);
    player.current.play();
    setPlaying(true);
  }

  /** Nút phát lớn ở chế độ Âm thanh: đang phát thì dừng, đang dừng thì phát tiếp
   *  (nếu đã ra ngoài câu thì quay về đầu câu). */
  function togglePlay() {
    if (!player.current) return;
    if (player.current.playing()) {
      player.current.pause();
      setPlaying(false);
      return;
    }
    const now = player.current.time();
    if (now < target.start || now > playbackEnd + 0.3) player.current.seek(target.start);
    player.current.rate(rate);
    player.current.play();
    setPlaying(true);
  }

  /** Trong Tổng quan, phát tự do từ vị trí hiện tại tới hết video, không dừng ở
   * mốc cuối câu như hai chế độ luyện tập. */
  function toggleWholeLesson() {
    if (!player.current) return;
    if (player.current.playing()) {
      player.current.pause();
      setPlaying(false);
      return;
    }
    if (player.current.time() >= lesson.seconds - 0.5) player.current.seek(0);
    player.current.rate(rate);
    player.current.play();
    setPlaying(true);
  }

  function playWholeFrom(seconds: number) {
    if (!player.current) return;
    player.current.seek(seconds);
    player.current.rate(rate);
    player.current.play();
    setPlaying(true);
  }

  async function openOverview() {
    player.current?.pause();
    setPlaying(false);
    setLessonView("overview");
    if (summaryFor === lesson.id || summaryLoading) return;
    const fallback = fallbackLessonSummary(lesson.title, lesson.sentences);
    setSummary(fallback);
    setSummaryLoading(true);
    setSummaryWarning("");
    try {
      const response = await aiFetch("/api/ai/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: lesson.title, sentences: lesson.sentences }),
      });
      const data = (await response.json()) as { summary?: Record<string, unknown>; warning?: string; error?: string };
      if (!response.ok || !data.summary) throw new Error(data.error || "Không tạo được bản tóm tắt.");
      setSummary(normalizeLessonSummary(data.summary, fallback));
      setSummaryWarning(data.warning ?? "");
      setSummaryFor(lesson.id);
    } catch (error) {
      setSummaryWarning(error instanceof Error ? `${error.message} Đang hiển thị bản tổng quan từ transcript.` : "Đang hiển thị bản tổng quan từ transcript.");
    } finally {
      setSummaryLoading(false);
    }
  }

  /** Tua trong phạm vi câu đang làm. */
  function nudge(seconds: number) {
    if (!player.current) return;
    const next = Math.min(target.end, Math.max(target.start, player.current.time() + seconds));
    player.current.seek(next);
  }

  // Lấy đúng chữ tiếng Anh trong vùng bôi đen — bỏ phần phiên âm IPA lẫn vào.
  function phraseFromSelection(selection: Selection): string {
    const host = stage.current;
    if (host) {
      const tokens = [...host.querySelectorAll<HTMLElement>(".shadowing-sentence .lesson-word, .lesson-sentence .lesson-word")];
      const hit = tokens.filter((token) => selection.containsNode(token, true));
      if (hit.length >= 2) {
        return hit.map((token) => token.querySelector("span")?.textContent?.trim() ?? "").filter(Boolean).join(" ");
      }
    }
    // Câu chép / đáp án là văn bản thuần; nếu có IPA dạng /.../ thì cắt bỏ.
    return (selection.toString() ?? "").replace(/\s*\/[^/]{1,40}\//g, "").replace(/\s+/g, " ").trim();
  }

  // Người học bôi đen một cụm trong câu → hiện thẻ "Dịch cụm / Lưu vào kho".
  function onPhraseSelect() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setPhrase(null);
      return;
    }
    const text = phraseFromSelection(selection);
    // Chỉ bắt cụm nhiều từ; một từ đơn thì đã có nút bấm-để-tra sẵn.
    if (!/\s/.test(text) || text.length > 160 || !/[a-zA-Z]/.test(text)) {
      setPhrase(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const width = 300;
    const x = Math.min(Math.max(rect.left + rect.width / 2, width / 2 + 8), window.innerWidth - width / 2 - 8);
    const below = rect.bottom + 8;
    const y = below + 190 > window.innerHeight ? Math.max(8, rect.top - 8) : below;
    setPhrase({ text, x, y, loading: true });
    void translatePhrase(text).then((vi) =>
      setPhrase((current) => (current && current.text === text ? { ...current, loading: false, vi: vi || "Không dịch được cụm này." } : current)),
    );
  }

  async function translateSelectedPhrase() {
    if (!phrase || phrase.loading) return;
    setPhrase((current) => (current ? { ...current, loading: true, vi: undefined } : current));
    const vi = await translatePhrase(phrase.text);
    setPhrase((current) =>
      current && current.text === phrase.text ? { ...current, loading: false, vi: vi || "Không dịch được cụm này." } : current,
    );
  }

  async function saveSelectedPhrase() {
    if (!phrase || !vocab || phrase.saved) return;
    const vi = phrase.vi && !/Không dịch/.test(phrase.vi) ? phrase.vi : await translatePhrase(phrase.text);
    vocab.saveWord({ term: phrase.text, ipa: "", meaning: vi || "", partOfSpeech: "cụm từ", definition: "" });
    setPhrase((current) => (current ? { ...current, saved: true, vi: current.vi ?? vi } : current));
  }

  async function lookUp(token: string, element: HTMLElement) {
    const word = token.toLowerCase().replace(/[^a-z'-]/g, "");
    if (!word) return;
    const card = element.closest(".shadowing-card, .lesson-shapes")?.getBoundingClientRect();
    const anchor = element.getBoundingClientRect();
    const position = { x: Math.max(12, anchor.left - (card?.left ?? anchor.left)), y: anchor.bottom - (card?.top ?? anchor.top) + 8 };
    setSavedWordId(null);
    setListMenuOpen(false);
    setShadowStage("listen");
    setShadowResponse("");
    setShadowFeedback(null);
    setLookup({ word, ipa: ipaCache[word] ?? "", meaning: "Đang tra…", ...position });
    try {
      const data = (await fetchGlance(word)) as {
        ipa: string;
        meaningVi: string;
        senses: { part: string; meaningVi: string; definition: string; synonyms: string[] }[];
      };
      const senses = data.senses.filter((sense) => sense.meaningVi || sense.definition);
      const parts = [...new Set(senses.map((sense) => sense.part).filter(Boolean))];
      setLookup({
        word,
        ipa: data.ipa || ipaCache[word] || "",
        // Dòng đậm chỉ để nghĩa tiếng Việt gọn — nếu chưa dịch được thì để trống,
        // danh sách nghĩa bên dưới vẫn hiện (tiếng Anh) chứ không nhồi cả câu vào đây.
        meaning: data.meaningVi || senses[0]?.meaningVi || "",
        parts,
        senses,
        ...position,
      });
    } catch {
      setLookup({ word, ipa: ipaCache[word] ?? "", meaning: "Không tra được từ này.", ...position });
    }
  }

  function speakLookup() {
    if (!lookup?.word) return;
    window.speechSynthesis?.cancel();
    const utterance = new SpeechSynthesisUtterance(lookup.word);
    utterance.lang = "en-US";
    window.speechSynthesis?.speak(utterance);
  }

  /** Mã của từ đang tra nếu đã nằm trong kho (state cục bộ hoặc tra lại từ kho). */
  const lookupWordId = savedWordId ?? (vocab && lookup ? vocab.wordId(lookup.word) : null);

  /** Đảm bảo từ đang tra đã có trong kho — trả về mã từ để xếp vào danh sách. */
  function ensureWordSaved(): string | null {
    if (!vocab || !lookup) return null;
    if (lookupWordId) return lookupWordId;
    const id = vocab.saveWord({
      term: lookup.word,
      ipa: lookup.ipa || "",
      meaning: lookup.meaning || lookup.senses?.[0]?.meaningVi || lookup.senses?.[0]?.definition || "",
      partOfSpeech: lookup.parts?.[0] ?? "",
      definition: lookup.senses?.[0]?.definition ?? "",
    });
    setSavedWordId(id);
    return id;
  }

  function go(step: number, autoplay = false) {
    const next = Math.min(lesson.sentences.length - 1, Math.max(0, index + step));
    const nextSentence = lesson.sentences[next];
    setIndex(next);
    setChain((value) => clampChain(lesson.sentences, next, value) as number);
    setTyped("");
    setChecked(false);
    setHints(0);
    setRevealed(false);
    setPeeked(new Set());
    setHeard("");
    setRecordingAttempted(false);
    setMicNote("");
    setRecordingSeconds(0);
    setProsody(null);
    setRecordUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setCoachComment("");
    setCoachError("");
    setCoachTips([]);
    setCoachLinks([]);
    setCoachOpen(false);
    setLookup(null);
    setPhrase(null);
    setSavedWordId(null);
    setListMenuOpen(false);
    // Câu đang chọn và vị trí video luôn là một trạng thái duy nhất. Trước đây
    // danh sách đổi câu nhưng player vẫn đứng ở thời gian cũ nên bấm phát sẽ nói
    // sang đoạn khác.
    player.current?.pause();
    if (nextSentence && player.current) {
      const syncPlayer = () => {
        if (!player.current) return;
        player.current.rate(rate);
        player.current.seek(nextSentence.start);
        if (autoplay) player.current.play();
      };
      // Khi bấm trực tiếp một đoạn, chờ React cập nhật target/end trước rồi mới
      // phát. Nếu phát ngay, bộ dừng có thể vẫn dùng end của câu cũ.
      if (autoplay) window.requestAnimationFrame(syncPlayer);
      else syncPlayer();
    }
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
  const examText = useMemo(() => lesson.sentences.map((item) => item.text).join(" "), [lesson.sentences]);
  const examResult = useMemo(
    () => examPhase === "checked" ? (scoreDictation(examText, examAnswer) as { percent: number; matched: number; total: number; words: { word: string; ok: boolean }[] }) : null,
    [examPhase, examText, examAnswer],
  );
  const missedWordsNow = useMemo(() => {
    const rows = listeningMode === "exam" ? examResult?.words : result?.words;
    return [...new Set((rows ?? []).filter((item) => !item.ok).map((item) => item.word.toLowerCase().replace(/[^a-z'-]/g, "")).filter(Boolean))];
  }, [listeningMode, examResult, result]);

  async function addMissedToReview() {
    if (!vocab) return;
    const added = new Set(missedSaved);
    const terms = missedWordsNow.filter((term) => !added.has(term));
    const found = await Promise.all(terms.map(async (term) => {
      try {
        const data = (await fetchGlance(term)) as { ipa?: string; meaningVi?: string; senses?: { part?: string; meaningVi?: string; definition?: string }[] };
        const sense = data.senses?.find((item) => item.meaningVi || item.definition);
        return { term, ipa: data.ipa || "", meaning: data.meaningVi || sense?.meaningVi || "", partOfSpeech: sense?.part || "", definition: sense?.definition || "" };
      } catch {
        return { term, ipa: "", meaning: "", partOfSpeech: "", definition: "" };
      }
    }));
    for (const word of found) {
      vocab.saveWord(word);
      const term = word.term;
      added.add(term);
    }
    setMissedSaved(added);
  }
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

  async function checkOpenSpeaking(stage: "retell" | "free") {
    const said = shadowResponse.trim();
    if (!said || shadowChecking) return;
    setShadowChecking(true);
    try {
      const goal = stage === "retell" ? "Tóm tắt đúng ý chính bằng lời của mình" : "Nêu một ý kiến hoặc trải nghiệm liên quan đến nội dung";
      const response = await aiFetch("/api/ai/speaking", {
        method: "POST",
        body: JSON.stringify({
          scenario: {
            title: stage === "retell" ? "Retell" : "Free Speaking",
            setting: `Câu gốc trong video: ${target.text}`,
            partner: "an English speaking coach",
            you: "a learner responding without reading the original sentence",
            goals: [goal],
            level: "B1",
          },
          history: [],
          said,
        }),
      });
      const data = (await response.json()) as { reply?: string; correction?: { type?: string; wrong?: string; right?: string; why?: string; rule?: string; example?: string } | null; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "Không chấm được phần nói mở rộng.");
      setShadowFeedback({ reply: data.reply || "Your meaning is clear.", correction: data.correction });
      if (data.correction) logAttempt(makeAttempt({
        term: `${lesson.title} · ${stage}`,
        vietnamese: target.text,
        answer: said,
        reference: data.correction.right || "",
        score: 0,
        correct: false,
        gradedBy: "llm",
        issues: [{ ...data.correction, kind: "error", sourceSkill: "speaking" }],
        assessedTypes: [data.correction.type || "grammar"],
      }));
      setShadowStage(stage === "retell" ? "free" : "feedback");
      setShadowResponse("");
    } catch (error) {
      setMicNote(error instanceof Error ? error.message : "Không chấm được phần nói mở rộng.");
    } finally {
      setShadowChecking(false);
    }
  }

  // ── Nói nhại ──────────────────────────────────────────────────────────────
  const spoken = useMemo(
    () =>
      recordingAttempted && target.text
        ? (scoreShadowing(target.text, heard) as {
            clarity: number;
            words: { word: string; status: string }[];
            marks: { word: string; heard?: string; status: string }[];
            missed: string[];
            swallowed: string[];
            spokenCount: number;
          })
        : null,
    [heard, recordingAttempted, target.text],
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

  // Giải mã bản ghi rồi chấm ngữ điệu. Lỗi ở bước nào cũng bỏ qua lặng lẽ — phần
  // chấm chữ (độ rõ lời) vẫn chạy độc lập, ngữ điệu chỉ là điểm cộng.
  async function scoreProsodyFromBlob(blob: Blob, at: { text: string; index: number; start: number; end: number }) {
    if (!at.text.trim()) return;
    // Bản ghi im lặng bị chặn ở scoreProsody bằng ngưỡng âm lượng, không dựa vào
    // chữ máy nghe được — kết quả nhận dạng đến sau lúc bản ghi dừng nên dựa vào
    // nó sẽ lúc chấm lúc không.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new Ctx();
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      // Giảm tần số mẫu về ~16kHz và cắt tối đa 15s trước khi phân tích: dò cao độ
      // bằng tự tương quan rất nặng, để nguyên 48kHz × 11s là treo cả giây.
      const raw = buffer.getChannelData(0);
      const step = Math.max(1, Math.round(buffer.sampleRate / 16000));
      const rate = buffer.sampleRate / step;
      const limit = Math.min(raw.length, Math.floor(15 * buffer.sampleRate));
      const samples = new Float32Array(Math.floor(limit / step));
      for (let i = 0; i < samples.length; i += 1) samples[i] = raw[i * step];
      const measured = analyseWaveform(samples, rate, { hopMs: 20 });
      // Hiện ngay điểm ước lượng từ văn bản để người học không phải chờ.
      const quick = scoreProsody(measured, expectedProsody(at.text));
      setProsody({ ...quick, comparedToVideo: false, modelRef: null });
      // Đoạn nói quá ngắn / quá nhỏ thì thôi, đừng tốn lượt AI gọi phân tích video.
      if (!quick.usable) return;
      // Rồi nâng cấp: so với chính người nói trong video (Gemini nghe đoạn clip,
      // nhớ lại theo câu nên chỉ tốn một lượt AI cho mỗi câu).
      const ref = (await fetchProsodyRef({
        videoId: lesson.videoId,
        sentenceIndex: at.index,
        start: at.start,
        end: at.end,
        sentence: at.text,
      })) as ProsodyRef | null;
      if (ref && scoringRef.current.index === at.index) {
        setProsody({ ...scoreProsody(measured, refToExpected(ref, at.text)), comparedToVideo: true, modelRef: ref });
      }
    } catch (error) {
      console.warn("prosody: không chấm được", error);
      setProsody((current) =>
        current?.usable
          ? current // đã có điểm rồi thì giữ, đừng xoá vì bước nâng cấp video hỏng
          : {
              usable: false, score: 0, rhythm: 0, stress: 0, melody: null,
              pauses: 0, expectedPauses: 0, dynamicDb: 0, monotone: false,
              notes: ["Chưa đọc được bản ghi để chấm ngữ điệu. Thử ghi âm lại."],
            },
      );
    } finally {
      void ctx?.close();
    }
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
        const blob = new Blob(chunks, { type: next.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        setRecordUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return url;
        });
        void scoreProsodyFromBlob(blob, scoringRef.current);
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
    setRecordingAttempted(false);
    setMicNote("");
    setCoachComment("");
    setCoachError("");
    setCoachTips([]);
    setCoachLinks([]);
    setCoachOpen(false);
    setRecordingSeconds(0);
    setProsody(null);
    scoringRef.current = { text: target.text, index, start: target.start, end: target.end };
    recordingActive.current = true;
    engine.current = recogniser;
    recogniser.continuous = true;
    startedAt.current = Date.now();
    player.current?.pause();
    await startRecording();

    let completed = "";
    let current = "";
    recogniser.onresult = (event) => {
      current = Array.from(event.results, (item) => item[0]?.transcript ?? "").join(" ").trim();
      setHeard([completed, current].filter(Boolean).join(" "));
    };
    recogniser.onerror = (event) => {
      setMicNote(micError(event.error));
      if (["not-allowed", "service-not-allowed", "audio-capture", "network"].includes(event.error)) recordingActive.current = false;
    };
    recogniser.onend = () => {
      if (recordingActive.current) {
        completed = [completed, current].filter(Boolean).join(" ");
        current = "";
        window.setTimeout(() => {
          if (!recordingActive.current) return;
          try { recogniser.start(); }
          catch { recordingActive.current = false; setListening(false); if (recorder.current?.state === "recording") recorder.current.stop(); }
        }, 80);
        return;
      }
      setListening(false);
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
    setListening(true);
    recogniser.start();
  }

  function stopRecording() {
    setRecordingAttempted(true);
    recordingActive.current = false;
    try { engine.current?.stop(); } catch { /* engine đã tự kết thúc */ }
    setListening(false);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function askCoach() {
    if (!sentence || !spoken || coaching) return;
    setCoachOpen(true);
    if (coachComment || coachTips.length > 0 || coachLinks.length > 0) return;
    setCoaching(true);
    setCoachError("");
    setCoachComment("");
    setCoachTips([]);
    setCoachLinks([]);
    try {
      const response = await aiFetch("/api/ai/pronounce", {
        method: "POST",
        body: JSON.stringify({ sentence: target.text, heard, missed: spoken.missed, swallowed: spoken.swallowed }),
      });
      const data = (await response.json()) as { comment?: string; tips?: CoachTip[]; links?: CoachLink[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "Chưa lấy được nhận xét phát âm.");
      setCoachTips(data.tips ?? []);
      setCoachLinks(data.links ?? []);
      if (!data.comment && !data.tips?.length && !data.links?.length) {
        setCoachComment("Máy đã nhận ra đầy đủ các từ trong câu. Hãy nghe lại bản ghi và đối chiếu nhịp điệu với câu mẫu.");
      } else {
        setCoachComment(data.comment ?? "");
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
        <BackButton destination="danh sách bài" onClick={close} />
        <p className="empty">Bài này chưa có câu nào.</p>
      </div>
    );

  // Ô tra nghĩa dùng chung cho cả nói nhại và nghe chép — đặt trong thẻ có
  // position:relative gần nhất, toạ độ tính theo thẻ đó.
  const lookupCard = lookup && (
    <div className="lesson-lookup lesson-lookup-popover" style={{ left: lookup.x, top: lookup.y }}>
      <div className="lesson-lookup-title">
        <b>{lookup.word}</b>
        <button className="lesson-lookup-speak" onClick={speakLookup} aria-label={`Phát âm ${lookup.word}`}>
          <Icon name="volume" size={15} />
        </button>
        {vocab && (
          <>
            <button
              className={`lesson-lookup-star${lookupWordId ? " on" : ""}`}
              onClick={() => { ensureWordSaved(); setListMenuOpen((open) => !open); }}
              aria-pressed={Boolean(lookupWordId)}
              aria-label="Lưu từ và xếp vào danh sách"
              title="Lưu từ và xếp vào danh sách"
            >
              <Icon name="star" size={15} />
            </button>
            <button
              className="lesson-lookup-open"
              onClick={() => vocab.openDictionary(lookup.word)}
              aria-label="Xem chi tiết trong Từ điển"
              title="Xem chi tiết trong Từ điển"
            >
              <Icon name="book" size={15} />
            </button>
          </>
        )}
        <button className="lesson-lookup-close" onClick={() => setLookup(null)} aria-label="Đóng">×</button>
      </div>

      {vocab && listMenuOpen && (
        <div className="lesson-lookup-lists">
          {lookupWordId ? (
            <WordListPicker compact legacyCollections={vocab.legacyCollections} folders={vocab.folders} wordId={lookupWordId} updateFolders={vocab.updateFolders} collection={vocab.collectionOf(lookup.word)} studyDay={vocab.studyDayOf(lookup.word)} onStudyDayChange={(day) => vocab.setStudyDay(lookupWordId, day)} onDone={() => setListMenuOpen(false)} />
          ) : <p>Đang lưu từ vào Kho từ vựng…</p>}
        </div>
      )}

      <div className="lesson-lookup-meta">
        {lookup.ipa && <code>{lookup.ipa}</code>}
        {lookup.parts?.map((part) => <em key={part}>{part}</em>)}
      </div>
      {lookup.meaning && <strong>{lookup.meaning}</strong>}
      {lookup.senses && lookup.senses.length > 0 && (
        <ul>
          {lookup.senses.map((sense, position) => (
            <li key={position}>
              {sense.part && <i>{sense.part}</i>}
              <span>{sense.meaningVi || sense.definition}</span>
              {sense.meaningVi && !sense.synonyms.length && sense.definition && <small>{sense.definition}</small>}
              {sense.synonyms.length > 0 && <small className="syn">{sense.synonyms.join(", ")}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const lessonTop = (
    <div className="lesson-top">
      <BackButton destination="danh sách bài" onClick={close} />
      <span className="lesson-level">B1</span>
      <div className="lesson-title">
        <b>{lesson.title}</b>
        <small>{[lesson.author, `${lesson.sentences.length} câu`].filter(Boolean).join(" · ")}</small>
      </div>
      <div className="lesson-mode-tabs" role="group" aria-label="Chế độ bài học">
        <button className={lessonView === "practice" && mode === "shadowing" ? "active" : ""} onClick={() => { player.current?.pause(); setLessonView("practice"); onMode?.("shadowing"); }}>
          <Icon name="mic" size={15} /> Nói nhại
        </button>
        <button className={lessonView === "practice" && mode === "dictation" ? "active" : ""} onClick={() => { player.current?.pause(); setLessonView("practice"); onMode?.("dictation"); }}>
          <Icon name="headphones" size={15} /> Nghe chép
        </button>
        <button className={lessonView === "overview" ? "active" : ""} onClick={() => void openOverview()}>
          <Icon name="book" size={15} /> Tổng quan bài
        </button>
      </div>
      <div className="lesson-view-tools">
        <div className="lesson-av-tabs" role="group" aria-label="Hình hoặc chỉ tiếng">
          <button className={!audioOnly ? "active" : ""} onClick={() => setAudioOnly(false)} aria-pressed={!audioOnly}>
            <Icon name="play" size={14} /> Video
          </button>
          <button className={audioOnly ? "active" : ""} onClick={() => setAudioOnly(true)} aria-pressed={audioOnly}>
            <Icon name="headphones" size={14} /> Âm thanh
          </button>
        </div>
        <button onClick={toggleFullscreen} aria-label={full ? "Thoát toàn màn hình" : "Toàn màn hình"}>
          <Icon name={full ? "stop" : "target"} size={15} />
        </button>
      </div>
      <span className="lesson-count">{done.size}/{lesson.sentences.length}</span>
    </div>
  );

  if (lessonView === "overview") {
    return (
      <div ref={stage} className={`page video-lesson video-lesson-v2 lesson-overview-page${audioOnly ? " audio-only" : ""}${full ? " full" : ""}`}>
        {lessonTop}
        <main className="lesson-overview-layout">
          <section className="lesson-overview-media">
            <div className="lesson-overview-video">
              <YouTubePlayer videoId={lesson.videoId} onReady={(handle) => { player.current = handle; }} onTime={setAt} />
              {audioOnly && (
                <div className="lesson-overview-audio">
                  <Icon name="headphones" size={34} />
                  <strong>Đang nghe toàn bài</strong>
                  <span>{clock(at)} / {clock(lesson.seconds)}</span>
                </div>
              )}
            </div>
            <div className="lesson-whole-controls">
              <button onClick={() => playWholeFrom(Math.max(0, at - 10))} aria-label="Lùi 10 giây"><Icon name="replay" size={17} /> 10s</button>
              <button className="primary" onClick={toggleWholeLesson}><Icon name={playing ? "stop" : "play"} size={18} /> {playing ? "Tạm dừng" : at > 0.5 ? "Tiếp tục nghe" : "Nghe toàn bài"}</button>
              <button onClick={() => playWholeFrom(Math.min(lesson.seconds, at + 10))} aria-label="Tiến 10 giây">10s <Icon name="arrow" size={16} /></button>
              <span>{clock(at)} / {clock(lesson.seconds)}</span>
              <div className="lesson-overview-rates">
                {RATES.map((value) => <button key={value} className={value === rate ? "active" : ""} onClick={() => { setRate(value); player.current?.rate(value); }}>{value}x</button>)}
              </div>
            </div>
            <div className="lesson-overview-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, (at / Math.max(1, lesson.seconds)) * 100)}%` }} /></div>
          </section>

          <section className="lesson-overview-content">
            <header className="lesson-overview-heading">
              <div><span>TỔNG QUAN BÀI</span><h1>Nắm nội dung trước khi luyện</h1></div>
              {summaryLoading && <em><Icon name="sparkles" size={14} /> Đang phân tích transcript…</em>}
            </header>
            {summaryWarning && <p className="lesson-summary-warning">{summaryWarning}</p>}
            <article className="lesson-summary-card">
              <h2>Nội dung chính</h2>
              <p>{summary.summaryVi}</p>
              <ul>{summary.keyPoints.map((point, position) => <li key={position}><span>{position + 1}</span>{point}</li>)}</ul>
            </article>

            <article className="lesson-summary-section">
              <div className="lesson-summary-title"><div><h2>Từ vựng đáng học</h2><p>Những từ và cụm từ nổi bật trong ngữ cảnh của bài</p></div><span>{summary.vocabulary.length} từ</span></div>
              <div className="lesson-summary-vocab">
                {summary.vocabulary.map((item) => (
                  <div key={item.term}>
                    <b>{item.term}</b>
                    <strong>{item.meaningVi || "Có trong transcript — bấm Từ điển AI để tra sâu"}</strong>
                    {item.example && <small>{item.example}</small>}
                    {vocab && <button onClick={() => vocab.openDictionary(item.term)}>Tra và lưu từ <Icon name="arrow" size={13} /></button>}
                  </div>
                ))}
              </div>
            </article>

            <article className="lesson-summary-section">
              <div className="lesson-summary-title"><div><h2>Câu và cách diễn đạt hay</h2><p>Có thể dùng lại khi nói hoặc viết</p></div><span>{summary.phrases.length} câu</span></div>
              <div className="lesson-summary-phrases">
                {summary.phrases.map((item, position) => <div key={position}><span>{String(position + 1).padStart(2, "0")}</span><div><b>{item.text}</b>{item.meaningVi && <p>{item.meaningVi}</p>}<small>{item.note}</small></div></div>)}
              </div>
            </article>

            <article className="lesson-summary-section lesson-full-transcript">
              <div className="lesson-summary-title"><div><h2>Transcript toàn bài</h2><p>Chọn một câu để nghe liên tục từ vị trí đó</p></div><span>{lesson.sentences.length} câu</span></div>
              <ol>{lesson.sentences.map((item) => <li key={item.index}><button onClick={() => playWholeFrom(item.start)}><time>{clock(item.start)}</time><span>{item.text}</span><Icon name="play" size={13} /></button></li>)}</ol>
            </article>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div
      ref={stage}
      className={`page video-lesson video-lesson-v2 ${mode === "shadowing" ? "shadowing-layout" : "dictation-layout"}${audioOnly ? " audio-only" : ""}${full ? " full" : ""}`}
    >
      {lessonTop}

      <div className="lesson-body">
        <div className="lesson-main">
          <YouTubePlayer
            videoId={lesson.videoId}
            onReady={(handle) => {
              player.current = handle;
            }}
            onTime={setAt}
          />

          {audioOnly && (
            // Chế độ Âm thanh: thay khung hình bằng một mặt đồng hồ + nút phát lớn.
            <div className="lesson-audio-card" aria-label="Trình phát âm thanh">
              <div className="lesson-audio-seg">Câu {index + 1} / {lesson.sentences.length}</div>
              <div className="lesson-audio-clock">{clock(at)}</div>
              <div className="lesson-audio-dots" aria-hidden="true">
                {Array.from({ length: 34 }, (_, dot) => {
                  const done = (dot + 1) / 34 <= (at - target.start) / Math.max(0.4, target.end - target.start);
                  return <span key={dot} className={done ? "on" : ""} />;
                })}
              </div>
              <div className="lesson-audio-transport">
                <button onClick={() => go(-1, true)} disabled={index === 0} aria-label="Câu trước"><Icon name="previous" size={18} /></button>
                <button onClick={() => nudge(-3)} aria-label="Lùi 3 giây"><Icon name="replay" size={17} /></button>
                <button className="lesson-audio-play" onClick={togglePlay} aria-label={playing ? "Tạm dừng" : "Phát"}>
                  <Icon name={playing ? "stop" : "play"} size={26} />
                </button>
                <button onClick={playSentence} aria-label="Nghe lại từ đầu câu"><Icon name="replay" size={17} className="mirror" /></button>
                <button onClick={() => go(1, true)} disabled={index >= lesson.sentences.length - 1} aria-label="Câu sau"><Icon name="previous" size={18} className="mirror" /></button>
              </div>
            </div>
          )}

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
            <section className="listening-mode-picker" aria-label="Mức độ bài nghe">
              <div><b>Mức độ nghe</b><span>{listeningMode === "exam" ? "Toàn bài" : `Câu ${index + 1}`}</span></div>
              {(LISTENING_MODES as { value: ListeningMode; label: string; hint: string }[]).map((item) => (
                <button
                  type="button"
                  key={item.value}
                  className={listeningMode === item.value ? "active" : ""}
                  disabled={examPhase === "playing"}
                  onClick={() => {
                    player.current?.pause();
                    setListeningMode(item.value);
                    setExamPhase("ready");
                    setChecked(false);
                    setRevealed(false);
                  }}
                ><b>{item.label}</b><small>{item.hint}</small></button>
              ))}
            </section>
          )}

          {mode === "dictation" && (
            <div className="lesson-controls">
              <span className="lesson-time">{clock(at)} / {clock(lesson.seconds)}</span>
              <div className="lesson-transport">
                <button onClick={() => go(-1)} disabled={index === 0 || listeningMode === "exam"} aria-label="Câu trước">⏮</button>
                <button onClick={playSentence} disabled={listeningMode === "exam" || !canReplay(listeningMode, replays[sentence.index] ?? 0)} aria-label="Nghe lại câu này">↺</button>
                <button className="primary" onClick={listeningMode === "exam" ? startExam : playSentence} disabled={listeningMode === "exam" ? examPhase !== "ready" : !canReplay(listeningMode, replays[sentence.index] ?? 0)} aria-label="Phát">▶</button>
                <button onClick={() => go(1)} disabled={index >= lesson.sentences.length - 1 || listeningMode === "exam"} aria-label="Câu sau">⏭</button>
              </div>
              <div className="lesson-rates">
                {listeningMode !== "easy" && <small>{listeningMode === "exam" ? "1 lượt toàn bài" : `Còn ${Math.max(0, replayLimit(listeningMode) - (replays[sentence.index] ?? 0))} lượt`}</small>}
                {RATES.map((value) => (
                  <button
                    key={value}
                    className={value === rate ? "active" : ""}
                    disabled={listeningMode === "exam"}
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

          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- bôi đen chữ để dịch cụm, không phải nút bấm */}
          <div className={`panel lesson-work${mode === "shadowing" ? ` shadow-stage-${shadowStage}` : ""}`} onMouseUp={onPhraseSelect}>
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
              {mode === "shadowing" && spoken && prosody?.usable && (
                <em
                  className={`lesson-clarity${prosody.score >= 75 ? " good" : prosody.score >= 45 ? " fair" : " low"}`}
                  title={prosody.comparedToVideo
                    ? "Đối chiếu nhịp ngắt, độ nhấn và lên–xuống giọng trong bản ghi của bạn với cách người trong video nói câu này."
                    : "Ước lượng từ nhịp ngắt, độ nhấn và lên–xuống giọng trong bản ghi của bạn."}
                >
                  <Icon name="volume" size={12} /> Ngữ điệu {prosody.score}%{prosody.comparedToVideo ? "" : " ~"}
                </em>
              )}
              {mode === "dictation" && <em className={result?.percent === 100 ? "good" : ""}>Khớp: {result?.percent ?? 0}%</em>}
              {mode === "dictation" && listeningMode !== "exam" && (
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
                {listeningMode === "exam" && (
                  <section className="listening-exam">
                    <div className="listening-exam-status">
                      <b>{examPhase === "ready" ? "Sẵn sàng thi" : examPhase === "playing" ? "Đang phát liên tục" : examPhase === "answering" ? "Đã nghe xong" : `Kết quả ${examResult?.percent ?? 0}%`}</b>
                      <span>{examPhase === "ready" ? "Bài chỉ phát một lượt. Không tua, không dừng và không hiện phụ đề." : examPhase === "playing" ? `Đang nghe câu ${index + 1}/${lesson.sentences.length}. Ghi lại những gì bạn nghe được.` : "Nhập toàn bộ nội dung bạn nhớ rồi chấm bài."}</span>
                    </div>
                    {examPhase === "ready" ? (
                      <button className="primary" type="button" onClick={startExam}>Bắt đầu phát toàn bài</button>
                    ) : (
                      <textarea value={examAnswer} onChange={(event) => setExamAnswer(event.target.value)} disabled={examPhase === "playing" || examPhase === "checked"} placeholder={examPhase === "playing" ? "Ô trả lời mở sau khi audio kết thúc…" : "Nhập transcript bạn đã nghe…"} />
                    )}
                    {examPhase === "answering" && <button className="primary" type="button" disabled={!examAnswer.trim()} onClick={() => { setExamPhase("checked"); finish(); }}>Chấm bài thi</button>}
                    {examPhase === "checked" && <p className="lesson-answer-text">{examText}</p>}
                    {examPhase === "checked" && missedWordsNow.length > 0 && vocab && (
                      <button type="button" className="listening-review-add" onClick={addMissedToReview} disabled={missedWordsNow.every((word) => missedSaved.has(word))}>
                        {missedWordsNow.every((word) => missedSaved.has(word)) ? "✓ Đã thêm từ nghe sai vào ôn tập" : `+ Thêm ${missedWordsNow.length} từ nghe sai vào ôn tập`}
                      </button>
                    )}
                  </section>
                )}
                {listeningMode !== "exam" && <>
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

                {/* Ô trống theo số chữ cái: biết câu dài bao nhiêu từ mà không lộ chữ nào.
                    Bấm một ô để lộ riêng từ đó và tra nghĩa, không phải mở cả câu. */}
                <div className="lesson-shapes">
                  {shapes.map((shape, position) => {
                    const shown = revealed || peeked.has(position) || (checked && result?.words[position]?.ok);
                    const cls = result?.words[position]?.ok
                      ? "ok"
                      : checked
                        ? "miss"
                        : peeked.has(position)
                          ? "peek"
                          : "";
                    return (
                      <button
                        type="button"
                        key={position}
                        className={cls}
                        title="Bấm để xem từ và tra nghĩa"
                        onClick={(event) => {
                          setPeeked((current) => new Set(current).add(position));
                          void lookUp(shape.word, event.currentTarget);
                        }}
                      >
                        {shown
                          ? shape.word
                          : hints > 0
                            ? `${shape.word.slice(0, 1)}${"·".repeat(Math.max(0, shape.letters - 1))}`
                            : "·".repeat(shape.letters || 1)}
                      </button>
                    );
                  })}
                  {lookupCard}
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
                {checked && missedWordsNow.length > 0 && vocab && (
                  <button type="button" className="listening-review-add" onClick={addMissedToReview} disabled={missedWordsNow.every((word) => missedSaved.has(word))}>
                    {missedWordsNow.every((word) => missedSaved.has(word)) ? "✓ Đã thêm từ nghe sai vào ôn tập" : `+ Thêm ${missedWordsNow.length} từ nghe sai vào ôn tập`}
                  </button>
                )}
                </>}
              </>
            ) : (
              <>
                <nav className="shadow-flow" aria-label="Các bước luyện nói">
                  {([
                    ["listen", "1", "Nghe"], ["shadow", "2", "Shadow"], ["retell", "3", "Kể lại"], ["free", "4", "Nói tự do"], ["feedback", "5", "Phản hồi"],
                  ] as [ShadowStage, string, string][]).map(([value, number, label]) => (
                    <button type="button" key={value} className={shadowStage === value ? "active" : ""} onClick={() => setShadowStage(value)}>
                      <i>{number}</i><span>{label}</span>
                    </button>
                  ))}
                </nav>

                {shadowStage !== "shadow" && (
                  <section className="shadow-open-stage">
                    {shadowStage === "listen" && <>
                      <span className="eyebrow">BƯỚC 1 · LISTEN</span>
                      <h2>Nghe để nắm ý và nhịp nói</h2>
                      <p>Chưa cần nhại ngay. Nghe trọn câu một lần và chú ý chỗ người nói nhấn hoặc ngắt hơi.</p>
                      <button className="primary" type="button" onClick={playSentence}><Icon name="play" size={18} /> Phát câu mẫu</button>
                    </>}
                    {(shadowStage === "retell" || shadowStage === "free") && <>
                      <span className="eyebrow">{shadowStage === "retell" ? "BƯỚC 3 · RETELL" : "BƯỚC 4 · FREE SPEAKING"}</span>
                      <h2>{shadowStage === "retell" ? "Kể lại ý bằng lời của bạn" : "Liên hệ với ý kiến hoặc trải nghiệm của bạn"}</h2>
                      <p>{shadowStage === "retell" ? "Không đọc lại câu gốc. Giữ đúng ý chính, nhưng đổi cách diễn đạt." : "Nói thêm 1–3 câu liên quan. Không có một đáp án mẫu duy nhất."}</p>
                      <textarea value={shadowResponse} onChange={(event) => setShadowResponse(event.target.value)} placeholder="Gõ nội dung bạn vừa nói bằng tiếng Anh…" />
                      <button className="primary" type="button" disabled={!shadowResponse.trim() || shadowChecking} onClick={() => void checkOpenSpeaking(shadowStage)}>{shadowChecking ? "AI đang phản hồi…" : "Gửi để nhận phản hồi"}</button>
                    </>}
                    {shadowStage === "feedback" && <>
                      <span className="eyebrow">BƯỚC 5 · AI FEEDBACK</span>
                      <h2>{shadowFeedback?.correction ? "Một điểm cần sửa trước" : "Bạn đã diễn đạt rõ ý"}</h2>
                      <p>{shadowFeedback?.reply || "Hoàn thành Retell và Free Speaking để nhận phản hồi theo nội dung."}</p>
                      {shadowFeedback?.correction && <div className="shadow-open-fix">
                        {shadowFeedback.correction.wrong && <s>{shadowFeedback.correction.wrong}</s>}
                        <b>{shadowFeedback.correction.right}</b>
                        <span>{shadowFeedback.correction.why}</span>
                        {shadowFeedback.correction.rule && <small>Quy tắc: {shadowFeedback.correction.rule}</small>}
                        {shadowFeedback.correction.example && <small>Ví dụ: {shadowFeedback.correction.example}</small>}
                      </div>}
                    </>}
                  </section>
                )}
                {/* Thẻ câu mẫu. Chữ đọc liền thành một câu, IPA thành một dòng
                    riêng bên dưới — trước đây mỗi từ là một ô có IPA xếp chồng
                    nên nhìn ra một dãy thẻ chứ không còn ra một câu. */}
                <div className="shadowing-card">
                  <div className="lesson-aid-toggles" role="group" aria-label="Hiện thêm">
                    <button className={showText ? "active" : ""} onClick={() => setShowText((value) => !value)} aria-pressed={showText}><Icon name="eye-off" size={12} /> Câu mẫu</button>
                    <button className={showIpa ? "active" : ""} onClick={() => setShowIpa((value) => !value)} aria-pressed={showIpa}><Icon name="eye-off" size={12} /> IPA</button>
                    <button className={showVi ? "active" : ""} onClick={() => setShowVi((value) => !value)} aria-pressed={showVi}><Icon name="eye-off" size={12} /> Dịch nghĩa</button>
                    {aidBusy && <span className="lesson-aid-busy">đang tra…</span>}
                  </div>

                  {showText ? (
                    <>
                      <p className={`shadowing-sentence${showIpa ? " with-ipa" : ""}`}>
                        {(withIpa(target.text, ipaCache) as { word: string; ipa: string; isWord: boolean; checked: boolean; estimated?: boolean }[]).map((row, position) => (
                          <button
                            className="shadowing-token lesson-word"
                            key={position}
                            onClick={(event) => {
                              // Vừa bôi đen xong thì bỏ qua — để thẻ "Dịch cụm" xử lý.
                              if (!window.getSelection()?.isCollapsed) return;
                              void lookUp(row.word, event.currentTarget);
                            }}
                            title="Bấm để tra nghĩa"
                          >
                            <span>{row.word}</span>
                            {/* Tra rồi mà không nguồn nào có — thường là tên riêng — thì để trống,
                                đừng treo dấu "…" như thể vẫn đang tra. */}
                            {/* Phiên âm ước lượng phải trông khác phiên âm tra được:
                                tên riêng thì mô hình đoán, và người học có quyền biết
                                cái nào chắc chắn cái nào không. */}
                            {showIpa && row.isWord && (row.ipa
                              ? <em className={row.estimated ? "guessed" : ""} title={row.estimated ? "Phiên âm ước lượng — chữ này không có trong từ điển" : undefined}>{row.ipa}</em>
                              : !row.checked && <em className="loading">…</em>)}
                          </button>
                        ))}
                      </p>
                      <p className="shadowing-tap"><Icon name="book" size={13} /> Nhấn vào từ để tra nghĩa</p>
                    </>
                  ) : (
                    <p className="lesson-hidden-note">Câu mẫu đang ẩn — nghe rồi nói theo, bật lại khi cần đối chiếu.</p>
                  )}

                  {showVi && <p className="shadowing-vi">{viCache[target.text] || "Đang dịch…"}</p>}

                  {lookupCard}
                </div>

                {showText && (
                  <div className="shadowing-groups">
                    <span>Chia nhịp</span>
                    {senseGroups(target.text).map((group, position) => <b key={position}>{group}</b>)}
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
                    <div className="shadowing-recording-live">
                      <button onClick={stopRecording} aria-label="Dừng ghi âm">
                        <Icon name="stop" size={21} />
                      </button>
                      <b><i /> {Math.max(1, Math.ceil(recordingSeconds))}s / 30s</b>
                      <div className="shadowing-recording-progress">
                        <i style={{ width: `${Math.min(100, (recordingSeconds / 30) * 100)}%` }} />
                      </div>
                    </div>
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

                    {prosody && !prosody.usable && (
                      <div className="shadowing-prosody">
                        <div className="shadowing-prosody-head"><b>Ngữ điệu</b></div>
                        {prosody.notes.length > 0 && <ul>{prosody.notes.map((note, position) => <li key={position}>{note}</li>)}</ul>}
                      </div>
                    )}
                    {prosody?.usable && (
                      <div className="shadowing-prosody">
                        <div className="shadowing-prosody-head">
                          <b>{prosody.comparedToVideo ? `Ngữ điệu — so với người nói trong video ${prosody.score}%` : `Ngữ điệu (ước lượng) ${prosody.score}%`}</b>
                          <small>{prosody.comparedToVideo ? "đối chiếu bản ghi của bạn với cách người trong video nói câu này" : "đo từ bản ghi của bạn — đang lấy phân tích giọng trong video…"}</small>
                        </div>
                        {prosody.comparedToVideo && prosody.modelRef && (
                          <p className="shadowing-prosody-model">
                            {prosody.modelRef.summary && <span>{prosody.modelRef.summary} </span>}
                            Người nói nhấn: <b>{prosody.modelRef.stressedWords.join(", ")}</b>
                            {prosody.modelRef.pauseAfter.length > 0 && <> · ngắt sau: <b>{prosody.modelRef.pauseAfter.join(", ")}</b></>}
                            {" · "}cuối câu {prosody.modelRef.finalPitch === "rise" ? "lên giọng" : prosody.modelRef.finalPitch === "flat" ? "giữ đều" : "xuống giọng"}
                          </p>
                        )}
                        <div className="shadowing-prosody-bars">
                          {[
                            { label: "Nhịp ngắt", value: prosody.rhythm },
                            { label: "Nhấn nhá", value: prosody.stress },
                            ...(prosody.melody !== null ? [{ label: "Lên–xuống giọng", value: prosody.melody }] : []),
                          ].map((item) => (
                            <div key={item.label} className={`shadowing-prosody-bar${item.value >= 70 ? " good" : item.value >= 45 ? " fair" : " low"}`}>
                              <span>{item.label}</span>
                              <i><b style={{ width: `${Math.max(4, item.value)}%` }} /></i>
                              <em>{item.value}%</em>
                            </div>
                          ))}
                        </div>
                        {prosody.notes.length > 0 && (
                          <ul>{prosody.notes.map((note, position) => <li key={position}>{note}</li>)}</ul>
                        )}
                      </div>
                    )}

                    {/* Từ thừa nằm đúng chỗ nó chen vào, không dồn xuống cuối. */}
                    <div className="shadowing-chips">
                      {spoken.marks.map((mark, position) => (
                        <span
                          key={position}
                          className={`chip ${mark.status}`}
                          data-tooltip={
                            mark.status === "ok"
                              ? undefined
                              : mark.status === "extra"
                                ? `Máy nghe thêm: “${mark.word}”`
                                : mark.heard
                                  ? `Bạn đã nói: “${mark.heard}”`
                                  : "Không nghe thấy từ này"
                          }
                          tabIndex={mark.status === "ok" ? undefined : 0}
                        >
                          {mark.word}
                          <i>{mark.status === "ok" ? "✓" : mark.status === "swallow" ? "⚠" : mark.status === "extra" ? "+" : "✕"}</i>
                        </span>
                      ))}
                    </div>

                    <div className="video-ai-coach">
                      <button onClick={() => void askCoach()} disabled={coaching}>
                        <Icon name="sparkles" size={16} /> {coaching ? "AI đang chấm…" : "Xem nhận xét AI"}
                      </button>
                    </div>

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
                  <button onClick={() => go(-1, true)} disabled={index === 0} aria-label="Câu trước"><Icon name="previous" size={17} /></button>
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

            {mode === "shadowing" ? (
              <button
                className="primary lesson-next"
                disabled={listening}
                onClick={() => {
                  if (shadowStage === "listen") return setShadowStage("shadow");
                  if (shadowStage === "shadow") return setShadowStage("retell");
                  if (shadowStage === "retell" || shadowStage === "free") return;
                  finish();
                  if (index < lesson.sentences.length - 1) go(1, true);
                }}
              >
                {shadowStage === "listen" ? "Bắt đầu Shadow" : shadowStage === "shadow" ? "Tiếp tục Kể lại" : shadowStage === "feedback" ? (index < lesson.sentences.length - 1 ? "Câu tiếp theo" : "Hoàn thành") : "Hoàn thành bước này ở phía trên"} <Icon name={shadowStage === "feedback" && index >= lesson.sentences.length - 1 ? "check" : "arrow"} size={16} />
              </button>
            ) : index < lesson.sentences.length - 1 ? (
              <button className="primary lesson-next" onClick={() => go(1)}>Câu tiếp theo <Icon name="arrow" size={16} /></button>
            ) : null}
          </div>
        </div>

        <aside className="lesson-list">
          <div className="lesson-list-tabs">
            <button className="active" type="button"><Icon name="list" size={15} /> Phụ đề</button>
            <button type="button" onClick={() => void openOverview()}><Icon name="sparkles" size={15} /> Gợi ý bài học</button>
          </div>

          {/* Mốc câu của bài cũ không sửa lại được: lúc lưu, mốc của từng dòng
              phụ đề đã bị gộp thành mốc câu. Chỉ còn cách bắt lại từ video. */}
          {needsRecapture(lesson) && (
            <p className="lesson-stale" role="status">
              <b>↻ Phụ đề cần cập nhật</b>
              <span>Thêm lại video để sửa timing; bài cũ sẽ được thay tự động.</span>
            </p>
          )}

          <div className="lesson-list-head">
            <span><b>{done.size}</b>/{lesson.sentences.length}</span>
            <div className="lesson-list-head-actions">
              <button className="lesson-list-reset" onClick={resetProgress} disabled={done.size === 0}>
                <Icon name="replay" size={12} /> Đặt lại tiến độ
              </button>
              {mode === "dictation" && (
                <button className={`lesson-list-toggle${previewAll ? " on" : ""}`} onClick={() => setPreviewAll((value) => !value)} aria-pressed={previewAll}>
                  {previewAll ? "Đang xem trước" : "Xem trước"}
                </button>
              )}
              {(mode !== "dictation" || listeningMode !== "exam") && (
                <button className="lesson-list-visibility" onClick={() => setShowText((value) => !value)} aria-pressed={showText} aria-label={showText ? "Ẩn nội dung phụ đề" : "Hiện nội dung phụ đề"}>
                  <span>Hiện</span><i aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="lesson-list-progress">
            <span>Tiến độ</span>
            <b>{Math.round((done.size / lesson.sentences.length) * 100)}%</b>
          </div>
          <div className="lesson-list-bar">
            <i style={{ width: `${Math.round((done.size / lesson.sentences.length) * 100)}%` }} />
          </div>

          <ol>
            {lesson.sentences.map((item, position) => {
              // Chép chính tả thì che MỌI câu chưa xong — kể cả câu ĐANG làm dù nó
              // đã từng chép đúng trước đó, vì hiện nguyên văn bên phải là lộ đáp
              // án lần này. Mở lại khi: đã chấm câu này lần này, hoặc là câu khác
              // đã chép xong, hoặc bật "Xem trước cả bài". Nói nhại thì luôn cho xem.
              const active = position === index;
              const open =
                listeningMode === "exam"
                  ? examPhase === "checked"
                  : mode === "shadowing" || previewAll || (active ? checked : done.has(item.index));
              return (
                <li key={item.index}>
                  <button
                    ref={active ? activeCaptionRef : undefined}
                    className={`${position === index ? "active" : ""} ${done.has(item.index) ? "done" : ""}`}
                    onClick={() => go(position - index, true)}
                  >
                    <span className="lesson-list-tick" aria-hidden="true">{done.has(item.index) ? "✓" : ""}</span>
                    <span className="lesson-list-body">
                      <span className="lesson-list-meta">
                        <em>#{item.index}</em>
                        {position === index && <i className="now">ĐANG HỌC</i>}
                        <em className="at">{clock(item.start)}</em>
                      </span>
                      <span className="lesson-list-text">
                        {listeningMode === "exam" && examPhase !== "checked"
                          ? (wordShapes(item.text) as { letters: number }[]).map((shape) => "·".repeat(shape.letters || 1)).join(" ")
                          : !showText && !previewAll
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

        {phrase && (
          <div className="phrase-bar" style={{ left: phrase.x, top: phrase.y }}>
            <div className="phrase-bar-head">
              <span>{phrase.text}</span>
              <button className="phrase-bar-close" onClick={() => setPhrase(null)} aria-label="Đóng">×</button>
            </div>
            <p className="phrase-bar-vi">{phrase.loading ? "Đang dịch…" : phrase.vi}</p>
            <div className="phrase-bar-actions">
              <button onClick={() => void translateSelectedPhrase()} disabled={phrase.loading}>
                <Icon name="search" size={13} /> {phrase.vi && !phrase.loading ? "Dịch lại" : "Dịch cụm"}
              </button>
              {vocab && (
                <button className={phrase.saved ? "done" : ""} onClick={() => void saveSelectedPhrase()} disabled={phrase.saved}>
                  <Icon name={phrase.saved ? "check" : "star"} size={13} /> {phrase.saved ? "Đã lưu vào kho" : "Lưu vào kho"}
                </button>
              )}
            </div>
          </div>
        )}

        {coachOpen && (
          <div className="ai-coach-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCoachOpen(false); }}>
            <section className="ai-coach-modal" role="dialog" aria-modal="true" aria-labelledby="ai-coach-title">
              <header>
                <i><Icon name="sparkles" size={18} /></i>
                <h2 id="ai-coach-title">AI Huấn luyện phát âm</h2>
                <button onClick={() => setCoachOpen(false)} aria-label="Đóng nhận xét AI">×</button>
              </header>
              <div className="ai-coach-content">
                {coaching && <div className="ai-coach-loading"><Icon name="sparkles" size={18} /> Đang phân tích phần thực hành của bạn…</div>}
                {!coaching && coachError && (
                  <div className="ai-coach-error">
                    <p>{coachError}</p>
                    <button onClick={() => { setCoachError(""); void askCoach(); }}>Thử lại</button>
                  </div>
                )}
                {!coaching && !coachError && coachComment && (
                  <>
                    <p className="ai-coach-intro">Chào bạn, tôi là huấn luyện viên phát âm của bạn. Dưới đây là đánh giá cho phần thực hành vừa rồi:</p>
                    <h3>1. Đánh giá chung</h3>
                    <p>{coachComment}</p>
                  </>
                )}
                {!coaching && !coachError && coachTips.length > 0 && (
                  <>
                    <h3>2. Các điểm cần cải thiện</h3>
                    <ul>
                      {coachTips.map((tip) => (
                        <li key={tip.word}><b>{tip.word}</b>{tip.ipa && <code>{tip.ipa}</code>}<span>{tip.how}</span></li>
                      ))}
                    </ul>
                  </>
                )}
                {!coaching && !coachError && coachLinks.length > 0 && (
                  <>
                    <h3>{coachTips.length > 0 ? "3" : "2"}. Nối âm trong câu</h3>
                    <p className="ai-coach-hint">Người bản ngữ đọc dính những chỗ này, không tách rời từng từ:</p>
                    <ul className="ai-coach-links">
                      {coachLinks.map((link, position) => (
                        <li key={position}>
                          <b>{link.pair}</b>
                          <code>{link.blend}</code>
                          {link.rule && <em>{link.rule}</em>}
                          <span>{link.how}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
