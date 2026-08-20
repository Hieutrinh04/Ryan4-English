"use client";

import { Dispatch, FormEvent, PointerEvent as ReactPointerEvent, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { aiFetch, supabase } from "../lib/supabase";
import { dictationLessons, dictationLevels, dictationTopics, type DictationLesson, type DictationLevel } from "../lib/dictation-lessons";
import ieltsAreaData from "../lib/ielts-areas.json";
import ShadowingPractice from "../components/Shadowing";
import VocabPractice from "../components/VocabPractice";
import Dictionary, { type NewWord } from "../components/Dictionary";
// Kết quả chấm bài của Gemini. Khác cách so câu mẫu: cách dịch đúng nhưng khác câu
// mẫu vẫn được công nhận đúng.
type AiGrade = { correct: boolean; score: number; suggestion: string; comment: string; issues: { type: string; wrong: string; right: string; why: string }[] };
import { PASSAGE_SIZE, buildPassages, gradeTranslation } from "../lib/translation-check.mjs";
import { SKILLS, logPractice, minutesInRange, minutesPerDay, readPractice, totalTime } from "../lib/practice-log.mjs";
import { levelFor, xpBreakdown, xpFrom } from "../lib/level.mjs";
import { attemptAdvice, attemptsSince, logAttempt, makeAttempt, readAttempts, summariseAttempts,
  typesFromIssues, typesFromNotes } from "../lib/error-log.mjs";
import { pushTranslationAttempt } from "../lib/cloud-sync";
// Một dòng nhật ký bài dịch. lib/error-log.mjs là JavaScript nên kiểu khai báo ở đây.
type TranslationAttempt = { at: string; day: string; term: string; vi: string; answer: string; reference: string;
  score: number; correct: boolean; gradedBy: "llm" | "reference"; errorTypes: string[] };
import { advice, byDay, entriesSince, summarise, weakest } from "../lib/review-log.mjs";
// Lịch ôn và các phép tính ngày: nguồn duy nhất ở lib/srs.mjs, giao diện chỉ gọi.
import { daysUntil, isDueForReview, localDateString, scheduleFor, streakFrom, weekdayIndex, wordState } from "../lib/srs.mjs";
import { clozeFor } from "../lib/cloze.mjs";
// Kiểu dùng chung và tầng lưu trữ đã tách khỏi file này.
import { detailsFrom, exampleFor, fallbackExample, fallbackExampleVi, isPdfVocabulary, isSeedWord, withMeanings,
  type EnrichmentMap, type ExamGoal, type ExampleMap, type ImportedVocabulary, type Rating, type ReviewMode,
  type UsageDetail, type UsageMap, type WeeklyVocabulary, type WordCard } from "../lib/types";
import { activeTabKey, composeVietnamese, logReview, markDeleted, markStudiedToday, mergeStoredWords, readDeletedIds,
  readExam, readLocalWords, readReviewLog, readSession, readSpeaking, readStudyDays, speakingMinutes, weeklyImportKey, writeExam, writeLocalWords,
  writeProgress, writeSession, type ReviewEntry, type StoredSession } from "../lib/storage";

// Kiểu thẻ trong phiên ôn. "mixed" xoay vòng 4 kiểu còn lại theo thứ tự thẻ.
const reviewModes: { value: ReviewMode; label: string }[] = [
  { value: "card", label: "Thẻ ghi nhớ" },
  { value: "vi_en", label: "Việt → Anh" },
  { value: "en_vi", label: "Anh → Việt" },
  { value: "quiz", label: "Trắc nghiệm" },
  { value: "listen", label: "Nghe viết" },
  { value: "mixed", label: "Trộn" },
];
// "Trộn" chỉ đảo giữa các kiểu có chấm điểm; thẻ ghi nhớ là kiểu xem lại tự do nên đứng ngoài.
const rotatingModes: ReviewMode[] = ["vi_en", "en_vi", "quiz", "listen"];
const DAILY_REVIEW_LIMIT = 30;
const DAILY_NEW_LIMIT = 8;
const PDF_DAILY_PREVIEW_LIMIT = 20;

// Câu ví dụ mặc định, chỉ dùng cho từ chưa có câu riêng.


// Khoét chỗ trống tại từ đang học. Nhiều từ khóa trong file PDF dính nhiễu OCR
// ("white (n, adj)", "bus bicycle") nên phải thử dần từ chuỗi đầy đủ tới từng từ thành phần.

const naturalExample = (term: string) => `I am learning how to use ${term} naturally.`;
const naturalExampleVi = (term: string) => `Tôi đang học cách dùng từ “${term}” một cách tự nhiên.`;

// Nguồn duy nhất tính hộp Leitner và khoảng ôn tiếp theo, dùng chung cho nút đánh giá và lúc lưu.


// Ngày theo lịch của máy người dùng. toISOString() trả về ngày UTC, ở GMT+7 sẽ lùi một ngày
// trong khoảng 00:00–07:00 sáng, khiến từ bị xếp nhầm sang thứ hôm trước.

// 0 = Thứ Hai … 6 = Chủ Nhật, khớp thứ tự dayNames.


// Từ do người dùng thêm được giữ lại trên máy, để mất kết nối Supabase cũng không mất dữ liệu khi tải lại trang.


// Câu ví dụ do app tự dựng lúc nhập (chưa tra từ điển) phải được coi như ô trống,
// nếu không thì "Dán danh sách" tạo ra cả trăm từ dùng chung một khuôn câu và
// mergeEnrichment sẽ giữ nguyên vì thấy ô đã có chữ.
function isGeneratedExample(word: WordCard) {
  const example = word.example?.trim();
  if (!example) return true;
  return example === naturalExample(word.term) || example === fallbackExample(word.term);
}

// Từ thêm từ trước khi có các trường mới (cụm, đồng/trái nghĩa, chủ đề IELTS…) sẽ thiếu dữ liệu.
function missingFields(word: WordCard) {
  const missing: string[] = [];
  if (isGeneratedExample(word)) missing.push("câu ví dụ thật");
  if (!word.meaning?.trim() || word.meaning === "Chưa bổ sung nghĩa" || word.meaning === "Chưa có nghĩa") missing.push("nghĩa tiếng Việt");
  if (!word.ipa || word.ipa === "/…/") missing.push("ipa");
  if (!word.definition?.trim()) missing.push("định nghĩa");
  if (!word.exampleVi?.trim()) missing.push("nghĩa câu ví dụ");
  if (!word.collocation?.trim() || !word.collocationVi?.trim()) missing.push("cụm nên học");
  if (!word.synonyms?.length) missing.push("đồng nghĩa");
  if (!word.related?.length) missing.push("từ cùng chủ đề");
  if (word.synonyms?.length && !word.synonymDetails?.length) missing.push("ngữ cảnh từ đồng nghĩa");
  if (word.antonyms?.length && !word.antonymDetails?.length) missing.push("ngữ cảnh từ trái nghĩa");
  if (word.related?.length && !word.relatedDetails?.length) missing.push("ngữ cảnh từ cùng chủ đề");
  if (!word.paraphrases?.length) missing.push("paraphrase");
  if (!word.ieltsTopics?.length) missing.push("chủ đề IELTS");
  return missing;
}
function needsEnrichment(word: WordCard) {
  const missingMeaning = !word.meaning?.trim() || word.meaning === "Chưa bổ sung nghĩa" || word.meaning === "Chưa có nghĩa";
  const missingUsageDetails = (!!word.synonyms?.length && !word.synonymDetails?.length) || (!!word.antonyms?.length && !word.antonymDetails?.length) || (!!word.related?.length && !word.relatedDetails?.length);
  return !isPdfVocabulary(word) && !isSeedWord(word) && (missingMeaning || missingUsageDetails || (!word.enrichmentCheckedAt && missingFields(word).length > 0));
}
// Một nghĩa trong từ điển, kèm bản dịch tiếng Việt để người dùng đọc mà chọn.
type DictionarySense = { index: number; part_of_speech?: string; definition_en?: string; definition_vi?: string; example?: string };
type EnrichPayload = {
  meaning_vi?: string;
  sense?: number;
  senses?: DictionarySense[];
  ipa?: string;
  part_of_speech?: string;
  definition_en?: string;
  example?: string;
  example_vi?: string;
  collocation?: string;
  collocation_vi?: string;
  synonyms?: string[];
  antonyms?: string[];
  related?: string[];
  synonym_details?: UsageDetail[];
  antonym_details?: UsageDetail[];
  related_details?: UsageDetail[];
  paraphrases?: string[];
  ielts_topics?: string[];
};
// Chỉ đắp vào ô đang trống — không bao giờ đè lên nội dung người dùng đã tự sửa.
function mergeEnrichment(word: WordCard, data: EnrichPayload): WordCard {
  // Dữ liệu tra về đi thẳng vào state rồi xuống máy, không qua mergeStoredWords,
  // nên phải tự ghép dấu tiếng Việt ở đây.
  return composeVietnamese(mergeEnrichmentRaw(word, data));
}
function mergeEnrichmentRaw(word: WordCard, data: EnrichPayload): WordCard {
  const keepText = (current: string | undefined, incoming: string | undefined, placeholder?: string) => (current?.trim() && current !== placeholder ? current : (incoming?.trim() ?? current ?? ""));
  const keepList = (current: string[] | undefined, incoming: string[] | undefined) => (current?.length ? current : (incoming ?? []));
  // Câu khuôn do app tự dựng thì cho phép thay; câu người dùng tự viết thì giữ nguyên.
  const templated = isGeneratedExample(word);
  const example = templated ? (data.example?.trim() || word.example || "") : word.example;
  const exampleVi = templated ? (data.example_vi?.trim() || word.exampleVi || "") : keepText(word.exampleVi, data.example_vi);
  return {
    ...word,
    enrichmentCheckedAt: new Date().toISOString(),
    meaning: keepText(word.meaning, data.meaning_vi, word.meaning === "Chưa có nghĩa" ? "Chưa có nghĩa" : "Chưa bổ sung nghĩa"),
    ipa: keepText(word.ipa, data.ipa, "/…/") || "/…/",
    partOfSpeech: word.partOfSpeech?.trim() ? word.partOfSpeech : (data.part_of_speech ?? ""),
    definition: keepText(word.definition, data.definition_en),
    example,
    exampleVi,
    // Câu đổi thì chỗ trống phải khoét lại theo câu mới.
    cloze: templated && example !== word.example ? clozeFor(word.term, example) : word.cloze?.includes("_____") ? word.cloze : clozeFor(word.term, example),
    collocation: keepText(word.collocation, data.collocation),
    collocationVi: keepText(word.collocationVi, data.collocation_vi),
    synonyms: keepList(word.synonyms, data.synonyms),
    antonyms: keepList(word.antonyms, data.antonyms),
    related: keepList(word.related, data.related),
    synonymDetails: word.synonymDetails?.length ? word.synonymDetails : (data.synonym_details ?? []),
    antonymDetails: word.antonymDetails?.length ? word.antonymDetails : (data.antonym_details ?? []),
    relatedDetails: word.relatedDetails?.length ? word.relatedDetails : (data.related_details ?? []),
    paraphrases: keepList(word.paraphrases, data.paraphrases),
    ieltsTopics: keepList(word.ieltsTopics, data.ielts_topics),
  };
}

// Một dòng dạng "flew (v): đã bay" hoặc "rescue: giải thoát" — kiểu ghi chép tay phổ biến nhất.
function parseTermLine(line: string): Omit<WordCard, "id" | "lapses"> | null {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  const left = line.slice(0, separator).trim();
  const meaning = line.slice(separator + 1).trim();
  if (!left || !meaning) return null;
  const partMatch = left.match(/\(([^)]*)\)\s*$/);
  const term = (partMatch ? left.slice(0, partMatch.index).trim() : left).replace(/\s+/g, " ");
  if (!term) return null;
  return {
    term,
    partOfSpeech: partMatch ? partMatch[1].trim() : "",
    ipa: "/…/",
    meaning,
    example: naturalExample(term),
    exampleVi: naturalExampleVi(term),
    cloze: clozeFor(term, naturalExample(term)),
    definition: "",
    topic: "Từ vựng chung",
    box: 1,
    status: "new",
    reviewCount: 0,
    addedDate: localDateString(),
  };
}



function weeklyWordCards(items: WeeklyVocabulary[], examples: ExampleMap): WordCard[] {
  return items.map((item) => ({
    ...item,
    ipa: "/…/",
    example: examples[item.term.trim().toLowerCase()]?.[0] || naturalExample(item.term),
    exampleVi: examples[item.term.trim().toLowerCase()]?.[1] || naturalExampleVi(item.term),
    cloze: clozeFor(item.term, examples[item.term.trim().toLowerCase()]?.[0] || naturalExample(item.term)),
    definition: "",
    box: 1,
    lapses: 0,
    status: "new" as const,
    reviewCount: 0,
  }));
}

