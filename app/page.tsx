"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { dictationLessons, dictationLevels, dictationTopics, type DictationLesson, type DictationLevel } from "../lib/dictation-lessons";

type Rating = "again" | "hard" | "good" | "easy";
// Kiểu thẻ trong phiên ôn. "mixed" xoay vòng 4 kiểu còn lại theo thứ tự thẻ.
type ReviewMode = "vi_en" | "en_vi" | "quiz" | "listen" | "mixed";
const reviewModes: { value: ReviewMode; label: string }[] = [
  { value: "vi_en", label: "Việt → Anh" },
  { value: "en_vi", label: "Anh → Việt" },
  { value: "quiz", label: "Trắc nghiệm" },
  { value: "listen", label: "Nghe viết" },
  { value: "mixed", label: "Trộn" },
];
const rotatingModes: ReviewMode[] = ["vi_en", "en_vi", "quiz", "listen"];
type WordCard = {
  id: string;
  term: string;
  ipa: string;
  meaning: string;
  example: string;
  exampleVi?: string;
  cloze: string;
  definition: string;
  topic: string;
  box: number;
  lapses: number;
  starred?: boolean;
  direction?: "vi_en" | "en_vi";
  dueDate?: string;
  status?: "new" | "learning" | "review" | "mastered";
  intervalDays?: number;
  reviewCount?: number;
  partOfSpeech?: string;
  note?: string;
  addedDate?: string;
  studyDay?: number;
  lastReviewedAt?: string;
  source?: string;
};

type ImportedVocabulary = { number: number; term: string; partOfSpeech: string; ipa: string; meaning: string; topic: string; source: string };

// Câu ví dụ riêng cho từng từ, soạn sẵn trong public/vocabulary-examples.json: term → [câu tiếng Anh, bản dịch].
type ExampleMap = Record<string, [string, string]>;

// Câu ví dụ mặc định, chỉ dùng cho từ chưa có câu riêng.
const fallbackExample = (term: string) => `I am learning the word ${term}.`;
const fallbackExampleVi = (term: string) => `Tôi đang học từ “${term}”.`;

function exampleFor(term: string, examples: ExampleMap) {
  const found = examples[term.trim().toLowerCase()];
  return found ? { example: found[0], exampleVi: found[1] } : { example: fallbackExample(term), exampleVi: fallbackExampleVi(term) };
}

// Khoét chỗ trống tại từ đang học. Nhiều từ khóa trong file PDF dính nhiễu OCR
// ("white (n, adj)", "bus bicycle") nên phải thử dần từ chuỗi đầy đủ tới từng từ thành phần.
function clozeFor(term: string, example: string) {
  const cleaned = term.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const candidates = [
    term.trim(),
    cleaned,
    cleaned.split("/")[0].trim(),
    ...cleaned
      .split(/[\s/]+/)
      .filter((word) => word.length >= 3)
      .sort((a, b) => b.length - a.length),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const pattern of [`\\b${escaped}\\b`, escaped]) {
      const blanked = example.replace(new RegExp(pattern, "i"), "_____");
      if (blanked !== example) return blanked;
    }
  }
  return example;
}
const naturalExample = (term: string) => `I am learning how to use ${term} naturally.`;
const naturalExampleVi = (term: string) => `Tôi đang học cách dùng từ “${term}” một cách tự nhiên.`;

// Nguồn duy nhất tính hộp Leitner và khoảng ôn tiếp theo, dùng chung cho nút đánh giá và lúc lưu.
function scheduleFor(card: WordCard, rating: Rating) {
  const box = rating === "again" ? (card.box === 6 ? 2 : 1) : Math.min(6, card.box + (rating === "easy" ? 2 : rating === "good" ? 1 : 0));
  const base = [0, 1, 3, 7, 14, 30, 90][box];
  const interval = rating === "hard" ? Math.max(1, Math.round((card.intervalDays ?? 1) * 0.6)) : Math.round(base * (rating === "easy" ? 1.3 : 1));
  return { box, interval };
}

// Ngày theo lịch của máy người dùng. toISOString() trả về ngày UTC, ở GMT+7 sẽ lùi một ngày
// trong khoảng 00:00–07:00 sáng, khiến từ bị xếp nhầm sang thứ hôm trước.
function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
// 0 = Thứ Hai … 6 = Chủ Nhật, khớp thứ tự dayNames.
function weekdayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

// Từ do người dùng thêm được giữ lại trên máy, để mất kết nối Supabase cũng không mất dữ liệu khi tải lại trang.
const localWordsKey = "lexilo:words:v1";
function readLocalWords(): WordCard[] {
  try {
    const raw = localStorage.getItem(localWordsKey);
    const parsed = raw ? (JSON.parse(raw) as WordCard[]) : [];
    return Array.isArray(parsed) ? parsed.filter((word) => word?.id && word.term) : [];
  } catch {
    return [];
  }
}
// Từ đã lên được Supabase sẽ quay về theo đúng id, nên gộp theo id là đủ để không nhân đôi.
// Tiến trình học được đắp lại sau cùng, áp cho cả từ cá nhân lẫn bộ PDF.
function mergeStoredWords(loaded: WordCard[]) {
  const ids = new Set(loaded.map((word) => word.id));
  return applyProgress([...readLocalWords().filter((word) => !ids.has(word.id)), ...loaded]);
}
function writeLocalWords(words: WordCard[]) {
  try {
    localStorage.setItem(localWordsKey, JSON.stringify(words.filter((word) => !isPdfVocabulary(word))));
  } catch {
    // Hết dung lượng hoặc trình duyệt chặn — bỏ qua, dữ liệu vẫn còn trong phiên hiện tại.
  }
}