function takeWeeklyImport(items: WeeklyVocabulary[], examples: ExampleMap) {
  try {
    const existingByTerm = new Map(readLocalWords().map((word) => [word.term.trim().toLowerCase(), word]));
    const deletedIds = readDeletedIds();
    // Luôn bù các mục còn thiếu. Cách này tự phục hồi nếu một lần nạp trước chỉ kịp ghi
    // dấu hoàn tất nhưng chưa kịp lưu từ. Nếu từ đã tồn tại, giữ tiến độ/nội dung đã học
    // nhưng đưa nó về đúng folder của workbook thay vì tạo một bản trùng.
    const fresh = weeklyWordCards(items, examples)
      .filter((word) => !deletedIds.has(word.id) || existingByTerm.has(word.term.trim().toLowerCase()))
      .map((word) => {
        const existing = existingByTerm.get(word.term.trim().toLowerCase());
        // Kho câu của workbook đã được rà soát riêng; luôn sửa câu hệ thống cũ của
        // chính bộ Excel, đồng thời giữ nguyên tiến độ và các trường đã bổ sung khác.
        return existing ? { ...word, ...existing, example: word.example, exampleVi: word.exampleVi, cloze: word.cloze, studyDay: word.studyDay, source: word.source, topic: "Từ vựng chung" } : word;
      });
    localStorage.setItem(weeklyImportKey, JSON.stringify({ importedAt: new Date().toISOString(), count: fresh.length }));
    return fresh;
  } catch {
    return weeklyWordCards(items, examples);
  }
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
  // Luôn khởi tạo "home" để HTML dựng sẵn khớp với client; trang đã lưu được khôi phục sau khi hydrate.
  const [tab, setTab] = useState<"home" | "words" | "practice" | "stats" | "dictionary">("home");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [reviewing, setReviewing] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<WordCard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [index, setIndex] = useState(0);
  const [words, setWords] = useState(initialWords);
  const [showAdd, setShowAdd] = useState(false);
  // Menu thêm từ: gộp ba lối thêm vào một nút thay vì xếp chồng từng nút một.
  const [addMenu, setAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenu) return;
    const onPointer = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenu(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [addMenu]);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  // Chế độ luyện tập chọn thẳng từ thanh bên; null nghĩa là trang công cụ ngoài.
  const [practiceIntent, setPracticeIntent] = useState<Exclude<PracticeMode, "menu"> | null>(null);
  // Rời khỏi mục luyện tập thì bỏ chế độ đang chọn, để lần sau quay lại không nhảy
  // thẳng vào chế độ cũ một cách bất ngờ.
  const goTab = (next: typeof tab) => {
    setPracticeIntent(null);
    setTab(next);
  };
  const [detailWord, setDetailWord] = useState<WordCard | null>(null);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [reviewMode, setReviewMode] = useState<ReviewMode>("vi_en");
  const [choice, setChoice] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<"connecting" | "synced" | "demo">("connecting");
  const [userId, setUserId] = useState<string | null>(null);
  // Bản sao dạng ref để handler onAuthStateChange (đăng ký một lần) luôn đọc được id hiện tại.
  const userIdRef = useRef<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pendingSession, setPendingSession] = useState<StoredSession | null>(null);
  const [backfill, setBackfill] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [exam, setExam] = useState<ExamGoal | null>(null);
  const [studyDays, setStudyDays] = useState<string[]>([]);
  // Điểm số của phiên đang chạy, dùng để quyết định có chúc mừng ở màn tổng kết hay không.
  const [sessionRatings, setSessionRatings] = useState<Rating[]>([]);
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

  // Chủ đề chỉ đọc được sau khi hydrate: nếu đọc localStorage lúc khởi tạo state thì HTML
  // dựng sẵn (luôn "dark") sẽ khác client và React báo lỗi hydration.
  useEffect(() => {
    const saved = localStorage.getItem("lexilo:theme");
    const nextTheme = saved === "light" ? "light" : "dark";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đồng bộ một lần với localStorage, không tạo vòng lặp render
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);
  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("lexilo:theme", next);
      return next;
    });
  }

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
    async function loadEnrichment(): Promise<EnrichmentMap> {
      try {
        const response = await fetch("/vocabulary-enrichment.json");
        return response.ok ? ((await response.json()) as EnrichmentMap) : {};
      } catch {
        return {};
      }
    }
    async function loadUsage(): Promise<UsageMap> {
      try {
        const response = await fetch("/usage-details.json");
        return response.ok ? ((await response.json()) as UsageMap) : {};
      } catch {
        return {};
      }
    }
    async function loadLocalVocabulary() {
      const [response, weeklyResponse, weeklyExamplesResponse, examples, extras, usage] = await Promise.all([fetch("/vocabulary-1000.json"), fetch("/weekly-vocabulary.json"), fetch("/weekly-examples.json"), loadExamples(), loadEnrichment(), loadUsage()]);
      const vocabulary = (await response.json()) as ImportedVocabulary[];
      const weeklyVocabulary = weeklyResponse.ok ? ((await weeklyResponse.json()) as WeeklyVocabulary[]) : [];
      const weeklyExamples = weeklyExamplesResponse.ok ? ((await weeklyExamplesResponse.json()) as ExampleMap) : {};
      if (!active) return;
      setWords(
        mergeStoredWords([...takeWeeklyImport(weeklyVocabulary, weeklyExamples), ...vocabulary.map((item) => {
          const { example, exampleVi } = exampleFor(item.term, examples);
          const extra = extras[item.term.trim().toLowerCase()];
          return {
            id: `pdf-${item.number}`,
            term: item.term,
            ipa: item.ipa || "/…/",
            meaning: item.meaning,
            example,
            exampleVi,
            cloze: clozeFor(item.term, example),
            definition: extra?.definition || "Vocabulary imported from the MochiMochi topic list.",
            topic: item.topic,
            box: 1,
            lapses: 0,
            partOfSpeech: item.partOfSpeech,
            status: "new" as const,
            reviewCount: 0,
            source: item.source,
            synonyms: extra?.synonyms ?? [],
            antonyms: extra?.antonyms ?? [],
            related: extra?.related ?? [],
            ieltsTopics: extra?.ieltsTopics ?? [],
            collocation: extra?.collocation ?? "",
            collocationVi: extra?.collocationVi ?? "",
            paraphrases: extra?.paraphrases ?? [],
            synonymDetails: detailsFrom(extra?.synonyms, usage),
            antonymDetails: detailsFrom(extra?.antonyms, usage),
          };
        })]),
      );
    }
    async function connect() {
      if (!supabase) {
        await loadLocalVocabulary();
        setCloudStatus("demo");
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        await loadLocalVocabulary();
        if (active) setCloudStatus("demo");
        return;
      }
      setUserId(session.user.id);
      userIdRef.current = session.user.id;
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
        const [vocabularyResponse, examples, extras, usage] = await Promise.all([fetch("/vocabulary-1000.json"), loadExamples(), loadEnrichment(), loadUsage()]);
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
                definition_en: extras[item.term.trim().toLowerCase()]?.definition || "Vocabulary imported from the MochiMochi topic list.",
                example: exampleFor(item.term, examples).example,
                example_vi: exampleFor(item.term, examples).exampleVi,
                example_cloze: clozeFor(item.term, exampleFor(item.term, examples).example),
                topic: item.topic,
                source: item.source,
                note: `Mục số ${item.number} trong tài liệu PDF`,
                synonyms: extras[item.term.trim().toLowerCase()]?.synonyms ?? [],
                antonyms: extras[item.term.trim().toLowerCase()]?.antonyms ?? [],
                related: extras[item.term.trim().toLowerCase()]?.related ?? [],
                ielts_topics: extras[item.term.trim().toLowerCase()]?.ieltsTopics ?? [],
                collocation: extras[item.term.trim().toLowerCase()]?.collocation ?? null,
                collocation_vi: extras[item.term.trim().toLowerCase()]?.collocationVi ?? null,
                paraphrases: extras[item.term.trim().toLowerCase()]?.paraphrases ?? [],
                synonym_details: detailsFrom(extras[item.term.trim().toLowerCase()]?.synonyms, usage),
                antonym_details: detailsFrom(extras[item.term.trim().toLowerCase()]?.antonyms, usage),
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
      try {
        const localPersonal = readLocalWords().filter((word) => !isPdfVocabulary(word) && !isSeedWord(word));
        const existingTerms = new Set(cloudWords.map((row) => String(row.term).trim().toLowerCase()));
        const missingPersonal = localPersonal.filter((word) => !existingTerms.has(word.term.trim().toLowerCase()));
        for (const word of missingPersonal) {
          const { data: inserted, error: insertError } = await supabase.from("words").insert({
            id: word.id,
            user_id: session.user.id,
            term: word.term,
            part_of_speech: word.partOfSpeech || null,
            ipa: word.ipa,
            meaning_vi: word.meaning,
            definition_en: word.definition || null,
            example: word.example,
            example_vi: word.exampleVi || null,
            example_cloze: word.cloze,
            topic: word.topic,
            note: word.note || null,
            collocation: word.collocation || null,
            collocation_vi: word.collocationVi || null,
            synonyms: word.synonyms || [],
            antonyms: word.antonyms || [],
            related: word.related || [],
            synonym_details: word.synonymDetails || [],
            antonym_details: word.antonymDetails || [],
            related_details: word.relatedDetails || [],
            paraphrases: word.paraphrases || [],
            ielts_topics: word.ieltsTopics || [],
            study_day: word.studyDay ?? null,
            is_starred: !!word.starred,
          }).select().single();
          if (insertError) throw insertError;
          const { error: stateError } = await supabase.from("word_states").insert(
            ["vi_en", "en_vi"].map((direction) => ({
              word_id: inserted.id,
              user_id: session.user.id,
              direction,
              box: word.box || 1,
              interval_days: word.intervalDays || 0,
              due_date: word.dueDate || localDateString(),
              review_count: word.reviewCount || 0,
              lapse_count: word.lapses || 0,
              status: word.status || "new",
              last_reviewed_at: word.lastReviewedAt || null,
            })),
          );
          if (stateError) throw stateError;
          cloudWords = [inserted, ...cloudWords];
        }
      } catch (migrationError) {
        console.error("Không thể chuyển từ cá nhân trên máy lên tài khoản", migrationError);
      }
      const mappedCloudWords = cloudWords.map((row) => {
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
              collocation: row.collocation ?? "",
            collocationVi: row.collocation_vi ?? "",
              synonyms: row.synonyms ?? [],
              antonyms: row.antonyms ?? [],
            related: row.related ?? [],
              synonymDetails: row.synonym_details ?? [],
              antonymDetails: row.antonym_details ?? [],
              relatedDetails: row.related_details ?? [],
              paraphrases: row.paraphrases ?? [],
              ieltsTopics: row.ielts_topics ?? [],
              addedDate: row.created_at?.slice(0, 10),
              studyDay: typeof row.study_day === "number" ? row.study_day : undefined,
              lastReviewedAt: state?.last_reviewed_at,
              source: row.source ?? "",
              enrichmentCheckedAt: row.enrichment_checked_at ?? undefined,
            };
          });
      // Luôn hợp nhất dữ liệu trên máy, kể cả khi cloud trả về rỗng hoặc chỉ có bộ PDF.
      // Nếu không làm vậy, từ cá nhân có thể biến mất khỏi giao diện sau khi phiên ẩn danh thay đổi.
      const [weeklyResponse, weeklyExamplesResponse] = await Promise.all([fetch("/weekly-vocabulary.json"), fetch("/weekly-examples.json")]);
      const weeklyVocabulary = weeklyResponse.ok ? ((await weeklyResponse.json()) as WeeklyVocabulary[]) : [];
      const weeklyExamples = weeklyExamplesResponse.ok ? ((await weeklyExamplesResponse.json()) as ExampleMap) : {};
      const weeklyTerms = new Set(weeklyVocabulary.map((word) => word.term.trim().toLowerCase()));
      const correctedCloudWords = mappedCloudWords.map((word) => {
        const pair = weeklyExamples[word.term.trim().toLowerCase()];
        if (!pair || (!word.source?.endsWith(".xlsx") && !weeklyTerms.has(word.term.trim().toLowerCase()))) return word;
        return { ...word, example: pair[0], exampleVi: pair[1], cloze: clozeFor(word.term, pair[0]) };
      });
      const cloudTerms = new Set(correctedCloudWords.map((word) => word.term.trim().toLowerCase()));
      setWords(mergeStoredWords([...takeWeeklyImport(weeklyVocabulary, weeklyExamples).filter((word) => !cloudTerms.has(word.term.trim().toLowerCase())), ...correctedCloudWords]));
      setCloudStatus("synced");
    }
    connect().finally(() => {
      if (!active) return;
      // Khôi phục ở đây (sau khi hydrate) thay vì lúc khởi tạo state, nếu không HTML dựng sẵn
      // sẽ là "home" còn client là trang đã lưu — React báo lỗi hydration.
      const savedTab = localStorage.getItem(activeTabKey);
      if (savedTab === "words" || savedTab === "practice" || savedTab === "stats") setTab(savedTab);
      setPendingSession(readSession());
      setExam(readExam());
      setStudyDays(readStudyDays());
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextId = session?.user?.id ?? null;
      // Supabase phát lại SIGNED_IN mỗi lần tab được focus để làm mới token. Nếu cứ thế tải lại
      // thì rời tab rồi quay lại là mất trang đang xem — chỉ tải lại khi danh tính thật sự đổi.
      const changedAccount = event === "SIGNED_IN" && !!userIdRef.current && !!nextId && nextId !== userIdRef.current;
      if (event === "SIGNED_OUT" || changedAccount) window.location.reload();
      else if (nextId) userIdRef.current = nextId;
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Chỉ ghi sau khi đã khôi phục xong, nếu không giá trị "home" ban đầu sẽ đè lên trang đã lưu.
    if (!hydrated) return;
    try {
      localStorage.setItem(activeTabKey, tab);
    } catch {
      // Trình duyệt chặn lưu trữ — bỏ qua.
    }
  }, [tab, hydrated]);

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
  // Tra lại lần lượt từng từ còn thiếu dữ liệu và đắp vào các ô trống.
  // Chạy tuần tự có giãn nhịp vì mỗi lần tra gọi tới từ điển, Datamuse và dịch máy.
  // Không truyền gì thì quét cả kho; truyền danh sách thì chỉ tra đúng những từ đó
  // (dùng ngay sau khi dán danh sách, lúc state chưa kịp cập nhật).
  async function fillMissingFields(only?: WordCard[]) {
    const targets = (only ?? words).filter(needsEnrichment);
    if (!targets.length || backfill) return;
    setBackfill({ done: 0, total: targets.length, failed: 0 });
    let failed = 0;
    for (const [position, word] of targets.entries()) {
      try {
        const response = await fetch("/api/ai/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term: word.term, part_of_speech: word.partOfSpeech }),
        });
        const data = (await response.json()) as EnrichPayload & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Tra từ thất bại");
        const enriched = mergeEnrichment(word, data);
        setWords((current) => current.map((item) => (item.id === word.id ? mergeEnrichment(item, data) : item)));
        // setWords được lưu xuống máy bởi effect phía trên; tài khoản đã đăng nhập cần
        // cập nhật trực tiếp lên cloud để lần tải lại không lấy bản cũ từ database đè lên.
        if (supabase && userIdRef.current) {
          const cloudPayload = {
              ipa: enriched.ipa,
              meaning_vi: enriched.meaning,
              part_of_speech: enriched.partOfSpeech || null,
              definition_en: enriched.definition || null,
              example: enriched.example,
              example_vi: enriched.exampleVi || null,
              example_cloze: enriched.cloze,
              collocation: enriched.collocation || null,
              collocation_vi: enriched.collocationVi || null,
              synonyms: enriched.synonyms || [],
              antonyms: enriched.antonyms || [],
              related: enriched.related || [],
              synonym_details: enriched.synonymDetails || [],
              antonym_details: enriched.antonymDetails || [],
              related_details: enriched.relatedDetails || [],
              paraphrases: enriched.paraphrases || [],
              ielts_topics: enriched.ieltsTopics || [],
              updated_at: new Date().toISOString(),
          };
          const { error: saveError } = await supabase
            .from("words")
            .update({
              ...cloudPayload,
              enrichment_checked_at: enriched.enrichmentCheckedAt,
            })
            .eq("id", word.id);
          if (saveError) {
            // Database cũ có thể chưa chạy migration enrichment_checked_at. Vẫn lưu toàn bộ
            // nội dung vừa tra bằng các cột sẵn có và không báo nhầm là "không tra được".
            const legacyCloudPayload = Object.fromEntries(Object.entries(cloudPayload).filter(([column]) => !["synonym_details", "antonym_details", "related_details"].includes(column)));
            const { error: fallbackSaveError } = await supabase.from("words").update(legacyCloudPayload).eq("id", word.id);
            if (fallbackSaveError) console.error(`Đã tra xong nhưng chưa đồng bộ được “${word.term}”`, fallbackSaveError);
          }
        }
      } catch (error) {
        failed += 1;
        console.error(`Không bổ sung được dữ liệu cho “${word.term}”`, error);
      }
      setBackfill({ done: position + 1, total: targets.length, failed });
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    // Giữ kết quả trên màn hình một lúc cho người dùng đọc rồi mới ẩn.
    setTimeout(() => setBackfill(null), 4000);
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

  // Thẻ ghi nhớ đi tới lui tự do và không chấm điểm: hộp Leitner giữ nguyên, không
  // ghi nhật ký ôn tập. Đây là kiểu xem lại, coi nó là đã thuộc thì sai lịch ôn.
  // Vẫn tính là có học trong ngày để chuỗi ngày học không bị đứt oan.
  function stepCard(delta: number) {
    if (delta > 0) setStudyDays(markStudiedToday());
    setIndex((value) => Math.max(0, Math.min(reviewQueue.length, value + delta)));
    setRevealed(false);
    setAnswer("");
    setChoice(null);
    startedAt.current = Date.now();
  }

  // Xáo lại thứ tự hàng đợi và quay về thẻ đầu, như nút ⇄ bên Luyện tập.
  function shuffleQueue() {
    setReviewQueue((queue) => seededOrder(queue, Date.now() % 1000));
    setIndex(0);
    setRevealed(false);
    setAnswer("");
    setChoice(null);
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
        // Thẻ ghi nhớ lật được hai chiều; kiểu có chấm điểm thì chỉ mở đáp án một lần.
        setRevealed((value) => (activeMode === "card" ? !value : true));
      }
      if (activeMode === "card" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        stepCard(event.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (["1", "2", "3", "4"].includes(event.key)) {
        // Thẻ ghi nhớ không chấm điểm nên phím 1–4 không có tác dụng gì.
        if (activeMode === "card") return;
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
    setSessionRatings([]);
    startedAt.current = Date.now();
  }
  function startReview(dayIndex?: number | "pdf") {
    const belongsToPdf = isPdfVocabulary;
    if (dayIndex === "pdf") {
      launchReview(buildCollectionQueue(words.filter(belongsToPdf)));
      return;
    }
    const belongsToDay = (word: WordCard) => !belongsToPdf(word) && (dayIndex === undefined || addedDayIndex(word) === dayIndex);
    const candidates = words.filter(belongsToDay);
    const queue = dayIndex === undefined ? buildTodayQueue(candidates) : buildCollectionQueue(candidates);
    launchReview(queue);
  }
  function startTopicReview(topic: string) {
    launchReview(buildCollectionQueue(words.filter((word) => word.topic.split(" · ").includes(topic))));
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
      lastReviewedAt: new Date().toISOString(),
    };
    setWords((current) => current.map((word) => (word.id !== card.id ? word : updated)));
    // Ghi nhật ký trước khi state cập nhật, để còn biết hộp cũ và đây có phải lượt
    // ôn đầu tiên của từ này hay không.
    logReview({
      at: new Date().toISOString(),
      id: card.id,
      term: card.term,
      rating,
      boxBefore: card.box,
      boxAfter: after,
      firstTime: !(card.reviewCount ?? 0),
    });
    void persistReview(card, updated, rating, Date.now() - startedAt.current);
    setStudyDays(markStudiedToday());
    setSessionRatings((current) => [...current, rating]);
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
      collocation: word.collocation || null,
      collocation_vi: word.collocationVi || null,
      synonyms: word.synonyms || [],
      antonyms: word.antonyms || [],
      related: word.related || [],
      synonym_details: word.synonymDetails || [],
      antonym_details: word.antonymDetails || [],
      related_details: word.relatedDetails || [],
      paraphrases: word.paraphrases || [],
      ielts_topics: word.ieltsTopics || [],
      study_day: word.studyDay ?? null,
      is_starred: !!word.starred,
      enrichment_checked_at: word.enrichmentCheckedAt || null,
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

  if (reviewing && (!reviewQueue.length || index >= reviewQueue.length)) return <SessionSummary total={reviewQueue.length} ratings={sessionRatings} streak={streakFrom(studyDays)} close={() => setReviewing(false)} restart={() => { setIndex(0); setRevealed(false); setAnswer(""); setChoice(null); setSessionRatings([]); startedAt.current = Date.now(); }} />;
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
        flip={() => setRevealed((value) => !value)}
        rate={rate}
        step={stepCard}
        shuffle={shuffleQueue}
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
        {/* Mọi chức năng nằm thẳng ở cột trái, chia theo nhóm. Trước đây bảy chế độ
            luyện tập bị giấu sau một trang lưới, phải bấm hai lần mới tới. */}
        <nav aria-label="Điều hướng chính">
          <span className="nav-group">TỔNG QUAN</span>
          <button className={tab === "home" ? "nav-item active" : "nav-item"} onClick={() => goTab("home")}>
            <span>⌂</span> Trang chủ
          </button>
          <button className={tab === "stats" ? "nav-item active" : "nav-item"} onClick={() => goTab("stats")}>
            <span>⌁</span> Tiến độ
          </button>

          <span className="nav-group">LUYỆN TẬP</span>
          {practiceNav.map((item) => (
            <button
              key={item.value}
              className={tab === "practice" && practiceIntent === item.value ? "nav-item active" : "nav-item"}
              onClick={() => {
                setPracticeIntent(item.value);
                setTab("practice");
              }}
            >
              <span>{item.icon}</span> {item.label}
            </button>
          ))}

          <span className="nav-group">THƯ VIỆN</span>
          <button className={tab === "words" ? "nav-item active" : "nav-item"} onClick={() => goTab("words")}>
            <span>▤</span> Danh sách từ
            <em className="nav-count">{words.length}</em>
          </button>
          <button className={tab === "dictionary" ? "nav-item active" : "nav-item"} onClick={() => goTab("dictionary")}>
            <span>⌕</span> Từ điển AI
          </button>
          <button className={tab === "practice" && !practiceIntent ? "nav-item active" : "nav-item"} onClick={() => { setPracticeIntent(null); setTab("practice"); }}>
            <span>◇</span> Công cụ ngoài
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="theme-toggle" onClick={toggleTheme} aria-label={`Chuyển sang chế độ ${theme === "dark" ? "sáng" : "tối"}`}>
            <span>{theme === "dark" ? "☀" : "☾"}</span>
            <b>{theme === "dark" ? "Chế độ sáng" : "Chế độ tối"}</b>
          </button>
          <div className="add-menu" ref={addMenuRef}>
            <button className="quick-add" onClick={() => setAddMenu((open) => !open)} aria-expanded={addMenu} aria-haspopup="menu">
              <span>＋ Thêm từ</span>
              <i className={addMenu ? "add-menu-caret open" : "add-menu-caret"}>⌄</i>
            </button>
            {addMenu && (
              <div className="add-menu-list" role="menu">
                <button role="menuitem" onClick={() => { setAddMenu(false); setShowAdd(true); }}>
                  <span className="add-menu-icon">✎</span>
                  <span><b>Thêm thủ công</b><small>Nhập từng từ bằng tay</small></span>
                  <kbd>⌘ K</kbd>
                </button>
                <button role="menuitem" onClick={() => { setAddMenu(false); setShowBulkAdd(true); }}>
                  <span className="add-menu-icon">☷</span>
                  <span><b>Dán danh sách</b><small>Dán nhiều từ cùng lúc</small></span>
                </button>
                <button role="menuitem" onClick={() => { setAddMenu(false); goTab("dictionary"); }}>
                  <span className="add-menu-icon">⌕</span>
                  <span><b>Tra từ điển AI</b><small>Tra nghĩa rồi lưu vào danh sách</small></span>
                </button>
              </div>
            )}
          </div>
          <button className="profile" onClick={() => setShowAuth(true)}>
            <span className="avatar">RY</span>
            <span>
              <b>{userEmail ?? "Đăng nhập"}</b>
              <small>{cloudStatus === "synced" ? "● Đã đồng bộ theo tài khoản" : cloudStatus === "connecting" ? "Đang kết nối…" : "◐ Chưa đăng nhập · chỉ lưu trên máy"}</small>
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
          <div className="mobile-head-actions">
            <button onClick={toggleTheme} aria-label={`Chuyển sang chế độ ${theme === "dark" ? "sáng" : "tối"}`}>{theme === "dark" ? "☀" : "☾"}</button>
            <button onClick={() => setShowAdd(true)} aria-label="Thêm từ">＋</button>
          </div>
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
        {tab === "home" && <Dashboard words={words} startReview={startReview} startTopicReview={startTopicReview} openWords={() => setTab("words")} openPractice={() => setTab("practice")} startWordReview={(id) => launchReview(words.filter((word) => word.id === id))} startDueReview={() => launchReview(words.filter(isDueAgain))} exam={exam} setExam={(goal) => { setExam(goal); writeExam(goal); }} streak={streakFrom(studyDays)} />}
        {tab === "words" && (
          <Words
            words={filtered}
            query={query}
            setQuery={setQuery}
            toggleStar={toggleStar}
            add={() => setShowAdd(true)}
            bulkAdd={() => setShowBulkAdd(true)}
            startTopicReview={startTopicReview}
            startDayReview={(day) => startReview(day)}
            fillMissingFields={() => void fillMissingFields()}
            backfill={backfill}
            setStudyDay={(id, day) => {
              setWords((current) => current.map((word) => (word.id !== id ? word : { ...word, studyDay: day })));
              if (supabase) void supabase.from("words").update({ study_day: day, updated_at: new Date().toISOString() }).eq("id", id);
            }}
            remove={(id) => {
              markDeleted(id);
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
            openWordDetail={(id) => setDetailWord(words.find((word) => word.id === id) ?? null)}
          />
        )}
        {/* key theo chế độ để mỗi lần chọn ở thanh bên là dựng lại từ đầu. */}
        {tab === "practice" && <Practice key={practiceIntent ?? "menu"} words={words} intent={practiceIntent} />}
        {/* Thống kê tính trên toàn bộ thư viện, cùng phạm vi với các ô ở trang chủ. */}
        {tab === "stats" && <Stats words={words} scopeLabel="toàn bộ thư viện" streak={streakFrom(studyDays)} />}
        {tab === "dictionary" && (
          <Dictionary
            has={(term) => words.some((word) => word.term.trim().toLowerCase() === term.trim().toLowerCase())}
            onSave={(found: NewWord) => {
              // Dùng đúng đường thêm từ như mọi chỗ khác, để từ tra được cũng vào
              // lịch ôn Leitner ngay chứ không nằm ngoài hệ thống.
              const created: WordCard = {
                id: crypto.randomUUID(),
                term: found.term,
                ipa: found.ipa,
                meaning: found.meaning,
                partOfSpeech: found.partOfSpeech,
                definition: found.definition,
                example: fallbackExample(found.term),
                exampleVi: fallbackExampleVi(found.term),
                cloze: clozeFor(found.term, fallbackExample(found.term)),
                topic: "Từ điển",
                box: 1,
                lapses: 0,
                status: "new",
                reviewCount: 0,
                addedDate: localDateString(),
              };
              setWords((current) => [created, ...current]);
              void persistWord(created);
            }}
          />
        )}
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
          existingWords={words.filter((word) => !isPdfVocabulary(word) && !isSeedWord(word))}
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
      {showBulkAdd && (
        <BulkAddWords
          existingWords={words.filter((word) => !isPdfVocabulary(word) && !isSeedWord(word))}
          close={() => setShowBulkAdd(false)}
          save={(items) => {
            const created = items.map((item) => ({ ...item, id: crypto.randomUUID(), box: 1, lapses: 0 }));
            setWords((current) => [...created, ...current]);
            created.forEach((word) => void persistWord(word));
            setShowBulkAdd(false);
            setTab("words");
            // Từ dán vào chỉ có mỗi chữ, nên tra bổ sung ngay thay vì bắt người dùng bấm thêm một nút.
            void fillMissingFields(created);
          }}
        />
      )}
      {detailWord && <WordDetail word={detailWord} close={() => setDetailWord(null)} study={() => { const selected = detailWord; setDetailWord(null); launchReview(words.filter((word) => word.id === selected.id)); }} speak={speak} />}
      {showAuth && <AuthModal close={() => setShowAuth(false)} signedInEmail={userEmail} />}
    </main>
  );
}

function Dashboard({ words, startReview, startTopicReview, openWords, openPractice, startWordReview, startDueReview, exam, setExam, streak }: { words: WordCard[]; startReview: (dayIndex?: number | "pdf") => void; startTopicReview: (topic: string) => void; openWords: () => void; openPractice: () => void; startWordReview: (id: string) => void; startDueReview: () => void; exam: ExamGoal | null; setExam: (goal: ExamGoal | null) => void; streak: { current: number; best: number; studiedToday: boolean } }) {
  const personal = words.filter((word) => !isPdfVocabulary(word));
  // Chưa có từ cá nhân thì phiên học hôm nay lấy từ bộ PDF, thay vì trống trơn.
  const onlyPdf = !personal.length && words.length > 0;
  // Các chỉ số ở đầu trang tính trên TOÀN BỘ thư viện, kể cả bộ PDF. Trước đây mỗi
  // ô một phạm vi khác nhau — tổng số thì gồm PDF, "đang học" thì không, "lượt đã
  // ôn" lại chỉ tính Từ của tôi — nên bốn con số không cộng trừ được với nhau.
  const scheduledWords = words;
  const pdfCount = words.length - personal.length;
  // Danh sách từ đứng sau ô số liệu đang mở; null là chưa mở ô nào.
  const [statList, setStatList] = useState<{ title: string; note: string; words: WordCard[] } | null>(null);
  const masteredWords = words.filter((word) => wordState(word).key === "mastered");
  const learningWords = words.filter((word) => wordState(word).key !== "mastered");
  const reviewedWords = words.filter((word) => (word.reviewCount ?? 0) > 0).sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
  const mastered = scheduledWords.filter((w) => wordState(w).key === "mastered").length;
  const todayQueue = onlyPdf ? buildCollectionQueue(words.filter(isPdfVocabulary)).slice(0, PDF_DAILY_PREVIEW_LIMIT) : buildTodayQueue(personal);
  const todayNew = todayQueue.filter((word) => wordState(word).key === "new").length;
  const todayReview = todayQueue.length - todayNew;
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
  // Giờ luyện và bài dịch chỉ đọc được trên máy, nên phải chờ hydrate xong.
  const [practice, setPractice] = useState<Record<string, Record<string, number>>>({});
  const [attemptCount, setAttemptCount] = useState(0);
  const [studiedDays, setStudiedDays] = useState<string[]>([]);
  const [chartSkill, setChartSkill] = useState<string>("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setPractice(readPractice());
    setAttemptCount(readAttempts().length);
    setStudiedDays(readStudyDays());
  }, []);
  const time = useMemo(() => totalTime(practice), [practice]);
  // XP được TÍNH LẠI từ nhật ký chứ không cộng dồn riêng, nên luôn khớp dữ liệu thật.
  const xpCounts = useMemo(
    () => ({
      reviews: words.reduce((total, word) => total + (word.reviewCount ?? 0), 0),
      learned: words.filter((word) => (word.reviewCount ?? 0) > 0).length,
      mastered: words.filter((word) => wordState(word).key === "mastered").length,
      attempts: attemptCount,
      minutes: time.minutes,
    }),
    [words, attemptCount, time.minutes],
  );
  const level = useMemo(() => levelFor(xpFrom(xpCounts)), [xpCounts]);
  const [showXp, setShowXp] = useState(false);
  const chartRows = useMemo(() => minutesPerDay(practice, 7, chartSkill || undefined), [practice, chartSkill]);
  const chartPeak = Math.max(1, ...chartRows.map((row: { minutes: number }) => row.minutes));
  // Dải điểm danh tuần này: Thứ Hai đến Chủ Nhật của tuần đang sống.
  const weekCheckIn = useMemo(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - weekdayIndex(now));
    return Array.from({ length: 7 }, (_, step) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + step);
      const day = localDateString(date);
      // Dùng chung nguồn với chuỗi ngày học, nếu không thì cùng một màn hình có hai
      // định nghĩa "đã học" khác nhau: một ngày ôn thẻ mà chưa đủ một phút luyện sẽ
      // tính vào chuỗi nhưng lại hiện dấu chấm ở dải tuần.
      return { day, label: "HBTNSBC"[step], studied: studiedDays.includes(day), today: day === localDateString() };
    });
  }, [studiedDays]);
  const [editingExam, setEditingExam] = useState(false);
  const [examDraft, setExamDraft] = useState<ExamGoal>({ date: exam?.date ?? "", label: exam?.label ?? "" });
  // Số từ chưa thuộc, dùng để gợi ý nhịp học mỗi ngày cho kịp ngày thi.
  const wordsLeft = words.filter((word) => wordState(word).key !== "mastered").length;
  // Nhắc ôn: gom tất cả từ đã học nay đến hạn, kể cả bộ PDF, và ghi rõ chúng đến từ nhóm nào.
  const dueAgain = words.filter(isDueAgain);
  const today = localDateString();
  const overdue = dueAgain.filter((word) => word.dueDate && word.dueDate < today).length;
  const dueGroups = [...dueAgain.reduce((map, word) => map.set(groupLabelOf(word), (map.get(groupLabelOf(word)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <div className="page dashboard">
      <div className="eyebrow" ref={dateRef}>
        HÔM NAY
      </div>
      <div className="greeting">
        <div>
          <h1>
            <span className="greeting-text" ref={greetingRef}>Chào bạn</span>, Ryan <span>✦</span>
          </h1>
          <p>Một phiên ôn ngắn hôm nay sẽ giúp trí nhớ đi xa hơn.</p>
        </div>
      </div>
      <div className="home-stats">
        <div className="home-stat">
          <span className="home-stat-icon">🔥</span>
          <div><b>{streak.current}</b><small>ngày · chuỗi hiện tại</small></div>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon">◷</span>
          <div><b>{time.hours}h {time.rest}m</b><small>thời gian luyện tập</small></div>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon">▤</span>
          <div><b>{words.length}</b><small>từ đã lưu</small></div>
        </div>
        <button className="home-stat as-button" onClick={() => setShowXp((value) => !value)} aria-expanded={showXp}>
          <span className="home-stat-icon">◎</span>
          <div>
            <b>{level.xp} XP</b>
            <small>Lv.{level.level} · {level.name}</small>
            <i className="home-xp-bar"><em style={{ width: `${level.percent}%` }} /></i>
          </div>
        </button>
      </div>

      {showXp && (
        <section className="panel home-xp-detail">
          <h3>XP của bạn ở đâu ra</h3>
          {/* Nói rõ từng khoản: một con số không giải thích được thì không đáng tin. */}
          <ul>
            {xpBreakdown(xpCounts).map((row: { key: string; label: string; count: number; xp: number }) => (
              <li key={row.key}><b>{row.xp} XP</b><span>{row.count} × {row.label}</span></li>
            ))}
          </ul>
          {level.next !== null && <p className="muted">Còn {level.next - level.xp} XP nữa là lên cấp {level.level + 1}.</p>}
        </section>
      )}

      <div className="home-row">
        <section className="panel home-chart">
          <div className="home-chart-head">
            <h3>Phút luyện tập</h3>
            <div className="home-chart-tabs" role="group" aria-label="Kỹ năng">
              <button className={chartSkill === "" ? "active" : ""} onClick={() => setChartSkill("")}>Tất cả</button>
              {SKILLS.map((skill: { key: string; label: string }) => (
                <button key={skill.key} className={chartSkill === skill.key ? "active" : ""} onClick={() => setChartSkill(skill.key)}>{skill.label}</button>
              ))}
            </div>
          </div>
          {minutesInRange(practice, 7, chartSkill || undefined) === 0 ? (
            <p className="muted home-chart-empty">Bảy ngày qua chưa có phút luyện nào ở mục này. Vào một chế độ bên trái, app tự đếm giờ cho bạn.</p>
          ) : (
            <div className="home-bars" aria-label="Số phút luyện mỗi ngày, bảy ngày gần đây">
              {chartRows.map((row: { day: string; minutes: number }) => (
                <div key={row.day}>
                  <span>{row.minutes || ""}</span>
                  <i style={{ height: `${Math.max(3, (row.minutes / chartPeak) * 120)}px` }} />
                  <b>{row.day.slice(8)}/{row.day.slice(5, 7)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel home-week">
          <h3>Tuần này</h3>
          <div className="home-week-days">
            {weekCheckIn.map((item: { day: string; label: string; studied: boolean; today: boolean }) => (
              <div key={item.day} className={`home-week-day${item.studied ? " done" : ""}${item.today ? " today" : ""}`}>
                <b>{item.label}</b>
                <span>{item.studied ? "✓" : "·"}</span>
              </div>
            ))}
          </div>
          <p className="muted">
            {/* Đánh dấu theo việc đã luyện thật, không có nút điểm danh riêng: bấm một
                nút mà không học thì con số chẳng nói lên điều gì. */}
            Ngày nào có luyện là tự đánh dấu. Chuỗi dài nhất của bạn: {streak.best} ngày.
          </p>
        </section>
      </div>

      <div className="goal-row">
        <section className={exam ? "goal-card exam" : "goal-card exam empty"}>
          {exam ? (
            <>
              <span className="goal-icon">◷</span>
              <div>
                <b>{daysUntil(exam.date) >= 0 ? `Còn ${daysUntil(exam.date)} ngày` : `Đã qua ${Math.abs(daysUntil(exam.date))} ngày`}</b>
                <small>
                  {exam.label || "Ngày thi"} · {exam.date}
                  {daysUntil(exam.date) > 0 && wordsLeft > 0 ? ` · cần ~${Math.ceil(wordsLeft / daysUntil(exam.date))} từ/ngày` : ""}
                </small>
              </div>
              <button onClick={() => setEditingExam(true)} aria-label="Sửa ngày thi">
                ✎
              </button>
            </>
          ) : (
            <button className="goal-set" onClick={() => setEditingExam(true)}>
              ◷ Đặt ngày thi để đếm ngược →
            </button>
          )}
        </section>
        <section className={streak.studiedToday ? "goal-card streak active" : "goal-card streak"}>
          <span className="goal-icon">{streak.current > 0 ? "🔥" : "○"}</span>
          <div>
            <b>
              {streak.current} ngày liên tiếp
            </b>
            <small>{streak.studiedToday ? `Hôm nay đã học · kỷ lục ${streak.best} ngày` : streak.current > 0 ? `Học hôm nay để giữ chuỗi · kỷ lục ${streak.best} ngày` : "Ôn một thẻ hôm nay để bắt đầu chuỗi"}</small>
          </div>
        </section>
      </div>
      {editingExam && (
        <div className="modal-backdrop" onMouseDown={() => setEditingExam(false)}>
          <form
            className="modal exam-modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (examDraft.date) setExam({ date: examDraft.date, label: examDraft.label.trim() || "Ngày thi" });
              setEditingExam(false);
            }}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">MỤC TIÊU</span>
                <h2>Ngày thi của bạn</h2>
              </div>
              <button type="button" onClick={() => setEditingExam(false)}>
                ×
              </button>
            </div>
            <label>
              Tên kỳ thi
              <input value={examDraft.label} onChange={(event) => setExamDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="IELTS, thi cuối kỳ…" />
            </label>
            <label>
              Ngày thi
              <input type="date" value={examDraft.date} min={localDateString()} onChange={(event) => setExamDraft((draft) => ({ ...draft, date: event.target.value }))} />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setExam(null);
                  setEditingExam(false);
                }}
              >
                Xoá mục tiêu
              </button>
              <button className="primary" type="submit" disabled={!examDraft.date}>
                Lưu
              </button>
            </div>
          </form>
        </div>
      )}
      {!!dueAgain.length && (
        <section className="due-reminder">
          <span className="due-reminder-icon">⏰</span>
          <div>
            <b>
              {dueAgain.length} từ đã học đến hạn ôn lại hôm nay
            </b>
            <small>
              {dueGroups.map(([label, count]) => `${label}: ${count} từ`).join(" · ")}
              {overdue > 0 && ` · ${overdue} từ đã quá hạn`}
            </small>
          </div>
          <button className="primary" onClick={startDueReview}>
            Ôn ngay {dueAgain.length} từ →
          </button>
        </section>
      )}
      <section className="hero-card">
        <div className="hero-copy">
          <div className="today-icon">◎</div>
          <div>
            <span>SẴN SÀNG CHO HÔM NAY</span>
            <h2>
              <strong>{todayQueue.length}</strong> thẻ trong phiên hôm nay
            </h2>
            <p>
              {todayReview} từ đến hạn · {todayNew} từ mới · khoảng {Math.max(5, Math.ceil(todayQueue.length * 0.45))} phút
            </p>
          </div>
        </div>
        <button className="primary" disabled={!todayQueue.length} onClick={() => startReview(onlyPdf ? "pdf" : undefined)}>
          Bắt đầu học <span>→</span>
        </button>
      </section>
      <div className="stats-grid">
        {/* Bốn ô cùng một phạm vi: toàn bộ thư viện, gồm cả bộ PDF. Nhờ vậy
            "đang học" + "đã thuộc" luôn cộng lại đúng bằng "tổng số từ". */}
        <Stat label="Tổng số từ" value={String(words.length)} note={pdfCount ? `${personal.length} từ của bạn · ${pdfCount} từ bộ PDF` : "Trong thư viện của bạn"} icon="▤" tone="purple"
          onOpen={() => setStatList({ title: "Tổng số từ", note: "TOÀN BỘ THƯ VIỆN", words })} />
        <Stat label="Đang học" value={String(words.length - mastered)} note="Chưa lên hộp 6" icon="◔" tone="orange"
          onOpen={() => setStatList({ title: "Đang học", note: "CHƯA LÊN HỘP 6", words: learningWords })} />
        <Stat label="Đã thuộc" value={String(mastered)} note="Đã lên hộp 6" icon="✓" tone="green"
          onOpen={() => setStatList({ title: "Đã thuộc", note: "ĐÃ LÊN HỘP 6", words: masteredWords })} />
        <Stat label="Lượt đã ôn" value={String(reviewedThisWeek)} note="Toàn bộ thư viện" icon="♨" tone="pink"
          onOpen={() => setStatList({ title: "Từ đã được ôn", note: "XẾP THEO SỐ LƯỢT ÔN", words: reviewedWords })} />
      </div>
      <LearningPlan reviewCount={todayReview} newCount={todayNew} startVocabulary={() => startReview(onlyPdf ? "pdf" : undefined)} openPractice={openPractice} />
      <DailyStudy words={words} startReview={startReview} startTopicReview={startTopicReview} />
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
      {statList && <WordListModal title={statList.title} note={statList.note} words={statList.words} close={() => setStatList(null)} />}
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

function prioritySort(a: WordCard, b: WordCard) {
  const dateOrder = (a.dueDate ?? "0000-00-00").localeCompare(b.dueDate ?? "0000-00-00");
  return dateOrder || b.lapses - a.lapses || a.term.localeCompare(b.term);
}

// Phiên chính luôn xử lý phần đã học đến hạn trước. Từ mới chỉ lấy ở nhóm của hôm nay
// và được giới hạn để lượng ôn không tăng nhanh hơn khả năng ghi nhớ.
function buildTodayQueue(words: WordCard[]) {
  const today = weekdayIndex();
  const reviews = words
    .filter((word) => wordState(word).key === "due")
    .sort(prioritySort)
    .slice(0, DAILY_REVIEW_LIMIT);
  const fresh = words
    .filter((word) => wordState(word).key === "new" && addedDayIndex(word) === today)
    .sort(prioritySort)
    .slice(0, DAILY_NEW_LIMIT);
  return [...reviews, ...fresh];
}

// Khi người dùng chủ động chọn một folder, đưa toàn bộ từ trong folder vào phiên.
// Thẻ đến hạn vẫn đứng trước, nhưng không loại từ đã thuộc và không cắt còn 20 thẻ.
function buildCollectionQueue(words: WordCard[]) {
  return words
    .sort((a, b) => {
      const rank = (word: WordCard) => wordState(word).key === "due" ? 0 : wordState(word).key === "new" ? 1 : 2;
      return rank(a) - rank(b) || prioritySort(a, b);
    });
}

function LearningPlan({ reviewCount, newCount, startVocabulary, openPractice }: { reviewCount: number; newCount: number; startVocabulary: () => void; openPractice: () => void }) {
  return (
    <section className="learning-plan panel">
      <div className="panel-title">
        <div>
          <h3>Học đủ 4 kỹ năng trong 25–35 phút</h3>
          <p>Ôn đúng hạn trước, tiếp nhận ít nội dung mới, rồi dùng lại ngay trong ngữ cảnh.</p>
        </div>
        <span className="plan-rule">5 ngày học · 1 ngày ôn nhẹ · 1 ngày nghỉ</span>
      </div>
      <div className="plan-steps">
        <button onClick={startVocabulary} disabled={!reviewCount && !newCount}>
          <span>01</span><b>Từ vựng · 10–15 phút</b>
          <small>{reviewCount} từ đến hạn trước · tối đa {DAILY_NEW_LIMIT} từ mới</small>
          <i>Bắt đầu phiên →</i>
        </button>
        <button onClick={openPractice}>
          <span>02</span><b>Nghe chép · 8–10 phút</b>
          <small>3–5 câu đúng trình độ; nghe, gõ, sửa rồi đọc nhại</small>
          <i>Mở luyện tập →</i>
        </button>
        <button onClick={openPractice}>
          <span>03</span><b>Nói/viết · 5–10 phút</b>
          <small>Dùng 3 từ vừa học để nói hoặc viết về chính mình</small>
          <i>Mở luyện tập →</i>
        </button>
      </div>
    </section>
  );
}

function DailyStudy({ words, startReview, startTopicReview }: { words: WordCard[]; startReview: (dayIndex: number | "pdf") => void; startTopicReview: (topic: string) => void }) {
  const pdfWords = words.filter(isPdfVocabulary);
  const dailyWords = words.filter((word) => !isPdfVocabulary(word));
  // Folder chủ đề phải khớp chính xác với 27 thư mục của bộ PDF trong trang Từ vựng.
  const topicFolders = [...new Set(pdfWords.flatMap((word) => word.topic.split(" · ")))]
    .map((topic) => ({ topic, count: pdfWords.filter((word) => word.topic.split(" · ").includes(topic)).length }))
    .filter((folder) => folder.topic && folder.count)
    .sort((a, b) => a.topic.localeCompare(b.topic, "vi"));
  return (
    <section className="daily-study">
      <div className="panel-title">
        <div>
          <h3>Học theo từng ngày</h3>
          <p>Các nhóm theo ngày dùng để nhận từ mới; từ đến hạn vẫn được ôn đúng lịch dù nằm ở nhóm nào.</p>
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
              <i>Học folder này →</i>
            </button>
          );
        })}
      </div>
      {!!pdfWords.length && (
        <button className="pdf-collection-card" onClick={() => startReview("pdf")}>
          <span>PDF</span>
          <strong>Bộ {pdfWords.length} từ vựng theo chủ đề</strong>
          <small>{pdfWords.length} mục · học toàn bộ trong một phiên</small>
          <b>Học bộ từ này →</b>
        </button>
      )}
      {!!topicFolders.length && (
        <div className="study-topic-folders">
          <div className="panel-title"><div><h3>Học theo chủ đề</h3><p>Mỗi chủ đề là một folder học độc lập.</p></div></div>
          <div className="topic-folder-grid">
            {topicFolders.map((folder) => (
              <button key={folder.topic} onClick={() => startTopicReview(folder.topic)}>
                <span>▰</span><b>{folder.topic}</b><small>{folder.count} từ</small><i>Học folder →</i>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}



// Một từ được đưa vào hàng đợi ôn khi đã tới hạn hoặc chưa học lần nào.


// Từ ĐÃ học rồi và nay tới hạn ôn lại — khác với từ chưa học lần nào.
// Đây là nhóm cần nhắc: học hôm thứ Ba, hôm nay thứ Tư đến lịch ôn.
function isDueAgain(word: WordCard) {
  return wordState(word).key === "due" && (word.reviewCount ?? 0) > 0;
}
// Nhãn nhóm của một từ: thứ trong tuần với từ tự thêm, tên thư mục với bộ PDF.
function groupLabelOf(word: WordCard) {
  if (isPdfVocabulary(word)) return word.topic.split(" · ")[0];
  return dayNames[addedDayIndex(word)];
}

function WeeklyTracker({ words }: { words: WordCard[] }) {
  const countRow = (label: string, list: WordCard[]) => ({
    label,
    total: list.length,
    due: list.filter((w) => wordState(w).key === "due").length,
    waiting: list.filter((w) => wordState(w).key === "waiting").length,
    fresh: list.filter((w) => wordState(w).key === "new").length,
    mastered: list.filter((w) => wordState(w).key === "mastered").length,
  });
  const personalWords = words.filter((word) => !isPdfVocabulary(word));
  const pdfWords = words.filter(isPdfVocabulary);
  const dayRows = dayNames.map((day, index) => countRow(`${String(index + 1).padStart(2, "0")} ${day}`, personalWords.filter((w) => addedDayIndex(w) === index)));
  // Bộ PDF được chia theo đúng các thư mục chủ đề đang hiện ở tab Từ vựng.
  const topicRows = [...new Set(pdfWords.flatMap((word) => word.topic.split(" · ")))]
    .sort((a, b) => a.localeCompare(b, "vi"))
    .map((topic) => countRow(topic, pdfWords.filter((word) => word.topic.split(" · ").includes(topic))));
  const tracked = personalWords.length + pdfWords.length;
  const masteredAll = words.filter((w) => wordState(w).key === "mastered").length;
  const [showTopics, setShowTopics] = useState(true);
  return (
    <section className="panel weekly">
      <div className="panel-title">
        <div>
          <h3>Bảng theo dõi Leitner</h3>
          <p>Từ bạn tự thêm xếp theo ngày học, bộ PDF xếp theo thư mục chủ đề</p>
        </div>
        <span className="mastery-rate">{tracked ? Math.round((masteredAll / tracked) * 100) : 0}% đã thuộc</span>
      </div>
      <div className="weekly-table">
        <div>
          <b>Nhóm</b>
          <b>Tổng</b>
          <b>🔴 Cần ôn</b>
          <b>⏳ Chưa tới hạn</b>
          <b>🆕 Chưa học</b>
          <b>✅ Đã thuộc</b>
        </div>
        {dayRows.map((r) => (
          <div key={r.label}>
            <span>{r.label}</span>
            <span>{r.total}</span>
            <span>{r.due}</span>
            <span>{r.waiting}</span>
            <span>{r.fresh}</span>
            <span>{r.mastered}</span>
          </div>
        ))}
        {!!topicRows.length && (
          <div className="weekly-group">
            <button onClick={() => setShowTopics((value) => !value)}>
              {showTopics ? "▾" : "▸"} Thư mục chủ đề · {topicRows.length} folder · {pdfWords.length} từ
            </button>
          </div>
        )}
        {showTopics &&
          topicRows.map((r) => (
            <div key={r.label}>
              <span>{r.label}</span>
              <span>{r.total}</span>
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

// Rê chuột vào một từ tiếng Anh là tra nghĩa ngay tại chỗ.
//
// Kết quả được nhớ lại trong phiên: đọc một đoạn thì cùng một từ hay lặp lại, tra
// lại mỗi lần vừa chậm vừa phí. Chờ 350ms mới gọi để lướt chuột qua không kích hoạt.
type Glance = { term: string; ipa: string; meaningVi: string; senses: { part: string; definition: string; synonyms: string[] }[] };
const glanceCache = new Map<string, Glance | "missing">();

function EnglishText({ text, className }: { text: string; className?: string }) {
  const [active, setActive] = useState<{ word: string; x: number; y: number } | null>(null);
  const [data, setData] = useState<Glance | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "missing">("idle");
  const timer = useRef<number | null>(null);

  function show(word: string, element: HTMLElement) {
    const clean = word.toLowerCase().replace(/[^a-z'-]/g, "");
    if (clean.length < 2) return;
    // Ghim bóng trong khung nhìn: từ ở sát mép phải hoặc gần đáy thì bóng sẽ tràn
    // ra ngoài và không đọc được.
    const box = element.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const height = 210;
    const x = Math.max(12, Math.min(box.left, window.innerWidth - width - 12));
    const y = box.bottom + height + 12 > window.innerHeight ? Math.max(12, box.top - height - 6) : box.bottom;
    setActive({ word: clean, x, y });
    const cached = glanceCache.get(clean);
    if (cached) {
      setData(cached === "missing" ? null : cached);
      setState(cached === "missing" ? "missing" : "idle");
      return;
    }
    setData(null);
    setState("loading");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/ai/glance?q=${encodeURIComponent(clean)}`);
        const payload = (await response.json()) as Glance & { error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error);
        glanceCache.set(clean, payload);
        setData(payload);
        setState("idle");
      } catch {
        glanceCache.set(clean, "missing");
        setState("missing");
      }
    }, 350);
  }
  function hide() {
    if (timer.current) window.clearTimeout(timer.current);
    setActive(null);
    setData(null);
    setState("idle");
  }

  // Tách theo khoảng trắng để giữ nguyên dấu câu dính liền từ.
  const pieces = text.split(/(\s+)/);
  return (
    <span className={`en-text ${className ?? ""}`} onMouseLeave={hide}>
      {pieces.map((piece, position) =>
        /^\s+$/.test(piece) || !/[a-z]/i.test(piece) ? (
          <span key={position}>{piece}</span>
        ) : (
          // onMouseOver thay vì onMouseEnter: mỗi thẻ chỉ chứa một từ, không có con
          // nên hai cái tương đương, mà onMouseOver là sự kiện thường, không phụ
          // thuộc cơ chế enter/leave của React.
          <span key={position} className="en-word" onMouseOver={(event) => show(piece, event.currentTarget)} onFocus={(event) => show(piece, event.currentTarget)} tabIndex={-1}>
            {piece}
          </span>
        ),
      )}
      {active && (
        <span className="gloss" style={{ left: active.x, top: active.y + 6 }} role="tooltip">
          <b className="gloss-term">{active.word}</b>
          {state === "loading" && <em className="gloss-note">Đang tra…</em>}
          {state === "missing" && <em className="gloss-note">Không tra được từ này.</em>}
          {data && (
            <>
              {(data.ipa || data.meaningVi) && (
                <span className="gloss-head">
                  {data.ipa && <i>{data.ipa}</i>}
                  {data.meaningVi && <strong>{data.meaningVi}</strong>}
                </span>
              )}
              {data.senses.map((sense) => (
                <span className="gloss-sense" key={sense.part}>
                  <i>{sense.part}</i>
                  <span>{sense.definition}</span>
                  {!!sense.synonyms.length && <small>{[...new Set(sense.synonyms)].join(", ")}</small>}
                </span>
              ))}
            </>
          )}
        </span>
      )}
    </span>
  );
}

// Có onOpen thì ô số liệu bấm được để xem đúng những từ đã tạo ra con số đó.
function Stat({ label, value, note, icon, tone, onOpen }: { label: string; value: string; note: string; icon: string; tone: string; onOpen?: () => void }) {
  const body = (
    <>
      <div className={`stat-icon ${tone}`}>{icon}</div>
      {/* Đặt tên lớp rõ ràng thay vì dựa vào :last-child — bản bấm được có thêm mũi
          tên ở cuối nên khối chữ mất display:grid, ba dòng dồn hết thành một. */}
      <div className="stat-text">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </>
  );
  // Số 0 thì không có gì để xem — đừng mời bấm rồi mở ra hộp rỗng.
  if (!onOpen || value === "0") return <div className="stat">{body}</div>;
  return (
    <button type="button" className="stat stat-open" onClick={onOpen} title={`Xem danh sách ${label.toLowerCase()}`}>
      {body}
      <span className="stat-arrow" aria-hidden="true">›</span>
    </button>
  );
}

// Danh sách từ đứng sau một con số thống kê. Bấm một dòng thì mở thẻ chi tiết.
function WordListModal({ title, note, words, close }: { title: string; note: string; words: WordCard[]; close: () => void }) {
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<WordCard | null>(null);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? words.filter((word) => `${word.term} ${word.meaning}`.toLowerCase().includes(needle)) : words;
  }, [words, query]);
  const speak = (text: string) => window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text));
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <section className="modal word-list-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{note}</span>
            <h2>{title} · {words.length} từ</h2>
          </div>
          <button type="button" onClick={close} aria-label="Đóng">×</button>
        </div>
        {words.length > 8 && (
          <div className="word-list-filter">
            <input aria-label="Lọc danh sách" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Lọc theo từ hoặc nghĩa…" />
          </div>
        )}
        {shown.length ? (
          <>
          <div className="word-list-head"><span>TỪ</span><span>NGHĨA</span><span>HỘP</span></div>
          <div className="word-list-rows">
            {shown.map((word) => (
              <button type="button" key={word.id} onClick={() => setDetail(word)}>
                <b className="wl-term">{word.term}</b>
                <span className="wl-mean">{word.meaning || "—"}</span>
                {/* Số lần quên chỉ hiện khi thực sự có — dòng nào cũng in "quên 0 lần" thì rối mắt. */}
                {!!word.lapses && <span className="wl-lapse">quên {word.lapses}</span>}
                <span className={`wl-box b${word.box}`}>{word.box}</span>
              </button>
            ))}
          </div>
          </>
        ) : (
          <p className="word-list-empty">{words.length ? "Không có từ nào khớp bộ lọc." : "Chưa có từ nào trong nhóm này."}</p>
        )}
        {detail && <WordDetail word={detail} close={() => setDetail(null)} speak={speak} />}
      </section>
    </div>
  );
}

function Words({ words, query, setQuery, toggleStar, add, bulkAdd, remove, importWords, startTopicReview, setStudyDay, startDayReview, openWordDetail, fillMissingFields, backfill }: { words: WordCard[]; query: string; setQuery: (s: string) => void; toggleStar: (id: string) => void; add: () => void; bulkAdd: () => void; remove: (id: string) => void; importWords: (w: Omit<WordCard, "id" | "lapses">[]) => void; startTopicReview: (topic: string) => void; setStudyDay: (id: string, day: number) => void; startDayReview: (day?: number) => void; openWordDetail: (id: string) => void; fillMissingFields: () => void; backfill: { done: number; total: number; failed: number } | null }) {
  const PAGE_SIZE = 25;
  const fileRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [collectionFilter, setCollectionFilter] = useState<"daily" | "pdf">("daily");
  const [pdfTopic, setPdfTopic] = useState<string | null>(null);
  const [page, setPage] = useState({ key: "", value: 1 });
  const [deleteCandidate, setDeleteCandidate] = useState<WordCard | null>(null);
  const isPdfWord = isPdfVocabulary;
  const personalWords = words.filter((word) => !isPdfWord(word));
  const pdfWords = words.filter(isPdfWord);
  const pdfTopics = [...new Set(pdfWords.flatMap((word) => word.topic.split(" · ")))].sort((a, b) => a.localeCompare(b, "vi"));
  const activeCollection = collectionFilter === "pdf" ? (pdfTopic ? pdfWords.filter((word) => word.topic.split(" · ").includes(pdfTopic)) : pdfWords) : personalWords;
  const visible = activeCollection.filter((w) => (statusFilter === "all" || wordState(w).key === statusFilter) && (dayFilter === null || addedDayIndex(w) === dayFilter));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Đổi bộ lọc thì về trang 1, và trang không bao giờ vượt quá số trang hiện có.
  // Suy ra ngay lúc render thay vì dùng effect, tránh một lượt render thừa hiển thị trang rỗng.
  const filterKey = `${query}|${statusFilter}|${dayFilter}|${collectionFilter}|${pdfTopic}`;
  const currentPage = page.key === filterKey ? Math.min(page.value, pageCount) : 1;
  const pagedVisible = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const goToPage = (value: number) => setPage({ key: filterKey, value: Math.min(Math.max(1, value), pageCount) });
  const dayWords = dayFilter === null ? [] : personalWords.filter((word) => addedDayIndex(word) === dayFilter);
  const incomplete = personalWords.filter(needsEnrichment);
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
      // Sheet đặt tên "01 …" là định dạng cũ; file chỉ có một sheet thường thì đọc hết.
      const named = workbook.SheetNames.filter((n) => /^0[1-7] /.test(n));
      const daySheets = named.length ? named : workbook.SheetNames;
      // Thứ lấy từ tên sheet, không có thì lấy từ tên file ("01 Monday.xlsx" → Thứ Hai).
      const dayFromName = (name: string) => {
        const numbered = name.match(/^0?([1-7])\b/);
        if (numbered) return Number(numbered[1]) - 1;
        const english = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].findIndex((d) => name.toLowerCase().includes(d));
        return english >= 0 ? english : undefined;
      };
      const imported: Omit<WordCard, "id" | "lapses">[] = [];
      for (const name of daySheets) {
        const sheetDay = dayFromName(name) ?? dayFromName(file.name);
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: "" });
        const headers = Object.keys(rows[0] ?? {});
        // File chỉ là một cột "từ: nghĩa" thì không có dòng tiêu đề — ô đầu tiên cũng là dữ liệu.
        if (!headers.includes("Từ / Cụm từ")) {
          const lines = XLSX.utils
            .sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" })
            .map((row) => String(row[0] ?? "").trim())
            .filter(Boolean);
          for (const line of lines) {
            const parsed = parseTermLine(line);
            if (parsed) imported.push({ ...parsed, studyDay: sheetDay });
          }
          continue;
        }
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
            studyDay: sheetDay,
          });
        }
      }
      importWords(imported);
      const days = [...new Set(imported.map((item) => item.studyDay).filter((day) => typeof day === "number"))].map((day) => dayNames[day as number]);
      alert(imported.length ? `Đã nhập ${imported.length} từ${days.length ? ` vào ${days.join(", ")}` : ""}.` : "Không đọc được từ nào trong file. Mỗi dòng nên có dạng: từ (loại từ): nghĩa");
      return;
    }
    const text = await file.text();
    // File văn bản cũng lấy thứ từ tên file, ví dụ "01 Monday.txt".
    const fileDay = (() => {
      const numbered = file.name.match(/^0?([1-7])\b/);
      if (numbered) return Number(numbered[1]) - 1;
      const english = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].findIndex((day) => file.name.toLowerCase().includes(day));
      return english >= 0 ? english : undefined;
    })();
    const items = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^"|"$/g, "").trim())
      .filter(Boolean)
      .slice(0, 1000)
      .map((line) => parseTermLine(line.includes("\t") ? line.replace("\t", ": ") : line))
      .filter((item): item is Omit<WordCard, "id" | "lapses"> => !!item && item.term.toLowerCase() !== "term")
      .map((item) => ({ ...item, studyDay: fileDay }));
    importWords(items);
    alert(items.length ? `Đã nhập ${items.length} từ${typeof fileDay === "number" ? ` vào ${dayNames[fileDay]}` : ""}.` : "Không đọc được từ nào. Mỗi dòng nên có dạng: từ (loại từ): nghĩa");
  }
  return (
    <div className="page words-page">
      <div className="section-head">
        <div>
          <div className="eyebrow">THƯ VIỆN CỦA BẠN</div>
          <h1>Từ vựng</h1>
          <p>{collectionFilter === "pdf" ? (pdfTopic ? `${activeCollection.length} từ trong chủ đề ${pdfTopic}.` : `${pdfWords.length} từ trong ${pdfTopics.length} thư mục chủ đề.`) : `${personalWords.length} từ cá nhân · quản lý theo Leitner Box.`}</p>
        </div>
        {collectionFilter === "daily" && <div className="section-actions"><button onClick={bulkAdd}>☷ Dán danh sách</button><button className="primary" onClick={add}>＋ Thêm từ mới</button></div>}
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
            <div><h3>Thư mục học</h3><p>Chọn một folder để học riêng như một bộ thẻ Quizlet.</p></div>
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
          <button className="primary" onClick={() => startTopicReview(pdfTopic)}>Học folder này →</button>
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
                Học tất cả →
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
                Học folder này →
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
        {collectionFilter === "daily" && !!incomplete.length && (
          <button className="backfill-button" disabled={!!backfill} onClick={fillMissingFields} title={`Thiếu dữ liệu: ${incomplete.map((word) => word.term).slice(0, 8).join(", ")}${incomplete.length > 8 ? "…" : ""}`}>
            {backfill ? `◌ Đang bổ sung ${backfill.done}/${backfill.total}…` : `✦ Bổ sung ${incomplete.length} từ thiếu`}
          </button>
        )}
        <button onClick={exportCsv}>Xuất CSV</button>
        <button onClick={exportQuizlet}>Quizlet</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
      </div>
      {backfill && (
        <div className={backfill.done < backfill.total ? "backfill-status" : "backfill-status done"}>
          {backfill.done < backfill.total ? (
            <>
              Đang tra và bổ sung <b>{backfill.done}</b>/{backfill.total} từ… chỉ điền vào ô đang trống, không đè lên nội dung bạn đã sửa.
            </>
          ) : (
            <>
              Xong: đã bổ sung <b>{backfill.total - backfill.failed}</b>/{backfill.total} từ{backfill.failed ? ` · ${backfill.failed} từ không tra được` : ""}.
            </>
          )}
        </div>
      )}
      <div className="word-table">
        <div className="word-tr word-th">
          <span>TỪ / LOẠI TỪ / NGHĨA</span>
          <span>CHỦ ĐỀ</span>
          <span>HỘP (1–6)</span>
          <span>TRẠNG THÁI</span>
          <span />
        </div>
        {pagedVisible.map((w) => (
          <div className={`word-tr word-clickable state-${wordState(w).key}`} key={w.id} role="button" tabIndex={0} aria-label={`Xem đầy đủ thông tin của ${w.term}`} onClick={() => openWordDetail(w.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openWordDetail(w.id); } }}>
            <span className="word-main">
              <button onClick={(event) => { event.stopPropagation(); toggleStar(w.id); }} aria-label="Gắn sao">
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
                <select className="day-select" aria-label={`Ngày học của ${w.term}`} value={addedDayIndex(w)} onClick={(event) => event.stopPropagation()} onChange={(e) => setStudyDay(w.id, Number(e.target.value))}>
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
              onClick={(event) => {
                event.stopPropagation();
                setDeleteCandidate(w);
              }}
            >
              ×
            </button>}
          </div>
        ))}
      </div>
      {visible.length > PAGE_SIZE && (
        <nav className="pagination" aria-label="Phân trang từ vựng">
          <span>Hiển thị {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)} trong {visible.length} từ</span>
          <div>
            <button disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}>← Trước</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1)
              .filter((number) => number === 1 || number === pageCount || Math.abs(number - currentPage) <= 1)
              .map((number, index, pages) => <span key={number}>{index > 0 && number - pages[index - 1] > 1 && <i>…</i>}<button className={number === currentPage ? "active" : ""} aria-current={number === currentPage ? "page" : undefined} onClick={() => goToPage(number)}>{number}</button></span>)}
            <button disabled={currentPage === pageCount} onClick={() => goToPage(currentPage + 1)}>Sau →</button>
          </div>
        </nav>
      )}
      </>}
      {deleteCandidate && (
        <div className="modal-backdrop" onMouseDown={() => setDeleteCandidate(null)}>
          <section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-icon">♲</span>
            <div>
              <span className="eyebrow">XÁC NHẬN XÓA TỪ</span>
              <h2 id="delete-title">Chuyển “{deleteCandidate.term}” vào thùng rác?</h2>
              <p>Từ này sẽ biến mất khỏi thư viện và các folder học. Nếu bạn đã đăng nhập, thay đổi cũng được đồng bộ với tài khoản của bạn.</p>
            </div>
            <div className="confirm-actions">
              <button onClick={() => setDeleteCandidate(null)}>Giữ lại</button>
              <button className="danger-button" onClick={() => { remove(deleteCandidate.id); setDeleteCandidate(null); }}>Chuyển vào thùng rác</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ReviewView({ card, index, total, revealed, answer, setAnswer, reveal, flip, rate, step, shuffle, close, speak, toggleStar, mode, modeSetting, setMode, choices, choice, pickChoice }: { card: WordCard; index: number; total: number; revealed: boolean; answer: string; setAnswer: (s: string) => void; reveal: () => void; flip: () => void; rate: (r: Rating) => void; step: (delta: number) => void; shuffle: () => void; close: () => void; speak: (s: string) => void; toggleStar: () => void; mode: ReviewMode; modeSetting: ReviewMode; setMode: (m: ReviewMode) => void; choices: WordCard[]; choice: string | null; pickChoice: (id: string) => void }) {
  // Trắc nghiệm cần ít nhất 2 lựa chọn, hàng đợi quá ngắn thì lùi về thẻ Việt → Anh.
  const shownMode: ReviewMode = mode === "quiz" && choices.length < 2 ? "vi_en" : mode;
  const [autoplay, setAutoplay] = useState(false);
  // Bật theo dõi tiến độ thì thẻ ghi nhớ chấm điểm luôn: "Đã biết" = Được, "Đang học"
  // = Quên, để lịch Leitner được cập nhật. Tắt thì chỉ xem lại, không đụng vào lịch.
  const [tracking, setTracking] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const classify = (known: boolean) => rate(known ? "good" : "again");
  // Tự động phát: lật thẻ rồi sang thẻ kế tiếp, nhịp giống Flashcards bên Luyện tập.
  // Tự tắt khi hết bộ hoặc khi rời khỏi kiểu thẻ ghi nhớ.
  useEffect(() => {
    if (!autoplay || shownMode !== "card") return;
    const timer = setTimeout(
      () => {
        if (!revealed) flip();
        else if (index + 1 < total) step(1);
        else setAutoplay(false);
      },
      revealed ? 2600 : 2200,
    );
    return () => clearTimeout(timer);
  });
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
          <button
            key={item.value}
            className={modeSetting === item.value ? "active" : ""}
            onClick={() => {
              // Đổi kiểu thẻ thì dừng tự động phát, không để nó chạy ngầm ở kiểu khác.
              setAutoplay(false);
              setMode(item.value);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {shownMode === "card" ? (
        // Dùng chung thẻ lật với Flashcards bên Luyện tập, kể cả nút loa góc phải.
        <div className="flash-stage" ref={stageRef}>
          <FlipCard card={card} flipped={revealed} flip={flip} onSwipe={tracking ? classify : undefined} />
          <div className="flash-tools">
            {/* Không lặp nút sao ở đây: header của phiên ôn đã có sẵn một nút cho mọi kiểu thẻ. */}
            <button onClick={() => speak(card.term)} aria-label={`Phát âm ${card.term}`}>
              ◖))
            </button>
          </div>
        </div>
      ) : (
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
            {card.collocation && <p className="review-collocation"><b>{card.collocation}</b>{card.collocationVi && <span>{card.collocationVi}</span>}</p>}
            {(card.synonyms?.length || card.antonyms?.length || card.related?.length || card.paraphrases?.length || card.ieltsTopics?.length) && (
              <div className="review-ielts">
                {!!card.synonyms?.length && <p><b>Đồng nghĩa</b><span>{withMeanings(card.synonyms, card.synonymDetails)}</span></p>}
                {!!card.antonyms?.length && <p><b>Trái nghĩa</b><span>{withMeanings(card.antonyms, card.antonymDetails)}</span></p>}
                {!!card.related?.length && <p><b>Từ cùng chủ đề</b><span>{withMeanings(card.related, card.relatedDetails)}</span></p>}
                {!!card.paraphrases?.length && <p><b>Paraphrase</b><span>{card.paraphrases.join(" · ")}</span></p>}
                {!!card.ieltsTopics?.length && <p><b>IELTS topics</b><span>{card.ieltsTopics.join(" · ")}</span></p>}
              </div>
            )}
            <p className="example">
              {card.example}
              {card.exampleVi && <em>{card.exampleVi}</em>}
            </p>
            <p className="definition">{card.definition}</p>
          </>
        )}
      </section>
      )}
      {shownMode === "card" ? (
        <div className="flash-bar">
          <label className="track-toggle">
            <input
              type="checkbox"
              checked={tracking}
              onChange={(event) => {
                setTracking(event.target.checked);
                setAutoplay(false);
              }}
            />
            <span />
            Theo dõi tiến độ
          </label>

          {tracking ? (
            <div className="track-actions">
              <button className="track-learning-btn" onClick={() => classify(false)}>
                Đang học
              </button>
              <b>
                {index + 1} / {total}
              </b>
              <button className="track-known-btn" onClick={() => classify(true)}>
                Đã biết
              </button>
            </div>
          ) : (
            <div className="flash-nav">
              <button onClick={() => step(-1)} disabled={index === 0} aria-label="Thẻ trước">
                ←
              </button>
              <b>
                {index + 1} / {total}
              </b>
              {/* Thẻ cuối bấm tiếp thì sang màn tổng kết của phiên, không khoá như bên Luyện tập. */}
              <button onClick={() => step(1)} aria-label={index + 1 >= total ? "Kết thúc phiên" : "Thẻ sau"}>
                →
              </button>
            </div>
          )}
          <div className="flash-options">
            <button className={autoplay ? "active" : ""} onClick={() => setAutoplay((value) => !value)} aria-label="Tự động phát" title="Tự động phát">
              {autoplay ? "❚❚" : "▶"}
            </button>
            <button onClick={shuffle} aria-label="Xáo trộn" title="Xáo trộn thứ tự thẻ">
              ⇄
            </button>
            <button
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void stageRef.current?.requestFullscreen();
              }}
              aria-label="Toàn màn hình"
              title="Toàn màn hình"
            >
              ⛶
            </button>
          </div>
        </div>
      ) : !revealed ? (
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
        {shownMode === "card" ? (
          tracking ? (
            <>
              Kéo thẻ sang <b>phải</b> nếu đã biết, sang <b>trái</b> nếu đang học · <kbd>Space</kbd> lật thẻ · <kbd>S</kbd> gắn sao · <kbd>Esc</kbd> thoát
            </>
          ) : (
            <>
              Phím tắt: <kbd>Space</kbd> lật thẻ · <kbd>←</kbd> <kbd>→</kbd> chuyển thẻ · <kbd>S</kbd> gắn sao · <kbd>Esc</kbd> thoát
            </>
          )
        ) : (
          <>
            Phím tắt: <kbd>Space</kbd> lật thẻ · <kbd>1–4</kbd> {shownMode === "quiz" && !revealed ? "chọn đáp án" : "đánh giá"} · <kbd>S</kbd> gắn sao · <kbd>Esc</kbd> thoát
          </>
        )}
      </footer>
    </main>
  );
}

// study không bắt buộc: ở màn luyện tập không có chỗ để mở phiên ôn cho một từ lẻ.
function WordDetail({ word, close, study, speak }: { word: WordCard; close: () => void; study?: () => void; speak: (text: string) => void }) {
  const usageFields = [
    ["Đồng nghĩa", word.synonyms, word.synonymDetails],
    ["Trái nghĩa", word.antonyms, word.antonymDetails],
    ["Từ hay đi cùng chủ đề", word.related, word.relatedDetails],
  ] as const;
  const simpleFields = [["Paraphrase IELTS", word.paraphrases], ["Chủ đề IELTS", word.ieltsTopics]] as const;
  return (
    <div className="modal-backdrop word-detail-backdrop" onMouseDown={close}>
      <article className="word-detail" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">THẺ TỪ VỰNG ĐẦY ĐỦ</span><h2>{word.term}</h2><p>{word.ipa} · {word.partOfSpeech || "chưa xác định loại từ"}</p></div>
          <button onClick={close} aria-label="Đóng">×</button>
        </header>
        <button className="detail-speak" onClick={() => speak(word.term)}>◖)) Nghe phát âm</button>
        <section className="detail-meaning"><b>Nghĩa tiếng Việt</b><p>{word.meaning}</p><small>{word.definition || "Chưa có định nghĩa Anh–Anh."}</small></section>
        {word.collocation && <section className="detail-collocation"><span>CỤM NÊN HỌC</span><h3><EnglishText text={word.collocation} /></h3><p>{word.collocationVi}</p></section>}
        <section className="detail-example"><b>Ví dụ thực tế</b><p><EnglishText text={word.example} /></p>{word.exampleVi && <small>{word.exampleVi}</small>}</section>
        <div className="usage-detail-grid">
          {usageFields.map(([label, values, details]) => <section key={label}><b>{label}</b>{details?.length ? (
                <div>
                  {details.map((item) => (
                    <article key={item.term}>
                      <h4>{item.term}</h4>
                      <strong>{item.meaningVi}</strong>
                      <p>{item.example}</p>
                      <small>{item.exampleVi}</small>
                    </article>
                  ))}
                </div>
              ) : values?.length ? (
                <div className="legacy-related">
                  {values.map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                  {/* Nút bổ sung chỉ áp dụng cho từ tự thêm; bộ PDF lấy dữ liệu từ file dựng sẵn. */}
                  {!isPdfVocabulary(word) && <small>Bấm “Bổ sung từ thiếu” để thêm nghĩa và câu ngữ cảnh.</small>}
                </div>
              ) : (
                <small>{label === "Trái nghĩa" ? "Từ này không có từ trái nghĩa thông dụng." : "Chưa có gợi ý."}</small>
              )}</section>)}
        </div>
        <div className="detail-field-grid">
          {simpleFields.map(([label, values]) => (
            <section key={label}>
              <b>{label}</b>
              {values?.length ? <div>{values.map((value) => <span key={value}>{value}</span>)}</div> : <small>Chưa có gợi ý.</small>}
            </section>
          ))}
        </div>
        <footer><button onClick={close}>Đóng</button>{study && <button className="primary" onClick={study}>Học từ này →</button>}</footer>
      </article>
    </div>
  );
}

// Pháo giấy dựng bằng DOM thuần, không thêm thư viện. Vị trí và màu cố định theo chỉ số
// nên không đổi giữa các lần render, và tự dừng sau khi animation chạy xong.
function Celebration({ pieces = 70 }: { pieces?: number }) {
  const confetti = useMemo(
    () =>
      Array.from({ length: pieces }, (_, index) => ({
        left: (index * 37) % 100,
        delay: ((index * 13) % 100) / 100,
        duration: 2.4 + ((index * 7) % 12) / 10,
        tilt: ((index * 29) % 90) - 45,
        tone: index % 5,
      })),
    [pieces],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {confetti.map((piece, index) => (
        <i key={index} className={`confetti-piece tone-${piece.tone}`} style={{ left: `${piece.left}%`, animationDelay: `${piece.delay}s`, animationDuration: `${piece.duration}s`, transform: `rotate(${piece.tilt}deg)` }} />
      ))}
    </div>
  );
}

function SessionSummary({ total, ratings, streak, close, restart }: { total: number; ratings: Rating[]; streak: { current: number; best: number }; close: () => void; restart: () => void }) {
  const graded = ratings.length;
  const solid = ratings.filter((rating) => rating === "good" || rating === "easy").length;
  const accuracy = graded ? Math.round((solid / graded) * 100) : 0;
  // "Hoàn thành tốt" = ôn hết phiên và từ 80% số thẻ trở lên ở mức Được/Dễ.
  const excellent = graded > 0 && accuracy >= 80;
  return (
    <main className="review summary">
      {excellent && <Celebration />}
      <section className="flashcard">
        <span className={excellent ? "summary-mark cheer" : "summary-mark"}>{excellent ? "🎉" : "✓"}</span>
        <span className="card-label">{excellent ? "XUẤT SẮC!" : "HOÀN THÀNH PHIÊN HỌC"}</span>
        <h1>{total} thẻ đã ôn</h1>
        {!!graded && (
          <div className="summary-stats">
            <div>
              <strong>{accuracy}%</strong>
              <span>nhớ tốt</span>
            </div>
            <div>
              <strong>
                {solid}/{graded}
              </strong>
              <span>thẻ Được · Dễ</span>
            </div>
            <div>
              <strong>🔥 {streak.current}</strong>
              <span>ngày liên tiếp</span>
            </div>
          </div>
        )}
        <p className="definition">
          {/* Thẻ ghi nhớ không chấm điểm nên không có thẻ nào vào lịch ôn — đừng hứa nhầm. */}
          {!graded
            ? `Bạn vừa xem lại ${total} thẻ. Chuyển sang kiểu có chấm điểm để lịch ôn được cập nhật.`
            : excellent
              ? streak.current > 1
                ? `Giữ chuỗi ${streak.current} ngày rồi — kỷ lục của bạn là ${streak.best} ngày.`
                : "Kết quả đã được đồng bộ vào lịch ôn tiếp theo của bạn."
              : "Những thẻ bạn còn quên sẽ quay lại sớm hơn trong lịch ôn."}
        </p>
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

// intent: chế độ được chọn thẳng từ thanh bên trái. Component được gắn key theo
// intent nên mỗi lần chọn là dựng lại từ đầu — khỏi phải đồng bộ state trong effect.
function Practice({ words, intent }: { words: WordCard[]; intent?: Exclude<PracticeMode, "menu"> | null }) {
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
  const [mode, setMode] = useState<PracticeMode>(intent === "shadow" ? "shadow" : "menu");
  const [pendingMode, setPendingMode] = useState<Exclude<PracticeMode, "menu"> | null>(intent === "shadow" ? null : intent ?? null);
  const [practiceWords, setPracticeWords] = useState<WordCard[]>([]);
  // Đếm giờ luyện tập cho biểu đồ trang chủ. Đặt ở đây nên mọi chế độ đều được
  // tính mà không phải sửa từng chế độ. Chỉ ghi vào localStorage, không đụng state.
  useEffect(() => {
    const skill = mode === "menu" ? "" : skillOfMode[mode];
    if (!skill) return;
    let last = Date.now();
    const flush = () => {
      const seconds = (Date.now() - last) / 1000;
      last = Date.now();
      // Bỏ qua quãng nghỉ dài: mở tab rồi đi làm việc khác không phải là luyện tập.
      if (seconds > 0 && seconds < 120) logPractice(skill, seconds);
    };
    const timer = setInterval(flush, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else last = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);
  if (!words.length)
    return (
      <div className="page">
        <h1>Luyện tập</h1>
        <p>Hãy thêm từ vựng trước khi bắt đầu.</p>
      </div>
    );
  const activeWords = practiceWords.length ? practiceWords : words;
  const personalWords = words.filter((item) => !isPdfVocabulary(item));
  const pdfWords = words.filter(isPdfVocabulary);
  const pdfTopics = [...new Set(pdfWords.flatMap((item) => item.topic.split(" · ")))];

  function chooseMode(nextMode: Exclude<PracticeMode, "menu">) {
    if (nextMode === "shadow") {
      setMode(nextMode);
      return;
    }
    setPendingMode(nextMode);
  }
  function chooseFolder(folderWords: WordCard[]) {
    if (!pendingMode || !folderWords.length) return;
    setPracticeWords(folderWords);
    setMode(pendingMode);
    setPendingMode(null);
  }
  function returnToModes() {
    setMode("menu");
    setPendingMode(null);
    setPracticeWords([]);
  }
  if (mode === "menu" && pendingMode)
    return (
      <FolderPicker
        mode={pendingMode}
        personalWords={personalWords}
        pdfWords={pdfWords}
        topics={pdfTopics}
        choose={chooseFolder}
        close={() => setPendingMode(null)}
      />
    );
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
          <button onClick={() => chooseMode("vocab")}>
            <span>▤</span>
            <b>Luyện từ vựng</b>
            <small>Sáu cách luyện trên cùng một bộ từ: lật thẻ, gõ từ, nghe, đảo ngược, điền chỗ trống, hỗn hợp</small>
          </button>
          <button onClick={() => chooseMode("learn")}>
            <span>✎</span>
            <b>Học tới khi thuộc</b>
            <small>Lặp lại riêng những từ còn sai cho tới khi thuộc hết bộ</small>
          </button>
          <button onClick={() => chooseMode("test")}>
            <span>◉</span>
            <b>Kiểm tra chấm điểm</b>
            <small>Làm một mạch không xem đáp án, chấm điểm ở cuối bài</small>
          </button>
          <button onClick={() => chooseMode("dictation")}>
            <span>≋</span>
            <b>Chép chính tả</b>
            <small>Nghe câu và gõ lại theo chủ đề, trình độ</small>
          </button>
          <button onClick={() => chooseMode("shadow")}>
            <span>◉</span>
            <b>Nói nhại</b>
            <small>Nghe câu mẫu, nói theo và xem máy nghe ra được bao nhiêu</small>
          </button>
          <button onClick={() => chooseMode("translate")}>
            <span>⇄</span>
            <b>Dịch Việt → Anh</b>
            <small>Đọc đoạn tiếng Việt của folder, viết lại bằng tiếng Anh và được chấm</small>
          </button>
          <button onClick={() => chooseMode("match")}>
            <span>⌘</span>
            <b>Nối cặp</b>
            <small>Ghép từ với nghĩa nhanh nhất</small>
          </button>
        </div>
      </div>
    );
  if (mode === "match") return <MatchGame words={activeWords} close={returnToModes} />;
  if (mode === "dictation") return <DictationPractice words={activeWords} close={returnToModes} />;
  if (mode === "shadow") return <ShadowingPractice close={returnToModes} onPractised={() => markStudiedToday()} />;
  if (mode === "vocab")
    return (
      <VocabPractice
        words={activeWords}
        close={returnToModes}
        onStudied={markStudiedToday}
        onPickOther={(next) => setMode(next as PracticeMode)}
      />
    );
  if (mode === "learn") return <LearnMode words={activeWords} setMode={setMode} />;
  if (mode === "test") return <TestMode words={activeWords} setMode={setMode} />;
  return <TranslateMode words={activeWords} setMode={setMode} back={returnToModes} />;
}

// Thứ tự và nhãn của các chế độ khi hiện ở thanh bên trái.
// Xếp theo việc người học đang muốn làm, không theo tên chế độ. Nhóm trên là học
// thuộc mặt chữ và nghĩa; nhóm dưới là dùng vốn từ đó vào nghe, nói, viết.
const practiceNav: { value: Exclude<PracticeMode, "menu">; label: string; icon: string; skill: string }[] = [
  { value: "dictation", label: "Dictation", icon: "◖))", skill: "dictation" },
  { value: "shadow", label: "Shadowing", icon: "◐", skill: "shadowing" },
  { value: "translate", label: "Luyện viết", icon: "✍", skill: "writing" },
  { value: "vocab", label: "Luyện từ vựng", icon: "▤", skill: "vocab" },
];

// Ba chế độ này cũng tính giờ vào kỹ năng từ vựng, dù không có mặt ở thanh bên.
const hiddenVocabModes: Exclude<PracticeMode, "menu">[] = ["learn", "test", "match"];

/** Chế độ nào tính giờ vào kỹ năng nào, để biểu đồ trang chủ tách được các tab. */
export const skillOfMode: Record<string, string> = {
  ...Object.fromEntries(practiceNav.map((item) => [item.value, item.skill])),
  ...Object.fromEntries(hiddenVocabModes.map((mode) => [mode, "vocab"])),
};

const practiceModeNames: Record<Exclude<PracticeMode, "menu">, string> = {
  vocab: "Luyện từ vựng",
  learn: "Học tới khi thuộc",
  test: "Kiểm tra chấm điểm",
  dictation: "Nghe chép chính tả",
  shadow: "Luyện nói (Shadowing)",
  match: "Nối cặp",
  translate: "Luyện viết",
};

function FolderPicker({ mode, personalWords, pdfWords, topics, choose, close }: { mode: Exclude<PracticeMode, "menu">; personalWords: WordCard[]; pdfWords: WordCard[]; topics: string[]; choose: (words: WordCard[]) => void; close: () => void }) {
  const dailyFolders = dayNames
    .map((name, index) => ({ name, words: personalWords.filter((word) => addedDayIndex(word) === index) }))
    .filter((folder) => folder.words.length);
  const topicFolders = topics
    .map((name) => ({ name, words: pdfWords.filter((word) => word.topic.split(" · ").includes(name)) }))
    .filter((folder) => folder.words.length);
  return (
    <div className="page folder-picker-page">
      <button className="back" onClick={close}>← Chọn chức năng khác</button>
      <div className="eyebrow">BƯỚC 2 / 2</div>
      <h1>Chọn folder cho {practiceModeNames[mode]}</h1>
      <p className="page-sub">Chức năng chỉ sử dụng các từ trong folder bạn chọn.</p>
      {!!personalWords.length && (
        <section className="folder-section">
          <h3>Folder của tôi</h3>
          <div className="practice-folder-grid">
            <button onClick={() => choose(personalWords)}><span>★</span><b>Tất cả từ của tôi</b><small>{personalWords.length} từ</small><i>Chọn folder →</i></button>
            {dailyFolders.map((folder) => <button key={folder.name} onClick={() => choose(folder.words)}><span>▰</span><b>{folder.name}</b><small>{folder.words.length} từ</small><i>Chọn folder →</i></button>)}
          </div>
        </section>
      )}
      {(!!pdfWords.length || !!topicFolders.length) && (
        <section className="folder-section">
          <h3>Folder theo chủ đề</h3>
          <div className="practice-folder-grid">
            {!!pdfWords.length && <button onClick={() => choose(pdfWords)}><span>PDF</span><b>Toàn bộ từ PDF</b><small>{pdfWords.length} từ</small><i>Chọn folder →</i></button>}
            {topicFolders.map((folder) => <button key={folder.name} onClick={() => choose(folder.words)}><span>▰</span><b>{folder.name}</b><small>{folder.words.length} từ</small><i>Chọn folder →</i></button>)}
          </div>
        </section>
      )}
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

// "flash" và "listen" đã bị bỏ: chúng làm đúng việc mà hai tab "Thẻ flashcard"
// và "Nghe" trong Luyện từ vựng đã làm, chỉ ít tính năng hơn.
type PracticeMode = "menu" | "vocab" | "learn" | "test" | "match" | "dictation" | "shadow" | "translate";
// Bốn cách luyện từ vựng, hiện ngay trong mục Luyện từ vựng để đổi qua lại nhanh.
const practiceModeBar: { value: PracticeMode; label: string; icon: string }[] = [
  { value: "vocab", label: "Luyện thẻ", icon: "▤" },
  { value: "learn", label: "Học tới khi thuộc", icon: "✎" },
  { value: "test", label: "Kiểm tra", icon: "◉" },
  { value: "match", label: "Nối cặp", icon: "⌘" },
];
function PracticeModeBar({ mode, setMode }: { mode: PracticeMode; setMode: (m: PracticeMode) => void }) {
  return (
    <div className="mode-bar" role="group" aria-label="Chế độ luyện tập">
      {practiceModeBar.map((item) => (
        <button key={item.value} className={mode === item.value ? "active" : ""} onClick={() => setMode(item.value)}>
          <span>{item.icon}</span>
          {item.label}
        </button>
      ))}
      <button className="mode-bar-more" onClick={() => setMode("menu")}>
        ⋯ Chế độ khác
      </button>
    </div>
  );
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

// Thẻ ghi nhớ kiểu Quizlet: đếm thẻ, lùi/tiến, xáo trộn, tự động phát, toàn màn hình
// và tuỳ chọn theo dõi "đã biết / đang học" tách rời khỏi hộp Leitner.
// Luyện dịch Việt → Anh trên chính folder từ vựng đang học.
//
// Cả folder được ghép thành một đoạn tiếng Việt, câu đang làm được tô sáng. Người
// học viết lại bằng tiếng Anh, app đối chiếu với câu mẫu đi kèm từ đó rồi chỉ ra
// chỗ lệch. App không có mô hình ngôn ngữ nên không dám phán một câu tự do là đúng
// hay sai ngữ pháp — chỉ những lỗi chắc chắn (sai dạng từ, thiếu mạo từ, thiếu giới
// từ, chưa dùng từ đang học) mới được gọi là lỗi. Xem lib/translation-check.mjs.
function TranslateMode({ words, setMode, back }: { words: WordCard[]; setMode: (m: PracticeMode) => void; back: () => void }) {
  // Chỉ nhận từ có đủ cả câu tiếng Anh lẫn bản dịch, vì bản dịch là đề bài còn câu
  // tiếng Anh là đáp án mẫu.
  const usable = useMemo(() => words.filter((word) => word.example?.trim() && word.exampleVi?.trim()), [words]);
  // Bước chọn từ: không phải lúc nào cũng muốn học cả folder mấy trăm từ. Mặc định
  // chọn sẵn 6 từ đầu — vừa một đoạn — rồi người học tự thêm bớt.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(usable.slice(0, PASSAGE_SIZE).map((word) => word.id)));
  const [choosing, setChoosing] = useState(true);
  const [filter, setFilter] = useState("");
  // Danh sách tự nhập, không thuộc folder nào. Những từ này chưa có câu ví dụ nên
  // phải nhờ mô hình ngôn ngữ viết trước khi luyện được.
  const [extraText, setExtraText] = useState("");
  const [extraWords, setExtraWords] = useState<WordCard[]>([]);
  const [extraState, setExtraState] = useState<"idle" | "loading" | "failed">("idle");
  const [extraNote, setExtraNote] = useState("");
  const extraTerms = useMemo(() => {
    const seen = new Set(usable.map((word) => word.term.trim().toLowerCase()));
    return extraText
      .split(/[\n,;]+/)
      .map((line) => line.replace(/^[-•*\d.)\s]+/, "").trim().replace(/\s+/g, " "))
      .filter((term) => {
        const key = term.toLowerCase();
        if (!term || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 24);
  }, [extraText, usable]);

  async function writeExtras() {
    if (!extraTerms.length || extraState === "loading") return;
    setExtraState("loading");
    setExtraNote("");
    const made: WordCard[] = [];
    let failed = 0;
    for (let start = 0; start < extraTerms.length; start += PASSAGE_SIZE) {
      const batch = extraTerms.slice(start, start + PASSAGE_SIZE);
      try {
        const response = await aiFetch("/api/ai/passage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ terms: batch, mode: batch.length < 2 ? "sentences" : extraMode }),
        });
        const data = (await response.json()) as { sentences?: { term: string; vi: string; en: string }[]; error?: string };
        if (!response.ok || !data.sentences?.length) throw new Error(data.error ?? "hỏng");
        data.sentences.forEach((item, position) => {
          const term = batch.find((candidate) => candidate.toLowerCase() === item.term.toLowerCase()) ?? batch[position];
          if (!term || !item.vi || !item.en) return;
          made.push({
            id: `extra-${term.toLowerCase().replace(/\s+/g, "-")}`,
            term,
            meaning: "",
            example: item.en,
            exampleVi: item.vi,
            cloze: clozeFor(term, item.en),
            definition: "",
            // Đặt sẵn chủ đề để themeOf không tách chúng ra theo từ khoá: bạn đã
            // chọn chúng thành một danh sách, và nếu chọn kiểu đoạn văn thì các câu
            // vốn đã nối ý nhau — tách ra là hỏng mạch.
            topic: "Danh sách của bạn",
            ieltsTopics: ["Danh sách của bạn"],
            ipa: "",
            partOfSpeech: "",
            box: 1,
            lapses: 0,
            status: "new",
            reviewCount: 0,
          } as WordCard);
        });
      } catch {
        failed += batch.length;
      }
    }
    setExtraWords(made);
    setPicked((current) => new Set([...current, ...made.map((word) => word.id)]));
    setExtraState(made.length ? "idle" : "failed");
    setExtraNote(made.length ? `✓ Đã viết ví dụ cho ${made.length}/${extraTerms.length} từ${failed ? ` · ${failed} từ chưa viết được` : ""}.` : "Không gọi được mô hình ngôn ngữ nên chưa viết được ví dụ cho danh sách này.");
  }

  const [extraMode, setExtraMode] = useState<"passage" | "sentences">("sentences");
  const pool = useMemo(() => [...usable, ...extraWords], [usable, extraWords]);
  const chosen = useMemo(() => pool.filter((word) => picked.has(word.id)), [pool, picked]);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? pool.filter((word) => `${word.term} ${word.meaning}`.toLowerCase().includes(needle)) : pool;
  }, [pool, filter]);
  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Gom theo chủ đề, bỏ câu khuôn nói VỀ từ, rồi cắt thành từng đoạn ngắn đọc được.
  const passages = useMemo(
    () => buildPassages(chosen.map((word) => ({ word, vi: word.exampleVi!.trim(), en: word.example!.trim() })), { areas: ieltsAreaData as [string, string[]][] }),
    [chosen],
  );
  const [passageIndex, setPassageIndex] = useState(0);
  const passage = passages[passageIndex];
  // Gemini viết lại đoạn này thành một mạch truyện liền lạc. Không gọi được thì vẫn
  // dùng các câu ví dụ ghép sẵn — bài học không bao giờ bị chặn vì thiếu Gemini.
  const [story, setStory] = useState<{ key: number; tasks: { word: WordCard; vi: string; en: string }[] } | null>(null);
  const [storyState, setStoryState] = useState<"idle" | "loading" | "ready" | "failed" | "auto">("idle");
  const fallbackTasks: { word: WordCard; vi: string; en: string }[] = useMemo(() => passage?.tasks ?? [], [passage]);
  // Câu thay thế cho từng từ, khi người học thấy câu hiện tại không hay và bấm đổi.
  const [replaced, setReplaced] = useState<Record<string, { vi: string; en: string }>>({});
  const [swapping, setSwapping] = useState(false);
  const [swapNote, setSwapNote] = useState("");
  const baseTasks = story?.key === passageIndex ? story.tasks : fallbackTasks;
  // Câu đã đổi thay chỗ câu gốc, kể cả khi đoạn văn được viết lại sau đó.
  const tasks = useMemo(() => baseTasks.map((task) => (replaced[task.word.id] ? { ...task, ...replaced[task.word.id] } : task)), [baseTasks, replaced]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [hintCount, setHintCount] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const [aiGrade, setAiGrade] = useState<AiGrade | null>(null);
  const [grading, setGrading] = useState(false);
  // Thẻ chi tiết của từ, mở khi bấm vào tên từ ở bảng bên phải hoặc ở bước chọn từ.
  const [detail, setDetail] = useState<WordCard | null>(null);
  const speakWord = (text: string) => window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text));
  const current = tasks[index];
  const result = useMemo(() => (current && checked ? gradeTranslation(current.en, typed, current.word.term) : null), [current, checked, typed]);
  const referenceWords = current ? current.en.split(/\s+/) : [];
  const average = scores.length ? Math.round(scores.reduce((total, item) => total + item, 0) / scores.length) : 0;

  async function buildStory() {
    if (!passage || storyState === "loading") return;
    setStoryState("loading");
    try {
      const response = await aiFetch("/api/ai/passage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: fallbackTasks.map((task) => task.word.term), topic: passage.topic }),
      });
      const data = (await response.json()) as { sentences?: { term: string; vi: string; en: string }[]; error?: string };
      if (!response.ok || !data.sentences?.length) throw new Error(data.error ?? "Không dựng được đoạn văn.");
      // Ghép câu Gemini viết trở lại đúng thẻ từ vựng, giữ nguyên thứ tự đã gửi đi.
      const rebuilt = data.sentences
        .map((item, position) => ({ word: fallbackTasks.find((task) => task.word.term.toLowerCase() === item.term.toLowerCase())?.word ?? fallbackTasks[position]?.word, vi: item.vi, en: item.en }))
        .filter((item): item is { word: WordCard; vi: string; en: string } => Boolean(item.word));
      if (rebuilt.length < 2) throw new Error("Đoạn văn không khớp với từ trong folder.");
      setStory({ key: passageIndex, tasks: rebuilt });
      setStoryState("ready");
      setIndex(0);
      setTyped("");
      setChecked(false);
      setAiGrade(null);
    } catch {
      setStoryState("failed");
    }
  }

  // Người học thấy câu không hay thì xin câu khác cho chính từ đó.
  async function swapSentence() {
    if (!current || swapping) return;
    setSwapping(true);
    setSwapNote("");
    try {
      const response = await aiFetch("/api/ai/passage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: [current.word.term], mode: "sentences", avoid: current.vi, topic: current.word.meaning || undefined }),
      });
      const data = (await response.json()) as { sentences?: { vi: string; en: string }[]; error?: string };
      const made = data.sentences?.[0];
      if (!response.ok || !made?.vi || !made?.en) throw new Error(data.error ?? "Không viết được câu khác.");
      setReplaced((current2) => ({ ...current2, [current.word.id]: { vi: made.vi, en: made.en } }));
      // Câu đổi rồi thì bài làm cũ không còn ý nghĩa, xoá đi để làm lại từ đầu.
      setTyped("");
      setChecked(false);
      setAiGrade(null);
      setHintCount(0);
    } catch (error) {
      setSwapNote(error instanceof Error ? error.message : "Không đổi được câu.");
    } finally {
      setSwapping(false);
    }
  }

  async function check() {
    if (!current || !typed.trim() || checked) return;
    const answer = typed;
    const task = current;
    setChecked(true);
    const local = gradeTranslation(task.en, answer, task.word.term);
    setScores((list) => [...list, local.accuracy]);
    setGrading(true);
    let grade: AiGrade | null = null;
    try {
      const response = await aiFetch("/api/ai/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vietnamese: task.vi, answer, term: task.word.term, reference: task.en }),
      });
      const data = (await response.json()) as AiGrade & { error?: string };
      grade = response.ok && !data.error ? data : null;
      setAiGrade(grade);
    } catch {
      setAiGrade(null);
    } finally {
      setGrading(false);
    }
    recordAttempt(task, answer, local, grade);
  }

  // Nhật ký bài dịch nuôi phần "bạn hay sai gì" ở trang Thống kê. Mô hình chấm thì
  // tin nhãn của mô hình; không có mô hình thì rút nhãn từ cách so câu mẫu — khắt
  // khe hơn, nhưng vẫn hơn là không ghi gì.
  function recordAttempt(task: { word: WordCard; vi: string; en: string }, answer: string, local: ReturnType<typeof gradeTranslation>, grade: AiGrade | null) {
    const gradedBy = grade ? "llm" : "reference";
    const errorTypes = grade ? typesFromIssues(grade.issues) : typesFromNotes(local.notes);
    const attempt = makeAttempt({
      term: task.word.term,
      vietnamese: task.vi,
      answer,
      reference: task.en,
      score: grade ? grade.score : local.accuracy,
      correct: grade ? grade.correct : local.matchesReference,
      gradedBy,
      errorTypes,
    });
    logAttempt(attempt);
    markStudiedToday();
    void pushTranslationAttempt({
      term: task.word.term,
      vietnamese: task.vi,
      reference: task.en,
      answer,
      score: attempt.score,
      correct: attempt.correct,
      gradedBy,
      corrected: grade?.suggestion,
      comment: grade?.comment,
      issues: grade?.issues,
      errorTypes,
    });
  }
  function next() {
    setIndex((value) => value + 1);
    setTyped("");
    setChecked(false);
    setHintCount(0);
  }
  function restart() {
    setPassageIndex(0);
    setIndex(0);
    setTyped("");
    setChecked(false);
    setHintCount(0);
    setScores([]);
    setAiGrade(null);
    setStory(null);
    setStoryState("idle");
  }
  // Quay lại bước chọn từ, giữ nguyên những từ đang tick để chỉnh thêm bớt.
  function backToPicker() {
    restart();
    setChoosing(true);
  }
  function nextPassage() {
    setPassageIndex((value) => value + 1);
    setIndex(0);
    setTyped("");
    setChecked(false);
    setHintCount(0);
  }

  // Folder rỗng vẫn cho vào bước chọn, vì có thể học bằng danh sách tự nhập.
  if (!pool.length && !choosing)
    return (
      <div className="page practice-session">
        <button className="back" onClick={back}>← Chọn chế độ khác</button>
        <div className="panel practice-card">
          <h2>Folder này chưa có câu ví dụ kèm bản dịch</h2>
          <p className="page-sub">Bài dịch cần cả câu tiếng Anh lẫn nghĩa tiếng Việt của câu đó. Hãy bấm “Bổ sung từ thiếu” ở trang Từ vựng rồi quay lại.</p>
        </div>
      </div>
    );

  // Bước chọn từ. Chọn xong mới dựng đoạn, nên không phải học cả folder mấy trăm từ.
  if (choosing)
    return (
      <div className="page practice-session">
        <button className="back" onClick={back}>← Chọn chế độ khác</button>
        <div className="eyebrow">BƯỚC CHỌN TỪ</div>
        <h1>Chọn từ để luyện dịch</h1>
        <p className="page-sub">Folder có {usable.length} từ đủ dữ liệu. Chọn riêng những từ bạn muốn, hoặc tự nhập danh sách bên dưới — mỗi đoạn văn gồm {PASSAGE_SIZE} câu.</p>

        <section className="extra-list">
          <b>Danh sách riêng của bạn</b>
          <p>Nhập từ không có trong folder — mỗi dòng một từ, hoặc ngăn nhau bằng dấu phẩy. App sẽ viết câu ví dụ kèm bản dịch cho chúng.</p>
          <textarea value={extraText} onChange={(event) => setExtraText(event.target.value)} placeholder={"deadline\nnegotiate\nbudget cut"} />
          <div className="extra-actions">
            <div className="bulk-example-modes" role="group" aria-label="Kiểu ví dụ cho danh sách riêng">
              <button type="button" className={extraMode === "sentences" ? "active" : ""} onClick={() => setExtraMode("sentences")}>
                Từng câu riêng
              </button>
              <button type="button" className={extraMode === "passage" ? "active" : ""} onClick={() => setExtraMode("passage")}>
                Một đoạn liền mạch
              </button>
            </div>
            <button type="button" className="primary" disabled={!extraTerms.length || extraState === "loading"} onClick={() => void writeExtras()}>
              {extraState === "loading" ? "◌ Đang viết ví dụ…" : `✦ Viết ví dụ cho ${extraTerms.length} từ`}
            </button>
          </div>
          {extraNote && <p className={extraNote.startsWith("✓") ? "lookup-message success" : "lookup-message"}>{extraNote}</p>}
        </section>
        <div className="picker-tools">
          <div className="picker-filter">
            <input aria-label="Lọc danh sách từ" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Lọc theo từ hoặc nghĩa…" />
          </div>
          <button type="button" onClick={() => setPicked(new Set(shown.map((word) => word.id)))}>Chọn tất cả{filter ? " (đang lọc)" : ""}</button>
          <button type="button" onClick={() => setPicked(new Set())}>Bỏ chọn hết</button>
        </div>
        <div className="picker-grid">
          {shown.map((word) => (
            <div key={word.id} className={`picker-card ${picked.has(word.id) ? "active" : ""} ${word.id.startsWith("extra-") ? "own" : ""}`}>
              <button type="button" className="picker-pick" onClick={() => toggle(word.id)}>
                <span>{picked.has(word.id) ? "✓" : "＋"}</span>
                <b>{word.term}</b>
                {/* Từ tự nhập chưa có nghĩa nên hiện luôn câu ví dụ vừa viết cho dễ nhận. */}
                <small>{word.id.startsWith("extra-") ? word.exampleVi : word.meaning}</small>
              </button>
              {/* Nút riêng để xem chi tiết, tách khỏi vùng bấm chọn nên không tick nhầm. */}
              <button type="button" className="picker-info" onClick={() => setDetail(word)} aria-label={`Xem chi tiết từ ${word.term}`} title="Xem chi tiết">
                ⓘ
              </button>
            </div>
          ))}
        </div>
        <div className="picker-bar">
          {/* Số đoạn lấy từ kết quả gom nhóm thật, vì các từ khác chủ đề sẽ tách ra
              nhiều đoạn chứ không chỉ chia theo số lượng. */}
          <b>Đã chọn {chosen.length} từ{passages.length ? ` · ${passages.length} đoạn` : ""}</b>
          <button className="primary" type="button" disabled={!chosen.length} onClick={() => { restart(); setChoosing(false); }}>
            Bắt đầu luyện dịch →
          </button>
        </div>
        {detail && <WordDetail word={detail} close={() => setDetail(null)} speak={speakWord} />}
      </div>
    );

  if (!passages.length)
    return (
      <div className="page practice-session">
        <button className="back" onClick={backToPicker}>← Chọn từ khác</button>
        <div className="panel practice-card">
          <h2>Những từ đã chọn chưa dùng được</h2>
          <p className="page-sub">Câu ví dụ của chúng là câu khuôn nói về chính từ đó nên không hợp để luyện dịch. Hãy chọn từ khác hoặc bổ sung lại ví dụ.</p>
        </div>
      </div>
    );

  // Xong đoạn này mà còn đoạn khác thì mời sang đoạn kế, chưa tổng kết vội.
  if (index >= tasks.length && passageIndex + 1 < passages.length)
    return (
      <div className="page practice-session">
        <PracticeModeBar mode="translate" setMode={setMode} />
        <div className="panel practice-card">
          <span className="summary-mark">✓</span>
          <h2>Xong đoạn {passageIndex + 1} / {passages.length}</h2>
          <p className="page-sub">Đoạn tiếp theo — <b>{passages[passageIndex + 1].topic}</b>, {passages[passageIndex + 1].tasks.length} câu.</p>
          <div className="summary-actions">
            <button onClick={back}>Thoát</button>
            <button className="primary" onClick={nextPassage}>Đoạn tiếp theo →</button>
          </div>
        </div>
      </div>
    );

  if (index >= tasks.length)
    return (
      <div className="page practice-session">
        <PracticeModeBar mode="translate" setMode={setMode} />
        <div className="panel practice-card">
          <span className="summary-mark">{average >= 80 ? "🎉" : "✓"}</span>
          <h2>Xong {scores.length} câu dịch</h2>
          <div className="track-summary">
            <div className="track-known"><strong>{average}</strong><span>điểm trung bình</span></div>
            <div className="track-learning"><strong>{scores.filter((item) => item >= 90).length}/{scores.length}</strong><span>câu đạt từ 90 điểm</span></div>
          </div>
          <div className="summary-actions">
            <button onClick={backToPicker}>Chọn từ khác</button>
            <button onClick={back}>Đổi folder</button>
            <button className="primary" onClick={restart}>Làm lại</button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="page practice-session translate-page">
      <PracticeModeBar mode="translate" setMode={setMode} />
      <div className="translate-grid">
        <section className="translate-source">
          <div className="translate-head">
            <span className="eyebrow">
              {passage.topic} · ĐOẠN {passageIndex + 1}/{passages.length}
              {storyState === "ready" && <em className="story-flag"> · ĐOẠN VĂN LIỀN MẠCH</em>}
            </span>
            <b>Câu {index + 1} / {tasks.length}</b>
          </div>
          <p className="translate-paragraph">
            {tasks.map((task, position) => (
              <span key={task.word.id} className={`${position === index ? "active" : position < index ? "done" : ""} ${replaced[task.word.id] ? "swapped" : ""}`}>
                {task.vi}{" "}
              </span>
            ))}
          </p>
          <div className="translate-input">
            <textarea
              aria-label="Bản dịch tiếng Anh của bạn"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (checked) next();
                  else check();
                }
              }}
              placeholder="Viết câu tiếng Anh cho câu đang tô sáng…"
            />
          </div>
          {storyState !== "ready" && storyState !== "auto" && (
            <button className="story-build" type="button" disabled={storyState === "loading"} onClick={() => void buildStory()}>
              {storyState === "loading" ? "◌ Đang viết đoạn văn…" : storyState === "failed" ? "↻ Thử viết lại đoạn văn liền mạch" : "✦ Viết lại thành đoạn văn liền mạch"}
            </button>
          )}
          {storyState === "failed" && <p className="story-note">Không gọi được mô hình ngôn ngữ. Bạn vẫn luyện dịch bình thường với các câu ví dụ sẵn có.</p>}
          {swapNote && <p className="story-note">{swapNote}</p>}
          <div className="translate-actions">
            <button onClick={backToPicker}>← Chọn từ</button>
            {/* Câu không hay thì xin câu khác cho chính từ này, bài làm dở được xoá. */}
            <button disabled={swapping} onClick={() => void swapSentence()} title="Viết câu khác cho từ này">
              {swapping ? "◌ Đang đổi…" : "↻ Câu khác"}
            </button>
            <button disabled={hintCount >= referenceWords.length} onClick={() => setHintCount((value) => value + 1)}>
              ♦ Gợi ý {hintCount ? `(${hintCount}/${referenceWords.length})` : ""}
            </button>
            {checked ? (
              <button className="primary" onClick={next}>{index + 1 >= tasks.length ? "Xem kết quả →" : "Câu tiếp →"}</button>
            ) : (
              <button className="primary" disabled={!typed.trim()} onClick={check}>Chấm câu này</button>
            )}
          </div>
          {hintCount > 0 && !checked && (
            <p className="translate-hint">
              {referenceWords.map((word, position) => (
                <span key={position} className={position < hintCount ? "shown" : "hidden"}>
                  {position < hintCount ? word : "_".repeat(Math.min(9, Math.max(2, word.replace(/[^a-z]/gi, "").length)))}
                </span>
              ))}
            </p>
          )}
        </section>

        <aside className="translate-feedback">
          <div className="translate-meta">
            {/* Bấm vào từ để mở thẻ chi tiết — nghĩa, IPA, cụm nên học, đồng/trái nghĩa. */}
            <button type="button" className="meta-word" onClick={() => setDetail(current.word)} title={`Xem chi tiết từ ${current.word.term}`}>
              <span>Từ đang luyện ⓘ</span>
              <b>{current.word.term}</b>
            </button>
            {/* Có chấm bằng mô hình thì hiện điểm thật. "Khớp câu mẫu" chỉ là độ
                giống một cách dịch, không phải điểm đúng/sai — đừng để nó đứng
                ngang hàng và nói ngược lại kết luận. */}
            <div>
              <span>{aiGrade ? "Điểm bài dịch" : "Khớp câu mẫu"}</span>
              <b>{aiGrade ? `${aiGrade.score}/100` : checked && result ? `${result.accuracy}%` : "—"}</b>
            </div>
          </div>
          {!checked ? (
            <p className="translate-empty">Viết câu tiếng Anh rồi bấm <b>Chấm câu này</b>. Bài sẽ được chấm và chỉ ra chỗ cần sửa.</p>
          ) : (
            result && (
              <>
                {grading && <p className="translate-empty">◌ Đang chấm bài…</p>}
                {aiGrade && (
                  <section className={aiGrade.correct ? "ai-grade correct" : "ai-grade"}>
                    <div className="ai-grade-head">
                      <b>{aiGrade.correct ? "✓ Câu của bạn đúng" : "Cần sửa"}</b>
                      <span>{aiGrade.score}/100</span>
                    </div>
                    {aiGrade.suggestion && <p className="ai-grade-suggestion"><span>Gợi ý:</span> <EnglishText text={aiGrade.suggestion} /></p>}
                    {aiGrade.issues.length > 0 && (
                      <ul className="translate-notes">
                        {aiGrade.issues.map((issue, position) => (
                          <li key={position} className="form">
                            {issue.wrong && issue.right && (
                              <>
                                <b>{issue.wrong}</b> → <b>{issue.right}</b> ·{" "}
                              </>
                            )}
                            {issue.why}
                          </li>
                        ))}
                      </ul>
                    )}
                    {aiGrade.comment && <p className="ai-grade-comment">{aiGrade.comment}</p>}
                  </section>
                )}
                {/* Khi đã chấm bằng mô hình, phần so câu mẫu chỉ còn là tham khảo và
                    được thu gọn. Trước đây nó đứng ngang hàng rồi nói ngược: mô hình
                    bảo "đúng 100/100" còn nó bảo "thiếu mạo từ the, cần sửa" — trong
                    khi câu người học hoàn toàn đúng, chỉ khác cách diễn đạt. */}
                {aiGrade ? (
                  <details className="reference-fold">
                    <summary>Đối chiếu từng từ với một cách dịch mẫu</summary>
                    <p className="translate-diff">
                      {result.operations.map((item, position) => (
                        <span key={position} className={item.type}>
                          {item.type === "extra" ? item.answer : item.reference}
                        </span>
                      ))}
                    </p>
                    <p className="translate-reference"><b>Một cách dịch:</b> <EnglishText text={current.en} /></p>
                    <p className="translate-caveat">Đây chỉ là một cách dịch để bạn tham khảo. Câu của bạn khác nó không có nghĩa là sai — phần chấm ở trên mới là kết luận.</p>
                  </details>
                ) : (
                  <>
                    <h3>Đối chiếu với câu mẫu</h3>
                    <p className="translate-diff">
                      {result.operations.map((item, position) => (
                        <span key={position} className={item.type}>
                          {item.type === "extra" ? item.answer : item.reference}
                        </span>
                      ))}
                    </p>
                    <p className="translate-reference"><b>Câu mẫu:</b> <EnglishText text={current.en} /></p>
                    {result.notes.length > 0 && (
                      <>
                        <h3>{result.notes.some((item) => item.kind !== "diff") ? "Cần sửa" : "Khác câu mẫu"}</h3>
                        <ul className="translate-notes">
                          {result.notes.map((item, position) => (
                            <li key={position} className={item.kind}>
                              {item.text.split("**").map((part, piece) => (piece % 2 ? <b key={piece}>{part}</b> : <span key={piece}>{part}</span>))}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <p className={`translate-verdict ${result.verdict}`}>
                      {result.verdict === "perfect"
                        ? "Trùng khớp câu mẫu."
                        : result.verdict === "errors"
                          ? "Có lỗi chắc chắn cần sửa ở phần trên."
                          : "Không thấy lỗi chắc chắn nào. Câu bạn diễn đạt khác câu mẫu — có thể vẫn đúng, hãy tự đối chiếu."}
                    </p>
                  </>
                )}
                <p className="translate-caveat">App chấm bằng cách so với câu mẫu, không phải bằng mô hình ngôn ngữ, nên một cách dịch đúng khác vẫn có thể bị báo là lệch.</p>
              </>
            )
          )}
        </aside>
      </div>
      {detail && <WordDetail word={detail} close={() => setDetail(null)} speak={speakWord} />}
    </div>
  );
}

// Thẻ lật dùng chung cho Flashcards ở Luyện tập và kiểu "Thẻ ghi nhớ" trong phiên ôn
// tập, để hai chỗ không trôi ra hai kiểu giao diện khác nhau.
// Kéo bao nhiêu pixel thì tính là đã chọn; dưới ngưỡng này coi như bấm để lật thẻ.
const SWIPE_THRESHOLD = 90;

function FlipCard({ card, flipped, flip, onSwipe }: { card: WordCard; flipped: boolean; flip: () => void; onSwipe?: (known: boolean) => void }) {
  // Kéo sang phải là "đã biết", sang trái là "đang học" — chỉ bật khi đang theo dõi tiến độ.
  const [drag, setDrag] = useState(0);
  const startX = useRef<number | null>(null);
  const moved = useRef(false);
  const decided = drag > SWIPE_THRESHOLD ? "known" : drag < -SWIPE_THRESHOLD ? "learning" : "";

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!onSwipe) return;
    startX.current = event.clientX;
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!onSwipe || startX.current === null) return;
    const offset = event.clientX - startX.current;
    // 12px là mức xê dịch quen thuộc của một cú bấm hơi rung tay; quá mức đó mới coi là kéo.
    if (Math.abs(offset) > 12) moved.current = true;
    setDrag(offset);
  }
  function onPointerUp() {
    if (!onSwipe || startX.current === null) return;
    startX.current = null;
    if (Math.abs(drag) > SWIPE_THRESHOLD) onSwipe(drag > 0);
    setDrag(0);
  }

  return (
    <button
      className={`quizlet-flashcard ${flipped ? "is-flipped" : ""} ${drag ? "is-dragging" : ""} ${decided ? `swipe-${decided}` : ""}`}
      // Kéo xong thì đừng lật thẻ, nếu không mỗi lần phân loại sẽ lật oan một cái.
      onClick={() => {
        if (!moved.current) flip();
        moved.current = false;
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 26}deg)` } : undefined}
    >
      {onSwipe && (
        <>
          <span className="swipe-tag swipe-tag-learning" aria-hidden="true">
            Đang học
          </span>
          <span className="swipe-tag swipe-tag-known" aria-hidden="true">
            Đã biết
          </span>
        </>
      )}
      <span className="flash-front">
        <small>TIẾNG ANH</small>
        <b>{card.term}</b>
        <em className="flash-ipa">{card.ipa}</em>
        <em>{card.example}</em>
        <i>Nhấn để lật thẻ</i>
      </span>
      <span className="flash-back">
        <small>TIẾNG VIỆT</small>
        <b>{card.meaning}</b>
        <em>{card.exampleVi || "(chưa có bản dịch câu ví dụ)"}</em>
        <i>Nhấn để lật lại</i>
      </span>
    </button>
  );
}

// Chế độ Học kiểu Quizlet: chia vòng, mỗi vòng vài từ, hỏi từ trắc nghiệm lên tự gõ,
// sai thì hỏi lại trong cùng vòng, có màn chốt vòng và tiến trình lưu lại giữa các lần mở.
const learnProgressKey = "lexilo:learn:v1";
const roundSize = 7;
type LearnDirection = "vi_en" | "en_vi" | "both";
function readLearnProgress(): Record<string, number> {
  try {
    const raw = localStorage.getItem(learnProgressKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeLearnProgress(levels: Record<string, number>) {
  try {
    localStorage.setItem(learnProgressKey, JSON.stringify(levels));
  } catch {
    // Bỏ qua khi trình duyệt chặn.
  }
}

function LearnMode({ words, setMode }: { words: WordCard[]; setMode: (m: PracticeMode) => void }) {
  const [starredOnly, setStarredOnly] = useState(false);
  const [direction, setDirection] = useState<LearnDirection>("vi_en");
  const [showSettings, setShowSettings] = useState(false);
  const [levels, setLevels] = useState<Record<string, number>>(() => (typeof window === "undefined" ? {} : readLearnProgress()));
  const [queue, setQueue] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = readLearnProgress();
    return words.filter((word) => (stored[word.id] ?? 0) < 2).slice(0, roundSize).map((word) => word.id);
  });
  const [roundLog, setRoundLog] = useState<{ id: string; correct: boolean }[]>([]);
  const [phase, setPhase] = useState<"question" | "checkpoint">("question");
  const [round, setRound] = useState(1);
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<{ correct: boolean; expected: string } | null>(null);
  const [asked, setAsked] = useState(0);

  const pool = useMemo(() => words.filter((word) => !starredOnly || word.starred), [words, starredOnly]);
  const byId = useMemo(() => new Map(pool.map((word) => [word.id, word])), [pool]);

  useEffect(() => {
    writeLearnProgress(levels);
  }, [levels]);

  const remaining = useMemo(() => pool.filter((word) => (levels[word.id] ?? 0) < 2), [pool, levels]);
  const mastered = pool.length - remaining.length;

  // Nạp vòng kế tiếp một cách tường minh, không dựa vào effect.
  function loadRound(nextLevels = levels, nextPool = pool) {
    setQueue(
      nextPool
        .filter((word) => (nextLevels[word.id] ?? 0) < 2)
        .slice(0, roundSize)
        .map((word) => word.id),
    );
    setRoundLog([]);
    setPhase("question");
    setFeedback(null);
    setTyped("");
  }

  // Hàng đợi có thể chứa id không còn trong pool sau khi đổi tuỳ chọn.
  const activeQueue = queue.filter((id) => byId.has(id));
  const current = activeQueue.length ? byId.get(activeQueue[0]) : undefined;
  const level = current ? (levels[current.id] ?? 0) : 0;
  // "Trộn" đảo chiều theo từng câu để không đoán được kiểu hỏi.
  const askViToEn = direction === "vi_en" || (direction === "both" && asked % 2 === 0);
  const prompt = current ? (askViToEn ? current.meaning : current.term) : "";
  const expected = current ? (askViToEn ? current.term : current.meaning) : "";
  const options = useMemo(() => {
    if (!current || level !== 0) return [];
    return seededOrder([current, ...pickDistractors(pool, current, asked)], asked);
  }, [current, level, pool, asked]);

  function answer(correct: boolean) {
    if (!current || feedback) return;
    setFeedback({ correct, expected });
    setLevels((previous) => ({ ...previous, [current.id]: correct ? Math.min(2, (previous[current.id] ?? 0) + 1) : 0 }));
    setRoundLog((log) => [...log, { id: current.id, correct }]);
  }
  function advance() {
    if (!current) return;
    const answeredRight = feedback?.correct ?? false;
    const stillLearning = (levels[current.id] ?? 0) < 2;
    const rest = activeQueue.slice(1);
    // Sai thì gặp lại ngay trong vòng này; đúng nhưng chưa lên bậc 2 thì để cuối vòng.
    const next = !answeredRight ? [...rest.slice(0, 2), activeQueue[0], ...rest.slice(2)] : stillLearning ? [...rest, activeQueue[0]] : rest;
    setQueue(next);
    setTyped("");
    setFeedback(null);
    setAsked((value) => value + 1);
    if (!next.length) setPhase("checkpoint");
  }

  function resetAll() {
    const cleared = {};
    setLevels(cleared);
    setRound(1);
    setAsked(0);
    loadRound(cleared, pool);
  }

  const settingsPanel = showSettings && (
    <div className="learn-settings">
      <label>
        Hướng hỏi
        <select value={direction} onChange={(event) => setDirection(event.target.value as LearnDirection)}>
          <option value="vi_en">Việt → Anh</option>
          <option value="en_vi">Anh → Việt</option>
          <option value="both">Trộn hai chiều</option>
        </select>
      </label>
      <label className="learn-check">
        <input
          type="checkbox"
          checked={starredOnly}
          onChange={(event) => {
            const next = event.target.checked;
            setStarredOnly(next);
            setRound(1);
            loadRound(levels, words.filter((word) => !next || word.starred));
          }}
        />
        Chỉ học từ đã gắn sao
      </label>
      <button onClick={resetAll}>Xoá tiến trình đã học</button>
    </div>
  );

  if (!pool.length)
    return (
      <div className="page practice-session">
        <PracticeModeBar mode="learn" setMode={setMode} />
        <div className="panel practice-card">
          <h2>Chưa có từ nào để học</h2>
          <p className="page-sub">{starredOnly ? "Không có từ nào được gắn sao." : "Hãy thêm từ vựng trước."}</p>
          {starredOnly && (
            <button className="primary" onClick={() => setStarredOnly(false)}>
              Học tất cả từ
            </button>
          )}
        </div>
      </div>
    );

  if (!remaining.length)
    return (
      <div className="page practice-session">
        <PracticeModeBar mode="learn" setMode={setMode} />
        <div className="panel practice-card">
          <span className="summary-mark">✓</span>
          <h2>Đã thuộc cả {pool.length} từ</h2>
          <p className="page-sub">Mỗi từ đều đã trả lời đúng ở cả hai bậc.</p>
          <div className="summary-actions">
            <button onClick={() => setMode("test")}>Làm bài kiểm tra</button>
            <button className="primary" onClick={resetAll}>
              Học lại từ đầu
            </button>
          </div>
        </div>
      </div>
    );

  if (phase === "checkpoint") {
    const dung = roundLog.filter((entry) => entry.correct).length;
    const sai = roundLog.filter((entry) => !entry.correct);
    return (
      <div className="page practice-session">
        <PracticeModeBar mode="learn" setMode={setMode} />
        <div className="panel practice-card checkpoint">
          <span className="eyebrow">CHỐT VÒNG {round}</span>
          <h2>
            {dung} đúng · {sai.length} cần ôn lại
          </h2>
          <div className="learn-progress-line">
            <i style={{ width: `${(mastered / pool.length) * 100}%` }} />
          </div>
          <p className="page-sub">
            Đã thuộc {mastered}/{pool.length} từ
          </p>
          {!!sai.length && (
            <ul className="checkpoint-list">
              {[...new Set(sai.map((entry) => entry.id))].map((id) => {
                const word = byId.get(id);
                return word ? (
                  <li key={id}>
                    <b>{word.term}</b>
                    <span>{word.meaning}</span>
                  </li>
                ) : null;
              })}
            </ul>
          )}
          <button
            className="primary"
            onClick={() => {
              setRound((value) => value + 1);
              loadRound();
            }}
          >
            Tiếp tục vòng {round + 1} →
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="page practice-session">
      <PracticeModeBar mode="learn" setMode={setMode} />
      <div className="learn-head">
        <span>
          Vòng {round} · còn {queue.length} thẻ
        </span>
        <div className="learn-progress-line">
          <i style={{ width: `${(mastered / pool.length) * 100}%` }} />
        </div>
        <span>
          Đã thuộc {mastered}/{pool.length}
        </span>
        <button className="settings-button" onClick={() => setShowSettings((value) => !value)}>
          ⚙ Tuỳ chọn
        </button>
      </div>
      {settingsPanel}
      <div className="panel practice-card">
        <span className="learn-label">
          {level === 0 ? "BẬC 1 · CHỌN ĐÁP ÁN" : "BẬC 2 · TỰ GÕ LẠI"} · {askViToEn ? "VIỆT → ANH" : "ANH → VIỆT"}
        </span>
        <h2>{prompt}</h2>
        {level === 0 ? (
          <div className="choice-grid">
            {options.map((option) => (
              <button key={option.id} disabled={!!feedback} className={feedback && option.id === current.id ? "is-answer" : ""} onClick={() => answer(option.id === current.id)}>
                {askViToEn ? option.term : option.meaning}
              </button>
            ))}
          </div>
        ) : (
          <>
            {askViToEn && <p className="learn-cloze">{current.cloze}</p>}
            <input
              className="listen-input"
              value={typed}
              disabled={!!feedback}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && typed.trim()) answer(normalizeAnswer(typed) === normalizeAnswer(expected));
              }}
              placeholder={askViToEn ? "Nhập từ tiếng Anh…" : "Nhập nghĩa tiếng Việt…"}
            />
            {!feedback && (
              <button className="primary" disabled={!typed.trim()} onClick={() => answer(normalizeAnswer(typed) === normalizeAnswer(expected))}>
                Kiểm tra
              </button>
            )}
          </>
        )}
        {feedback && (
          <div className={feedback.correct ? "practice-result good" : "practice-result"}>
            <span>
              {feedback.correct ? "Đúng rồi!" : `Đáp án: ${feedback.expected}`}
              {!feedback.correct && <small className="learn-hint"> · {current.example}</small>}
            </span>
            <button onClick={advance}>Tiếp →</button>
          </div>
        )}
      </div>
    </div>
  );
}

type TestKind = "written" | "mc" | "tf" | "match";
type TestQuestion = { kind: TestKind; word: WordCard; options?: WordCard[]; shown?: WordCard; group?: WordCard[]; pairs?: WordCard[] };
type TestAnswer = string | Record<string, string>;
const testKindLabels: Record<TestKind, string> = { written: "Tự viết", mc: "Trắc nghiệm", tf: "Đúng/Sai", match: "Nối cặp" };

function TestMode({ words, setMode }: { words: WordCard[]; setMode: (m: PracticeMode) => void }) {
  const [starredOnly, setStarredOnly] = useState(false);
  const pool = useMemo(() => words.filter((word) => !starredOnly || word.starred), [words, starredOnly]);
  const sizes = [5, 10, 20, 30].filter((size) => size <= pool.length);
  const [size, setSize] = useState(10);
  const [kinds, setKinds] = useState<TestKind[]>(["written", "mc", "tf", "match"]);
  const [answerWith, setAnswerWith] = useState<"term" | "meaning">("term");
  const [seed, setSeed] = useState(1);
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<number, TestAnswer>>({});
  const [submitted, setSubmitted] = useState(false);

  const questions = useMemo<TestQuestion[]>(() => {
    if (!kinds.length || pool.length < 2) return [];
    const chosen = seededOrder(pool, seed).slice(0, Math.min(size, pool.length));
    return chosen.map((word, position) => {
      const kind = kinds[(position + seed) % kinds.length];
      if (kind === "mc") return { kind, word, options: seededOrder([word, ...pickDistractors(pool, word, seed + position)], seed + position) };
      if (kind === "tf") {
        const wrong = pickDistractors(pool, word, seed + position, 1)[0];
        const showTrue = (position + seed) % 2 === 0 || !wrong;
        return { kind, word, shown: showTrue ? word : wrong };
      }
      if (kind === "match") {
        const group = [word, ...pickDistractors(pool, word, seed + position, 3)];
        return { kind, word, group, pairs: seededOrder(group, seed + position + 11) };
      }
      return { kind, word };
    });
  }, [pool, size, seed, kinds]);

  function isCorrect(question: TestQuestion, given?: TestAnswer) {
    if (given === undefined) return false;
    if (question.kind === "mc") return given === question.word.id;
    if (question.kind === "written") return typeof given === "string" && normalizeAnswer(given) === normalizeAnswer(answerWith === "term" ? question.word.term : question.word.meaning);
    if (question.kind === "tf") return given === (question.shown?.id === question.word.id ? "true" : "false");
    if (typeof given !== "object") return false;
    return (question.group ?? []).every((item) => given[item.id] === item.id);
  }
  function isAnswered(question: TestQuestion, given?: TestAnswer) {
    if (given === undefined) return false;
    if (question.kind === "match") return typeof given === "object" && (question.group ?? []).every((item) => given[item.id]);
    return typeof given === "string" && given.trim() !== "";
  }
  const score = questions.filter((question, position) => isCorrect(question, answers[position])).length;
  const answered = questions.filter((question, position) => isAnswered(question, answers[position])).length;

  function toggleKind(kind: TestKind) {
    setKinds((previous) => (previous.includes(kind) ? (previous.length > 1 ? previous.filter((item) => item !== kind) : previous) : [...previous, kind]));
  }

  if (!started)
    return (
      <div className="page practice-session">
        <PracticeModeBar mode="test" setMode={setMode} />
        <div className="eyebrow">KIỂM TRA</div>
        <h1>Thiết lập bài kiểm tra</h1>
        <p className="page-sub">Chọn số câu, dạng câu và cách trả lời. Chấm điểm sau khi nộp bài.</p>
        <div className="test-config">
          <div className="test-field">
            <b>Số câu</b>
            <div className="test-sizes">
              {(sizes.length ? sizes : [pool.length]).map((option) => (
                <button key={option} className={size === option ? "active" : ""} onClick={() => setSize(option)}>
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="test-field">
            <b>Dạng câu hỏi</b>
            <div className="test-kinds">
              {(Object.keys(testKindLabels) as TestKind[]).map((kind) => (
                <label key={kind} className={kinds.includes(kind) ? "active" : ""}>
                  <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggleKind(kind)} />
                  {testKindLabels[kind]}
                </label>
              ))}
            </div>
          </div>
          <div className="test-field">
            <b>Trả lời bằng</b>
            <div className="test-sizes">
              <button className={answerWith === "term" ? "active" : ""} onClick={() => setAnswerWith("term")}>
                Tiếng Anh
              </button>
              <button className={answerWith === "meaning" ? "active" : ""} onClick={() => setAnswerWith("meaning")}>
                Tiếng Việt
              </button>
            </div>
          </div>
          <label className="learn-check">
            <input type="checkbox" checked={starredOnly} onChange={(event) => setStarredOnly(event.target.checked)} />
            Chỉ kiểm tra từ đã gắn sao
          </label>
        </div>
        <button
          className="primary test-submit"
          disabled={pool.length < 2}
          onClick={() => {
            setAnswers({});
            setSubmitted(false);
            setSeed((value) => value + 1);
            setStarted(true);
          }}
        >
          {pool.length < 2 ? "Cần ít nhất 2 từ" : "Bắt đầu làm bài →"}
        </button>
      </div>
    );

  const askText = (word: WordCard) => (answerWith === "term" ? word.meaning : word.term);
  const answerText = (word: WordCard) => (answerWith === "term" ? word.term : word.meaning);

  return (
    <div className="page practice-session">
      <PracticeModeBar mode="test" setMode={setMode} />
      <button className="back" onClick={() => setStarted(false)}>
        ← Đổi thiết lập
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
            Đề khác →
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
                  CÂU {position + 1} · {testKindLabels[question.kind].toUpperCase()}
                </span>
                {submitted && <span className="test-mark">{correct ? "✓" : "✗"}</span>}
              </div>
              {question.kind === "match" ? (
                <div className="match-question">
                  {(question.group ?? []).map((item) => (
                    <div key={item.id}>
                      <span>{askText(item)}</span>
                      <select
                        disabled={submitted}
                        value={typeof given === "object" ? (given[item.id] ?? "") : ""}
                        onChange={(event) =>
                          setAnswers((previous) => {
                            const current = typeof previous[position] === "object" ? { ...(previous[position] as Record<string, string>) } : {};
                            current[item.id] = event.target.value;
                            return { ...previous, [position]: current };
                          })
                        }
                      >
                        <option value="">— chọn —</option>
                        {(question.pairs ?? []).map((choice) => (
                          <option value={choice.id} key={choice.id}>
                            {answerText(choice)}
                          </option>
                        ))}
                      </select>
                      {submitted && typeof given === "object" && given[item.id] !== item.id && <em className="test-answer-inline">{answerText(item)}</em>}
                    </div>
                  ))}
                </div>
              ) : question.kind === "tf" ? (
                <>
                  <h3>
                    {askText(question.word)} = {question.shown ? answerText(question.shown) : ""}
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
                  <h3>{askText(question.word)}</h3>
                  <div className="choice-grid">
                    {question.options?.map((option) => (
                      <button key={option.id} disabled={submitted} className={given === option.id ? "selected" : ""} onClick={() => setAnswers((previous) => ({ ...previous, [position]: option.id }))}>
                        {answerText(option)}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h3>{askText(question.word)}</h3>
                  <input
                    className="listen-input"
                    disabled={submitted}
                    value={typeof given === "string" ? given : ""}
                    onChange={(event) => setAnswers((previous) => ({ ...previous, [position]: event.target.value }))}
                    placeholder={answerWith === "term" ? "Viết từ tiếng Anh…" : "Viết nghĩa tiếng Việt…"}
                  />
                </>
              )}
              {submitted && !correct && question.kind !== "match" && (
                <p className="test-answer">
                  Đáp án: <b>{question.kind === "tf" ? (question.shown?.id === question.word.id ? "Đúng" : "Sai") : answerText(question.word)}</b> · {question.word.example}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {!submitted && (
        <button className="primary test-submit" disabled={answered < questions.length} onClick={() => setSubmitted(true)}>
          {answered < questions.length ? `Còn ${questions.length - answered} câu chưa làm` : "Nộp bài"}
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

const PERIODS = [
  { key: 7, label: "7 ngày qua" },
  { key: 30, label: "30 ngày qua" },
  { key: 365, label: "365 ngày qua" },
] as const;

function Stats({ words, scopeLabel, streak }: { words: WordCard[]; scopeLabel: string; streak: { current: number; best: number } }) {
  const boxes = [1, 2, 3, 4, 5, 6].map((box) => ({
    box,
    count: words.filter((w) => w.box === box).length,
  }));
  const max = Math.max(1, ...boxes.map((b) => b.count));
  const [days, setDays] = useState<number>(7);
  // Nhật ký chỉ đọc được trên máy nên phải chờ hydrate, giống các state khác.
  const [log, setLog] = useState<ReviewEntry[]>([]);
  const [spoken, setSpoken] = useState<Record<string, number>>({});
  const [attempts, setAttempts] = useState<TranslationAttempt[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setLog(readReviewLog());
    setSpoken(readSpeaking());
    setAttempts(readAttempts());
  }, []);
  // Thời gian luyện nói đếm riêng: số từ đã thuộc không nói lên bạn nói được hay chưa.
  const spokenMinutes = useMemo(() => speakingMinutes(spoken, days), [spoken, days]);
  // Bài dịch đếm riêng khỏi lịch ôn: ôn thẻ đo trí nhớ, dịch câu đo khả năng viết ra.
  const scopedAttempts: TranslationAttempt[] = useMemo(() => attemptsSince(attempts, days), [attempts, days]);
  const errorSummary = useMemo(() => summariseAttempts(scopedAttempts), [scopedAttempts]);
  const errorTips = useMemo(() => attemptAdvice(errorSummary, scopedAttempts), [errorSummary, scopedAttempts]);
  const scoped: ReviewEntry[] = useMemo(() => entriesSince(log, days), [log, days]);
  const summary = useMemo(() => summarise(scoped), [scoped]);
  const weakWords = useMemo(() => weakest(scoped, 5), [scoped]);
  const daily = useMemo(() => byDay(scoped, Math.min(days, 30)), [scoped, days]);
  const tips = useMemo(() => advice(summary, weakWords, streak.current), [summary, weakWords, streak.current]);
  const peak = Math.max(1, ...daily.map((row: { reviews: number }) => row.reviews));
  // Tổng cộng dồn từ chính thẻ từ: có từ trước khi bật nhật ký nên luôn lớn hơn hoặc
  // bằng số của quãng đang xem. Nói rõ để không ai tưởng số liệu bị mất.
  const allTimeReviews = words.reduce((total, word) => total + (word.reviewCount ?? 0), 0);
  const allTimeLapses = words.reduce((total, word) => total + (word.lapses ?? 0), 0);
  const [statList, setStatList] = useState<{ title: string; note: string; words: WordCard[] } | null>(null);
  // Nhật ký chỉ giữ id, phải tra ngược lại thẻ từ để dựng danh sách xem được.
  const byId = useMemo(() => new Map(words.map((word) => [word.id, word])), [words]);
  const openIds = (title: string, note: string, ids: Set<string>) => {
    const list = [...ids].map((id) => byId.get(id)).filter((word): word is WordCard => Boolean(word));
    if (list.length) setStatList({ title, note, words: list });
  };
  const learnedIds = useMemo(() => new Set(scoped.filter((entry) => entry.firstTime).map((entry) => entry.id)), [scoped]);
  const forgotIds = useMemo(() => new Set(scoped.filter((entry) => entry.rating === "again").map((entry) => entry.id)), [scoped]);
  const masteredIds = useMemo(() => new Set(scoped.filter((entry) => entry.boxAfter === 6 && entry.boxBefore !== 6).map((entry) => entry.id)), [scoped]);
  const touchedIds = useMemo(() => new Set(scoped.map((entry) => entry.id)), [scoped]);

  return (
    <div className="page">
      <div className="eyebrow">TIẾN ĐỘ CỦA BẠN</div>
      <h1>Thống kê</h1>
      <p className="page-sub">Tổng quan được tính trực tiếp trên {scopeLabel.toLowerCase()}.</p>

      <section className="period-block">
        <div className="period-head">
          <div>
            <h3>Bạn học thế nào trong {PERIODS.find((item) => item.key === days)?.label.toLowerCase()}</h3>
            <p>Đếm từ nhật ký ôn tập, mỗi lượt bấm đánh giá là một dòng.</p>
            {spokenMinutes > 0 && <p className="period-speaking">◉ Đã luyện nói {spokenMinutes} phút trong quãng này.</p>}
          </div>
          <div className="period-tabs" role="group" aria-label="Khoảng thời gian">
            {PERIODS.map((item) => (
              <button key={item.key} type="button" className={days === item.key ? "active" : ""} onClick={() => setDays(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {!log.length ? (
          <p className="period-empty">
            Chưa có dữ liệu nào trong nhật ký. App bắt đầu ghi lại từng lượt ôn kèm thời gian <b>kể từ bản cập nhật này</b> — hãy học một phiên rồi quay lại. Các
            con số cộng dồn từ trước vẫn còn: <b>{allTimeReviews}</b> lượt ôn và <b>{allTimeLapses}</b> lần quên, nhưng không có ngày tháng nên không chia theo tuần
            tháng được.
          </p>
        ) : (
          <>
            <div className="period-grid">
              <button type="button" className="period-stat" onClick={() => openIds("Từ mới đã học", "LẦN ĐẦU ĐƯỢC ÔN", learnedIds)}><strong>{summary.learned}</strong><span>từ mới đã học</span><small>lần đầu được ôn</small></button>
              <button type="button" className="period-stat warn" onClick={() => openIds("Từ bị quên", "ĐÃ BẤM QUÊN", forgotIds)}><strong>{summary.forgotWords}</strong><span>từ bị quên</span><small>{summary.forgot} lượt bấm Quên</small></button>
              <button type="button" className="period-stat good" onClick={() => openIds("Từ vừa thuộc", "MỚI LÊN HỘP 6", masteredIds)}><strong>{summary.mastered}</strong><span>từ vừa thuộc</span><small>mới lên hộp 6</small></button>
              <div className="period-stat"><strong>{summary.accuracy}%</strong><span>tỉ lệ nhớ</span><small>Được + Dễ trên tổng lượt</small></div>
              <button type="button" className="period-stat" onClick={() => openIds("Từ đã ôn trong quãng này", "CÓ TRONG NHẬT KÝ", touchedIds)}><strong>{summary.reviews}</strong><span>lượt ôn</span><small>{summary.perDay} lượt/ngày · {touchedIds.size} từ</small></button>
              <div className="period-stat"><strong>{summary.activeDays}</strong><span>ngày có học</span><small>chuỗi hiện tại {streak.current} ngày</small></div>
            </div>

            <div className="period-chart" aria-label="Số lượt ôn theo ngày">
              {daily.map((row: { day: string; reviews: number; forgot: number }) => (
                <div key={row.day} title={`${row.day}: ${row.reviews} lượt, quên ${row.forgot}`}>
                  <i style={{ height: `${Math.max(2, (row.reviews / peak) * 92)}px` }}>
                    <em style={{ height: `${row.reviews ? (row.forgot / row.reviews) * 100 : 0}%` }} />
                  </i>
                  <span>{row.day.slice(8)}</span>
                </div>
              ))}
            </div>
            <p className="period-legend"><i className="ok" /> nhớ được · <i className="bad" /> quên · cột là một ngày</p>

            {!!tips.length && (
              <ul className="period-advice">
                {tips.map((tip: { tone: string; text: string }, position: number) => (
                  <li key={position} className={tip.tone}>{tip.text}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <section className="panel error-block">
        <div className="error-head">
          <div>
            <h3>Bạn hay sai gì khi viết</h3>
            <p>Đếm từ {errorSummary.attempts} bài dịch trong {PERIODS.find((item) => item.key === days)?.label.toLowerCase()}.</p>
          </div>
          {errorSummary.attempts > 0 && (
            <div className="error-score">
              <b>{errorSummary.avgScore}</b>
              <small>điểm trung bình</small>
            </div>
          )}
        </div>
        {errorSummary.attempts === 0 ? (
          <p className="period-empty">
            Chưa có bài dịch nào trong quãng này. Vào <b>Luyện tập → Dịch Việt → Anh</b>, mỗi bài bạn làm sẽ được ghi lại kèm loại lỗi để chỗ này chỉ ra bạn cần sửa gì trước.
          </p>
        ) : (
          <>
            {errorSummary.byType.length > 0 && (
              <div className="error-bars">
                {errorSummary.byType.slice(0, 6).map((row: { type: string; label: string; count: number; share: number }) => (
                  <div key={row.type} className="error-bar">
                    <b>{row.label}</b>
                    <i style={{ width: `${Math.max(6, row.share)}%` }} />
                    <span>{row.count} lần · {row.share}%</span>
                  </div>
                ))}
              </div>
            )}
            <ul className="shadowing-notes error-notes">
              {errorTips.map((tip: { kind: string; text: string }, position: number) => (
                <li key={position} className={tip.kind}>{tip.text}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="stats-grid stats-overview">
        <Stat label="Tổng từ" value={String(words.length)} note={`Đang tính trên ${scopeLabel}`} icon="▤" tone="purple"
          onOpen={() => setStatList({ title: "Tổng từ", note: "TOÀN BỘ THƯ VIỆN", words })} />
        <Stat label="Đã thuộc" value={String(words.filter((w) => wordState(w).key === "mastered").length)} note="Hộp 6" icon="✓" tone="green"
          onOpen={() => setStatList({ title: "Đã thuộc", note: "ĐÃ LÊN HỘP 6", words: words.filter((w) => wordState(w).key === "mastered") })} />
        <Stat label="Từ cứng đầu" value={String(words.filter((w) => w.lapses >= 4).length)} note="Quên từ 4 lần" icon="♨" tone="pink"
          onOpen={() => setStatList({ title: "Từ cứng đầu", note: "QUÊN TỪ 4 LẦN TRỞ LÊN", words: words.filter((w) => w.lapses >= 4).slice().sort((a, b) => b.lapses - a.lapses) })} />
        <Stat label="Đến hạn" value={String(words.filter(isDueForReview).length)} note="Cần ôn hôm nay" icon="◔" tone="orange"
          onOpen={() => setStatList({ title: "Đến hạn hôm nay", note: "CẦN ÔN LẠI", words: words.filter(isDueForReview) })} />
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
      {statList && <WordListModal title={statList.title} note={statList.note} words={statList.words} close={() => setStatList(null)} />}
    </div>
  );
}

function BulkAddWords({ close, save, existingWords }: { close: () => void; save: (items: Omit<WordCard, "id" | "box" | "lapses">[]) => void; existingWords: WordCard[] }) {
  const [text, setText] = useState("");
  const [studyDay, setStudyDay] = useState(() => weekdayIndex());
  const normalizedExisting = useMemo(() => new Set(existingWords.map((word) => word.term.trim().toLowerCase().replace(/\s+/g, " "))), [existingWords]);
  const preview = useMemo(() => {
    const seen = new Set<string>();
    return text.split(/\r?\n/).map((line) => line.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 200).map((term) => {
      const normalized = term.toLowerCase().replace(/\s+/g, " ");
      const duplicate = normalizedExisting.has(normalized) || seen.has(normalized);
      seen.add(normalized);
      return { term: term.replace(/\s+/g, " "), duplicate };
    });
  }, [text, normalizedExisting]);
  const valid = preview.filter((item) => !item.duplicate);
  // Ví dụ do mô hình ngôn ngữ viết, tra theo từ. Chưa sinh thì vẫn lưu được bằng
  // khung câu mặc định như trước — không sinh được cũng không chặn việc thêm từ.
  const [written, setWritten] = useState<Record<string, { vi: string; en: string }>>({});
  const [exampleMode, setExampleMode] = useState<"passage" | "sentences">("sentences");
  const [writing, setWriting] = useState(false);
  const [writeNote, setWriteNote] = useState("");

  async function writeExamples() {
    if (!valid.length || writing) return;
    setWriting(true);
    setWriteNote("");
    const batches: string[][] = [];
    // Mô hình chỉ nhận tối đa 12 từ một lượt; đoạn văn thì ngắn hơn cho liền mạch.
    const size = exampleMode === "passage" ? 6 : 10;
    for (let start = 0; start < valid.length; start += size) batches.push(valid.slice(start, start + size).map((item) => item.term));
    const collected: Record<string, { vi: string; en: string }> = {};
    let failed = 0;
    for (const batch of batches) {
      try {
        const response = await aiFetch("/api/ai/passage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ terms: batch, mode: batch.length < 2 ? "sentences" : exampleMode }),
        });
        const data = (await response.json()) as { sentences?: { term: string; vi: string; en: string }[]; error?: string };
        if (!response.ok || !data.sentences?.length) throw new Error(data.error ?? "hỏng");
        data.sentences.forEach((item, position) => {
          const term = batch.find((candidate) => candidate.toLowerCase() === item.term.toLowerCase()) ?? batch[position];
          if (term && item.vi && item.en) collected[term] = { vi: item.vi, en: item.en };
        });
      } catch {
        failed += batch.length;
      }
      setWritten({ ...collected });
    }
    setWriting(false);
    const done = Object.keys(collected).length;
    setWriteNote(done ? `✓ Đã viết ví dụ cho ${done}/${valid.length} từ${failed ? ` · ${failed} từ chưa viết được, sẽ dùng khung câu mặc định` : ""}.` : "Không gọi được mô hình ngôn ngữ. Các từ vẫn được thêm với khung câu mặc định.");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid.length) return;
    save(valid.map(({ term }) => {
      const made = written[term];
      const example = made?.en ?? naturalExample(term);
      return {
        term,
        meaning: "Chưa bổ sung nghĩa",
        ipa: "/…/",
        partOfSpeech: "",
        definition: "",
        example,
        exampleVi: made?.vi ?? naturalExampleVi(term),
        cloze: clozeFor(term, example),
        collocation: "",
        collocationVi: "",
        synonyms: [],
        antonyms: [],
        related: [],
        paraphrases: [],
        ieltsTopics: [],
        topic: "Từ vựng chung",
        status: "new",
        reviewCount: 0,
        addedDate: localDateString(),
        studyDay,
      };
    }));
  }
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form className="modal bulk-add-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="modal-head"><div><span className="eyebrow">THÊM NHANH</span><h2>Dán danh sách từ</h2></div><button type="button" onClick={close}>×</button></div>
        <p className="bulk-help">Mỗi dòng là một từ hoặc cụm từ. Có thể giữ nguyên dấu “/”, ví dụ: <b>shopping cart / trolley</b>.</p>
        <label>Danh sách của bạn<textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder={"grocery shopping\nshopping cart / trolley\nbuggy\ndepartment/section\naisle"} /></label>
        <label>Folder ngày học<select value={studyDay} onChange={(event) => setStudyDay(Number(event.target.value))}>{dayNames.map((name, index) => <option value={index} key={name}>{name}</option>)}</select></label>
        {!!valid.length && (
          <section className="bulk-examples">
            <b>Ví dụ tiếng Việt cho các từ này</b>
            <div className="bulk-example-modes" role="group" aria-label="Kiểu ví dụ">
              <button type="button" className={exampleMode === "sentences" ? "active" : ""} onClick={() => setExampleMode("sentences")}>
                Từng câu riêng<small>Mỗi từ một câu độc lập</small>
              </button>
              <button type="button" className={exampleMode === "passage" ? "active" : ""} onClick={() => setExampleMode("passage")}>
                Một đoạn liền mạch<small>Các câu nối ý nhau</small>
              </button>
            </div>
            <button type="button" className="ai-fill" disabled={writing} onClick={() => void writeExamples()}>
              {writing ? "◌ Đang viết ví dụ…" : `✦ Viết ví dụ cho ${valid.length} từ`}
            </button>
            {writeNote && <p className={writeNote.startsWith("✓") ? "lookup-message success" : "lookup-message"}>{writeNote}</p>}
            {!!Object.keys(written).length && (
              <div className="bulk-example-list">
                {valid.filter((item) => written[item.term]).slice(0, 6).map((item) => (
                  <article key={item.term}>
                    <b>{item.term}</b>
                    <p>{written[item.term].vi}</p>
                    <small>{written[item.term].en}</small>
                  </article>
                ))}
                {Object.keys(written).length > 6 && <span className="bulk-example-more">…và {Object.keys(written).length - 6} từ nữa</span>}
              </div>
            )}
          </section>
        )}
        {!!preview.length && <section className="bulk-preview"><div className="bulk-summary"><b>{valid.length} mục sẽ được thêm</b><span>{preview.length - valid.length} mục trùng sẽ bỏ qua</span></div><div className="bulk-preview-list">{preview.map((item, index) => <span className={item.duplicate ? "duplicate" : ""} key={`${item.term}-${index}`}>{item.duplicate ? "⊘" : "✓"} {item.term}</span>)}</div></section>}
        <p className="bulk-note">Sau khi lưu, dùng nút “Bổ sung từ thiếu” để tự điền nghĩa, IPA, ví dụ, cụm từ và nội dung IELTS.</p>
        <div className="modal-actions"><button type="button" onClick={close}>Hủy</button><button className="primary" type="submit" disabled={!valid.length}>Thêm {valid.length || ""} từ vào {dayNames[studyDay]}</button></div>
      </form>
    </div>
  );
}

function AddWord({ close, save, existingWords }: { close: () => void; save: (w: Omit<WordCard, "id" | "box" | "lapses">) => void; existingWords: WordCard[] }) {
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const [example, setExample] = useState("");
  const [exampleVi, setExampleVi] = useState("");
  const [topic, setTopic] = useState("Từ vựng chung");
  const [ipa, setIpa] = useState("");
  const [partOfSpeech, setPartOfSpeech] = useState("");
  const [definition, setDefinition] = useState("");
  const [collocation, setCollocation] = useState("");
  const [collocationVi, setCollocationVi] = useState("");
  const [synonyms, setSynonyms] = useState("");
  const [antonyms, setAntonyms] = useState("");
  const [related, setRelated] = useState("");
  const [synonymDetails, setSynonymDetails] = useState<UsageDetail[]>([]);
  const [antonymDetails, setAntonymDetails] = useState<UsageDetail[]>([]);
  const [relatedDetails, setRelatedDetails] = useState<UsageDetail[]>([]);
  const [paraphrases, setParaphrases] = useState("");
  const [ieltsTopics, setIeltsTopics] = useState("");
  const [studyDay, setStudyDay] = useState(() => weekdayIndex());
  const [loading, setLoading] = useState(false);
  const [lookupMessage, setLookupMessage] = useState("");
  // Các nghĩa từ điển của từ đang tra, đã xếp theo nghĩa người dùng nhập.
  const [senses, setSenses] = useState<DictionarySense[]>([]);
  const [chosenSense, setChosenSense] = useState<number | undefined>(undefined);
  const [writingExample, setWritingExample] = useState(false);
  const [exampleNote, setExampleNote] = useState("");
  // Gợi ý từ theo tiền tố. pickedSuggestion để chọn xong thì đóng luôn danh sách,
  // nếu không nó lại bật lên ngay vì ô nhập vừa đổi giá trị.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [pickedSuggestion, setPickedSuggestion] = useState(false);
  const lookupRequest = useRef(0);
  const suggestRequest = useRef(0);

  function chooseSuggestion(word: string) {
    setTerm(word);
    setSuggestions([]);
    setHighlight(-1);
    setPickedSuggestion(true);
  }

  // Điều kiện ẩn/hiện tính lúc render chứ không xoá state trong effect — xoá đồng bộ
  // trong effect bắt React dựng lại thêm một lượt.
  const visibleSuggestions = pickedSuggestion || term.trim().length < 2 ? [] : suggestions;

  useEffect(() => {
    const value = term.trim().toLowerCase();
    if (pickedSuggestion || value.length < 2) return;
    const requestId = ++suggestRequest.current;
    // Chờ 220ms cho người dùng gõ xong, khỏi bắn một lượt mạng mỗi phím.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/ai/suggest?q=${encodeURIComponent(value)}`);
        const data = (await response.json()) as { words?: string[] };
        if (requestId !== suggestRequest.current) return;
        // Bỏ chính từ đang gõ ra khỏi danh sách: gõ đủ rồi thì không cần gợi lại.
        setSuggestions((data.words ?? []).filter((word) => word !== value));
        setHighlight(-1);
      } catch {
        if (requestId === suggestRequest.current) setSuggestions([]);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [term, pickedSuggestion]);

  // Viết câu ví dụ mới bằng mô hình ngôn ngữ, bám theo nghĩa người dùng đang nhập.
  async function writeExample() {
    const word = term.trim();
    if (!word || writingExample) return;
    setWritingExample(true);
    setExampleNote("");
    try {
      const response = await aiFetch("/api/ai/passage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: [word], mode: "sentences", topic: meaning.trim() || undefined }),
      });
      const data = (await response.json()) as { sentences?: { vi: string; en: string }[]; error?: string };
      const made = data.sentences?.[0];
      if (!response.ok || !made?.en || !made?.vi) throw new Error(data.error ?? "Không viết được ví dụ.");
      setExample(made.en);
      setExampleVi(made.vi);
      setExampleNote("✓ Đã viết câu ví dụ mới kèm bản dịch.");
    } catch (error) {
      setExampleNote(error instanceof Error ? error.message : "Không viết được ví dụ.");
    } finally {
      setWritingExample(false);
    }
  }
  const normalizedTerm = term.trim().toLowerCase().replace(/\s+/g, " ");
  const duplicate = existingWords.find((word) => word.term.trim().toLowerCase().replace(/\s+/g, " ") === normalizedTerm);
  // setDetails là setter của useState nên phải nhận được cả hàm cập nhật, không chỉ mảng.
  function updateUsageList(value: string, setValue: (value: string) => void, setDetails: Dispatch<SetStateAction<UsageDetail[]>>) {
    setValue(value);
    const retained = new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    setDetails((current) => current.filter((item) => retained.has(item.term.trim().toLowerCase())));
  }
  function usagePreview(title: string, details: UsageDetail[]) {
    if (!details.length) return null;
    return (
      <section className="add-usage-preview">
        <b>{title}</b>
        <div>
          {details.map((item) => (
            <article key={`${title}-${item.term}`}>
              <h4>{item.term}</h4>
              <strong>{item.meaningVi || "Chưa có nghĩa tiếng Việt"}</strong>
              <p>{item.example || "Chưa có ngữ cảnh sử dụng."}</p>
              <small>{item.exampleVi || "Chưa có bản dịch ngữ cảnh."}</small>
            </article>
          ))}
        </div>
      </section>
    );
  }
  async function requestEnrichment(word: string, sense?: number) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 12000);
        try {
          return await fetch("/api/ai/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Gửi kèm nghĩa người dùng tự nhập để API xếp các nghĩa của từ điển theo đó.
            body: JSON.stringify({ term: word, part_of_speech: partOfSpeech, meaning_vi: meaning.trim() || undefined, sense }),
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
  async function enrich(value = term, sense?: number) {
    const word = value.trim().replace(/\s+/g, " ");
    const requestId = ++lookupRequest.current;
    if (!/^[a-z][a-z'\- ]{0,59}$/i.test(word)) {
      setLoading(false);
      setLookupMessage(word ? "Chỉ tra được nội dung gồm chữ cái, dấu nháy và gạch nối." : "");
      return;
    }
    const existing = existingWords.find((item) => item.term.trim().toLowerCase().replace(/\s+/g, " ") === word.toLowerCase());
    if (existing) {
      // Không đặt lookupMessage ở đây: đó là văn bản tĩnh, xoá từ xong nó vẫn nằm lại.
      // Cảnh báo trùng đã có sẵn ngay dưới ô nhập và tự biến mất khi từ không còn.
      setLoading(false);
      setLookupMessage("");
      return;
    }
    setLoading(true);
    setLookupMessage("Đang tra từ điển và chọn chủ đề…");
    try {
      const response = await requestEnrichment(word, sense);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Không thể tra từ (mã ${response.status}).`);
      if (requestId !== lookupRequest.current || data.term?.toLowerCase() !== word.toLowerCase()) return;
      setIpa(data.ipa || "");
      setPartOfSpeech(data.part_of_speech || "");
      setMeaning((current) => current.trim() || data.meaning_vi || "");
      setSenses(data.senses || []);
      setChosenSense(data.sense);
      setDefinition(data.definition_en || "");
      setCollocation(data.collocation || "");
      setCollocationVi(data.collocation_vi || "");
      setSynonyms((data.synonyms || []).join(", "));
      setAntonyms((data.antonyms || []).join(", "));
      setRelated((data.related || []).join(", "));
      setSynonymDetails(data.synonym_details || []);
      setAntonymDetails(data.antonym_details || []);
      setRelatedDetails(data.related_details || []);
      setParaphrases((data.paraphrases || []).join("; "));
      setIeltsTopics((data.ielts_topics || []).join(", "));
      setExample(data.example || "");
      setExampleVi(data.example_vi || "");
      setTopic(data.topic || "Từ vựng chung");
      setLookupMessage(
        data.partial
          ? "✓ Đã điền từ dữ liệu của từng từ. Cụm từ không có mục từ riêng nên phần định nghĩa là nghĩa từng từ — hãy sửa lại cho đúng ngữ cảnh."
          : data.example_source === "practical"
            ? `✓ Đã chọn cụm “${data.collocation}” và đặt trong câu đời thường dễ dùng.`
          : data.example_source === "sense"
            ? "✓ Đã lấy định nghĩa và câu ví dụ của đúng nghĩa bạn chọn."
          : data.example_source === "corpus"
            ? "✓ Từ điển không có câu ví dụ cho từ này nên đã lấy câu thật từ kho ngữ liệu Tatoeba."
          : data.example_source === "generated_phrase"
            ? `✓ Đã tự tạo cụm “${data.collocation}” và câu ngắn chứa cụm này. Hãy kiểm tra trước khi lưu.`
          : data.example_source === "template"
            ? "✓ Đã tự động điền. Từ điển không có câu ví dụ cho từ này — hãy thay câu ví dụ bằng ngữ cảnh của riêng bạn."
            : "✓ Đã tự động điền kèm câu ví dụ thật từ từ điển — hãy kiểm tra trước khi lưu.",
      );
    } catch (error) {
      if (requestId !== lookupRequest.current) return;
      const networkError = error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError");
      setLookupMessage(networkError ? "Không kết nối được dịch vụ tra từ. Bạn vẫn có thể nhập nghĩa thủ công và lưu từ." : error instanceof Error ? error.message : "Không thể tra từ.");
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
    if (!term.trim()) return;
    if (duplicate) {
      setLookupMessage(`⚠ Từ “${duplicate.term}” đã được thêm trước đó. Không thể lưu thêm bản trùng.`);
      return;
    }
    if (!collocation.trim() || !collocationVi.trim()) {
      setLookupMessage("Mỗi từ cần có cụm đi cùng và nghĩa của cụm. Hãy bấm “Tra và tự động điền” trước khi lưu.");
      return;
    }
    const safeTerm = term.trim().replace(/\s+/g, " ");
    const escapedTerm = safeTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    save({
      term: safeTerm,
      meaning: meaning.trim() || "Chưa bổ sung nghĩa",
      example: example || naturalExample(safeTerm),
      exampleVi: exampleVi || (example ? "" : naturalExampleVi(safeTerm)),
      cloze: (example || naturalExample(safeTerm)).replace(new RegExp(escapedTerm, "i"), "_____"),
      ipa: ipa || "/…/",
      partOfSpeech,
      definition: definition || "Bổ sung định nghĩa Anh–Anh sau.",
      collocation,
      collocationVi,
      synonyms: synonyms.split(",").map((item) => item.trim()).filter(Boolean),
      antonyms: antonyms.split(",").map((item) => item.trim()).filter(Boolean),
      related: related.split(",").map((item) => item.trim()).filter(Boolean),
      synonymDetails,
      antonymDetails,
      relatedDetails,
      paraphrases: paraphrases.split(";").map((item) => item.trim()).filter(Boolean),
      ieltsTopics: ieltsTopics.split(",").map((item) => item.trim()).filter(Boolean),
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
        <label className="term-field">
          Từ hoặc cụm từ tiếng Anh
          <input
            value={term}
            autoComplete="off"
            onChange={(e) => {
              // Gõ tiếp làm kết quả đang chờ trở nên vô hiệu, phải tắt luôn trạng thái đang tải.
              lookupRequest.current++;
              setLoading(false);
              setLookupMessage("");
              setTerm(e.target.value);
              setPickedSuggestion(false);
              setHighlight(-1);
            }}
            onKeyDown={(event) => {
              if (!visibleSuggestions.length) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((current) => {
                  const next = event.key === "ArrowDown" ? current + 1 : current - 1;
                  return (next + suggestions.length) % suggestions.length;
                });
              } else if (event.key === "Enter" && highlight >= 0) {
                event.preventDefault();
                chooseSuggestion(visibleSuggestions[highlight]);
              } else if (event.key === "Escape") {
                setPickedSuggestion(true);
              }
            }}
            placeholder="Ví dụ: meaningful hoặc take for granted"
          />
          {/* Gợi ý từ theo tiền tố đang gõ, để không phải nhớ chính xác mặt chữ. */}
          {!!visibleSuggestions.length && (
            <div className="term-suggest" role="listbox">
              {visibleSuggestions.map((word, position) => {
                const had = existingWords.some((item) => item.term.trim().toLowerCase() === word);
                return (
                  <button
                    type="button"
                    key={word}
                    role="option"
                    aria-selected={position === highlight}
                    className={position === highlight ? "active" : ""}
                    onMouseEnter={() => setHighlight(position)}
                    onClick={() => chooseSuggestion(word)}
                  >
                    <span>{word}</span>
                    {had && <em>đã có trong kho</em>}
                  </button>
                );
              })}
            </div>
          )}
        </label>
        {duplicate && <p className="duplicate-warning">⚠ Từ “{duplicate.term}” đã được thêm trước đó{duplicate.addedDate ? ` vào ngày ${duplicate.addedDate}` : ""}{duplicate.topic ? ` · Chủ đề: ${duplicate.topic}` : ""}.</p>}
        {/* Hai việc hay dùng nhất để ngay đây, đừng chôn dưới đáy form dài. */}
        <div className="ai-actions">
          <button className="ai-fill" type="button" disabled={loading || !term} onClick={() => void enrich()}>
            {loading ? "◌ Đang tự động điền…" : "✦ Tra và tự động điền"}
          </button>
          <button className="ai-fill" type="button" disabled={writingExample || !term.trim()} onClick={() => void writeExample()} title="Viết câu ví dụ mới bám theo nghĩa bạn đang nhập">
            {writingExample ? "◌ Đang viết ví dụ…" : "✎ Viết câu ví dụ"}
          </button>
        </div>
        {lookupMessage && <p className={lookupMessage.startsWith("✓") ? "lookup-message success" : "lookup-message"}>{lookupMessage}</p>}
        {exampleNote && <p className={exampleNote.startsWith("✓") ? "lookup-message success" : "lookup-message"}>{exampleNote}</p>}
        {/* Xem ngay kết quả tại đây, khỏi phải cuộn xuống cuối form để kiểm tra. */}
        {example && (
          <section className="example-peek">
            <p>{example}</p>
            {exampleVi && <small>{exampleVi}</small>}
          </section>
        )}
        <div className="form-grid">
          <label>
            Nghĩa tiếng Việt
            <input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder="Tự động điền nghĩa..." />
          </label>
          {senses.length > 1 && (
            // Một từ mang nhiều nghĩa xa nhau ("fixed" = đã sửa / cố định / đã triệt sản).
            // Máy chỉ xếp thứ tự theo nghĩa bạn gõ; chọn ở đây mới là chốt, và mọi trường
            // còn lại được lấy lại theo đúng nghĩa đã chọn.
            <section className="sense-picker">
              <b>Từ này có {senses.length} nghĩa — chọn đúng nghĩa bạn cần</b>
              <div>
                {senses.map((item) => (
                  <button
                    type="button"
                    key={item.index}
                    className={item.index === chosenSense ? "active" : ""}
                    disabled={loading}
                    onClick={() => void enrich(term, item.index)}
                  >
                    <span>{item.part_of_speech}</span>
                    <b>{item.definition_vi || item.definition_en}</b>
                    {item.definition_vi && <small>{item.definition_en}</small>}
                    {item.example && <em>{item.example}</em>}
                  </button>
                ))}
              </div>
            </section>
          )}
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
        <div className="form-grid collocation-fields">
          <label>
            Cụm nên học
            <input value={collocation} onChange={(e) => setCollocation(e.target.value)} placeholder="Ví dụ: pull out weeds" />
          </label>
          <label>
            Nghĩa của cụm
            <input value={collocationVi} onChange={(e) => setCollocationVi(e.target.value)} placeholder="Ví dụ: nhổ cỏ dại" />
          </label>
        </div>
        <section className="ielts-word-family">
          <b>Mở rộng từ vựng IELTS</b>
          <div className="form-grid">
            <label>Từ đồng nghĩa<input value={synonyms} onChange={(e) => updateUsageList(e.target.value, setSynonyms, setSynonymDetails)} placeholder="Các từ cách nhau bằng dấu phẩy" /></label>
            <label>Từ trái nghĩa<input value={antonyms} onChange={(e) => updateUsageList(e.target.value, setAntonyms, setAntonymDetails)} placeholder="Các từ cách nhau bằng dấu phẩy" /></label>
          </div>
          <label>Từ hay đi cùng chủ đề<input value={related} onChange={(e) => updateUsageList(e.target.value, setRelated, setRelatedDetails)} placeholder="Các từ liên quan cách nhau bằng dấu phẩy" /></label>
          {(synonymDetails.length > 0 || antonymDetails.length > 0 || relatedDetails.length > 0) && (
            <div className="add-usage-details">
              <p>Gợi ý sử dụng — các nội dung dưới đây sẽ được lưu cùng thẻ từ.</p>
              {usagePreview("Ngữ cảnh từ đồng nghĩa", synonymDetails)}
              {usagePreview("Ngữ cảnh từ trái nghĩa", antonymDetails)}
              {usagePreview("Ngữ cảnh từ cùng chủ đề", relatedDetails)}
            </div>
          )}
          <label>Cách paraphrase<textarea value={paraphrases} onChange={(e) => setParaphrases(e.target.value)} placeholder="Các cách diễn đạt cách nhau bằng dấu chấm phẩy" /></label>
          <label>Chủ đề IELTS có thể áp dụng<input value={ieltsTopics} onChange={(e) => setIeltsTopics(e.target.value)} placeholder="Environment, Education, Technology…" /></label>
        </section>
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
          <button className="primary" type="submit" disabled={loading || !!duplicate || !collocation.trim() || !collocationVi.trim()} title={duplicate ? "Từ này đã tồn tại trong kho của bạn" : !collocation.trim() ? "Hãy tra từ để tự động tạo cụm trước khi lưu" : undefined}>
            Lưu từ mới
          </button>
        </div>
      </form>
    </div>
  );
}

function AuthModal({ close, signedInEmail }: { close: () => void; signedInEmail: string | null }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(e: FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setMessage("Chưa cấu hình kết nối Supabase cho ứng dụng.");
      return;
    }
    if (!email) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMessage(error ? error.message : "✓ Đã gửi liên kết đăng nhập. Hãy mở email trên thiết bị này và bấm vào liên kết để hoàn tất.");
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
            <span className="eyebrow">TÀI KHOẢN CỦA BẠN</span>
            <h2>{signedInEmail ? "Đã đăng nhập" : "Đăng nhập bằng email"}</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <p className="auth-copy">{signedInEmail ? `Dữ liệu đang được lưu riêng cho ${signedInEmail}.` : "Không cần mật khẩu. Chúng tôi sẽ gửi một liên kết đăng nhập vào email; dữ liệu sau đó được lưu riêng cho tài khoản này."}</p>
        {!signedInEmail && <label>
          Địa chỉ email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@example.com" />
        </label>}
        {message && <p className="auth-message">{message}</p>}
        <div className="modal-actions">
          {signedInEmail ? <button className="primary" type="button" onClick={() => void logout()}>Đăng xuất</button> : <>
            <button type="button" onClick={close}>Để sau</button>
            <button className="primary" disabled={busy || !email}>
              {busy ? "Đang gửi…" : "Gửi liên kết đăng nhập"}
            </button>
          </>}
        </div>
      </form>
    </div>
  );
}