// Tiến trình học (hộp Leitner, lịch ôn, số lần ôn) của MỌI từ, kể cả bộ PDF vốn không lưu nội dung từ.
type WordProgress = Pick<WordCard, "box" | "lapses" | "dueDate" | "status" | "intervalDays" | "reviewCount" | "lastReviewedAt" | "starred" | "studyDay">;
const progressKey = "lexilo:progress:v1";
function readProgress(): Record<string, WordProgress> {
  try {
    const raw = localStorage.getItem(progressKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, WordProgress>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function hasProgress(word: WordCard) {
  return word.box > 1 || !!word.reviewCount || !!word.lapses || !!word.starred || !!word.dueDate || (!!word.status && word.status !== "new") || typeof word.studyDay === "number";
}
function writeProgress(words: WordCard[]) {
  try {
    // Chỉ ghi từ đã học để file không phình theo cả 983 từ chưa đụng tới.
    const store: Record<string, WordProgress> = {};
    for (const word of words) {
      if (!hasProgress(word)) continue;
      store[word.id] = { box: word.box, lapses: word.lapses, dueDate: word.dueDate, status: word.status, intervalDays: word.intervalDays, reviewCount: word.reviewCount, lastReviewedAt: word.lastReviewedAt, starred: word.starred, studyDay: word.studyDay };
    }
    localStorage.setItem(progressKey, JSON.stringify(store));
  } catch {
    // Bỏ qua như trên.
  }
}
function applyProgress(words: WordCard[]) {
  const store = readProgress();
  return words.map((word) => (store[word.id] ? { ...word, ...store[word.id] } : word));
}

// Phiên ôn đang dở, để đóng tab rồi quay lại vẫn học tiếp đúng chỗ.
type StoredSession = { ids: string[]; index: number; mode: ReviewMode };
const sessionKey = "lexilo:session:v1";
function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(sessionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return Array.isArray(parsed?.ids) && parsed.ids.length && typeof parsed.index === "number" ? parsed : null;
  } catch {
    return null;
  }
}
function writeSession(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(sessionKey, JSON.stringify(session));
    else localStorage.removeItem(sessionKey);
  } catch {
    // Bỏ qua như trên.
  }
}

function isPdfVocabulary(word: WordCard) {
  return word.source?.includes("MochiMochi") || word.id.startsWith("pdf-");
}

const initialWords: WordCard[] = [
  {
    id: "1",
    term: "resilient",
    ipa: "/rɪˈzɪliənt/",
    meaning: "kiên cường, nhanh chóng hồi phục",
    example: "She remained resilient despite several difficult setbacks.",
    exampleVi: "Cô ấy vẫn kiên cường dù gặp nhiều trở ngại khó khăn.",
    cloze: "She remained _____ despite several difficult setbacks.",
    definition: "Able to recover quickly from difficulties.",
    topic: "Cảm xúc",
    box: 2,
    lapses: 5,
    starred: true,
  },
  {
    id: "2",
    term: "take for granted",
    ipa: "/teɪk fər ˈɡrɑːntɪd/",
    meaning: "coi là điều hiển nhiên",
    example: "We often take clean water for granted.",
    exampleVi: "Chúng ta thường coi nước sạch là điều hiển nhiên.",
    cloze: "We often _____ clean water _____.",
    definition: "To fail to properly appreciate someone or something.",
    topic: "Đời sống",
    box: 3,
    lapses: 4,
    starred: true,
  },
  {
    id: "3",
    term: "deploy",
    ipa: "/dɪˈplɔɪ/",
    meaning: "triển khai",
    example: "The team will deploy the update after lunch.",
    exampleVi: "Nhóm sẽ triển khai bản cập nhật sau bữa trưa.",
    cloze: "The team will _____ the update after lunch.",
    definition: "To put something into effective action.",
    topic: "Công nghệ",
    box: 4,
    lapses: 2,
  },
  {
    id: "4",
    term: "subtle",
    ipa: "/ˈsʌtl/",
    meaning: "tinh tế; khó nhận thấy",
    example: "There was a subtle change in her voice.",
    exampleVi: "Có một thay đổi tinh tế trong giọng nói của cô ấy.",
    cloze: "There was a _____ change in her voice.",
    definition: "Not obvious and therefore difficult to notice.",
    topic: "Giao tiếp",
    box: 2,
    lapses: 3,
  },
  {
    id: "5",
    term: "retrieve",
    ipa: "/rɪˈtriːv/",
    meaning: "lấy lại; truy xuất",
    example: "The service can retrieve cached data instantly.",
    exampleVi: "Dịch vụ có thể truy xuất dữ liệu đã lưu đệm ngay lập tức.",
    cloze: "The service can _____ cached data instantly.",
    definition: "To find and bring back something.",
    topic: "Công nghệ",
    box: 1,
    lapses: 6,
    starred: true,
  },
];

const weekDays = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const heat = [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 4, 2, 0, 1, 1, 2, 4, 3, 1, 2, 0, 3, 4, 2, 1, 3, 4, 1, 2, 1, 3, 4, 2, 3, 0, 4, 3, 2, 4, 3, 1, 2, 1, 2, 3, 2, 4, 3, 1, 3, 4, 4, 2, 3, 1, 0, 2, 3, 1, 4, 4, 2, 1, 4, 3, 2, 3, 4, 1, 2, 2, 4, 3, 4, 2, 3, 1, 3, 4, 2, 4, 3, 2, 1];

export default function Home() {
  const [tab, setTab] = useState<"home" | "words" | "practice" | "stats">("home");
  const [reviewing, setReviewing] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<WordCard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [index, setIndex] = useState(0);
  const [words, setWords] = useState(initialWords);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [reviewMode, setReviewMode] = useState<ReviewMode>("vi_en");
  const [choice, setChoice] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<"connecting" | "synced" | "demo">("connecting");
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pendingSession, setPendingSession] = useState<StoredSession | null>(null);
  const startedAt = useRef(Date.now());
  const card = reviewQueue[index];

  const filtered = useMemo(() => words.filter((word) => `${word.term} ${word.meaning} ${word.topic}`.toLowerCase().includes(query.toLowerCase())), [words, query]);
  const activeMode: ReviewMode = reviewMode === "mixed" ? rotatingModes[index % rotatingModes.length] : reviewMode;
  // Ba đáp án nhiễu lấy tất định theo vị trí thẻ, để không xáo lại mỗi lần render.
  const quizChoices = useMemo(() => {
    if (!card) return [];
    const pool = reviewQueue.filter((word) => word.id !== card.id && word.meaning !== card.meaning);
    const picked: WordCard[] = [];
    for (let step = 1; picked.length < 3 && step <= pool.length; step++) {
      const candidate = pool[(index * 7 + step * 13) % pool.length];
      if (!picked.includes(candidate)) picked.push(candidate);
    }
    return [...picked, card].sort((a, b) => (a.id + index).localeCompare(b.id + index));
  }, [card, index, reviewQueue]);
  const personalWords = useMemo(() => words.filter((word) => !isPdfVocabulary(word)), [words]);
  // Chưa có từ cá nhân (chế độ demo) thì luyện tập và thống kê chạy trên bộ PDF thay vì hiện màn hình trống.
  const studyPool = personalWords.length ? personalWords : words;

  useEffect(() => {
    let active = true;
    async function loadExamples(): Promise<ExampleMap> {
      try {
        const response = await fetch("/vocabulary-examples.json");
        return response.ok ? ((await response.json()) as ExampleMap) : {};
      } catch {
        return {};
      }
    }
    async function loadLocalVocabulary() {
      const [response, examples] = await Promise.all([fetch("/vocabulary-1000.json"), loadExamples()]);
      const vocabulary = (await response.json()) as ImportedVocabulary[];
      if (!active) return;
      setWords(
        mergeStoredWords(vocabulary.map((item) => {
          const { example, exampleVi } = exampleFor(item.term, examples);
          return {
            id: `pdf-${item.number}`,
            term: item.term,
            ipa: item.ipa || "/…/",
            meaning: item.meaning,
            example,
            exampleVi,
            cloze: clozeFor(item.term, example),
            definition: "Vocabulary imported from the MochiMochi topic list.",
            topic: item.topic,
            box: 1,
            lapses: 0,
            partOfSpeech: item.partOfSpeech,
            status: "new" as const,
            reviewCount: 0,
            source: item.source,
          };
        })),
      );
    }
    async function connect() {
      if (!supabase) {
        await loadLocalVocabulary();
        setCloudStatus("demo");
        return;
      }
      let {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        const result = await supabase.auth.signInAnonymously();
        session = result.data.session;
        if (result.error || !session) {
          await loadLocalVocabulary();
          if (active) setCloudStatus("demo");
          return;
        }
      }
      setUserId(session.user.id);
      setUserEmail(session.user.email ?? null);
      const { data, error } = await supabase.from("words").select("*, word_states(box,lapse_count,direction,due_date,status,interval_days,review_count,last_reviewed_at)").is("deleted_at", null).order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        await loadLocalVocabulary();
        setCloudStatus("demo");
        return;
      }
      let cloudWords = data ?? [];
      try {
        const [vocabularyResponse, examples] = await Promise.all([fetch("/vocabulary-1000.json"), loadExamples()]);
        const vocabulary = (await vocabularyResponse.json()) as ImportedVocabulary[];
        const mergedVocabulary = new Map<string, ImportedVocabulary>();
        for (const item of vocabulary) {
          const key = item.term.trim().toLowerCase();
          const previous = mergedVocabulary.get(key);
          if (!previous) mergedVocabulary.set(key, item);
          else {
            previous.meaning = [...new Set([previous.meaning, item.meaning])].join("; ");
            previous.topic = [...new Set([previous.topic, item.topic])].join(" · ");
          }
        }
        const existingTerms = new Set(cloudWords.map((row) => String(row.term).trim().toLowerCase()));
        const missing = [...mergedVocabulary.values()].filter((item) => !existingTerms.has(item.term.trim().toLowerCase()));
        for (let start = 0; start < missing.length; start += 100) {
          const batch = missing.slice(start, start + 100);
          const { data: inserted, error: insertError } = await supabase
            .from("words")
            .insert(
              batch.map((item) => ({
                user_id: session.user.id,
                term: item.term,
                part_of_speech: item.partOfSpeech,
                ipa: item.ipa,
                meaning_vi: item.meaning,
                definition_en: "Vocabulary imported from the MochiMochi topic list.",
                example: exampleFor(item.term, examples).example,
                example_vi: exampleFor(item.term, examples).exampleVi,
                example_cloze: clozeFor(item.term, exampleFor(item.term, examples).example),
                topic: item.topic,
                source: item.source,
                note: `Mục số ${item.number} trong tài liệu PDF`,
              })),
            )
            .select();
          if (insertError) throw insertError;
          if (inserted?.length) {
            const { error: stateError } = await supabase.from("word_states").insert(
              inserted.flatMap((row) => ["vi_en", "en_vi"].map((direction) => ({ word_id: row.id, user_id: session.user.id, direction }))),
            );
            if (stateError) throw stateError;
            cloudWords = [...inserted, ...cloudWords];
          }
        }
      } catch (importError) {
        console.error("Không thể nhập bộ từ vựng PDF", importError);
      }
      if (cloudWords.length)
        setWords(
          mergeStoredWords(cloudWords.map((row) => {
            const state = row.word_states?.find((item: { direction: string }) => item.direction === "vi_en") ?? row.word_states?.[0];
            return {
              id: row.id,
              term: row.term,
              ipa: row.ipa ?? "/…/",
              meaning: row.meaning_vi,
              example: row.example,
              exampleVi: row.example_vi ?? "",
              cloze: row.example_cloze,
              definition: row.definition_en ?? "",
              topic: row.topic ?? "Khác",
              box: state?.box ?? 1,
              lapses: state?.lapse_count ?? 0,
              starred: row.is_starred,
              direction: state?.direction ?? "vi_en",
              dueDate: state?.due_date,
              status: state?.status ?? "new",
              intervalDays: state?.interval_days ?? 0,
              reviewCount: state?.review_count ?? 0,
              partOfSpeech: row.part_of_speech ?? "",
              note: row.note ?? "",
              addedDate: row.created_at?.slice(0, 10),
              studyDay: typeof row.study_day === "number" ? row.study_day : undefined,
              lastReviewedAt: state?.last_reviewed_at,
              source: row.source ?? "",
            };
          })),
        );
      setCloudStatus("synced");
    }
    connect().finally(() => {
      if (!active) return;
      setPendingSession(readSession());
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Ghi lại từ cá nhân sau mỗi thay đổi; chỉ bật sau khi nạp xong để không ghi đè bằng dữ liệu mẫu.
  useEffect(() => {
    if (!hydrated) return;
    writeLocalWords(words);
    writeProgress(words);
  }, [words, hydrated]);

  // Ghi lại phiên đang dở sau mỗi thẻ. Chỉ động vào bản lưu khi đang ôn, để phiên cũ
  // không bị xoá ngay lúc mở lại trang (khi đó reviewing vẫn là false).
  useEffect(() => {
    if (!hydrated || !reviewing) return;
    if (reviewQueue.length && index < reviewQueue.length) writeSession({ ids: reviewQueue.map((word) => word.id), index, mode: reviewMode });
    else writeSession(null);
  }, [hydrated, reviewing, reviewQueue, index, reviewMode]);

  // Thoát giữa chừng thì hiện lại thanh "Học tiếp" ngay, không phải đợi tải lại trang.
  function exitReview() {
    if (reviewQueue.length && index < reviewQueue.length) setPendingSession({ ids: reviewQueue.map((word) => word.id), index, mode: reviewMode });
    setReviewing(false);
  }
  function resumeSession() {
    if (!pendingSession) return;
    const byId = new Map(words.map((word) => [word.id, word]));
    const queue = pendingSession.ids.map((id) => byId.get(id)).filter((word): word is WordCard => !!word);
    setPendingSession(null);
    if (!queue.length) {
      writeSession(null);
      return;
    }
    setReviewMode(pendingSession.mode ?? "vi_en");
    setReviewQueue(queue);
    setIndex(Math.min(pendingSession.index, queue.length - 1));
    setReviewing(true);
    setRevealed(false);
    setAnswer("");
    setChoice(null);
    startedAt.current = Date.now();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowAdd(true);
      }
      if (!reviewing) return;
      if (event.key === "Escape") {
        exitReview();
        return;
      }
      if (!card || (event.target as HTMLElement)?.tagName === "INPUT") return;
      const isQuiz = activeMode === "quiz" && quizChoices.length >= 2;
      if (event.code === "Space" && !isQuiz) {
        event.preventDefault();
        setRevealed(true);
      }
      if (["1", "2", "3", "4"].includes(event.key)) {
        if (revealed) rate(({ 1: "again", 2: "hard", 3: "good", 4: "easy" } as Record<string, Rating>)[event.key]);
        else if (isQuiz) {
          const picked = quizChoices[Number(event.key) - 1];
          if (picked) {
            setChoice(picked.id);
            setRevealed(true);
          }
        }
      }
      if (event.key.toLowerCase() === "s") toggleStar(card.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function launchReview(queue: WordCard[]) {
    if (!queue.length) {
      alert("Không còn từ nào cần ôn trong nhóm này. Hãy chọn nhóm khác hoặc thêm từ mới.");
      return;
    }
    setReviewQueue(queue);
    setReviewing(true);
    setIndex(0);
    setRevealed(false);
    setAnswer("");
    setChoice(null);
    startedAt.current = Date.now();
  }
  function startReview(dayIndex?: number | "pdf") {
    const belongsToPdf = isPdfVocabulary;
    if (dayIndex === "pdf") {
      launchReview(words.filter((word) => belongsToPdf(word) && wordState(word).key !== "mastered"));
      return;
    }
    const belongsToDay = (word: WordCard) => !belongsToPdf(word) && (dayIndex === undefined || addedDayIndex(word) === dayIndex);
    let queue = words.filter((word) => belongsToDay(word) && isDueForReview(word));
    if (!queue.length) queue = words.filter((word) => belongsToDay(word) && wordState(word).key !== "mastered");
    launchReview(queue);
  }
  function startPdfTopicReview(topic: string) {
    launchReview(words.filter((word) => isPdfVocabulary(word) && word.topic.split(" · ").includes(topic) && wordState(word).key !== "mastered"));
  }
  function rate(rating: Rating) {
    const { box: after, interval } = scheduleFor(card, rating);
    const due = new Date();
    due.setDate(due.getDate() + interval);
    const updated = {
      ...card,
      box: after,
      lapses: rating === "again" ? card.lapses + 1 : card.lapses,
      intervalDays: interval,
      dueDate: localDateString(due),
      status: after === 6 ? ("mastered" as const) : ("review" as const),
      reviewCount: (card.reviewCount ?? 0) + 1,
    };
    setWords((current) => current.map((word) => (word.id !== card.id ? word : updated)));
    void persistReview(card, updated, rating, Date.now() - startedAt.current);
    setIndex((value) => value + 1);
    setRevealed(false);
    setAnswer("");
    setChoice(null);
    startedAt.current = Date.now();
  }
  function toggleStar(id: string) {
    setWords((current) =>
      current.map((word) => {
        if (word.id !== id) return word;
        const starred = !word.starred;
        if (supabase)
          void supabase
            .from("words")
            .update({
              is_starred: starred,
              updated_at: new Date().toISOString(),
            })
            .eq("id", id);
        return { ...word, starred };
      }),
    );
  }
  async function persistReview(before: WordCard, after: WordCard, rating: Rating, durationMs: number) {
    if (!supabase || !userId) return;
    await supabase
      .from("word_states")
      .update({
        box: after.box,
        interval_days: after.intervalDays,
        due_date: after.dueDate,
        review_count: after.reviewCount,
        lapse_count: after.lapses,
        status: after.status,
        last_reviewed_at: new Date().toISOString(),
      })
      .eq("word_id", before.id)
      .eq("direction", before.direction ?? "vi_en");
    await supabase.from("review_logs").insert({
      user_id: userId,
      word_id: before.id,
      direction: before.direction ?? "vi_en",
      rating,
      box_before: before.box,
      box_after: after.box,
      duration_ms: durationMs,
    });
  }
  async function persistWord(word: WordCard) {
    if (!supabase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("words").insert({
      id: word.id,
      user_id: user.id,
      term: word.term,
      part_of_speech: word.partOfSpeech,
      ipa: word.ipa,
      meaning_vi: word.meaning,
      definition_en: word.definition,
      example: word.example,
      example_vi: word.exampleVi || null,
      example_cloze: word.cloze,
      topic: word.topic,
      note: word.note,
      study_day: word.studyDay ?? null,
      is_starred: !!word.starred,
      created_at: word.addedDate ? new Date(word.addedDate).toISOString() : undefined,
    });
    if (error) {
      console.error("Không lưu được từ lên Supabase, từ vẫn được giữ trên máy này.", error);
      setCloudStatus("demo");
      return;
    }
    await supabase.from("word_states").insert([
      {
        word_id: word.id,
        user_id: user.id,
        direction: "vi_en",
        box: word.box || 1,
        review_count: word.reviewCount || 0,
        due_date: word.dueDate || localDateString(),
        status: word.status || "new",
        last_reviewed_at: word.lastReviewedAt || null,
      },
      {
        word_id: word.id,
        user_id: user.id,
        direction: "en_vi",
        box: word.box || 1,
        review_count: word.reviewCount || 0,
        due_date: word.dueDate || localDateString(),
        status: word.status || "new",
        last_reviewed_at: word.lastReviewedAt || null,
      },
    ]);
    setCloudStatus("synced");
  }
  function speak(term: string) {
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(term));
  }

  if (reviewing && (!reviewQueue.length || index >= reviewQueue.length)) return <SessionSummary total={reviewQueue.length} close={() => setReviewing(false)} restart={() => { setIndex(0); setRevealed(false); setAnswer(""); setChoice(null); startedAt.current = Date.now(); }} />;
  if (reviewing)
    return (
      <ReviewView
        card={card}
        index={index}
        total={reviewQueue.length}
        revealed={revealed}
        answer={answer}
        setAnswer={setAnswer}
        reveal={() => setRevealed(true)}
        rate={rate}
        close={exitReview}
        speak={speak}
        toggleStar={() => toggleStar(card.id)}
        mode={activeMode}
        modeSetting={reviewMode}
        setMode={setReviewMode}
        choices={quizChoices}
        choice={choice}
        pickChoice={(id) => {
          setChoice(id);
          setRevealed(true);
        }}
      />
    );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">L</span>
          <span>Lexilo</span>
        </div>
        <nav aria-label="Điều hướng chính">
          <button className={tab === "home" ? "nav-item active" : "nav-item"} onClick={() => setTab("home")}>
            <span>⌂</span> Hôm nay
          </button>
          <button className={tab === "words" ? "nav-item active" : "nav-item"} onClick={() => setTab("words")}>
            <span>▤</span> Từ vựng
          </button>
          <button className={tab === "practice" ? "nav-item active" : "nav-item"} onClick={() => setTab("practice")}>
            <span>◇</span> Luyện tập
          </button>
          <button className={tab === "stats" ? "nav-item active" : "nav-item"} onClick={() => setTab("stats")}>
            <span>⌁</span> Thống kê
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="quick-add" onClick={() => setShowAdd(true)}>
            ＋ Thêm từ mới <kbd>⌘ K</kbd>
          </button>
          <button className="profile" onClick={() => setShowAuth(true)}>
            <span className="avatar">RY</span>
            <span>
              <b>{userEmail ?? "Ryan"}</b>
              <small>{cloudStatus === "synced" ? (userEmail ? "● Đã đồng bộ Supabase" : "● Đồng bộ ẩn danh") : cloudStatus === "connecting" ? "Đang kết nối…" : "◐ Chỉ lưu trên máy này"}</small>
            </span>
            <span>•••</span>
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="mobile-head">
          <div className="brand">
            <span className="brand-mark">L</span>
            <span>Lexilo</span>
          </div>
          <button onClick={() => setShowAdd(true)} aria-label="Thêm từ">
            ＋
          </button>
        </header>
        {pendingSession && (
          <div className="resume-bar">
            <span>◷</span>
            <div>
              <b>Phiên học đang dở</b>
              <small>
                Đã ôn {pendingSession.index}/{pendingSession.ids.length} thẻ · còn {pendingSession.ids.length - pendingSession.index} thẻ
              </small>
            </div>
            <button className="primary" onClick={resumeSession}>
              Học tiếp →
            </button>
            <button
              aria-label="Bỏ phiên đang dở"
              onClick={() => {
                setPendingSession(null);
                writeSession(null);
              }}
            >
              ×
            </button>
          </div>
        )}
        {tab === "home" && <Dashboard words={words} startReview={startReview} openWords={() => setTab("words")} startWordReview={(id) => launchReview(words.filter((word) => word.id === id))} />}
        {tab === "words" && (
          <Words
            words={filtered}
            query={query}
            setQuery={setQuery}
            toggleStar={toggleStar}
            add={() => setShowAdd(true)}
            startTopicReview={startPdfTopicReview}
            startDayReview={(day) => startReview(day)}
            setStudyDay={(id, day) => {
              setWords((current) => current.map((word) => (word.id !== id ? word : { ...word, studyDay: day })));
              if (supabase) void supabase.from("words").update({ study_day: day, updated_at: new Date().toISOString() }).eq("id", id);
            }}
            remove={(id) => {
              setWords((current) => current.filter((w) => w.id !== id));
              if (supabase) void supabase.from("words").update({ deleted_at: new Date().toISOString() }).eq("id", id);
            }}
            importWords={(items) => {
              items.forEach((item) => {
                const created = {
                  ...item,
                  id: crypto.randomUUID(),
                  box: item.box ?? 1,
                  lapses: 0,
                };
                setWords((current) => [created, ...current]);
                void persistWord(created);
              });
            }}
          />
        )}
        {tab === "practice" && <Practice words={studyPool} />}
        {tab === "stats" && <Stats words={studyPool} scopeLabel={personalWords.length ? "Từ của tôi" : "Bộ từ vựng PDF"} />}
      </section>

      <nav className="mobile-nav" aria-label="Điều hướng di động">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
          <span>⌂</span>Hôm nay
        </button>
        <button className={tab === "words" ? "active" : ""} onClick={() => setTab("words")}>
          <span>▤</span>Từ vựng
        </button>
        <button className={tab === "practice" ? "active" : ""} onClick={() => setTab("practice")}>
          <span>◇</span>Luyện tập
        </button>
        <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>
          <span>⌁</span>Thống kê
        </button>
      </nav>
      {showAdd && (
        <AddWord
          close={() => setShowAdd(false)}
          save={(word) => {
            const created = {
              ...word,
              id: crypto.randomUUID(),
              box: 1,
              lapses: 0,
            };
            setWords((current) => [created, ...current]);
            void persistWord(created);
            setShowAdd(false);
          }}
        />
      )}
      {showAuth && <AuthModal close={() => setShowAuth(false)} />}
    </main>
  );
}

function Dashboard({ words, startReview, openWords, startWordReview }: { words: WordCard[]; startReview: (dayIndex?: number | "pdf") => void; openWords: () => void; startWordReview: (id: string) => void }) {
  const personal = words.filter((word) => !isPdfVocabulary(word));
  // Chưa có từ cá nhân thì các chỉ số ở đầu trang nói về bộ PDF, thay vì hiển thị toàn số 0.
  const onlyPdf = !personal.length && words.length > 0;
  const scheduledWords = onlyPdf ? words : personal;
  const mastered = scheduledWords.filter((w) => wordState(w).key === "mastered").length;
  const due = scheduledWords.filter(isDueForReview).length;
  const reviewedThisWeek = scheduledWords.reduce((total, word) => total + (word.reviewCount ?? 0), 0);
  const [showTip, setShowTip] = useState(true);
  // Ngày và lời chào chỉ có thể tính trên máy người dùng — cập nhật sau khi hydrate để không lệch với HTML dựng sẵn.
  const dateRef = useRef<HTMLDivElement>(null);
  const greetingRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const now = new Date();
    if (dateRef.current) dateRef.current.textContent = `${dayNames[(now.getDay() + 6) % 7]}, ${String(now.getDate()).padStart(2, "0")} THÁNG ${now.getMonth() + 1}`.toUpperCase();
    if (greetingRef.current) greetingRef.current.textContent = now.getHours() < 12 ? "Chào buổi sáng" : now.getHours() < 18 ? "Chào buổi chiều" : "Chào buổi tối";
  }, []);
  const activityHeat = heat.map((_, index) => index < heat.length - 7 ? 0 : Math.min(4, Math.ceil(scheduledWords.filter((word) => addedDayIndex(word) === index - (heat.length - 7)).reduce((total, word) => total + (word.reviewCount ?? 0), 0) / 5)));
  return (
    <div className="page dashboard">
      <div className="eyebrow" ref={dateRef}>
        HÔM NAY
      </div>
      <div className="greeting">
        <div>
          <h1>
            <span ref={greetingRef}>Chào bạn</span>, Ryan <span>✦</span>
          </h1>
          <p>Một phiên ôn ngắn hôm nay sẽ giúp trí nhớ đi xa hơn.</p>
        </div>
      </div>
      <section className="hero-card">
        <div className="hero-copy">
          <div className="today-icon">◎</div>
          <div>
            <span>SẴN SÀNG CHO HÔM NAY</span>
            <h2>
              <strong>{due}</strong> từ đang chờ bạn ôn tập
            </h2>
            <p>
              {scheduledWords.filter((w) => { const key = wordState(w).key; return key === "due" || key === "waiting"; }).length} từ đang học · {scheduledWords.filter((w) => wordState(w).key === "new").length} từ mới
            </p>
          </div>
        </div>
        <button className="primary" onClick={() => startReview(onlyPdf ? "pdf" : undefined)}>
          Bắt đầu học <span>→</span>
        </button>
      </section>
      <div className="stats-grid">
        <Stat label="Tổng số từ" value={String(words.length)} note="Trong thư viện của bạn" icon="▤" tone="purple" />
        <Stat label="Đang học" value={String(scheduledWords.length - mastered)} note={onlyPdf ? "Trong bộ từ vựng PDF" : "Không gồm bộ PDF"} icon="◔" tone="orange" />
        <Stat label="Đã thuộc" value={String(mastered)} note={onlyPdf ? "Trong bộ từ vựng PDF" : "Trong lịch học hằng ngày"} icon="✓" tone="green" />
        <Stat label="Lượt đã ôn" value={String(reviewedThisWeek)} note={onlyPdf ? "Trong bộ từ vựng PDF" : "Trong Từ của tôi"} icon="♨" tone="pink" />
      </div>
      <DailyStudy words={words} startReview={startReview} />
      <WeeklyTracker words={words} />
      <div className="dashboard-grid">
        <section className="panel heatmap-panel">
          <div className="panel-title">
            <div>
              <h3>Nhịp học của bạn</h3>
              <p>12 tuần gần nhất</p>
            </div>
            <div className="legend">
              Ít <i className="h0" />
              <i className="h1" />
              <i className="h2" />
              <i className="h3" />
              <i className="h4" /> Nhiều
            </div>
          </div>
          <div className="heatmap">
            <div className="days">
              {weekDays.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="heat-cells">
              {activityHeat.map((v, i) => (
                <i className={`h${v}`} key={i} title={`${v * 8} từ đã ôn`} />
              ))}
            </div>
          </div>
          <div className="heat-footer">
            <span>
              <b>{reviewedThisWeek}</b> lượt ôn đã ghi nhận
            </span>
            <span>{reviewedThisWeek ? "Đang cập nhật từ Leitner" : "Chưa có phiên ôn"}</span>
          </div>
        </section>
        <section className="panel tough">
          <div className="panel-title">
            <div>
              <h3>Từ cần chú ý</h3>
              <p>Những từ bạn hay quên nhất</p>
            </div>
            <button onClick={openWords}>Xem tất cả →</button>
          </div>
          {scheduledWords
            .slice()
            .sort((a, b) => b.lapses - a.lapses)
            .slice(0, 4)
            .map((w) => (
              <div className="tough-row" key={w.id}>
                <span className="word-dot">{w.term[0].toUpperCase()}</span>
                <span>
                  <b>{w.term}</b>
                  <small>{w.meaning}</small>
                </span>
                <span className="lapse">{w.lapses} lần quên</span>
                <button aria-label={`Ôn từ ${w.term}`} onClick={() => startWordReview(w.id)}>→</button>
              </div>
            ))}
        </section>
      </div>
      {showTip && (
        <div className="tip">
          <span>♢</span>
          <p>
            <b>Mẹo nhỏ hôm nay</b>
            <br />
            Đặt một câu thật về chính bạn với từ mới — ký ức gắn với trải nghiệm cá nhân sẽ bền hơn.
          </p>
          <button aria-label="Ẩn mẹo" onClick={() => setShowTip(false)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

const dayNames = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"];
// Ngày học do người dùng chọn; chưa chọn thì suy ra từ ngày thêm như trước.
function addedDayIndex(word: WordCard) {
  if (typeof word.studyDay === "number") return word.studyDay;
  if (!word.addedDate) return 0;
  return weekdayIndex(new Date(word.addedDate + "T12:00:00"));
}

function DailyStudy({ words, startReview }: { words: WordCard[]; startReview: (dayIndex: number | "pdf") => void }) {
  const pdfWords = words.filter(isPdfVocabulary);
  const dailyWords = words.filter((word) => !isPdfVocabulary(word));
  return (
    <section className="daily-study">
      <div className="panel-title">
        <div>
          <h3>Học theo từng ngày</h3>
          <p>Giữ nguyên thói quen 7 tab như trong file Excel</p>
        </div>
      </div>
      <div className="day-cards">
        {dayNames.map((name, index) => {
          const list = dailyWords.filter((w) => addedDayIndex(w) === index);
          const due = list.filter(isDueForReview).length;
          return (
            <button key={name} onClick={() => startReview(index)} disabled={!list.length}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{name}</b>
              <small>
                {list.length} từ · {due} cần ôn
              </small>
              <i>Học →</i>
            </button>
          );
        })}
      </div>
      {!!pdfWords.length && (
        <button className="pdf-collection-card" onClick={() => startReview("pdf")}>
          <span>PDF</span>
          <strong>Bộ {pdfWords.length} từ vựng theo chủ đề</strong>
          <small>{pdfWords.length} mục · học riêng, không tính vào lịch theo ngày</small>
          <b>Học bộ từ này →</b>
        </button>
      )}
    </section>
  );
}

function wordState(word: WordCard) {
  if (word.box >= 6 || word.status === "mastered") return { key: "mastered", label: "✅ Đã thuộc" };
  if (!word.reviewCount && word.status === "new") return { key: "new", label: "🆕 Chưa học" };
  if (!word.dueDate || word.dueDate <= localDateString()) return { key: "due", label: "🔴 Cần ôn" };
  return { key: "waiting", label: "⏳ Chưa tới hạn" };
}

// Một từ được đưa vào hàng đợi ôn khi đã tới hạn hoặc chưa học lần nào.
function isDueForReview(word: WordCard) {
  const key = wordState(word).key;
  return key === "due" || key === "new";
}

function WeeklyTracker({ words }: { words: WordCard[] }) {
  const scheduledWords = words.filter((word) => !isPdfVocabulary(word));
  const rows = dayNames.map((day, index) => {
    const list = scheduledWords.filter((w) => addedDayIndex(w) === index);
    return {
      day,
      list,
      due: list.filter((w) => wordState(w).key === "due").length,
      waiting: list.filter((w) => wordState(w).key === "waiting").length,
      fresh: list.filter((w) => wordState(w).key === "new").length,
      mastered: list.filter((w) => wordState(w).key === "mastered").length,
    };
  });
  return (
    <section className="panel weekly">
      <div className="panel-title">
        <div>
          <h3>Bảng theo dõi Leitner</h3>
          <p>Tự cập nhật theo ngày thêm và trạng thái hiện tại</p>
        </div>
        <span className="mastery-rate">{scheduledWords.length ? Math.round((scheduledWords.filter((w) => wordState(w).key === "mastered").length / scheduledWords.length) * 100) : 0}% đã thuộc</span>
      </div>
      <div className="weekly-table">
        <div>
          <b>Ngày thêm</b>
          <b>Tổng</b>
          <b>🔴 Cần ôn</b>
          <b>⏳ Chưa tới hạn</b>
          <b>🆕 Chưa học</b>
          <b>✅ Đã thuộc</b>
        </div>
        {rows.map((r, i) => (
          <div key={r.day}>
            <span>
              {String(i + 1).padStart(2, "0")} {r.day}
            </span>
            <span>{r.list.length}</span>
            <span>{r.due}</span>
            <span>{r.waiting}</span>
            <span>{r.fresh}</span>
            <span>{r.mastered}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: string; tone: string }) {
  return (
    <div className="stat">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function Words({ words, query, setQuery, toggleStar, add, remove, importWords, startTopicReview, setStudyDay, startDayReview }: { words: WordCard[]; query: string; setQuery: (s: string) => void; toggleStar: (id: string) => void; add: () => void; remove: (id: string) => void; importWords: (w: Omit<WordCard, "id" | "lapses">[]) => void; startTopicReview: (topic: string) => void; setStudyDay: (id: string, day: number) => void; startDayReview: (day?: number) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [collectionFilter, setCollectionFilter] = useState<"daily" | "pdf">("daily");
  const [pdfTopic, setPdfTopic] = useState<string | null>(null);
  const isPdfWord = isPdfVocabulary;
  const personalWords = words.filter((word) => !isPdfWord(word));
  const pdfWords = words.filter(isPdfWord);
  const pdfTopics = [...new Set(pdfWords.flatMap((word) => word.topic.split(" · ")))].sort((a, b) => a.localeCompare(b, "vi"));
  const activeCollection = collectionFilter === "pdf" ? (pdfTopic ? pdfWords.filter((word) => word.topic.split(" · ").includes(pdfTopic)) : pdfWords) : personalWords;
  const visible = activeCollection.filter((w) => (statusFilter === "all" || wordState(w).key === statusFilter) && (dayFilter === null || addedDayIndex(w) === dayFilter));
  const dayWords = dayFilter === null ? [] : personalWords.filter((word) => addedDayIndex(word) === dayFilter);
  function exportCsv() {
    const rows = [["term", "meaning_vi", "ipa", "example", "example_vi", "topic"], ...activeCollection.map((w) => [w.term, w.meaning, w.ipa, w.example, w.exampleVi ?? "", w.topic])];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    download(csv, "lexilo-vocabulary.csv", "text/csv;charset=utf-8");
  }
  function exportQuizlet() {
    download(activeCollection.map((w) => `${w.term}\t${w.meaning}`).join("\n"), collectionFilter === "pdf" ? "lexilo-pdf-983-quizlet.txt" : "lexilo-quizlet.txt", "text/plain;charset=utf-8");
  }
  function download(content: string, name: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function readFile(file?: File) {
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: true,
      });
      const daySheets = workbook.SheetNames.filter((n) => /^0[1-7] /.test(n));
      const imported: Omit<WordCard, "id" | "lapses">[] = [];
      for (const name of daySheets) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: "" });
        for (const row of rows) {
          const term = String(row["Từ / Cụm từ"] || "").trim();
          if (!term) continue;
          const box = Number(row["Hộp (1-6)"] || 1);
          const reviewed = Number(row["Số lần ôn"] || 0);
          const excelDate = (v: unknown) => (v instanceof Date ? localDateString(v) : v ? localDateString(new Date(String(v))) : undefined);
          const example = String(row["Câu ví dụ (ngữ cảnh)"] || "");
          const exampleVi = String(row["Dịch câu ví dụ"] || row["Nghĩa câu ví dụ"] || "");
          imported.push({
            term,
            partOfSpeech: String(row["Loại từ"] || ""),
            ipa: String(row["Phát âm (IPA)"] || "/…/"),
            meaning: String(row["Nghĩa tiếng Việt"] || "Chưa có nghĩa"),
            example: example || naturalExample(term),
            exampleVi: exampleVi || (example ? "" : naturalExampleVi(term)),
            cloze: (example || naturalExample(term)).replace(new RegExp(term, "i"), "_____"),
            definition: "",
            topic: String(row["Chủ đề"] || "Khác"),
            note: String(row["Ghi chú"] || ""),
            addedDate: excelDate(row["Ngày thêm"]),
            lastReviewedAt: excelDate(row["Lần ôn gần nhất"]),
            reviewCount: reviewed,
            box,
            dueDate: excelDate(row["Ngày ôn tiếp"]),
            status: box >= 6 ? "mastered" : reviewed === 0 ? "new" : "review",
          });
        }
      }
      importWords(imported);
      alert(`Đã nhập ${imported.length} từ từ ${daySheets.length} sheet.`);
      return;
    }
    const text = await file.text();
    const items = text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 1000)
      .map((line) => {
        const parts = line.includes("\t") ? line.split("\t") : line.split(/[:,]/);
        const term = (parts.shift() ?? "").replace(/^"|"$/g, "").trim();
        const meaning = parts.join(":").replace(/^"|"$/g, "").trim();
        return {
          term,
          meaning: meaning || "Chưa có nghĩa",
          ipa: "/…/",
          example: naturalExample(term),
          exampleVi: naturalExampleVi(term),
          cloze: `I am learning how to use _____ naturally.`,
          definition: "",
          topic: "Nhập khẩu",
          box: 1,
        };
      })
      .filter((x) => x.term.toLowerCase() !== "term" && x.term);
    importWords(items);
  }
  return (
    <div className="page words-page">
      <div className="section-head">
        <div>
          <div className="eyebrow">THƯ VIỆN CỦA BẠN</div>
          <h1>Từ vựng</h1>
          <p>{collectionFilter === "pdf" ? (pdfTopic ? `${activeCollection.length} từ trong chủ đề ${pdfTopic}.` : `${pdfWords.length} từ trong ${pdfTopics.length} thư mục chủ đề.`) : `${personalWords.length} từ cá nhân · quản lý theo Leitner Box.`}</p>
        </div>
        {collectionFilter === "daily" && <button className="primary" onClick={add}>＋ Thêm từ mới</button>}
      </div>
      <div className="day-tabs">
        <button className={dayFilter === null && collectionFilter === "daily" ? "active" : ""} onClick={() => { setDayFilter(null); setCollectionFilter("daily"); setPdfTopic(null); setQuery(""); }}>
          Từ của tôi
          <small>{personalWords.length}</small>
        </button>
        <button className={collectionFilter === "pdf" ? "active" : ""} onClick={() => { setDayFilter(null); setCollectionFilter("pdf"); setPdfTopic(null); setQuery(""); }}>
          Bộ từ vựng PDF
          <small>{pdfWords.length}</small>
        </button>
        {collectionFilter === "daily" && dayNames.map((name, index) => (
          <button className={dayFilter === index && collectionFilter === "daily" ? "active" : ""} onClick={() => { setDayFilter(index); setCollectionFilter("daily"); }} key={name}>
            {name}
            <small>{personalWords.filter((w) => addedDayIndex(w) === index).length}</small>
          </button>
        ))}
      </div>
      {collectionFilter === "pdf" && !pdfTopic && (
        <section className="topic-folders">
          <div className="topic-folders-head">
            <div><h3>Thư mục chủ đề</h3><p>Chọn một thư mục để xem và ôn riêng nhóm từ đó.</p></div>
          </div>
          <div className="topic-folder-grid">
            {pdfTopics.map((topic) => {
              const count = pdfWords.filter((word) => word.topic.split(" · ").includes(topic)).length;
              return <button key={topic} onClick={() => setPdfTopic(topic)}><span>▰</span><b>{topic}</b><small>{count} từ</small><i> Mở →</i></button>;
            })}
          </div>
        </section>
      )}
      {collectionFilter === "pdf" && pdfTopic && (
        <div className="selected-topic-bar">
          <button onClick={() => setPdfTopic(null)}>← Tất cả chủ đề</button>
          <div><b>{pdfTopic}</b><small>{activeCollection.length} từ</small></div>
          <button className="primary" onClick={() => startTopicReview(pdfTopic)}>Ôn chủ đề này →</button>
        </div>
      )}
      {collectionFilter === "daily" && (
        <div className="selected-topic-bar">
          {dayFilter === null ? (
            <>
              <span className="collection-hint">Toàn bộ từ bạn tự thêm</span>
              <div>
                <b>Từ của tôi</b>
                <small>
                  {personalWords.length} từ · {personalWords.filter(isDueForReview).length} cần ôn
                </small>
              </div>
              <button className="primary" disabled={!personalWords.length} onClick={() => startDayReview()}>
                Ôn tất cả →
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setDayFilter(null)}>← Tất cả từ của tôi</button>
              <div>
                <b>{dayNames[dayFilter]}</b>
                <small>
                  {dayWords.length} từ · {dayWords.filter(isDueForReview).length} cần ôn
                </small>
              </div>
              <button className="primary" disabled={!dayWords.length} onClick={() => startDayReview(dayFilter)}>
                Ôn ngày này →
              </button>
            </>
          )}
        </div>
      )}
      {(collectionFilter === "daily" || pdfTopic) && <>
      <div className="word-tools">
        <label>
          <span>⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm từ, nghĩa hoặc chủ đề..." />
        </label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Tất cả trạng thái</option>
          <option value="due">🔴 Cần ôn</option>
          <option value="waiting">⏳ Chưa tới hạn</option>
          <option value="new">🆕 Chưa học</option>
          <option value="mastered">✅ Đã thuộc</option>
        </select>
        {collectionFilter === "daily" && <button onClick={() => fileRef.current?.click()}>Nhập Excel</button>}
        <button onClick={exportCsv}>Xuất CSV</button>
        <button onClick={exportQuizlet}>Quizlet</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
      </div>
      <div className="word-table">
        <div className="word-tr word-th">
          <span>TỪ / LOẠI TỪ / NGHĨA</span>
          <span>CHỦ ĐỀ</span>
          <span>HỘP (1–6)</span>
          <span>TRẠNG THÁI</span>
          <span />
        </div>
        {visible.map((w) => (
          <div className={`word-tr state-${wordState(w).key}`} key={w.id}>
            <span className="word-main">
              <button onClick={() => toggleStar(w.id)} aria-label="Gắn sao">
                {w.starred ? "★" : "☆"}
              </button>
              <span>
                <b>
                  {w.term} {w.partOfSpeech && <em>({w.partOfSpeech})</em>}
                </b>
                <small>
                  {w.ipa} · {w.meaning}
                </small>
                <small className="word-example">{w.example}</small>
                {w.exampleVi && <small className="word-example vi">{w.exampleVi}</small>}
              </span>
            </span>
            <span className="topic-cell">
              <em>{w.topic}</em>
              {!isPdfWord(w) && (
                <select className="day-select" aria-label={`Ngày học của ${w.term}`} value={addedDayIndex(w)} onChange={(e) => setStudyDay(w.id, Number(e.target.value))}>
                  {dayNames.map((name, index) => (
                    <option value={index} key={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </span>
            <span>
              <span className="box-dots">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <i className={n <= w.box ? "filled" : ""} key={n} />
                ))}
              </span>
              <small className="due-date">{w.dueDate ? `Ôn: ${w.dueDate}` : "Chưa có lịch"}</small>
            </span>
            <span className="state-label">{wordState(w).label}</span>
            {!isPdfWord(w) && <button
              aria-label={`Xóa ${w.term}`}
              onClick={() => {
                if (confirm(`Chuyển “${w.term}” vào thùng rác?`)) remove(w.id);
              }}
            >
              ×
            </button>}
          </div>
        ))}
      </div>
      </>}
    </div>
  );
}

function ReviewView({ card, index, total, revealed, answer, setAnswer, reveal, rate, close, speak, toggleStar, mode, modeSetting, setMode, choices, choice, pickChoice }: { card: WordCard; index: number; total: number; revealed: boolean; answer: string; setAnswer: (s: string) => void; reveal: () => void; rate: (r: Rating) => void; close: () => void; speak: (s: string) => void; toggleStar: () => void; mode: ReviewMode; modeSetting: ReviewMode; setMode: (m: ReviewMode) => void; choices: WordCard[]; choice: string | null; pickChoice: (id: string) => void }) {
  // Trắc nghiệm cần ít nhất 2 lựa chọn, hàng đợi quá ngắn thì lùi về thẻ Việt → Anh.
  const shownMode: ReviewMode = mode === "quiz" && choices.length < 2 ? "vi_en" : mode;
  const graded = shownMode === "quiz" ? (choice === null ? null : choice === card.id) : shownMode === "en_vi" || !answer.trim() ? null : normalizeAnswer(answer) === normalizeAnswer(card.term);
  return (
    <main className="review">
      <header>
        <button onClick={close} aria-label="Thoát phiên học">
          ×
        </button>
        <div>
          <div className="review-count">
            <span>
              {Math.min(index + 1, total)} / {total}
            </span>
            <span>{Math.round(((index + 1) / total) * 100)}%</span>
          </div>
          <div className="progress">
            <i style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
        <button onClick={toggleStar} aria-label="Gắn sao">
          {card.starred ? "★" : "☆"}
        </button>
      </header>
      <div className="review-modes" role="group" aria-label="Kiểu thẻ ôn tập">
        {reviewModes.map((item) => (
          <button key={item.value} className={modeSetting === item.value ? "active" : ""} onClick={() => setMode(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      <section className={`flashcard ${revealed ? "revealed" : ""}`}>
        {!revealed ? (
          <>
            {shownMode === "vi_en" && (
              <>
                <span className="card-label">VIỆT → ANH</span>
                <h1>{card.meaning}</h1>
                <p className="cloze">{card.cloze}</p>
                <label className="answer">
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") reveal();
                    }}
                    placeholder="Nhập từ tiếng Anh..."
                  />
                  <span>↵</span>
                </label>
                <small>Tự nhớ trong đầu hoặc nhập đáp án</small>
              </>
            )}
            {shownMode === "en_vi" && (
              <>
                <span className="card-label">ANH → VIỆT</span>
                <div className="term-line">
                  <h1>{card.term}</h1>
                  <button onClick={() => speak(card.term)} aria-label={`Phát âm ${card.term}`}>
                    ◖))
                  </button>
                </div>
                <div className="ipa">{card.ipa}</div>
                <small>Nhớ lại nghĩa tiếng Việt rồi lật thẻ</small>
              </>
            )}
            {shownMode === "quiz" && (
              <>
                <span className="card-label">TRẮC NGHIỆM</span>
                <h1>{card.term}</h1>
                <div className="ipa">{card.ipa}</div>
                <div className="choice-grid">
                  {choices.map((item, position) => (
                    <button key={item.id} onClick={() => pickChoice(item.id)}>
                      <kbd>{position + 1}</kbd> {item.meaning}
                    </button>
                  ))}
                </div>
              </>
            )}
            {shownMode === "listen" && (
              <>
                <span className="card-label">NGHE VÀ VIẾT</span>
                <button className="listen-btn" onClick={() => speak(card.term)} aria-label={`Phát âm ${card.term}`}>
                  ◖))
                </button>
                <label className="answer">
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") reveal();
                    }}
                    placeholder="Nhập từ nghe được..."
                  />
                  <span>↵</span>
                </label>
                <small>Nghe lại bao nhiêu lần cũng được trước khi lật thẻ</small>
              </>
            )}
          </>
        ) : (
          <>
            <span className="card-label">ĐÁP ÁN</span>
            <div className="term-line">
              <h1>{card.term}</h1>
              <button onClick={() => speak(card.term)} aria-label={`Phát âm ${card.term}`}>
                ◖))
              </button>
            </div>
            <div className="ipa">{card.ipa}</div>
            {graded !== null && <p className={graded ? "review-verdict good" : "review-verdict"}>{graded ? "✓ Bạn trả lời đúng" : shownMode === "quiz" ? `✗ Bạn chọn: ${choices.find((item) => item.id === choice)?.meaning}` : `✗ Bạn viết: ${answer}`}</p>}
            <p className="review-meaning">{card.meaning}</p>
            <p className="example">
              {card.example}
              {card.exampleVi && <em>{card.exampleVi}</em>}
            </p>
            <p className="definition">{card.definition}</p>
          </>
        )}
      </section>
      {!revealed ? (
        <button className="reveal" onClick={reveal} disabled={shownMode === "quiz"}>
          {shownMode === "quiz" ? "Chọn một đáp án ở trên" : "Hiện đáp án"} {shownMode !== "quiz" && <kbd>Space</kbd>}
        </button>
      ) : (
        <div className="ratings">
          {([
            ["again", "😵 Quên", "1"],
            ["hard", "😐 Khó", "2"],
            ["good", "🙂 Được", "3"],
            ["easy", "😎 Dễ", "4"],
          ] as [Rating, string, string][]).map(([value, label, key]) => (
            <button key={value} className={graded !== null && value === (graded ? "good" : "again") ? "suggested" : ""} onClick={() => rate(value)}>
              <b>{label}</b>
              <small>{scheduleFor(card, value).interval} ngày</small>
              <kbd>{key}</kbd>
            </button>
          ))}
        </div>
      )}
      <footer>
        Phím tắt: <kbd>Space</kbd> lật thẻ · <kbd>1–4</kbd> {shownMode === "quiz" && !revealed ? "chọn đáp án" : "đánh giá"} · <kbd>S</kbd> gắn sao · <kbd>Esc</kbd> thoát
      </footer>
    </main>
  );
}

function SessionSummary({ total, close, restart }: { total: number; close: () => void; restart: () => void }) {
  return (
    <main className="review summary">
      <section className="flashcard">
        <span className="summary-mark">✓</span>
        <span className="card-label">HOÀN THÀNH PHIÊN HỌC</span>
        <h1>{total} thẻ đã ôn</h1>
        <p className="definition">Kết quả đã được đồng bộ vào lịch ôn tiếp theo của bạn.</p>
        <div className="summary-actions">
          <button onClick={close}>Về trang chủ</button>
          <button className="primary" onClick={restart}>
            Ôn lại
          </button>
        </div>
      </section>
    </main>
  );
}

function Practice({ words }: { words: WordCard[] }) {
  const externalTools = [
    { label: "Luyện nghe A2", short: "EL", url: "https://elllo.org/book/A2/index.html", tone: "blue" },
    { label: "Hội thoại hằng ngày", short: "BE", url: "https://basicenglishspeaking.com/daily-english-conversation-topics/", tone: "orange" },
    { label: "Nghe chép chính tả", short: "DD", url: "https://dailydictation.com/", tone: "navy" },
    { label: "IELTS Reading", short: "YP", url: "https://youpass.vn/luyen-thi/ielts/reading?quiz_type=quiz&status=unfinished&passage=32", tone: "gold" },
    { label: "Duolingo", short: "DU", url: "https://www.duolingo.com/", tone: "green" },
    { label: "Quizlet", short: "Q", url: "https://quizlet.com/", tone: "purple" },
    { label: "Từ điển", short: "C", url: "https://dictionary.cambridge.org/", tone: "teal" },
    { label: "Google Dịch", short: "G", url: "https://translate.google.com/?sl=en&tl=vi", tone: "sky" },
  ];
  const [mode, setMode] = useState<"menu" | "flash" | "learn" | "test" | "listen" | "match" | "dictation">("menu");
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [flipped, setFlipped] = useState(false);
  if (!words.length)
    return (
      <div className="page">
        <h1>Luyện tập</h1>
        <p>Hãy thêm từ vựng trước khi bắt đầu.</p>
      </div>
    );
  const word = words[index % words.length];
  function next() {
    setIndex((i) => i + 1);
    setResult(null);
    setTyped("");
    setFlipped(false);
  }
  if (mode === "menu")
    return (
      <div className="page">
        <section className="external-tools" aria-label="Công cụ học tiếng Anh">
          {externalTools.map((tool) => (
            <a href={tool.url} target="_blank" rel="noreferrer" key={tool.label} title={`Mở ${tool.label}`}>
              <span className={`external-tool-icon ${tool.tone}`}>{tool.short}</span>
              <b>{tool.label}</b>
            </a>
          ))}
        </section>
        <div className="eyebrow">LUYỆN NGOÀI LỊCH ÔN</div>
        <h1>Luyện tập kiểu Quizlet</h1>
        <p className="page-sub">Chọn một chế độ để củng cố trí nhớ. Kết quả luyện tập không làm giảm hộp Leitner.</p>
        <div className="practice-grid quizlet-modes">
          <button onClick={() => setMode("flash")}>
            <span>▱</span>
            <b>Flashcards</b>
            <small>Lật thẻ, nghe phát âm và tự kiểm tra</small>
          </button>
          <button onClick={() => setMode("learn")}>
            <span>✎</span>
            <b>Học</b>
            <small>Từ trắc nghiệm lên tự gõ, lặp lại tới khi thuộc hết</small>
          </button>
          <button onClick={() => setMode("test")}>
            <span>◉</span>
            <b>Kiểm tra</b>
            <small>Bài kiểm tra trộn nhiều dạng câu, chấm điểm cuối bài</small>
          </button>
          <button onClick={() => setMode("listen")}>
            <span>◖))</span>
            <b>Nghe và viết</b>
            <small>Nghe phát âm rồi nhập lại từ</small>
          </button>
          <button onClick={() => setMode("dictation")}>
            <span>≋</span>
            <b>Chép chính tả</b>
            <small>Nghe câu và gõ lại theo chủ đề, trình độ</small>
          </button>
          <button onClick={() => setMode("match")}>
            <span>⌘</span>
            <b>Nối cặp</b>
            <small>Ghép từ với nghĩa nhanh nhất</small>
          </button>
        </div>
      </div>
    );
  if (mode === "match") return <MatchGame words={words} close={() => setMode("menu")} />;
  if (mode === "dictation") return <DictationPractice words={words} close={() => setMode("menu")} />;
  if (mode === "learn") return <LearnMode words={words} close={() => setMode("menu")} />;
  if (mode === "test") return <TestMode words={words} close={() => setMode("menu")} />;
  if (mode === "flash")
    return (
      <div className="page practice-session">
        <button className="back" onClick={() => setMode("menu")}>
          ← Chọn chế độ khác
        </button>
        <div className="practice-progress">
          <span>
            {(index % words.length) + 1}/{words.length}
          </span>
          <i
            style={{
              width: `${(((index % words.length) + 1) / words.length) * 100}%`,
            }}
          />
        </div>
        <button className={`quizlet-flashcard ${flipped ? "is-flipped" : ""}`} onClick={() => setFlipped((v) => !v)}>
          <span className="flash-front">
            <small>TIẾNG ANH</small>
            <b>{word.term}</b>
            <em className="flash-ipa">{word.ipa}</em>
            <em>{word.example}</em>
            <i>Nhấn để lật thẻ</i>
          </span>
          <span className="flash-back">
            <small>TIẾNG VIỆT</small>
            <b>{word.meaning}</b>
            <em>{word.exampleVi || "(chưa có bản dịch câu ví dụ)"}</em>
            <i>Nhấn để lật lại</i>
          </span>
        </button>
        <div className="flash-actions">
          <button onClick={() => window.speechSynthesis?.speak(new SpeechSynthesisUtterance(word.term))}>◖)) Nghe</button>
          <button onClick={next}>Thẻ tiếp theo →</button>
        </div>
      </div>
    );
  return (
    <div className="page practice-session">
      <button className="back" onClick={() => setMode("menu")}>
        ← Chọn chế độ khác
      </button>
      <div className="panel practice-card">
        <div className="eyebrow">CÂU {index + 1}</div>
        <button className="listen-btn" onClick={() => window.speechSynthesis?.speak(new SpeechSynthesisUtterance(word.term))}>
          ◖))
        </button>
        <h2>Nghe và nhập từ</h2>
        <input
          className="listen-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setResult(normalizeAnswer(typed) === normalizeAnswer(word.term) ? "Đúng rồi!" : "Đáp án: " + word.term);
          }}
          placeholder="Nhập từ nghe được…"
        />
        <button className="primary" onClick={() => setResult(normalizeAnswer(typed) === normalizeAnswer(word.term) ? "Đúng rồi!" : "Đáp án: " + word.term)}>
          Kiểm tra
        </button>
        {result && (
          <div className={result.startsWith("Đúng") ? "practice-result good" : "practice-result"}>
            {result}
            <button onClick={next}>Câu tiếp →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeAnswer(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ");
}

// Xáo tất định theo seed để danh sách không đảo lại mỗi lần render.
function seededOrder<T>(items: T[], seed: number) {
  return items
    .map((item, position) => ({ item, key: Math.imul(position + seed + 1, 2654435761) >>> 0 }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

function pickDistractors(pool: WordCard[], answer: WordCard, seed: number, howMany = 3) {
  return seededOrder(
    pool.filter((word) => word.id !== answer.id && word.meaning !== answer.meaning),
    seed,
  ).slice(0, howMany);
}

// Chế độ Học: mỗi từ đi qua hai bậc — chọn đáp án đúng rồi tự gõ lại — mới tính là thuộc.
function LearnMode({ words, close }: { words: WordCard[]; close: () => void }) {
  const pool = useMemo(() => words.slice(0, 40), [words]);
  const [levels, setLevels] = useState<Record<string, number>>(() => Object.fromEntries(pool.map((word) => [word.id, 0])));
  const [queue, setQueue] = useState<string[]>(() => pool.map((word) => word.id));
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);
  const [asked, setAsked] = useState(0);
  const byId = useMemo(() => new Map(pool.map((word) => [word.id, word])), [pool]);
  const current = queue.length ? byId.get(queue[0]) : undefined;
  const level = current ? (levels[current.id] ?? 0) : 0;
  const options = useMemo(() => (current && level === 0 ? seededOrder([current, ...pickDistractors(pool, current, asked)], asked) : []), [current, level, pool, asked]);
  const mastered = pool.filter((word) => (levels[word.id] ?? 0) >= 2).length;

  function answer(correct: boolean) {
    if (!current || feedback) return;
    setFeedback({ correct });
    setLevels((previous) => ({ ...previous, [current.id]: correct ? Math.min(2, (previous[current.id] ?? 0) + 1) : 0 }));
  }
  function advance() {
    if (!current) return;
    const nextLevel = levels[current.id] ?? 0;
    // Thuộc rồi thì bỏ khỏi hàng đợi, chưa thuộc thì đẩy xuống cuối để gặp lại.
    setQueue((previous) => (nextLevel >= 2 ? previous.slice(1) : [...previous.slice(1), previous[0]]));
    setTyped("");
    setFeedback(null);
    setAsked((value) => value + 1);
  }
  function restart() {
    setLevels(Object.fromEntries(pool.map((word) => [word.id, 0])));
    setQueue(pool.map((word) => word.id));
    setTyped("");
    setFeedback(null);
    setAsked(0);
  }

  if (!current)
    return (
      <div className="page practice-session">
        <button className="back" onClick={close}>
          ← Chọn chế độ khác
        </button>
        <div className="panel practice-card">
          <span className="summary-mark">✓</span>
          <h2>Đã thuộc hết {pool.length} từ</h2>
          <p className="page-sub">Bạn đã trả lời đúng cả hai bậc cho mọi từ trong lượt học này.</p>
          <div className="summary-actions">
            <button onClick={close}>Chọn chế độ khác</button>
            <button className="primary" onClick={restart}>
              Học lại
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page practice-session">
      <button className="back" onClick={close}>
        ← Chọn chế độ khác
      </button>
      <div className="learn-progress">
        <span>
          Đã thuộc <b>{mastered}</b>/{pool.length}
        </span>
        <i style={{ width: `${(mastered / pool.length) * 100}%` }} />
        <span>Còn {queue.length} thẻ trong lượt</span>
      </div>
      <div className="panel practice-card">
        <span className="learn-label">{level === 0 ? "BẬC 1 · CHỌN ĐÁP ÁN" : "BẬC 2 · TỰ GÕ LẠI"}</span>
        <h2>{current.meaning}</h2>
        {level === 0 ? (
          <div className="choice-grid">
            {options.map((option) => (
              <button key={option.id} disabled={!!feedback} className={feedback && option.id === current.id ? "is-answer" : ""} onClick={() => answer(option.id === current.id)}>
                {option.term}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="learn-cloze">{current.cloze}</p>
            <input
              className="listen-input"
              value={typed}
              disabled={!!feedback}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && typed.trim()) answer(normalizeAnswer(typed) === normalizeAnswer(current.term));
              }}
              placeholder="Nhập từ tiếng Anh…"
            />
            {!feedback && (
              <button className="primary" disabled={!typed.trim()} onClick={() => answer(normalizeAnswer(typed) === normalizeAnswer(current.term))}>
                Kiểm tra
              </button>
            )}
          </>
        )}
        {feedback && (
          <div className={feedback.correct ? "practice-result good" : "practice-result"}>
            <span>
              {feedback.correct ? "Đúng rồi!" : `Đáp án: ${current.term}`}
              {!feedback.correct && <small className="learn-hint"> · {current.example}</small>}
            </span>
            <button onClick={advance}>Tiếp →</button>
          </div>
        )}
      </div>
    </div>
  );
}

type TestQuestion = { kind: "mc" | "written" | "tf"; word: WordCard; options?: WordCard[]; shown?: WordCard };
// Chế độ Kiểm tra: sinh đề trộn ba dạng câu, làm hết rồi mới chấm.
function TestMode({ words, close }: { words: WordCard[]; close: () => void }) {
  const sizes = [5, 10, 20].filter((size) => size <= words.length);
  const [size, setSize] = useState(sizes[sizes.length - 1] ?? words.length);
  const [seed, setSeed] = useState(1);
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const questions = useMemo<TestQuestion[]>(() => {
    const chosen = seededOrder(words, seed).slice(0, Math.min(size, words.length));
    return chosen.map((word, position) => {
      const kind = (["mc", "written", "tf"] as const)[(position + seed) % 3];
      if (kind === "mc") return { kind, word, options: seededOrder([word, ...pickDistractors(words, word, seed + position)], seed + position) };
      if (kind === "tf") {
        const wrong = pickDistractors(words, word, seed + position, 1)[0];
        const showTrue = (position + seed) % 2 === 0 || !wrong;
        return { kind, word, shown: showTrue ? word : wrong };
      }
      return { kind, word };
    });
  }, [words, size, seed]);

  function isCorrect(question: TestQuestion, given?: string) {
    if (!given) return false;
    if (question.kind === "mc") return given === question.word.id;
    if (question.kind === "written") return normalizeAnswer(given) === normalizeAnswer(question.word.term);
    return given === (question.shown?.id === question.word.id ? "true" : "false");
  }
  const score = questions.filter((question, position) => isCorrect(question, answers[position])).length;

  if (!started)
    return (
      <div className="page practice-session">
        <button className="back" onClick={close}>
          ← Chọn chế độ khác
        </button>
        <div className="eyebrow">KIỂM TRA</div>
        <h1>Tạo bài kiểm tra</h1>
        <p className="page-sub">Đề trộn ba dạng: chọn đáp án, đúng/sai và tự viết. Chấm điểm sau khi nộp bài.</p>
        <div className="test-setup">
          <div className="test-sizes">
            {(sizes.length ? sizes : [words.length]).map((option) => (
              <button key={option} className={size === option ? "active" : ""} onClick={() => setSize(option)}>
                {option} câu
              </button>
            ))}
          </div>
          <button
            className="primary"
            onClick={() => {
              setAnswers({});
              setSubmitted(false);
              setStarted(true);
            }}
          >
            Bắt đầu làm bài →
          </button>
        </div>
      </div>
    );

  return (
    <div className="page practice-session">
      <button className="back" onClick={() => setStarted(false)}>
        ← Đổi số câu
      </button>
      {submitted && (
        <div className={score === questions.length ? "test-score perfect" : "test-score"}>
          <strong>
            {score}/{questions.length}
          </strong>
          <span>{Math.round((score / questions.length) * 100)}% đúng</span>
          <button
            className="primary"
            onClick={() => {
              setSeed((value) => value + 1);
              setAnswers({});
              setSubmitted(false);
            }}
          >
            Làm đề khác →
          </button>
        </div>
      )}
      <div className="test-list">
        {questions.map((question, position) => {
          const given = answers[position];
          const correct = isCorrect(question, given);
          return (
            <div className={submitted ? (correct ? "panel test-question ok" : "panel test-question wrong") : "panel test-question"} key={position}>
              <div className="test-head">
                <span className="eyebrow">
                  CÂU {position + 1} · {question.kind === "mc" ? "CHỌN ĐÁP ÁN" : question.kind === "written" ? "TỰ VIẾT" : "ĐÚNG HAY SAI"}
                </span>
                {submitted && <span className="test-mark">{correct ? "✓" : "✗"}</span>}
              </div>
              {question.kind === "tf" ? (
                <>
                  <h3>
                    {question.word.term} = {question.shown?.meaning}
                  </h3>
                  <div className="choice-grid">
                    {[
                      ["true", "Đúng"],
                      ["false", "Sai"],
                    ].map(([value, label]) => (
                      <button key={value} disabled={submitted} className={given === value ? "selected" : ""} onClick={() => setAnswers((previous) => ({ ...previous, [position]: value }))}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              ) : question.kind === "mc" ? (
                <>
                  <h3>{question.word.meaning}</h3>
                  <div className="choice-grid">
                    {question.options?.map((option) => (
                      <button key={option.id} disabled={submitted} className={given === option.id ? "selected" : ""} onClick={() => setAnswers((previous) => ({ ...previous, [position]: option.id }))}>
                        {option.term}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h3>{question.word.meaning}</h3>
                  <input className="listen-input" disabled={submitted} value={given ?? ""} onChange={(event) => setAnswers((previous) => ({ ...previous, [position]: event.target.value }))} placeholder="Viết từ tiếng Anh…" />
                </>
              )}
              {submitted && !correct && (
                <p className="test-answer">
                  Đáp án: <b>{question.kind === "tf" ? (question.shown?.id === question.word.id ? "Đúng" : "Sai") : question.word.term}</b> · {question.word.example}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {!submitted && (
        <button className="primary test-submit" disabled={Object.keys(answers).length < questions.length} onClick={() => setSubmitted(true)}>
          {Object.keys(answers).length < questions.length ? `Còn ${questions.length - Object.keys(answers).length} câu chưa làm` : "Nộp bài"}
        </button>
      )}
    </div>
  );
}

function MatchGame({ words, close }: { words: WordCard[]; close: () => void }) {
  const pool = words.slice(0, Math.min(6, words.length));
  const [selected, setSelected] = useState<{
    id: string;
    side: "term" | "meaning";
  } | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [mistake, setMistake] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const tiles = [
        ...pool.map((w) => ({ id: w.id, side: "term" as const, text: w.term })),
        ...pool.map((w) => ({
          id: w.id,
          side: "meaning" as const,
          text: w.meaning,
        })),
      ].sort((a, b) => (a.text + a.side).localeCompare(b.text + b.side));
  function choose(tile: { id: string; side: "term" | "meaning" }, eventTime: number) {
    if (matched.includes(tile.id)) return;
    if (!selected) {
      if (startedAt === null) setStartedAt(eventTime);
      setSelected({ id: tile.id, side: tile.side });
      setMistake(false);
      return;
    }
    if (selected.id === tile.id && selected.side !== tile.side) {
      const done = [...matched, tile.id];
      setMatched(done);
      setSelected(null);
      if (done.length === pool.length) setFinishedAt(eventTime);
    } else {
      setMistake(true);
      setTimeout(() => {
        setSelected(null);
        setMistake(false);
      }, 450);
    }
  }
  return (
    <div className="page match-page">
      <button className="back" onClick={close}>
        ← Chọn chế độ khác
      </button>
      <div className="match-head">
        <div>
          <div className="eyebrow">NỐI CẶP</div>
          <h1>Ghép từ với nghĩa</h1>
        </div>
        <strong>{finishedAt && startedAt !== null ? ((finishedAt - startedAt) / 1000).toFixed(1) : "—"}s</strong>
      </div>
      {finishedAt ? (
        <div className="match-complete">
          <span>✓</span>
          <h2>Hoàn thành!</h2>
          <p>
            Bạn đã ghép {pool.length} cặp trong {startedAt !== null ? ((finishedAt - startedAt) / 1000).toFixed(1) : "0.0"} giây.
          </p>
          <button className="primary" onClick={close}>
            Chọn chế độ khác
          </button>
        </div>
      ) : (
        <div className={`match-grid ${mistake ? "shake" : ""}`}>
          {tiles.map((tile) => (
            <button key={tile.side + tile.id} className={`${selected?.id === tile.id && selected.side === tile.side ? "selected" : ""} ${matched.includes(tile.id) ? "matched" : ""}`} onClick={(event) => choose(tile, event.timeStamp)}>
              {tile.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DictationPractice({ words, close }: { words: WordCard[]; close: () => void }) {
  const [selectedTopic, setSelectedTopic] = useState(dictationTopics[0]);
  const [selectedLevel, setSelectedLevel] = useState<DictationLevel>("A1");
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [rate, setRate] = useState(0.85);
  const [plays, setPlays] = useState(0);
  const [hintCount, setHintCount] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [autoReplay, setAutoReplay] = useState(0);
  const [replayDelay, setReplayDelay] = useState(1);
  const personal: DictationLesson[] = words
    .filter((w) => w.example && w.example.length > 8)
    .map((w, i) => ({
      id: `personal-${i}`,
      topic: "Từ vựng của tôi",
      level: (w.example.split(/\s+/).length < 9 ? "A1" : w.example.split(/\s+/).length < 14 ? "A2" : "B1") as DictationLevel,
      title: w.term,
      sentence: w.example,
    }));
  const allLessons: DictationLesson[] = [...dictationLessons, ...personal];
  const sentences = allLessons.filter((item) => item.topic === selectedTopic && item.level === selectedLevel);
  const current = sentences[index % Math.max(1, sentences.length)];
  useEffect(() => {
    if (!started || !current) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "`" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        speak();
      }
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        speak();
      }
      if (event.key === "Enter" && event.target instanceof HTMLTextAreaElement && !event.shiftKey) {
        event.preventDefault();
        if (typed.trim()) setChecked(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [started, current?.id, typed, rate, autoReplay, replayDelay]);
  if (!started) {
    const topics = [...dictationTopics, "Từ vựng của tôi"];
    return (
      <div className="page dictation-library">
        <button className="back" onClick={close}>
          ← Chọn chế độ khác
        </button>
        <div className="eyebrow">THƯ VIỆN CHÉP CHÍNH TẢ</div>
        <h1>Chọn chủ đề và trình độ</h1>
        <p className="page-sub">Luyện với bài riêng của Lexilo và transcript được phép sử dụng từ các nguồn mở. Mỗi bài bên ngoài đều hiển thị nguồn và giấy phép.</p>
        <h3>1. Chủ đề</h3>
        <div className="dictation-topics">
          {topics.map((topic) => (
            <button className={selectedTopic === topic ? "active" : ""} onClick={() => setSelectedTopic(topic)} key={topic}>
              <span>{topic === "Đời sống hằng ngày" ? "⌂" : topic === "Du lịch" ? "✈" : topic === "Công nghệ" ? "⌘" : topic === "Công việc" ? "▣" : topic === "Truyện ngắn" ? "▤" : topic === "Hội thoại" ? "◌" : topic === "Số & thời gian" ? "#" : topic === "Từ vựng của tôi" ? "★" : "◇"}</span>
              <b>{topic}</b>
              <small>{allLessons.filter((x) => x.topic === topic).length} câu</small>
            </button>
          ))}
        </div>
        <h3>2. Trình độ</h3>
        <div className="level-picker">
          {dictationLevels.map((level) => (
            <button className={selectedLevel === level ? "active" : ""} onClick={() => setSelectedLevel(level)} key={level}>
              <b>{level}</b>
              <span>{level === "A1" ? "Cơ bản" : level === "A2" ? "Sơ cấp" : level === "B1" ? "Trung cấp" : level === "B2" ? "Trên trung cấp" : "Nâng cao"}</span>
              <small>{allLessons.filter((x) => x.topic === selectedTopic && x.level === level).length} bài</small>
            </button>
          ))}
        </div>
        <div className="library-start">
          <div>
            <b>
              {selectedTopic} · {selectedLevel}
            </b>
            <span>{sentences.length} câu phù hợp</span>
          </div>
          <button
            className="primary"
            disabled={!sentences.length}
            onClick={() => {
              setStarted(true);
              setIndex(0);
            }}
          >
            {sentences.length ? "Bắt đầu chép chính tả →" : "Chưa có bài ở mức này"}
          </button>
        </div>
      </div>
    );
  }
  if (!current)
    return (
      <div className="page">
        <button className="back" onClick={close}>
          ← Chọn chế độ khác
        </button>
        <div className="panel">Hãy bổ sung câu ví dụ cho từ vựng trước khi luyện chép chính tả.</div>
      </div>
    );
  function speak() {
    window.speechSynthesis?.cancel();
    let remaining = autoReplay;
    const play = () => {
      const voice = new SpeechSynthesisUtterance(current.sentence);
      voice.lang = "en-US";
      voice.rate = rate;
      voice.onend = () => {
        if (remaining > 0) {
          remaining--;
          setTimeout(play, replayDelay * 1000);
        }
      };
      window.speechSynthesis?.speak(voice);
      setPlays((v) => v + 1);
    };
    play();
  }
  function goTo(nextIndex: number) {
    setIndex((nextIndex + sentences.length) % sentences.length);
    setTyped("");
    setChecked(false);
    setPlays(0);
    setHintCount(0);
  }
  function next() {
    goTo(index + 1);
  }
  const expected = current.sentence.trim().split(/\s+/);
  const actual = typed.trim().split(/\s+/);
  const correct = normalizeAnswer(typed) === normalizeAnswer(current.sentence);
  const percent = Math.round((expected.filter((word, i) => normalizeAnswer(word) === normalizeAnswer(actual[i] || "")).length / expected.length) * 100);
  return (
    <div className="page dictation-page">
      <button className="back" onClick={() => setStarted(false)}>
        ← Đổi chủ đề hoặc trình độ
      </button>
      <div className="dictation-head">
        <div>
          <div className="eyebrow">
            {selectedTopic} · {selectedLevel}
          </div>
          <h1>{current.title}</h1>
          <p>Thực hiện đủ 4 bước để luyện nghe, chính tả và phát âm.</p>
          {current.sourceName && current.sourceUrl && (
            <p className="dictation-source">
              Nguồn:{" "}
              <a href={current.sourceUrl} target="_blank" rel="noreferrer">
                {current.sourceName}
              </a>
              {current.license && <span> · {current.license}</span>}
            </p>
          )}
        </div>
        <div className="dictation-score">{checked ? `${percent}%` : "—"}</div>
      </div>
      <div className="dictation-view-tabs">
        <button className={!showTranscript ? "active" : ""} onClick={() => setShowTranscript(false)}>
          Chép chính tả
        </button>
        <button className={showTranscript ? "active" : ""} onClick={() => setShowTranscript(true)}>
          Toàn bộ transcript
        </button>
      </div>
      {showTranscript ? (
        <section className="panel full-transcript">
          <div className="transcript-head">
            <div>
              <h3>
                {selectedTopic} · {selectedLevel}
              </h3>
              <p>{sentences.length} câu trong bài</p>
            </div>
            <button
              onClick={() => {
                window.speechSynthesis?.cancel();
                const full = new SpeechSynthesisUtterance(sentences.map((x) => x.sentence).join(" "));
                full.lang = "en-US";
                full.rate = rate;
                window.speechSynthesis?.speak(full);
              }}
            >
              ▶ Nghe toàn bài
            </button>
          </div>
          {sentences.map((item, i) => (
            <button
              key={item.id}
              onClick={() => {
                goTo(i);
                setShowTranscript(false);
              }}
            >
              <span>{i + 1}</span>
              <p>{item.sentence}</p>
            </button>
          ))}
        </section>
      ) : (
        <>
          <div className="sentence-nav">
            <button onClick={() => goTo(index - 1)}>‹</button>
            <b>
              {index + 1} / {sentences.length}
            </b>
            <button onClick={() => goTo(index + 1)}>›</button>
            <button className="settings-button" onClick={() => setShowSettings((v) => !v)}>
              ⚙ Cài đặt
            </button>
          </div>
          {showSettings && (
            <div className="dictation-settings">
              <label>
                Tự động phát lại
                <select value={autoReplay} onChange={(e) => setAutoReplay(Number(e.target.value))}>
                  <option value={0}>Không</option>
                  <option value={1}>1 lần</option>
                  <option value={2}>2 lần</option>
                  <option value={3}>3 lần</option>
                </select>
              </label>
              <label>
                Khoảng nghỉ
                <select value={replayDelay} onChange={(e) => setReplayDelay(Number(e.target.value))}>
                  <option value={0.5}>0.5 giây</option>
                  <option value={1}>1 giây</option>
                  <option value={1.5}>1.5 giây</option>
                  <option value={2}>2 giây</option>
                </select>
              </label>
              <p>
                <kbd>`</kbd> phát/ngừng · <kbd>Ctrl + Enter</kbd> nghe lại · <kbd>Enter</kbd> kiểm tra
              </p>
            </div>
          )}
          <div className="dictation-steps">
            <span className="active">
              <b>1</b> Nghe
            </span>
            <span className={plays ? "active" : ""}>
              <b>2</b> Gõ lại
            </span>
            <span className={checked ? "active" : ""}>
              <b>3</b> Kiểm tra
            </span>
            <span className={checked ? "active" : ""}>
              <b>4</b> Đọc to
            </span>
          </div>
          <section className="panel dictation-card">
            <div className="audio-control">
              <button className="dictation-play" onClick={speak}>
                ▶
              </button>
              <div>
                <b>Nghe câu tiếng Anh</b>
                <small>
                  {current.sourceName ? "Transcript mở · giọng đọc trình duyệt" : "Giọng đọc trình duyệt"} · Đã nghe {plays} lần
                </small>
              </div>
              <label>
                Tốc độ
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  <option value={0.65}>0.65×</option>
                  <option value={0.85}>0.85×</option>
                  <option value={1}>1.0×</option>
                </select>
              </label>
            </div>
            <textarea
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setChecked(false);
              }}
              placeholder="Gõ chính xác câu bạn nghe được…"
            />
            {!checked && (
              <div className="hint-panel">
                <div className="hint-words" aria-label="Gợi ý câu">
                  {expected.map((word, i) => (
                    <span className={i < hintCount ? "shown" : "hidden"} key={i}>
                      {i < hintCount ? word : "_".repeat(Math.min(8, Math.max(2, word.replace(/[^a-z]/gi, "").length)))}
                    </span>
                  ))}
                </div>
                <button disabled={hintCount >= expected.length} onClick={() => setHintCount((value) => Math.min(expected.length, value + 1))}>
                  💡 {hintCount ? "Gợi ý từ tiếp theo" : "Gợi ý một từ"}
                </button>
                <small>
                  Đã dùng {hintCount}/{expected.length} gợi ý
                </small>
              </div>
            )}
            <div className="dictation-actions">
              <button onClick={speak}>↻ Nghe lại</button>
              <button
                onClick={() => {
                  setChecked(true);
                }}
              >
                Bỏ qua
              </button>
              <button className="primary" disabled={!typed.trim()} onClick={() => setChecked(true)}>
                Kiểm tra
              </button>
            </div>
            {checked && (
              <div className={correct ? "correction correct" : "correction"}>
                <div className="correction-title">
                  <b>{correct ? "✓ Chính xác!" : "Xem và sửa những chỗ khác nhau"}</b>
                  <span>
                    {percent}% đúng · {hintCount} gợi ý
                  </span>
                </div>
                <div className="word-diff">
                  {expected.map((word, i) => (
                    <span className={normalizeAnswer(word) === normalizeAnswer(actual[i] || "") ? "ok" : "wrong"} key={i}>
                      {word}
                    </span>
                  ))}
                </div>
                {typed && !correct && (
                  <p>
                    Bạn viết: <del>{typed}</del>
                  </p>
                )}
                <div className="read-aloud">
                  <span>④</span>
                  <p>
                    <b>Đọc câu này thành tiếng</b>
                    <br />
                    Đọc chậm một lần, sau đó nhấn nghe mẫu và đọc theo đúng nhịp.
                  </p>
                  <button onClick={speak}>◖)) Nghe mẫu</button>
                </div>
                <button className="primary next-dictation" onClick={next}>
                  Câu tiếp theo →
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stats({ words, scopeLabel }: { words: WordCard[]; scopeLabel: string }) {
  const boxes = [1, 2, 3, 4, 5, 6].map((box) => ({
    box,
    count: words.filter((w) => w.box === box).length,
  }));
  const max = Math.max(1, ...boxes.map((b) => b.count));
  return (
    <div className="page">
      <div className="eyebrow">TIẾN ĐỘ CỦA BẠN</div>
      <h1>Thống kê</h1>
      <p className="page-sub">Tổng quan được tính trực tiếp trên {scopeLabel.toLowerCase()}.</p>
      <div className="stats-grid stats-overview">
        <Stat label="Tổng từ" value={String(words.length)} note={`Đang tính trên ${scopeLabel}`} icon="▤" tone="purple" />
        <Stat label="Đã thuộc" value={String(words.filter((w) => wordState(w).key === "mastered").length)} note="Hộp 6" icon="✓" tone="green" />
        <Stat label="Từ cứng đầu" value={String(words.filter((w) => w.lapses >= 4).length)} note="Quên từ 4 lần" icon="♨" tone="pink" />
        <Stat label="Đến hạn" value={String(words.filter(isDueForReview).length)} note="Cần ôn hôm nay" icon="◔" tone="orange" />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <h3>Phân bố theo hộp Leitner</h3>
          <div className="bar-chart">
            {boxes.map((b) => (
              <div key={b.box}>
                <span>{b.count}</span>
                <i style={{ height: `${Math.max(8, (b.count / max) * 170)}px` }} />
                <b>Hộp {b.box}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h3>Từ cần chú ý nhất</h3>
          {words
            .slice()
            .sort((a, b) => b.lapses - a.lapses)
            .slice(0, 6)
            .map((w) => (
              <div className="tough-row" key={w.id}>
                <span className="word-dot">{w.term[0].toUpperCase()}</span>
                <span>
                  <b>{w.term}</b>
                  <small>{w.meaning}</small>
                </span>
                <span className="lapse">{w.lapses} lần</span>
              </div>
            ))}
        </section>
      </div>
    </div>
  );
}

function AddWord({ close, save }: { close: () => void; save: (w: Omit<WordCard, "id" | "box" | "lapses">) => void }) {
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const [example, setExample] = useState("");
  const [exampleVi, setExampleVi] = useState("");
  const [topic, setTopic] = useState("Từ vựng chung");
  const [ipa, setIpa] = useState("");
  const [partOfSpeech, setPartOfSpeech] = useState("");
  const [definition, setDefinition] = useState("");
  const [studyDay, setStudyDay] = useState(() => weekdayIndex());
  const [loading, setLoading] = useState(false);
  const [lookupMessage, setLookupMessage] = useState("");
  const lookupRequest = useRef(0);
  async function enrich(value = term) {
    const word = value.trim().replace(/\s+/g, " ");
    const requestId = ++lookupRequest.current;
    if (!/^[a-z][a-z'\- ]{0,59}$/i.test(word)) {
      setLoading(false);
      setLookupMessage(word ? "Chỉ tra được nội dung gồm chữ cái, dấu nháy và gạch nối." : "");
      return;
    }
    setLoading(true);
    setLookupMessage("Đang tra từ điển và chọn chủ đề…");
    try {
      const response = await fetch("/api/ai/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: word }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (requestId !== lookupRequest.current || data.term?.toLowerCase() !== word.toLowerCase()) return;
      setIpa(data.ipa || "");
      setPartOfSpeech(data.part_of_speech || "");
      setMeaning(data.meaning_vi || "");
      setDefinition(data.definition_en || "");
      setExample(data.example || "");
      setExampleVi(data.example_vi || "");
      setTopic(data.topic || "Từ vựng chung");
      setLookupMessage(
        data.partial
          ? "✓ Đã điền từ dữ liệu của từng từ. Cụm từ không có mục từ riêng nên phần định nghĩa là nghĩa từng từ — hãy sửa lại cho đúng ngữ cảnh."
          : data.example_source === "template"
            ? "✓ Đã tự động điền. Từ điển không có câu ví dụ cho từ này — hãy thay câu ví dụ bằng ngữ cảnh của riêng bạn."
            : "✓ Đã tự động điền kèm câu ví dụ thật từ từ điển — hãy kiểm tra trước khi lưu.",
      );
    } catch (error) {
      if (requestId !== lookupRequest.current) return;
      setLookupMessage(error instanceof Error ? error.message : "Không thể tra từ.");
    } finally {
      if (requestId === lookupRequest.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (!/^[a-z][a-z'\- ]{1,59}$/i.test(term.trim())) return;
    const timer = setTimeout(() => void enrich(term), 800);
    return () => clearTimeout(timer);
  }, [term]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!term || !meaning) return;
    save({
      term,
      meaning,
      example: example || naturalExample(term),
      exampleVi: exampleVi || (example ? "" : naturalExampleVi(term)),
      cloze: (example || naturalExample(term)).replace(new RegExp(term, "i"), "_____"),
      ipa: ipa || "/…/",
      partOfSpeech,
      definition: definition || "Bổ sung định nghĩa Anh–Anh sau.",
      topic,
      addedDate: localDateString(),
      studyDay,
      status: "new",
      reviewCount: 0,
    });
  }
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">THÊM NHANH</span>
            <h2>Từ mới của bạn</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <label>
          Từ hoặc cụm từ tiếng Anh
          <input
            value={term}
            onChange={(e) => {
              // Gõ tiếp làm kết quả đang chờ trở nên vô hiệu, phải tắt luôn trạng thái đang tải.
              lookupRequest.current++;
              setLoading(false);
              setLookupMessage("");
              setTerm(e.target.value);
            }}
            placeholder="Ví dụ: meaningful hoặc take for granted"
          />
        </label>
        <button className="ai-fill" type="button" disabled={loading || !term} onClick={() => void enrich()}>
          {loading ? "◌ Đang tự động điền…" : "✦ Tra và tự động điền"}
        </button>
        {lookupMessage && <p className={lookupMessage.startsWith("✓") ? "lookup-message success" : "lookup-message"}>{lookupMessage}</p>}
        <div className="form-grid">
          <label>
            Nghĩa tiếng Việt
            <input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder="Tự động điền nghĩa..." />
          </label>
          <label>
            Ngày học
            <select value={studyDay} onChange={(e) => setStudyDay(Number(e.target.value))}>
              {dayNames.map((name, index) => (
                <option value={index} key={name}>
                  {String(index + 1).padStart(2, "0")} {name}
                  {index === weekdayIndex() ? " (hôm nay)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chủ đề
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option>Từ vựng chung</option>
              <option>Đời sống</option>
              <option>Công nghệ</option>
              <option>Cảm xúc</option>
              <option>Động vật</option>
              <option>Khoa học</option>
              <option>Công việc</option>
              <option>Giao tiếp</option>
            </select>
          </label>
          <label>
            Loại từ
            <input value={partOfSpeech} onChange={(e) => setPartOfSpeech(e.target.value)} placeholder="noun, verb, adjective…" />
          </label>
          <label>
            Phát âm IPA
            <input value={ipa} onChange={(e) => setIpa(e.target.value)} placeholder="/…/" />
          </label>
        </div>
        <label>
          Định nghĩa Anh–Anh
          <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder="English definition" />
        </label>
        <label>
          Câu ví dụ
          <textarea value={example} onChange={(e) => setExample(e.target.value)} placeholder="Một câu trong ngữ cảnh tự nhiên" />
        </label>
        <label>
          Nghĩa câu ví dụ
          <textarea value={exampleVi} onChange={(e) => setExampleVi(e.target.value)} placeholder="Bản dịch tiếng Việt của câu ví dụ" />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Hủy
          </button>
          <button className="primary" type="submit" disabled={loading}>
            Lưu từ mới
          </button>
        </div>
      </form>
    </div>
  );
}

function AuthModal({ close }: { close: () => void }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !email) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMessage(error ? error.message : "Đã gửi liên kết đăng nhập. Hãy kiểm tra email của bạn.");
    setBusy(false);
  }
  async function logout() {
    await supabase?.auth.signOut();
    location.reload();
  }
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form className="modal auth-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={login}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">TÀI KHOẢN</span>
            <h2>Đăng nhập Lexilo</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <p className="auth-copy">Nhận liên kết đăng nhập qua email để dùng cùng một kho từ vựng trên mọi thiết bị.</p>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@example.com" />
        </label>
        {message && <p className="auth-message">{message}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => void logout()}>
            Đăng xuất phiên hiện tại
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Đang gửi…" : "Gửi liên kết đăng nhập"}
          </button>
        </div>
      </form>
    </div>
  );
}
