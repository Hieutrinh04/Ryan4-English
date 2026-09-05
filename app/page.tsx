"use client";

import { createContext, Dispatch, FormEvent, Fragment, useCallback, useContext, useSyncExternalStore, PointerEvent as ReactPointerEvent, type ReactNode, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { aiFetch, supabase } from "../lib/supabase";
import ieltsAreaData from "../lib/ielts-areas.json";
import VocabPractice from "../components/VocabPractice";
import Dictionary, { type NewWord } from "../components/Dictionary";
import Upgrade from "../components/Upgrade";
import AdminPanel from "../components/AdminPanel";
import AuthModal from "../components/AuthModal";
import FeedbackModal from "../components/FeedbackModal";
import ModalPortal from "../components/ModalPortal";
import LandingPage from "../components/LandingPage";
import { usePlan } from "../lib/use-plan";
import Icon, { type IconName } from "../components/Icon";
import { useEscape } from "../components/useEscape";
import VideoLesson, { type LookupVocab } from "../components/VideoLesson";
import LessonLibrary from "../components/LessonLibrary";
import WritingPractice from "../components/WritingPractice";
import SpeakingPractice from "../components/SpeakingPractice";
import BackButton from "../components/BackButton";
import WordListPicker from "../components/WordListPicker";
import { DRILL_MODES, MIXED_POOL, deckSupports } from "../lib/vocab-drill.mjs";
import { exampleUsesVocabulary } from "../lib/example-match.mjs";
import { inferLexicalType, lexicalTypeLabel, lexicalTypeOptions } from "../lib/lexical-item.mjs";
import { DEFAULT_THEME, THEMES, applyTheme, readTheme, themeById, themeGroups, writeTheme } from "../lib/themes.mjs";
import { lessonFromHash, mergeLessonSources, promoteSystemLessons, readLessonProgress, readLessons, readSystemDrafts, saveLesson } from "../lib/lessons.mjs";
import { addLessonsToCatalogue, videoProgress } from "../lib/catalogue.mjs";
import { fetchGlance } from "../lib/glance.mjs";
import { CHANGE_LABEL, RELEASES, hasUnseenRelease, latestRelease } from "../lib/changelog.mjs";
import { MAX_FOLDERS, addFolder, addWords, editFolder, folderDate, folderPath,
  commitFolders, foldersOf, foldersServerSnapshot, foldersSnapshot, foldersWithCounts,
  removeFolder, setFolderScope, subscribeFolders, toggleWord,
  wordsIn } from "../lib/folders.mjs";
// Kiểu lấy ngay từ module JS: khai báo lại ở đây thì sớm muộn cũng lệch nhau.
type FolderStore = ReturnType<typeof foldersSnapshot>;
type Folder = FolderStore["list"][number];
import { alignTranscript } from "../lib/youtube.mjs";
// Kết quả chấm bài của Gemini. Khác cách so câu mẫu: cách dịch đúng nhưng khác câu
// mẫu vẫn được công nhận đúng.
type GradeCriterion = "meaning" | "grammar" | "vocabulary" | "naturalness";
type AiFeedbackItem = { kind: "error" | "improvement"; type: string; wrong: string; right: string; why: string; rule: string; example: string };
type AiGrade = {
  correct: boolean; score: number; criteria: Record<GradeCriterion, number>; suggestion: string; alternatives: string[];
  good: string; comment: string; errors: AiFeedbackItem[]; improvements: AiFeedbackItem[];
  chunks: { text: string; meaning: string }[]; issues: AiFeedbackItem[];
};
import { PASSAGE_SIZE, buildPassages, gradeTranslation } from "../lib/translation-check.mjs";
import { SKILLS, logPractice, minutesInRange, minutesPerDay, readPractice, totalTime } from "../lib/practice-log.mjs";
import { levelFor, xpBreakdown, xpFrom } from "../lib/level.mjs";
import { LEADERBOARD_METRICS, LEADERBOARD_PERIODS, leaderboardSnapshot, rankLeaderboard, safeDisplayName } from "../lib/leaderboard.mjs";
import { initialsFor } from "../lib/auth.mjs";
import { MASTERY_LABELS, errorStats, weakestErrors } from "../lib/error-mastery.mjs";
import { attemptAdvice, attemptsSince, logAttempt, makeAttempt, practiceForError, readAttempts, summariseAttempts,
  typesFromIssues, typesFromNotes } from "../lib/error-log.mjs";
import { pushTranslationAttempt } from "../lib/cloud-sync";
// Một dòng nhật ký bài dịch. lib/error-log.mjs là JavaScript nên kiểu khai báo ở đây.
type TranslationAttempt = { at: string; day: string; term: string; vi: string; answer: string; reference: string;
  score: number; correct: boolean; gradedBy: "llm" | "reference"; errorTypes: string[]; assessedTypes?: string[];
  practiceType?: string | null; issues?: AiFeedbackItem[] };
import { advice, byDay, entriesSince, summarise, weakest } from "../lib/review-log.mjs";
// Lịch ôn và các phép tính ngày: nguồn duy nhất ở lib/srs.mjs, giao diện chỉ gọi.
import { daysUntil, isDueForReview, localDateString, scheduleFor, streakFrom, weekdayIndex, wordState } from "../lib/srs.mjs";
import { deckStats, primaryTopic, setsFor } from "../lib/word-sets.mjs";
import { cleanStudyVietnamese } from "../lib/vietnamese-text.mjs";
import { DAILY_NEW_LIMIT, DAILY_REVIEW_LIMIT, buildDailyQueue, buildFullCollectionQueue } from "../lib/study-queue.mjs";
import { clozeFor } from "../lib/cloze.mjs";
// Kiểu dùng chung và tầng lưu trữ đã tách khỏi file này.
import { detailsFrom, exampleFor, fallbackExample, fallbackExampleVi, isLegacyOwnerVocabulary, isPdfVocabulary, isSeedWord, withMeanings,
  type EnrichmentMap, type ExamGoal, type ExampleMap, type ImportedVocabulary, type Rating, type ReviewMode,
  type LexicalType, type UsageDetail, type UsageMap, type WeeklyVocabulary, type WordCard } from "../lib/types";
import { accountStorageKey, activeTabKey, composeVietnamese, logReview, markDeleted, markStudiedToday, mergeStoredWords, readAppNavigation, readDeletedIds,
  readExam, readLocalWords, readReviewLog, readSeenRelease, readSession, readSpeaking, readStudyDays, setStorageScope, speakingMinutes, weeklyImportKey, writeExam, writeLocalWords,
  writeSeenRelease,
  writeAppNavigation, writeProgress, writeSession, type ReviewEntry, type StoredSession } from "../lib/storage";

// Mỗi chế độ nói rõ đầu vào và việc người học cần làm; "mixed" xoay vòng
// các kiểu có chấm điểm để tránh học thuộc vị trí câu trả lời.
const drillToReviewMode: Record<string, ReviewMode> = {
  card: "card", type: "vi_en", listen: "listen", reverse: "en_vi", quiz: "quiz", mixed: "mixed",
};
// Chiều ngược lại, suy thẳng từ bảng trên để hai chiều không thể lệch nhau.
const reviewToDrillMode = Object.fromEntries(
  Object.entries(drillToReviewMode).map(([drill, review]) => [review, drill]),
) as Record<ReviewMode, string>;
// Dùng đúng một nguồn nhãn/mô tả cho cả màn "Luyện từ vựng" và phiên ôn.
// Trước đây cùng một thao tác lại mang hai tên khác nhau (Gõ từ/Nhớ từ,
// Trắc nghiệm/Chọn đáp án), khiến người dùng tưởng đây là hai luồng riêng.
const reviewModes: { value: ReviewMode; label: string; description: string; icon: IconName; badge?: string }[] = DRILL_MODES.map((item) => ({
  value: drillToReviewMode[item.value],
  label: item.label,
  description: item.hint,
  icon: item.icon as IconName,
  badge: item.badge,
}));
// "Luyện tổng hợp" phải xoay đúng những kiểu mà màn Luyện từ vựng xoay, và theo
// đúng thứ tự đó. Trước đây chỗ này là một danh sách chép tay: cùng nội dung
// nhưng khác thứ tự, nên cùng một lựa chọn lại cho ra hai chuỗi bài khác nhau —
// và không có gì giữ cho hai bên khỏi trôi xa nhau khi thêm kiểu luyện mới.
// (Thẻ ghi nhớ đứng ngoài vòng xoay vì nó tự đánh giá, không chấm được.)
const rotatingModes: ReviewMode[] = (MIXED_POOL as string[]).map((value) => drillToReviewMode[value]);
const PDF_DAILY_PREVIEW_LIMIT = 20;
// Dùng chung cho mọi màn tạo ví dụ: người dùng chọn kiểu nào thì khi quay lại
// vẫn giữ đúng kiểu đó, kể cả chuyển sang màn thêm từ hoặc luyện dịch.
const exampleLayoutModeKey = "lexilo-example-layout-mode";

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
  return example === naturalExample(word.term)
    || example === fallbackExample(word.term)
    || !exampleUsesVocabulary(example, word.term, word.partOfSpeech);
}

// Những lỗi cũ đã được lưu trước khi bộ lọc dạng từ ra đời vẫn cần được sửa ngay
// trên thẻ, không bắt người học chờ chạy lại toàn bộ kho từ.
const verifiedExampleRepairs: Record<string, Pick<WordCard, "example" | "exampleVi">> = {
  closet: { example: "She keeps her winter coats in the bedroom closet.", exampleVi: "Cô ấy cất áo khoác mùa đông trong tủ quần áo ở phòng ngủ." },
  closets: { example: "The bedrooms have large closets for winter coats.", exampleVi: "Các phòng ngủ có tủ lớn để cất áo khoác mùa đông." },
};

function cardWithRelevantExample(card: WordCard): WordCard {
  const repaired = verifiedExampleRepairs[card.term.trim().toLowerCase()];
  // Với mục đã biết từng bị lẫn loại từ, ưu tiên kiểm tra dạng danh từ chính xác
  // trước. Nhờ vậy metadata cũ ghi nhầm "verb" cũng không giữ lại "closeted".
  if (repaired && !exampleUsesVocabulary(card.example, card.term)) {
    return { ...card, ...repaired, cloze: clozeFor(card.term, repaired.example) };
  }
  if (exampleUsesVocabulary(card.example, card.term, card.partOfSpeech)) return card;
  // Với từ chưa có bản sửa đã kiểm chứng, hiển thị một câu học tập trung thực còn
  // tốt hơn giữ một câu từ điển sai nghĩa. Lần "Bổ sung" tiếp theo sẽ thay nó.
  const example = `The word “${card.term}” appeared in today's English lesson.`;
  return { ...card, example, exampleVi: `Từ “${card.term}” xuất hiện trong bài học tiếng Anh hôm nay.`, cloze: clozeFor(card.term, example) };
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
  if (word.synonyms?.length && !word.synonymDetails?.length) missing.push("ngữ cảnh từ đồng nghĩa");
  if (word.antonyms?.length && !word.antonymDetails?.length) missing.push("ngữ cảnh từ trái nghĩa");
  if (!word.paraphrases?.length) missing.push("paraphrase");
  if (!word.ieltsTopics?.length) missing.push("chủ đề IELTS");
  if (!word.cefr) missing.push("cấp độ CEFR");
  return missing;
}
// Số lần tra tối đa: từ hiếm có thể không bao giờ đủ dữ liệu, tra mãi chỉ tổ đợi.
const MAX_ENRICH_TRIES = 3;
function needsEnrichment(word: WordCard) {
  if (isPdfVocabulary(word) || isSeedWord(word)) return false;
  // Bỏ chốt "đã tra rồi thì thôi": nếu vẫn thiếu trường thì tra lại, tối đa vài
  // lần. Nhờ vậy nút "Bổ sung" quét lại được cả từ từng tra hụt hoặc thiếu
  // trường mới thêm sau này (ví dụ cấp độ CEFR).
  return missingFields(word).length > 0 && (word.enrichmentTries ?? 0) < MAX_ENRICH_TRIES;
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
    localStorage.setItem(accountStorageKey(weeklyImportKey), JSON.stringify({ importedAt: new Date().toISOString(), count: fresh.length }));
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
  // Kho danh sách từ nằm ở đây chứ không nằm trong Words: sườn trái cần đếm số
  // danh sách, và số đó phải đổi ngay khi người dùng tạo hay xoá bên trong.
  const folders: FolderStore = useSyncExternalStore(subscribeFolders, foldersSnapshot, foldersServerSnapshot);
  const [wordsView, setWordsView] = useState<"root" | "daily" | "pdf">("root");
  // Kỹ năng đang mở ở màn tổng quan của nó. null = đang xem một công cụ cụ thể.
  // Đứng riêng với `tab` để không phải đụng vào union đã lưu xuống localStorage.
  const [skillHub, setSkillHub] = useState<SkillId | null>(null);
  const updateFolders = commitFolders;
  // Bài nghe lấy từ video. Tiện ích trình duyệt mở app kèm bài trong phần neo địa chỉ.
  const [lessons, setLessons] = useState<VideoLesson[]>([]);
  const systemLessonsRef = useRef<VideoLesson[]>([]);
  const [imported, setImported] = useState("");
  const [importedVideoId, setImportedVideoId] = useState("");
  const [showVideoAdd, setShowVideoAdd] = useState(false);
  const [theme, setTheme] = useState<string>(DEFAULT_THEME);
  const [reviewing, setReviewing] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<WordCard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [index, setIndex] = useState(0);
  const [words, setWords] = useState(initialWords);
  // Luồng tra từ cần trả về đúng một mã ổn định ngay trong cùng một nhịp bấm.
  // Chỉ đọc `words` từ closure có thể tạo hai UUID nếu người dùng bấm Lưu rồi
  // mở Danh sách rất nhanh, khiến danh sách giữ một mã không có trong kho.
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const [showAdd, setShowAdd] = useState(false);
  const [addOriginLabel, setAddOriginLabel] = useState("màn trước");
  const [showFeedback, setShowFeedback] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  // Chế độ luyện tập chọn thẳng từ thanh bên; null nghĩa là trang công cụ ngoài.
  const [practiceIntent, setPracticeIntent] = useState<Exclude<PracticeMode, "menu"> | null>(null);
  const [practiceLaunch, setPracticeLaunch] = useState(0);
  // Yêu cầu mở thẳng bài vừa nhập. Tách khỏi `lessons` vì chỉ đổi danh sách bài
  // không đủ để màn Practice biết người dùng muốn mở bài nào.
  const [lessonLaunch, setLessonLaunch] = useState<{ videoId: string; mode: "dictation" | "shadow"; nonce: number } | null>(null);
  const lessonLaunchNonce = useRef(0);
  const [libraryLaunch, setLibraryLaunch] = useState<{ filter: "video"; nonce: number } | null>(null);
  const libraryLaunchNonce = useRef(0);
  const openVideoLesson = useCallback((videoId: string, mode: "dictation" | "shadow" = "dictation") => {
    if (!videoId) return;
    // Bài đang dở được mở từ màn tổng quan kỹ năng. Nếu không đóng tổng quan ở
    // đây thì `tab` đã đổi sang practice nhưng SkillHub vẫn phủ lên trên, khiến
    // người dùng có cảm giác nút "Học tiếp" không hoạt động.
    setSkillHub(null);
    setLibraryLaunch(null);
    setPracticeIntent(mode);
    setPracticeLaunch((value) => value + 1);
    lessonLaunchNonce.current += 1;
    setLessonLaunch({ videoId, mode, nonce: lessonLaunchNonce.current });
    setTab("practice");
  }, []);
  const withSystemLessons = useCallback((personal: VideoLesson[]) => (
    mergeLessonSources(systemLessonsRef.current, personal) as VideoLesson[]
  ), []);
  const promoteSystemLesson = useCallback(async (lesson: VideoLesson | VideoLesson[]) => {
    const drafts = promoteSystemLessons(lesson) as VideoLesson[];
    systemLessonsRef.current = mergeLessonSources(systemLessonsRef.current, drafts) as VideoLesson[];
    addLessonsToCatalogue(systemLessonsRef.current);
    setLessons(withSystemLessons(readLessons() as VideoLesson[]));
  }, [withSystemLessons]);
  // Rời khỏi mục luyện tập thì bỏ chế độ đang chọn, để lần sau quay lại không nhảy
  // thẳng vào chế độ cũ một cách bất ngờ.
  const goTab = (next: typeof tab) => {
    if (reviewing) exitReview();
    setShowAdd(false);
    if (next !== "practice") setLibraryLaunch(null);
    // Mở một công cụ cụ thể thì đóng màn tổng quan kỹ năng đang che nội dung.
    setSkillHub(null);
    // Đi thẳng từ sườn trái hoặc thanh trên cùng thì không có cấp nào để lùi về.
    setToolOrigin(null);
    setTab(next);
  };

  /**
   * Kỹ năng mà công cụ đang mở xuất phát từ đó — null nếu vào thẳng.
   *
   * Chỉ dùng để quyết định có hiện nút lùi hay không: nút lùi chỉ có nghĩa khi
   * nó đi LÊN đúng một cấp, chứ không phải mọi màn đều cần một nút về trang chủ.
   */
  const [toolOrigin, setToolOrigin] = useState<SkillId | null>(null);

  /** Mở màn tổng quan của một kỹ năng. */
  const openSkill = (id: SkillId) => {
    if (reviewing) exitReview();
    setShowAdd(false);
    setLibraryLaunch(null);
    // Viết chỉ có một cửa vào với ba lộ trình bên trong. Mở thẳng cửa đó để
    // không bắt người dùng đi qua thêm một màn "Luyện viết" trùng nội dung.
    if (id === "write") {
      setSkillHub(null);
      setLessonLaunch(null);
      try { localStorage.removeItem(practiceShellSessionKey); } catch { /* bộ nhớ bị chặn */ }
      setPracticeIntent("translate");
      setPracticeLaunch((value) => value + 1);
      setTab("practice");
      return;
    }
    setSkillHub(id);
  };

  /** Mở một công cụ bên trong kỹ năng tại đúng điểm bắt đầu của công cụ đó. */
  /** Kho video riêng của người dùng — một mục đứng riêng ở cột trái. */
  const openMyVideos = () => {
    if (reviewing) exitReview();
    setShowAdd(false);
    setSkillHub(null);
    setLessonLaunch(null);
    // Người dùng vừa chủ động chọn, nên không khôi phục bài/chế độ còn sót lại.
    try { localStorage.removeItem(practiceShellSessionKey); } catch { /* bộ nhớ bị chặn */ }
    setPracticeIntent("dictation");
    setPracticeLaunch((value) => value + 1);
    libraryLaunchNonce.current += 1;
    setLibraryLaunch({ filter: "video", nonce: libraryLaunchNonce.current });
    setTab("practice");
  };

  const openTool = (tool: SkillTool) => {
    if (reviewing) exitReview();
    // Ghi lại trước khi xoá: nút lùi của công cụ cần biết nó thuộc kỹ năng nào.
    setToolOrigin(skillHub);
    setSkillHub(null);
    if (tool.kind === "tab") {
      setLibraryLaunch(null);
      if (tool.value === "words") setWordsView("root");
      setTab(tool.value);
      return;
    }
    setLibraryLaunch(null);
    setLessonLaunch(null);
    // Hai thẻ Nói nhại/Luyện nói phải mở luồng mới tương ứng, không dính
    // lessonVideoId hay mode đã lưu từ phiên công cụ cũ.
    try { localStorage.removeItem(practiceShellSessionKey); } catch { /* bộ nhớ bị chặn */ }
    setPracticeIntent(tool.value);
    setPracticeLaunch((value) => value + 1);
    setTab("practice");
  };
  const [detailWord, setDetailWord] = useState<WordCard | null>(null);
  // Từ được nạp sẵn khi mở trang Từ điển AI từ chỗ khác (ô tra nhanh trong bài học).
  const [dictionaryWord, setDictionaryWord] = useState("");
  // Nơi người dùng đứng trước khi mở Từ điển. Không dùng history.back(): ứng
  // dụng đổi màn bằng state nên URL không đổi, nút Back của trình duyệt không
  // biết phải quay về bài video, phiên ôn hay kho từ nào.
  const [dictionaryOrigin, setDictionaryOrigin] = useState<{
    tab: "home" | "words" | "practice" | "stats" | "dictionary";
    skillHub: SkillId | null;
    reviewing: boolean;
    label: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [reviewMode, setReviewMode] = useState<ReviewMode>("mixed");
  const [choice, setChoice] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<"connecting" | "synced" | "demo">("connecting");
  const [userId, setUserId] = useState<string | null>(null);
  // Bản sao dạng ref để handler onAuthStateChange (đăng ký một lần) luôn đọc được id hiện tại.
  const userIdRef = useRef<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "magic" | "forgot" | "recovery">("signin");
  const openAuth = useCallback((mode: "signin" | "signup" | "magic" | "forgot" | "recovery" = "signin") => {
    setAuthMode(mode);
    setShowAuth(true);
  }, []);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const { plan: planInfo, refresh: refreshPlan } = usePlan(userId);
  const [legacyCollections, setLegacyCollections] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pendingSession, setPendingSession] = useState<StoredSession | null>(null);
  const [backfill, setBackfill] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [leveling, setLeveling] = useState<{ done: number; total: number } | null>(null);
  const [exam, setExam] = useState<ExamGoal | null>(null);
  const [studyDays, setStudyDays] = useState<string[]>([]);
  // Điểm số của phiên đang chạy, dùng để quyết định có chúc mừng ở màn tổng kết hay không.
  const [sessionRatings, setSessionRatings] = useState<Rating[]>([]);
  const startedAt = useRef(Date.now());
  const card = reviewQueue[index];

  const filtered = useMemo(() => words.filter((word) => `${word.term} ${word.meaning} ${word.topic}`.toLowerCase().includes(query.toLowerCase())), [words, query]);
  const personalLessonCount = useMemo(() => lessons.filter((lesson) => lesson.source !== "system").length, [lessons]);
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
  // Nhận bài do tiện ích gửi sang. Dữ liệu đến từ địa chỉ nên lessonFromHash phải
  // kiểm từng trường trước khi lưu; ở đây chỉ lo phần đọc neo và dọn neo đi.
  useEffect(() => {
    const decode = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
    /**
     * Tiện ích gửi sang một video KHÔNG CÓ PHỤ ĐỀ để nhờ AI nghe hộ.
     *
     * Tiện ích không gọi thẳng API được: nó chạy ở origin chrome-extension://…
     * nên bị chặn chéo nguồn. Ở đây thì cùng origin, gọi thoải mái.
     */
    const takeTranscribe = async () => {
      const match = window.location.hash.match(/[#&]transcribe=([^&]+)/);
      if (!match) return false;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      let video: { videoId?: string; title?: string; author?: string; seconds?: number };
      try {
        video = JSON.parse(decode(decodeURIComponent(match[1])));
      } catch {
        setImported("Không đọc được video tiện ích gửi sang.");
        return true;
      }
      setImported(`Đang nhờ AI nghe "${video.title || "video"}"… video dài thì mất một lúc.`);
      try {
        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${video.videoId}`, seconds: video.seconds }),
        });
        const data = (await response.json()) as { sentences?: unknown[]; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? "Không đọc được lời thoại.");
        const lesson = {
          videoId: video.videoId,
          title: video.title,
          author: video.author,
          seconds: video.seconds,
          source: "extension",
          // Mốc giờ là ước lượng, không phải mốc thật của phụ đề. Đánh dấu để
          // app nói rõ điều đó và không nhắc "bắt lại phụ đề" — video này làm
          // gì có phụ đề mà bắt lại.
          estimated: true,
          sentences: data.sentences ?? [],
        };
        addLessonsToCatalogue([lesson]);
        const personal = saveLesson(lesson) as VideoLesson[];
        const list = withSystemLessons(personal);
        setLessons(list);
        // Đếm theo bài ĐÃ LƯU, không theo số đoạn AI trả về: bước lưu còn gộp
        // các mẩu ngắn lại, nên hai con số lệch nhau và người học thấy sai.
        const saved = list.find((item) => item.id === `yt-${lesson.videoId}`);
        setImported(`AI đã nghe xong "${lesson.title}" · ${saved?.sentences.length ?? 0} câu · đang mở bài để luyện.`);
        if (lesson.videoId) {
          setImportedVideoId(lesson.videoId);
          openVideoLesson(lesson.videoId);
        }
      } catch (problem) {
        setImported(problem instanceof Error ? problem.message : "Không đọc được lời thoại.");
      }
      return true;
    };

    const take = () => {
      const lesson = lessonFromHash(window.location.hash, decode) as { title: string; sentences: unknown[] } | null;
      if (!lesson) return;
      addLessonsToCatalogue([lesson]);
      const next = withSystemLessons(saveLesson(lesson) as VideoLesson[]);
      setLessons(next);
      const opened = "videoId" in lesson ? next.find((item) => item.videoId === lesson.videoId) : null;
      setImported(`Đã thêm bài "${lesson.title}" · ${opened?.sentences.length ?? 0} câu · đang mở bài để luyện`);
      if ("videoId" in lesson && typeof lesson.videoId === "string") {
        setImportedVideoId(lesson.videoId);
        openVideoLesson(lesson.videoId);
      }
      // Dọn neo đi để tải lại trang không thêm bài lần nữa.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    const personal = readLessons() as VideoLesson[];
    systemLessonsRef.current = readSystemDrafts() as VideoLesson[];
    setLessons(withSystemLessons(personal));
    void fetch("/system-lessons.json")
      .then(async (response) => {
        const data = (await response.json()) as VideoLesson[];
        if (!response.ok) return;
        systemLessonsRef.current = mergeLessonSources(data, readSystemDrafts()) as VideoLesson[];
        addLessonsToCatalogue(systemLessonsRef.current);
        setLessons(withSystemLessons(readLessons() as VideoLesson[]));
      })
      .catch(() => {
        // Kho mặc định không đọc được thì kho cá nhân vẫn hoạt động bình thường.
      });
    const takeIncoming = () => {
      void takeTranscribe().then((done) => {
        if (!done) take();
      });
    };
    takeIncoming();
    // Cả bài có phụ đề lẫn bài cần AI nghe đều phải chạy khi tiện ích gửi vào tab
    // đang mở. Trước đây hashchange chỉ gọi `take`, nên nhánh transcribe báo thành
    // công ở tiện ích nhưng Lexilo không dựng màn video.
    window.addEventListener("hashchange", takeIncoming);
    return () => window.removeEventListener("hashchange", takeIncoming);
  }, [openVideoLesson, withSystemLessons]);

  useEffect(() => {
    const saved = readTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đồng bộ một lần với localStorage, không tạo vòng lặp render
    setTheme(saved);
    applyTheme(saved);
  }, []);
  function chooseTheme(id: string) {
    setTheme(writeTheme(id).id);
    applyTheme(id);
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
    async function loadPdfCards(): Promise<WordCard[]> {
      const [response, examples, extras, usage] = await Promise.all([
        fetch("/vocabulary-1000.json"), loadExamples(), loadEnrichment(), loadUsage(),
      ]);
      if (!response.ok) return [];
      const vocabulary = (await response.json()) as ImportedVocabulary[];
      return vocabulary.map((item) => {
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
      });
    }
    async function loadLocalVocabulary(includeLegacy = false) {
      if (!includeLegacy) {
        if (active) setWords(mergeStoredWords([]).filter((word) => !isLegacyOwnerVocabulary(word)));
        return;
      }
      const [pdfCards, weeklyResponse, weeklyExamplesResponse] = await Promise.all([loadPdfCards(), fetch("/weekly-vocabulary.json"), fetch("/weekly-examples.json")]);
      const weeklyVocabulary = weeklyResponse.ok ? ((await weeklyResponse.json()) as WeeklyVocabulary[]) : [];
      const weeklyExamples = weeklyExamplesResponse.ok ? ((await weeklyExamplesResponse.json()) as ExampleMap) : {};
      if (!active) return;
      setWords(
        mergeStoredWords([...takeWeeklyImport(weeklyVocabulary, weeklyExamples), ...pdfCards]),
      );
    }
    async function connect() {
      if (!supabase) {
        setStorageScope(null);
        setFolderScope(null);
        setLegacyCollections(false);
        await loadLocalVocabulary(false);
        setCloudStatus("demo");
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setStorageScope(null);
        setFolderScope(null);
        setLegacyCollections(false);
        await loadLocalVocabulary(false);
        if (active) setCloudStatus("demo");
        return;
      }
      let ownsLegacyLibrary = false;
      try {
        const response = await aiFetch("/api/me/entitlement");
        if (response.ok) {
          const entitlement = (await response.json()) as { legacyLibrary?: boolean };
          ownsLegacyLibrary = entitlement.legacyLibrary === true;
        }
      } catch {
        // Mặc định an toàn: không công khai bộ cá nhân cũ khi chưa xác minh được chủ sở hữu.
      }
      setStorageScope(session.user.id, ownsLegacyLibrary);
      setFolderScope(session.user.id, ownsLegacyLibrary);
      setLegacyCollections(ownsLegacyLibrary);
      const scopedLessons = readLessons() as VideoLesson[];
      addLessonsToCatalogue(systemLessonsRef.current);
      setLessons(withSystemLessons(scopedLessons));
      setUserId(session.user.id);
      userIdRef.current = session.user.id;
      setUserEmail(session.user.email ?? null);
      setUserName(safeDisplayName(session.user.user_metadata?.full_name ?? session.user.user_metadata?.name, session.user.id));
      let { data, error } = await supabase.from("words").select("*, word_states(box,lapse_count,direction,due_date,status,interval_days,review_count,last_reviewed_at)").is("deleted_at", null).order("created_at", { ascending: false });
      if (error) {
        // Schema cũ có thể chưa có deleted_at hoặc một trường lịch ôn mới. Vẫn
        // đọc được kho từ cốt lõi; tiến độ thiếu sẽ dùng giá trị mặc định/local.
        ({ data, error } = await supabase.from("words").select("*").order("created_at", { ascending: false }));
      }
      if (!active) return;
      if (error) {
        await loadLocalVocabulary(ownsLegacyLibrary);
        setCloudStatus("demo");
        return;
      }
      let cloudWords = data ?? [];
      if (ownsLegacyLibrary) try {
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
        const localPersonal = readLocalWords().filter((word) => !isLegacyOwnerVocabulary(word) && !isSeedWord(word));
        const existingTerms = new Set(cloudWords.map((row) => String(row.term).trim().toLowerCase()));
        const missingPersonal = localPersonal.filter((word) => !existingTerms.has(word.term.trim().toLowerCase()));
        for (const word of missingPersonal) {
          const personalPayload = {
            id: word.id,
            user_id: session.user.id,
            term: word.term,
            lexical_type: word.lexicalType || inferLexicalType(word.term, word.partOfSpeech),
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
          };
          let { data: inserted, error: insertError } = await supabase.from("words").insert(personalPayload).select().single();
          if (insertError) {
            const compatiblePayload = Object.fromEntries(Object.entries(personalPayload).filter(([column]) => !["synonym_details", "antonym_details", "related_details"].includes(column)));
            ({ data: inserted, error: insertError } = await supabase.from("words").insert(compatiblePayload).select().single());
          }
          if (insertError) throw insertError;
          if (!inserted) throw new Error("Supabase không trả về từ vừa lưu.");
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
              lexicalType: row.lexical_type || inferLexicalType(row.term, row.part_of_speech),
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
              cefr: typeof row.cefr === "string" && row.cefr ? row.cefr : undefined,
            };
          }).filter((word) => ownsLegacyLibrary || !isLegacyOwnerVocabulary(word));
      // Luôn hợp nhất dữ liệu trên máy, kể cả khi cloud trả về rỗng hoặc chỉ có bộ PDF.
      // Nếu không làm vậy, từ cá nhân có thể biến mất khỏi giao diện sau khi phiên ẩn danh thay đổi.
      if (!ownsLegacyLibrary) {
        setWords(mergeStoredWords(mappedCloudWords).filter((word) => !isLegacyOwnerVocabulary(word)));
        setCloudStatus("synced");
        return;
      }
      const [weeklyResponse, weeklyExamplesResponse, pdfCards] = await Promise.all([fetch("/weekly-vocabulary.json"), fetch("/weekly-examples.json"), loadPdfCards()]);
      const weeklyVocabulary = weeklyResponse.ok ? ((await weeklyResponse.json()) as WeeklyVocabulary[]) : [];
      const weeklyExamples = weeklyExamplesResponse.ok ? ((await weeklyExamplesResponse.json()) as ExampleMap) : {};
      const weeklyTerms = new Set(weeklyVocabulary.map((word) => word.term.trim().toLowerCase()));
      const correctedCloudWords = mappedCloudWords.map((word) => {
        const pair = weeklyExamples[word.term.trim().toLowerCase()];
        if (!pair || (!word.source?.endsWith(".xlsx") && !weeklyTerms.has(word.term.trim().toLowerCase()))) return word;
        return { ...word, example: pair[0], exampleVi: pair[1], cloze: clozeFor(word.term, pair[0]) };
      });
      // Nội dung PDF luôn lấy từ file gốc để đủ 983 mục và giữ mã pdf-* ổn định.
      // Nếu cloud có tiến độ của bản PDF đã nhập trước đây, ghép phần tiến độ vào
      // thẻ gốc thay vì dùng bản cloud thay thế rồi làm mất thư mục/chủ đề.
      const cloudPdfByTerm = new Map(correctedCloudWords.filter(isPdfVocabulary).map((word) => [word.term.trim().toLowerCase(), word]));
      const restoredPdfCards = pdfCards.map((word) => {
        const cloud = cloudPdfByTerm.get(word.term.trim().toLowerCase());
        return cloud ? {
          ...word,
          box: cloud.box,
          lapses: cloud.lapses,
          starred: cloud.starred,
          dueDate: cloud.dueDate,
          status: cloud.status,
          intervalDays: cloud.intervalDays,
          reviewCount: cloud.reviewCount,
          lastReviewedAt: cloud.lastReviewedAt,
        } : word;
      });
      const personalCloudWords = correctedCloudWords.filter((word) => !isPdfVocabulary(word));
      const cloudTerms = new Set(personalCloudWords.map((word) => word.term.trim().toLowerCase()));
      setWords(mergeStoredWords([
        ...takeWeeklyImport(weeklyVocabulary, weeklyExamples).filter((word) => !cloudTerms.has(word.term.trim().toLowerCase())),
        ...restoredPdfCards,
        ...personalCloudWords,
      ]));
      setCloudStatus("synced");
    }
    connect().finally(() => {
      if (!active) return;
      // Khôi phục ở đây (sau khi hydrate) thay vì lúc khởi tạo state, nếu không HTML dựng sẵn
      // sẽ là "home" còn client là trang đã lưu — React báo lỗi hydration.
      const navigation = readAppNavigation();
      const savedTab = navigation?.tab ?? localStorage.getItem(activeTabKey);
      if (savedTab === "home" || savedTab === "words" || savedTab === "practice" || savedTab === "stats" || savedTab === "dictionary") setTab(savedTab);
      if (navigation?.practiceIntent && practiceNav.some((item) => item.value === navigation.practiceIntent)) {
        setPracticeIntent(navigation.practiceIntent as Exclude<PracticeMode, "menu">);
      }
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
      // Bấm liên kết khôi phục mật khẩu từ email → mở luôn màn đặt mật khẩu mới.
      if (event === "PASSWORD_RECOVERY") {
        setAuthMode("recovery");
        setShowAuth(true);
        return;
      }
      // Nạp lại đúng một lần khi khách vừa đăng nhập hoặc đổi tài khoản để hàm connect
      // phía trên tải dữ liệu cloud. Các lần làm mới token sau đó không làm mất màn đang học.
      const freshSignIn = event === "SIGNED_IN" && !userIdRef.current && !!nextId;
      const changedAccount = event === "SIGNED_IN" && !!userIdRef.current && !!nextId && nextId !== userIdRef.current;
      if (event === "SIGNED_OUT" || freshSignIn || changedAccount) window.location.reload();
      else if (nextId && session?.user) {
        userIdRef.current = nextId;
        setUserId(nextId);
        setUserEmail(session.user.email ?? null);
        setUserName(safeDisplayName(session.user.user_metadata?.full_name ?? session.user.user_metadata?.name, nextId));
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Chỉ ghi sau khi đã khôi phục xong, nếu không giá trị "home" ban đầu sẽ đè lên trang đã lưu.
    if (!hydrated) return;
    try {
      writeAppNavigation({ tab, practiceIntent });
    } catch {
      // Trình duyệt chặn lưu trữ — bỏ qua.
    }
  }, [tab, practiceIntent, hydrated]);

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
  // Đẩy bậc CEFR lên cloud để lần tải sau (kể cả trên máy khác) không phải xếp lại.
  // Cột `cefr` có thể chưa tồn tại ở database cũ — lỗi thì bỏ qua, bản trên máy vẫn giữ.
  const saveCefrToCloud = useCallback((updates: { id: string; cefr: string }[]) => {
    if (!supabase || !userIdRef.current) return;
    for (const { id, cefr } of updates) {
      if (id.startsWith("pdf-")) continue; // từ bộ PDF không nằm trên cloud
      void supabase.from("words").update({ cefr }).eq("id", id).then(({ error }) => {
        if (error) console.warn("Chưa đồng bộ được cấp độ (có thể database chưa có cột cefr)", error.message);
      });
    }
  }, []);
  const levelingRef = useRef(false);
  const ipaFillRef = useRef(false);

  // Đắp phiên âm IPA cho các từ đang trống (kể cả bộ PDF và cụm nhiều từ). Dùng
  // /api/ipa — từ điển CMU đóng gói sẵn nên phần lớn xong ngay tại chỗ, rất nhanh.
  const fillIpa = useCallback(async (targets: WordCard[]) => {
    const need = targets.filter((word) => word.term && (!word.ipa || word.ipa === "/…/" || word.ipa === "//"));
    if (!need.length || ipaFillRef.current) return;
    ipaFillRef.current = true;
    try {
      for (let start = 0; start < need.length; start += 100) {
        const batch = need.slice(start, start + 100);
        const response = await fetch("/api/ipa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words: batch.map((word) => word.term) }),
        });
        const data = (await response.json().catch(() => ({}))) as { ipa?: Record<string, string>; estimated?: Record<string, string> };
        const found = { ...(data.ipa ?? {}), ...(data.estimated ?? {}) };
        setWords((current) => current.map((word) => {
          const key = word.term.replace(/\s+/g, " ").trim().toLowerCase();
          const ipa = found[key];
          return ipa && (!word.ipa || word.ipa === "/…/" || word.ipa === "//") ? { ...word, ipa } : word;
        }));
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } catch (error) {
      console.error("Không đắp được phiên âm", error);
    } finally {
      ipaFillRef.current = false;
    }
  }, []);

  // Tra lại lần lượt từng từ còn thiếu dữ liệu và đắp vào các ô trống.
  // Chạy tuần tự có giãn nhịp vì mỗi lần tra gọi tới từ điển, Datamuse và dịch máy.
  // Không truyền gì thì quét cả kho; truyền danh sách thì chỉ tra đúng những từ đó
  // (dùng ngay sau khi dán danh sách, lúc state chưa kịp cập nhật).
  async function fillMissingFields(only?: WordCard[]) {
    if (backfill) return;
    const scope = only ?? words;
    // Bước 0: xếp cấp độ CEFR + đắp phiên âm IPA cho MỌI từ còn thiếu (kể cả bộ
    // PDF) — chạy nền song song, không chặn vòng tra bên dưới. Cả hai đều tra dữ
    // liệu đóng gói sẵn tại chỗ nên nhanh.
    void assignLevels(scope.filter((word) => !isSeedWord(word)), true);
    void fillIpa(scope.filter((word) => !isSeedWord(word)));
    // Bước 1: các trường còn lại của TỪ TỰ THÊM (nghĩa, câu ví dụ, đồng nghĩa,
    // chủ đề IELTS…) — bộ PDF đã có sẵn dữ liệu dựng trước. CEFR đã lo ở bước 0.
    const pool = scope.filter((word) => !isPdfVocabulary(word) && !isSeedWord(word));
    const targets = pool.filter((word) => {
      if ((word.enrichmentTries ?? 0) >= MAX_ENRICH_TRIES) return false;
      return missingFields(word).filter((field) => field !== "cấp độ CEFR").length > 0;
    });
    if (!targets.length) return;
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
        setWords((current) => current.map((item) => (item.id === word.id ? { ...mergeEnrichment(item, data), enrichmentTries: (item.enrichmentTries ?? 0) + 1 } : item)));
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
        // Tra hỏng cũng tính là một lần thử, để từ hiếm không kẹt lại mãi.
        setWords((current) => current.map((item) => (item.id === word.id ? { ...item, enrichmentTries: (item.enrichmentTries ?? 0) + 1 } : item)));
        console.error(`Không bổ sung được dữ liệu cho “${word.term}”`, error);
      }
      setBackfill({ done: position + 1, total: targets.length, failed });
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    // Giữ kết quả trên màn hình một lúc cho người dùng đọc rồi mới ẩn.
    setTimeout(() => setBackfill(null), 4000);
  }

  const assignLevels = useCallback(async (targets: WordCard[], quiet = false) => {
    const list = targets.filter((word) => !word.cefr && word.term);
    if (!list.length || levelingRef.current) return;
    levelingRef.current = true;
    if (!quiet) setLeveling({ done: 0, total: list.length });
    for (let start = 0; start < list.length; start += 120) {
      const batch = list.slice(start, start + 120);
      try {
        const response = await fetch("/api/ai/level", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ terms: batch.map((word) => word.term) }),
        });
        const data = (await response.json()) as { levels?: Record<string, string | null>; error?: string };
        if (!response.ok || !data.levels) throw new Error(data.error ?? "Không xếp được cấp độ.");
        const levels = data.levels;
        setWords((current) => current.map((word) => {
          if (word.cefr || !(word.term in levels)) return word;
          // "?" = đã xét nhưng không xếp được (cụm nhiều từ) — để không hỏi lại mãi.
          return { ...word, cefr: levels[word.term] ?? "?" };
        }));
        saveCefrToCloud(
          batch
            .filter((word) => !word.cefr && levels[word.term] && levels[word.term] !== "?")
            .map((word) => ({ id: word.id, cefr: levels[word.term] as string })),
        );
      } catch (error) {
        console.error("Không xếp được cấp độ cho lô từ", error);
      }
      if (!quiet) setLeveling({ done: Math.min(start + batch.length, list.length), total: list.length });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    levelingRef.current = false;
    if (!quiet) setTimeout(() => setLeveling(null), 3500);
  }, [saveCefrToCloud]);

  // Từ trong phiên dở còn khôi phục được — dùng để hiện/ẩn thanh "Học tiếp" và
  // hiện đúng số. Khi mới đăng nhập, `words` còn đang tải từ cloud nên phiên có
  // thể tạm chưa khớp; lúc đó ẩn thanh đi rồi hiện lại khi dữ liệu về, tốt hơn là
  // hiện một nút bấm vào không làm gì.
  const resumableQueue = useMemo(() => {
    if (!pendingSession) return [];
    const byId = new Map(words.map((word) => [word.id, word]));
    return pendingSession.ids.map((id) => byId.get(id)).filter((word): word is WordCard => !!word);
  }, [pendingSession, words]);
  function resumeSession() {
    if (!pendingSession || !resumableQueue.length) return;
    const queue = resumableQueue;
    setPendingSession(null);
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
        openAddWordForm();
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

  function launchReview(queue: WordCard[], mode?: ReviewMode) {
    if (!queue.length) {
      alert("Không còn từ nào cần ôn trong nhóm này. Hãy chọn nhóm khác hoặc thêm từ mới.");
      return;
    }
    setReviewQueue(queue);
    // Mọi lối vào trực tiếp (Trang chủ, từ đến hạn, folder, chủ đề) dùng cùng
    // một mặc định. Không để kiểu vừa dùng ở một luồng rò sang luồng kế tiếp.
    setReviewMode(mode ?? "mixed");
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
    launchReview(buildCollectionQueue(words.filter((word) => primaryTopic(word) === topic)));
  }
  // Học đúng một danh sách đã chọn sẵn. Thư mục người dùng tự tạo không suy ra
  // được từ một trường nào của từ, nên phải nhận thẳng danh sách.
  function startWordListReview(list: WordCard[]) {
    launchReview(buildCollectionQueue(list));
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

  // Mọi màn học/luyện đều ghi về cùng tiến trình với màn Ôn tập. Trước đây các
  // màn này chỉ giữ điểm trong component nên trang chủ và lịch ôn không biết người
  // dùng vừa học từ nào.
  function recordPracticeResult(id: string, rating: Rating) {
    const before = words.find((word) => word.id === id);
    if (!before) return;
    const { box: afterBox, interval } = scheduleFor(before, rating);
    const due = new Date();
    due.setDate(due.getDate() + interval);
    const after: WordCard = {
      ...before,
      box: afterBox,
      lapses: rating === "again" ? before.lapses + 1 : before.lapses,
      intervalDays: interval,
      dueDate: localDateString(due),
      status: afterBox === 6 ? "mastered" : "review",
      reviewCount: (before.reviewCount ?? 0) + 1,
      lastReviewedAt: new Date().toISOString(),
    };
    setWords((current) => current.map((word) => (word.id === id ? after : word)));
    logReview({ at: new Date().toISOString(), id, term: before.term, rating, boxBefore: before.box, boxAfter: afterBox, firstTime: !(before.reviewCount ?? 0) });
    void persistReview(before, after, rating, 0);
    setStudyDays(markStudiedToday());
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
  // Lưu một từ vừa tra vào kho, đi đúng đường thêm từ như mọi nơi để từ đó vào
  // luôn lịch ôn Leitner. Trả về mã từ: đã có thì trả mã cũ, chưa có thì tạo mới.
  function saveFoundWord(found: NewWord): string {
    const key = found.term.trim().toLowerCase();
    const existing = wordsRef.current.find((word) => word.term.trim().toLowerCase() === key);
    if (existing) return existing.id;
    const created: WordCard = {
      id: crypto.randomUUID(),
      term: found.term,
      ipa: found.ipa,
      meaning: found.meaning,
      partOfSpeech: found.partOfSpeech,
      lexicalType: found.lexicalType || (inferLexicalType(found.term, found.partOfSpeech) as LexicalType),
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
      studyDay: legacyCollections ? weekdayIndex() : undefined,
    };
    // Chốt mã trước khi React render lại để mọi lần bấm kế tiếp trong cùng một
    // frame đều nhận đúng mã của từ vừa được thêm.
    wordsRef.current = [created, ...wordsRef.current];
    setWords((current) =>
      current.some((word) => word.term.trim().toLowerCase() === key) ? current : [created, ...current],
    );
    void persistWord(created);
    return created.id;
  }

  function setWordStudyDay(id: string, day: number | null) {
    const safeDay = typeof day === "number" ? Math.min(6, Math.max(0, Math.trunc(day))) : undefined;
    setWords((current) => current.map((word) => (word.id !== id ? word : { ...word, studyDay: safeDay })));
    if (supabase) void supabase.from("words").update({ study_day: safeDay ?? null, updated_at: new Date().toISOString() }).eq("id", id);
  }

  // Ghi lại bậc CEFR khi thẻ chi tiết tự tra. Ổn định qua useCallback để effect
  // trong WordDetail không chạy lại vòng vòng.
  const markWordLevel = useCallback((id: string, level: string) => {
    setWords((current) => current.map((word) => (word.id === id && (!word.cefr || word.cefr === "?") ? { ...word, cefr: level } : word)));
    saveCefrToCloud([{ id, cefr: level }]);
  }, [saveCefrToCloud]);

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
    const cloudWord = {
      id: word.id,
      user_id: user.id,
      term: word.term,
      lexical_type: word.lexicalType || inferLexicalType(word.term, word.partOfSpeech),
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
    };
    let { error } = await supabase.from("words").insert(cloudWord);
    if (error) {
      // Một số dự án Supabase cũ chưa chạy migration cho các trường enrichment.
      // Lưu phần cốt lõi trước để từ không chỉ nằm trên một máy; nội dung mở rộng
      // vẫn được giữ trong localStorage và có thể đồng bộ sau khi nâng schema.
      const optionalColumns = new Set(["synonym_details", "antonym_details", "related_details", "enrichment_checked_at", "lexical_type"]);
      const compatibleWord = Object.fromEntries(Object.entries(cloudWord).filter(([column]) => !optionalColumns.has(column)));
      ({ error } = await supabase.from("words").insert(compatibleWord));
    }
    if (error) {
      console.error("Không lưu được từ lên Supabase, từ vẫn được giữ trên máy này.", error);
      setCloudStatus("demo");
      return;
    }
    const { error: stateError } = await supabase.from("word_states").insert([
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
    if (stateError) {
      console.error("Đã lưu từ nhưng chưa tạo được lịch ôn trên Supabase.", stateError);
      setCloudStatus("demo");
      return;
    }
    setCloudStatus("synced");
  }
  async function deleteWordFromCloud(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from("words").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    // Schema cũ chưa có deleted_at: thao tác xoá mà người dùng vừa xác nhận vẫn
    // phải có hiệu lực sau khi tải lại, nên lùi về xoá bản ghi thật.
    if (error) {
      const { error: deleteError } = await supabase.from("words").delete().eq("id", id);
      if (deleteError) console.error("Không xoá được từ trên Supabase.", deleteError);
    }
  }
  function speak(term: string) {
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(term));
  }

  // Tên màn đang mở. Một nguồn duy nhất cho thanh trên cùng và cho góp ý, nhờ
  // vậy góp ý không bao giờ khai sai màn so với thứ người dùng đang nhìn.
  const screenLabel = showAdd ? "Thêm từ"
    : skillHub
    ? (SKILL_SPACES.find((item) => item.id === skillHub)?.label ?? "Kỹ năng")
    : tab === "home" ? "Tổng quan hôm nay"
      : tab === "words" ? "Kho từ vựng"
        : tab === "practice" ? (libraryLaunch ? "Video của tôi" : practiceNav.find((item) => item.value === practiceIntent)?.label ?? "Luyện tập")
          : tab === "stats" ? "Tiến độ học tập" : "Từ điển AI";

  function openAddWordForm() {
    setAddOriginLabel(screenLabel);
    setShowAdd(true);
  }

  function openDictionaryPage(term = "") {
    if (tab !== "dictionary" || reviewing || skillHub) {
      setDictionaryOrigin({ tab, skillHub, reviewing, label: reviewing ? "phiên học" : screenLabel });
    }
    setDictionaryWord(term);
    // Tạm ẩn phiên học nhưng giữ nguyên queue/index/đáp án. Khi quay lại, người
    // học tiếp tục đúng thẻ đang đứng chứ không khởi tạo một phiên mới.
    if (reviewing) setReviewing(false);
    setSkillHub(null);
    setTab("dictionary");
  }

  function returnFromDictionary() {
    if (!dictionaryOrigin) return;
    setTab(dictionaryOrigin.tab);
    setSkillHub(dictionaryOrigin.skillHub);
    setReviewing(dictionaryOrigin.reviewing);
    setDictionaryWord("");
    setDictionaryOrigin(null);
  }

  // Trang công khai là cổng vào của ứng dụng. Chỉ dựng workspace học sau khi đã
  // có phiên Supabase; nhờ vậy khách không nhìn thấy sidebar rồi mới được hỏi đăng nhập.
  if (!userId) {
    return (
      <>
        <LandingPage
          loading={!hydrated || cloudStatus === "connecting"}
          openSignIn={() => openAuth("signin")}
          openSignUp={() => openAuth("signup")}
        />
        {showAuth && <AuthModal close={() => setShowAuth(false)} signedInEmail={null} startMode={authMode} />}
      </>
    );
  }

  return (
    <LookupActionsContext.Provider value={{ saveWord: saveFoundWord, openDictionary: openDictionaryPage }}>
    <main className="app-shell lexilo-workspace" data-section={tab} data-practice={practiceIntent ?? undefined}>
      <a className="skip-link" href="#workspace-content">Bỏ qua điều hướng</a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">L</span>
          <span className="brand-copy"><b>Lexilo</b><small>English workspace</small></span>
        </div>
        {/* Bốn kỹ năng thay cho mười mục phẳng. Mỗi kỹ năng mở ra không gian
            riêng chứa đủ công cụ của nó — xem SKILLS. Không mất chức năng nào,
            chỉ đổi cách tìm tới chúng. */}
        <nav aria-label="Điều hướng chính" className="skill-nav">
          <button className={tab === "home" && !skillHub && !showAdd ? "nav-item active" : "nav-item"} onClick={() => goTab("home")}>
            <Icon name="home" /> Trang chủ
          </button>

          <span className="nav-group">KỸ NĂNG</span>
          {SKILL_SPACES.map((item) => {
            // Sáng đèn khi đang ở màn tổng quan của kỹ năng, HOẶC đang dùng một
            // công cụ thuộc kỹ năng đó — để người dùng luôn biết mình đang ở đâu.
            const insideTool =
              !skillHub &&
              item.tools.some((tool) =>
                tool.kind === "practice"
                  ? tab === "practice" && practiceIntent === tool.value && !libraryLaunch
                  : tab === tool.value,
              );
            const active = showAdd ? item.id === "vocab" : skillHub === item.id || insideTool;
            return (
              <button
                key={item.id}
                className={active ? "nav-item nav-skill active" : "nav-item nav-skill"}
                aria-current={active ? "page" : undefined}
                onClick={() => openSkill(item.id)}
              >
                <Icon name={item.icon} /> {item.label}
              </button>
            );
          })}

          <span className="nav-group">THEO DÕI</span>
          <button className={tab === "stats" && !skillHub ? "nav-item active" : "nav-item"} onClick={() => goTab("stats")}>
            <Icon name="chart" /> Tiến độ
          </button>
          {/* Kho video riêng đứng tách khỏi bốn kỹ năng: nó không phải một cách
              luyện, mà là nguồn tư liệu dùng chung cho cả Nghe lẫn Nói. Vì vậy
              nó cũng không thuộc nhóm THEO DÕI — cho nó nhãn riêng. */}
          <span className="nav-group">THƯ VIỆN</span>
          <button
            className={tab === "practice" && !!libraryLaunch && !skillHub ? "nav-item active" : "nav-item"}
            onClick={openMyVideos}
          >
            <Icon name="play" /> Video của tôi
            {personalLessonCount > 0 && <em className="nav-count">{personalLessonCount}</em>}
          </button>
        </nav>
        <div className="sidebar-bottom">
          {planInfo?.plan === "admin" ? (
            <button className="upgrade-cta is-admin" onClick={() => setShowAdmin(true)}>
              <Icon name="sparkles" size={15} />
              <span>Quản trị Premium</span>
            </button>
          ) : (
            <button className={`upgrade-cta${planInfo?.plan === "premium" ? " is-premium" : ""}`} onClick={() => setShowUpgrade(true)}>
              <Icon name="sparkles" size={15} />
              <span>
                {planInfo?.plan === "premium" ? "Đang dùng Premium" : "Nâng cấp Premium"}
                {planInfo && planInfo.plan !== "premium" && planInfo.monthly.aiLookups
                  ? ` · Truy vấn AI ${planInfo.monthly.aiLookups.used}/${planInfo.monthly.aiLookups.cap}`
                  : ""}
              </span>
            </button>
          )}
          <ThemeMenu current={theme} choose={chooseTheme} />
          <button className="profile" onClick={() => openAuth()}>
            <span className="avatar">{initialsFor(userName, userEmail ?? "")}</span>
            <span>
              <b>{userId ? userName : "Đăng nhập"}</b>
              {userEmail && <small className="profile-email">{userEmail}</small>}
              <small className="profile-status">{userId
                ? cloudStatus === "synced" ? "● Đã đồng bộ" : cloudStatus === "connecting" ? "Đang đồng bộ…" : "◐ Đã đăng nhập · chờ đồng bộ"
                : cloudStatus === "connecting" ? "Đang kết nối…" : "◐ Chưa đăng nhập · chỉ lưu trên máy"}</small>
            </span>
            <span>•••</span>
          </button>
        </div>
      </aside>

      <section className="content" id="workspace-content">
        {reviewing ? (
          !reviewQueue.length || index >= reviewQueue.length ? (
            <SessionSummary total={reviewQueue.length} ratings={sessionRatings} streak={streakFrom(studyDays)} close={() => setReviewing(false)} restart={() => { setIndex(0); setRevealed(false); setAnswer(""); setChoice(null); setSessionRatings([]); startedAt.current = Date.now(); }} />
          ) : (
            <ReviewView
              card={card}
              deck={reviewQueue}
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
              setMode={(nextMode) => {
                setReviewMode(nextMode);
                setRevealed(false);
                setAnswer("");
                setChoice(null);
              }}
              choices={quizChoices}
              choice={choice}
              pickChoice={(id) => { setChoice(id); setRevealed(true); }}
            />
          )
        ) : (
        <>
        <header className="workspace-topbar">
          <div className="workspace-location">
            <span>Không gian học</span>
            <b>{screenLabel}</b>
          </div>
          <div className="workspace-quick-actions">
            <button onClick={() => setShowFeedback(true)}><Icon name="flag" size={16} /><span>Góp ý</span></button>
            <button onClick={() => openDictionaryPage()}><Icon name="search" size={16} /><span>Tra từ</span></button>
            <button className="primary" onClick={openAddWordForm}><Icon name="plus" size={16} /><span>Thêm từ</span></button>
          </div>
        </header>
        {imported && (
          <div className="import-banner">
            <Icon name="check" size={17} />
            <span>{imported}</span>
            {importedVideoId && (
              <button
                className="import-open"
                onClick={() => openVideoLesson(importedVideoId, practiceIntent === "shadow" ? "shadow" : "dictation")}
              >
                Mở video
              </button>
            )}
            <button className="import-close" onClick={() => setImported("")} aria-label="Đóng thông báo">×</button>
          </div>
        )}
        <header className="mobile-head">
          <div className="brand">
            <span className="brand-mark">L</span>
            <span className="brand-copy"><b>Lexilo</b><small>{skillHub ? (SKILL_SPACES.find((item) => item.id === skillHub)?.label ?? "Kỹ năng") : tab === "home" ? "Trang chủ" : tab === "words" ? "Kho từ" : tab === "practice" ? (libraryLaunch ? "Video của tôi" : practiceNav.find((item) => item.value === practiceIntent)?.label ?? "Luyện tập") : tab === "stats" ? "Tiến độ" : "Từ điển"}</small></span>
          </div>
          <div className="mobile-head-actions">
            {/* Tiến độ mất chỗ ở thanh dưới khi bốn kỹ năng vào — đưa lên đây để
                vẫn tới được trong một lần bấm. */}
            <button
              className={tab === "stats" && !skillHub ? "is-on" : ""}
              onClick={() => goTab("stats")}
              aria-label="Xem tiến độ học tập"
            >
              <Icon name="chart" size={18} />
            </button>
            {/* Kho video riêng chỉ nằm ở cột trái, mà cột trái bị ẩn dưới 900px —
                không đưa lên đây thì trên điện thoại nó không tới được. */}
            <button
              className={tab === "practice" && !!libraryLaunch && !skillHub ? "is-on" : ""}
              onClick={openMyVideos}
              aria-label="Video của tôi"
            >
              <Icon name="play" size={18} />
            </button>
            <button
              onClick={() => {
                const now = themeById(theme);
                const pair = THEMES.find((item) => item.hue === now.hue && item.mode !== now.mode);
                if (pair) chooseTheme(pair.id);
              }}
              aria-label={`Chuyển sang chế độ ${themeById(theme).mode === "dark" ? "sáng" : "tối"}`}
            >
              <Icon name={themeById(theme).mode === "dark" ? "sun" : "moon"} size={18} />
            </button>
            <button onClick={openAddWordForm} aria-label="Thêm từ">＋</button>
          </div>
        </header>
        {pendingSession && resumableQueue.length > 0 && tab === "home" && (
          <div className="resume-bar">
            <span><Icon name="clock" size={18} /></span>
            <div>
              <b>Phiên học đang dở</b>
              <small>
                {(() => {
                  const done = Math.min(pendingSession.index, resumableQueue.length);
                  return `Đã ôn ${done}/${resumableQueue.length} thẻ · còn ${resumableQueue.length - done} thẻ`;
                })()}
              </small>
            </div>
            <button className="primary" onClick={resumeSession}>
              Học tiếp <Icon name="arrow" size={16} />
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
        {/* Màn tổng quan kỹ năng: che nội dung tab bên dưới cho tới khi chọn
            một công cụ. Đặt trước mọi nhánh tab nên không nhánh nào phải sửa. */}
        {skillHub && <SkillHub
          skill={SKILL_SPACES.find((item) => item.id === skillHub)!}
          words={words}
          lessons={lessons}
          dueCount={words.filter(isDueAgain).length}
          open={openTool}
          openLesson={openVideoLesson}
          startReview={() => launchReview(words.filter(isDueAgain))}
          extra={skillHub === "vocab" ? <DailyStudy words={words} startReview={startReview} startTopicReview={startTopicReview} /> : null}
        />}
        {!skillHub && tab === "home" && <Dashboard openVideoAdd={() => setShowVideoAdd(true)} addMenu={<AddMenu onManual={openAddWordForm} onPaste={() => setShowBulkAdd(true)} onDictionary={() => openDictionaryPage()} />} words={words} lessons={lessons} openLesson={openVideoLesson} userId={userId} userName={userName} openSignIn={() => openAuth("signin")} openPractice={(mode) => {
          setPracticeIntent(mode ?? "vocab");
          setPracticeLaunch((value) => value + 1);
          setTab("practice");
        }} openErrors={() => { setSkillHub(null); setTab("stats"); }} exam={exam} setExam={(goal) => { setExam(goal); writeExam(goal); }} streak={streakFrom(studyDays)}
          startReview={startReview} startDueReview={() => launchReview(words.filter(isDueAgain))} openFeedback={() => setShowFeedback(true)} />}
        {!skillHub && tab === "words" && (
          <Words
            words={filtered}
            legacyCollections={legacyCollections}
            query={query}
            setQuery={setQuery}
            toggleStar={toggleStar}
            add={openAddWordForm}
            bulkAdd={() => setShowBulkAdd(true)}
            openDictionary={() => openDictionaryPage()}
            folders={folders}
            updateFolders={updateFolders}
            collectionFilter={wordsView}
            setCollectionFilter={setWordsView}
            startWordListReview={startWordListReview}
            fillMissingFields={() => void fillMissingFields()}
            backfill={backfill}
            assignLevels={assignLevels}
            leveling={leveling}
            onExitTool={toolOrigin ? () => openSkill(toolOrigin) : undefined}
            setStudyDay={setWordStudyDay}
            remove={(id) => {
              markDeleted(id);
              setWords((current) => current.filter((w) => w.id !== id));
              void deleteWordFromCloud(id);
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
        {!skillHub && tab === "practice" && <Practice key={`practice-${practiceLaunch}-${lessonLaunch?.nonce ?? libraryLaunch?.nonce ?? 0}`} launch={practiceLaunch} openLesson={lessonLaunch} initialLibraryFilter={libraryLaunch?.filter ?? null} words={words} intent={practiceIntent} lessons={lessons} onAddVideo={() => setShowVideoAdd(true)} onPromoteVideo={promoteSystemLesson} onStudied={() => markStudiedToday()} onResult={recordPracticeResult} onToggleStar={toggleStar} onStartReview={launchReview} onExitTool={() => {
          setLessonLaunch(null);
          setLibraryLaunch(null);
          openSkill(skillHubForPractice(practiceIntent));
        }}
          lookupVocab={{
            folders,
            updateFolders,
            legacyCollections,
            wordId: (term) => words.find((word) => word.term.trim().toLowerCase() === term.trim().toLowerCase())?.id ?? null,
            collectionOf: (term) => {
              const found = words.find((word) => word.term.trim().toLowerCase() === term.trim().toLowerCase());
              return found && isPdfVocabulary(found) ? "pdf" : "mine";
            },
            studyDayOf: (term) => {
              const found = words.find((word) => word.term.trim().toLowerCase() === term.trim().toLowerCase());
              return typeof found?.studyDay === "number" ? found.studyDay : null;
            },
            setStudyDay: setWordStudyDay,
            saveWord: saveFoundWord,
            openDictionary: openDictionaryPage,
          }} />}
        {/* Thống kê tính trên toàn bộ thư viện, cùng phạm vi với các ô ở trang chủ. */}
        {!skillHub && tab === "stats" && <Stats words={words} scopeLabel="toàn bộ thư viện" streak={streakFrom(studyDays)} />}
        {!skillHub && tab === "dictionary" && (
          <Dictionary
            onExitTool={dictionaryOrigin ? returnFromDictionary : toolOrigin ? () => openSkill(toolOrigin) : undefined}
            backDestination={dictionaryOrigin?.label}
            initialWord={dictionaryWord}
            legacyCollections={legacyCollections}
            wordId={(term) => words.find((word) => word.term.trim().toLowerCase() === term.trim().toLowerCase())?.id ?? null}
            collectionOf={(term) => {
              const found = words.find((word) => word.term.trim().toLowerCase() === term.trim().toLowerCase());
              return found && isPdfVocabulary(found) ? "pdf" : "mine";
            }}
            studyDayOf={(term) => {
              const found = words.find((word) => word.term.trim().toLowerCase() === term.trim().toLowerCase());
              return typeof found?.studyDay === "number" ? found.studyDay : null;
            }}
            setStudyDay={setWordStudyDay}
            onSave={saveFoundWord}
            folders={folders}
            updateFolders={updateFolders}
          />
        )}
        </>
        )}
      </section>

      {/* Dùng đúng tên và đúng icon của thanh bên: trước đây chỗ này gọi là
          "Hôm nay / Từ vựng / Luyện tập / Thống kê" — bộ tên thứ ba trong cùng
          một app — và vẽ bằng ký tự Unicode nên lệch hẳn với phần còn lại. */}
      {/* Thanh dưới khớp đúng cột trái: Trang chủ + bốn kỹ năng. Tiến độ chuyển
          lên thanh tiêu đề để không phải cắt mất một kỹ năng — năm ô là trần của
          một thanh điều hướng đáy còn bấm được bằng ngón cái. */}
      {!reviewing && <nav className="mobile-nav" aria-label="Điều hướng di động">
        <button className={tab === "home" && !skillHub ? "active" : ""} onClick={() => goTab("home")}>
          <Icon name="home" size={18} />Trang chủ
        </button>
        {SKILL_SPACES.map((item) => (
          <button
            key={item.id}
            className={skillHub === item.id ? "active" : ""}
            onClick={() => openSkill(item.id)}
          >
            <Icon name={item.icon} size={18} />{item.label}
          </button>
        ))}
      </nav>}
      {showAdd && (
        <AddWord
          legacyCollections={legacyCollections}
          folders={folders}
          updateFolders={updateFolders}
          backDestination={addOriginLabel}
          existingWords={words.filter((word) => !isPdfVocabulary(word) && !isSeedWord(word))}
          close={() => setShowAdd(false)}
          save={(word, folderIds) => {
            const created = {
              ...word,
              id: crypto.randomUUID(),
              box: 1,
              lapses: 0,
            };
            setWords((current) => [created, ...current]);
            void persistWord(created);
            if (folderIds.length) {
              const nextFolders = folderIds.reduce(
                (current, folderId) => addWords(current, folderId, [created.id]),
                folders,
              );
              updateFolders(nextFolders);
            }
            setShowAdd(false);
          }}
        />
      )}
      {showBulkAdd && (
        <BulkAddWords
          legacyCollections={legacyCollections}
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
      {showVideoAdd && (
        <VideoImportModal
          close={() => setShowVideoAdd(false)}
          save={(lesson) => {
            addLessonsToCatalogue([lesson]);
            const next = withSystemLessons(saveLesson(lesson) as VideoLesson[]);
            setLessons(next);
            const opened = next.find((item) => item.videoId === lesson.videoId);
            setImported(`Đã thêm video “${lesson.title || "YouTube"}” · ${opened?.sentences.length ?? 0} đoạn · đang mở bài để luyện`);
            setImportedVideoId(lesson.videoId);
            setShowVideoAdd(false);
            const mode = practiceIntent === "shadow" ? "shadow" : "dictation";
            openVideoLesson(lesson.videoId, mode);
          }}
        />
      )}
      {detailWord && <WordDetail word={detailWord} close={() => setDetailWord(null)} study={() => { const selected = detailWord; setDetailWord(null); launchReview(words.filter((word) => word.id === selected.id)); }} speak={speak} folders={folders} updateFolders={updateFolders} onLevel={markWordLevel} />}
      {showAuth && <AuthModal close={() => setShowAuth(false)} signedIn={Boolean(userId)} signedInEmail={userEmail} signedInName={userName} startMode={authMode} syncStatus={cloudStatus} />}
      {showFeedback && <FeedbackModal close={() => setShowFeedback(false)} screen={screenLabel} signedInEmail={userEmail} />}
      {showUpgrade && (
        <Upgrade
          plan={planInfo}
          signedIn={Boolean(userId)}
          onClose={() => setShowUpgrade(false)}
          onNeedSignIn={() => { setShowUpgrade(false); openAuth("signin"); }}
          onPaid={() => { void refreshPlan(); }}
        />
      )}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </main>
    </LookupActionsContext.Provider>
  );
}

/**
 * Màn tổng quan của một kỹ năng.
 *
 * KHÔNG phải một menu. Các app học ngôn ngữ đang chạy tốt đều theo cùng một
 * nguyên tắc: người học hiếm khi nên đối diện một bảng trống — màn hình phải chỉ
 * thẳng vào việc kế tiếp (bài đang dở, thẻ tới hạn), rồi mới tới danh sách công
 * cụ. Vì vậy bố cục ở đây là:
 *
 *   [ TIẾP TỤC — chiếm 2/3 ]  [ 7 NGÀY QUA — 1/3 ]
 *   [ công cụ · công cụ · … ]
 *
 * Kích thước chênh nhau CÓ CHỦ ĐÍCH. Một lưới thẻ đều nhau đọc ra là "chọn đi",
 * còn thứ người học cần là "làm tiếp cái này".
 */
function SkillHub({ skill, words, lessons, dueCount, open, openLesson, startReview, extra }: {
  skill: (typeof SKILL_SPACES)[number];
  words: WordCard[];
  lessons: VideoLesson[];
  dueCount: number;
  open: (tool: SkillTool) => void;
  openLesson: (videoId: string, mode?: "dictation" | "shadow") => void;
  startReview: () => void;
  /** Khối chỉ có nghĩa với một kỹ năng — ví dụ bộ chọn nhóm từ của Từ vựng. */
  extra?: ReactNode;
}) {
  const [practice, setPractice] = useState<ReturnType<typeof readPractice> | null>(null);
  const [progress, setProgress] = useState<Record<string, unknown>>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setPractice(readPractice());
    setProgress(readLessonProgress() as Record<string, unknown>);
  }, []);

  // Phút luyện 7 ngày của RIÊNG kỹ năng này, cộng từ mọi khoá thống kê của nó.
  const week = useMemo(() => {
    if (!practice) return { total: 0, days: [] as number[] };
    const days = skill.timeKeys
      .map((key) => minutesPerDay(practice, 7, key) as { minutes: number }[])
      .reduce<number[]>((sum, rows) => rows.map((row, index) => (sum[index] ?? 0) + (row?.minutes ?? 0)), []);
    return { total: days.reduce((a, b) => a + b, 0), days };
  }, [practice, skill.timeKeys]);

  // Bài dở dang — chỉ có nghĩa với hai kỹ năng dùng video.
  const mode: "dictation" | "shadow" = skill.id === "speak" ? "shadow" : "dictation";
  const unfinished = useMemo(() => {
    if (skill.id !== "listen" && skill.id !== "speak") return null;
    return lessons
      .map((lesson) => ({ lesson, ...videoProgress(lesson, progress, mode === "shadow" ? "shadowing" : "dictation") }))
      .filter((item) => item.total > 0 && item.percent < 100)
      .sort((a, b) => b.percent - a.percent)[0] ?? null;
  }, [lessons, progress, skill.id, mode]);

  const primary = skill.tools[0];
  const max = Math.max(1, ...week.days);
  const dayNames = ["H", "B", "T", "N", "S", "B", "C"];

  /** Ô "tiếp tục": mỗi kỹ năng có một khái niệm việc-đang-dở khác nhau. */
  function renderContinue() {
    if (unfinished) {
      return (
        <button className="skill-continue" onClick={() => openLesson(unfinished.lesson.videoId, mode)}>
          <span className="eyebrow">ĐANG DỞ</span>
          <b>{unfinished.lesson.title}</b>
          <span className="skill-continue-bar"><i style={{ width: `${unfinished.percent}%` }} /></span>
          <small>{unfinished.done}/{unfinished.total} câu · {unfinished.percent}%</small>
          <em>Học tiếp →</em>
        </button>
      );
    }
    if (skill.id === "vocab" && dueCount > 0) {
      return (
        <button className="skill-continue" onClick={startReview}>
          <span className="eyebrow">HÔM NAY</span>
          <b>{dueCount} thẻ tới hạn ôn</b>
          <small>Ôn đúng hạn là cách rẻ nhất để không quên.</small>
          <em>Ôn ngay →</em>
        </button>
      );
    }
    return (
      <button className="skill-continue is-empty" onClick={() => open(primary)}>
        <span className="eyebrow">BẮT ĐẦU</span>
        <b>{primary.label}</b>
        <small>{primary.note}</small>
        <em>Mở ra →</em>
      </button>
    );
  }

  return (
    <div className="page skill-hub">
      <header className="skill-hub-head">
        <span className="skill-hub-icon"><Icon name={skill.icon} size={22} /></span>
        <div>
          <h1>{skill.label}</h1>
          <p>{skill.blurb}</p>
        </div>
      </header>

      <div className="skill-hub-grid">
        {renderContinue()}

        <section className="skill-week">
          <span className="eyebrow">7 NGÀY QUA</span>
          <b>{week.total} <i>phút</i></b>
          {/* Cột dựng từ nhật ký luyện tập thật — không phải hình trang trí. */}
          <div className="skill-spark" aria-hidden="true">
            {week.days.map((minutes, index) => (
              <span key={index} title={`${minutes} phút`}>
                <i style={{ height: `${Math.max(6, (minutes / max) * 100)}%`, opacity: minutes ? 1 : 0.28 }} />
                <small>{dayNames[index] ?? ""}</small>
              </span>
            ))}
          </div>
        </section>
      </div>

      <section className="skill-tools-block">
        <span className="eyebrow">CÔNG CỤ</span>
        <div className="skill-tools">
          {skill.tools.map((tool) => {
            const badge =
              tool.kind === "tab" && tool.value === "words" ? `${words.length} từ`
                : tool.kind === "practice" && tool.value === "vocab" && dueCount > 0 ? `${dueCount} cần ôn`
                  : "";
            return (
              <button key={tool.label} className="skill-tool" onClick={() => open(tool)}>
                <span className="skill-tool-icon"><Icon name={tool.icon} size={19} /></span>
                <b>{tool.label}</b>
                <small>{tool.note}</small>
                {badge && <em>{badge}</em>}
              </button>
            );
          })}
        </div>
      </section>

      {extra}
    </div>
  );
}


/**
 * Nhật ký cập nhật ở cuối Trang chủ.
 *
 * Người học không theo dõi repo, nên nếu không nói ra thì mọi cải tiến đều vô
 * hình với họ. Mặc định chỉ mở bản mới nhất: danh sách đầy đủ là thứ để tra
 * khi tò mò, không phải thứ đọc mỗi lần vào trang.
 */
function Changelog({ openFeedback }: { openFeedback: () => void }) {
  const latest = latestRelease();
  // null = chưa đọc xong localStorage. Phải phân biệt với chuỗi rỗng (người
  // dùng mới, chưa xem bản nào) vì hai trường hợp này cho ra dấu khác nhau.
  const [seen, setSeen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setSeen(readSeenRelease());
  }, []);
  if (!latest) return null;
  // Chỉ chấm dấu SAU khi đã hydrate, nếu không thì lần vẽ trên máy chủ và trên
  // trình duyệt khác nhau và React báo lệch.
  const fresh = seen !== null && hasUnseenRelease(seen);
  const shown = open ? RELEASES : RELEASES.slice(0, 1);

  function markRead() {
    writeSeenRelease(latest.version);
    setSeen(latest.version);
  }

  return (
    <section className="home-changelog" aria-labelledby="home-changelog-title">
      <div className="home-section-head">
        <div>
          <h2 id="home-changelog-title">
            Cập nhật
            {fresh && <span className="changelog-new">Có gì mới</span>}
          </h2>
          <p>App vừa thay đổi những gì kể từ lần bạn ghé trước.</p>
        </div>
        <button
          onClick={() => {
            setOpen((value) => !value);
            markRead();
          }}
          aria-expanded={open}
        >
          {open ? "Thu gọn ↑" : "Xem toàn bộ nhật ký →"}
        </button>
      </div>
      <ol className="changelog-list">
        {shown.map((release: { version: string; date: string; title: string; items: { kind: string; text: string }[] }) => (
          <li key={release.version} className="changelog-release">
            <div className="changelog-head">
              <b>v{release.version}</b>
              {release.version === latest.version && <em>Mới nhất</em>}
              <time dateTime={release.date}>{new Date(release.date).toLocaleDateString("vi-VN")}</time>
            </div>
            <strong>{release.title}</strong>
            <ul>
              {release.items.map((item, position) => (
                <li key={position}>
                  <span className={`changelog-tag is-${item.kind}`}>{CHANGE_LABEL[item.kind as keyof typeof CHANGE_LABEL]}</span>
                  {item.text}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <button className="changelog-ask" onClick={openFeedback}>
        <Icon name="flag" size={15} />
        <span><b>Bạn thấy chỗ nào chưa ổn?</b><small>Gửi góp ý — lỗi và ý tưởng đều được đọc.</small></span>
        <em>Góp ý →</em>
      </button>
    </section>
  );
}

function Dashboard({ words, lessons, openLesson, openPractice, openErrors, exam, setExam, streak, addMenu, openVideoAdd, userId, userName, openSignIn, startReview, startDueReview, openFeedback }: { words: WordCard[]; lessons: VideoLesson[]; openLesson: (videoId: string, mode?: "dictation" | "shadow") => void; addMenu?: ReactNode; openVideoAdd: () => void; openPractice: (mode?: Exclude<PracticeMode, "menu">) => void; openErrors: () => void; exam: ExamGoal | null; setExam: (goal: ExamGoal | null) => void; streak: { current: number; best: number; studiedToday: boolean }; userId: string | null; userName: string; openSignIn: () => void; startReview: (dayIndex?: number | "pdf") => void; startDueReview: () => void; openFeedback: () => void }) {
  // Ngày và lời chào chỉ có thể tính trên máy người dùng — cập nhật sau khi hydrate để không lệch với HTML dựng sẵn.
  const dateRef = useRef<HTMLDivElement>(null);
  const greetingRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const now = new Date();
    if (dateRef.current) dateRef.current.textContent = `${dayNames[(now.getDay() + 6) % 7]}, ${String(now.getDate()).padStart(2, "0")} THÁNG ${now.getMonth() + 1}`.toUpperCase();
    if (greetingRef.current) greetingRef.current.textContent = now.getHours() < 12 ? "Chào buổi sáng" : now.getHours() < 18 ? "Chào buổi chiều" : "Chào buổi tối";
  }, []);
  // Giờ luyện và bài dịch chỉ đọc được trên máy, nên phải chờ hydrate xong.
  const [practice, setPractice] = useState<Record<string, Record<string, number>>>({});
  const [attempts, setAttempts] = useState<TranslationAttempt[]>([]);
  const [reviewEntries, setReviewEntries] = useState<ReviewEntry[]>([]);
  const [lessonProgress, setLessonProgress] = useState<Record<string, unknown>>({});
  const [chartSkill, setChartSkill] = useState<string>("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setPractice(readPractice());
    setAttempts(readAttempts());
    setReviewEntries(readReviewLog());
    setLessonProgress(readLessonProgress() as Record<string, unknown>);
  }, []);
  const attemptCount = attempts.length;
  const todayAttemptCount = useMemo(() => attempts.filter((attempt) => attempt.day === localDateString()).length, [attempts]);
  const weakestError = useMemo(() => weakestErrors(attempts, 1)[0] as { label: string; occurrenceCount: number; status: string } | undefined, [attempts]);
  const minutesToday = useMemo(() => {
    const row = practice[localDateString()] ?? {};
    return Math.round(Object.values(row).reduce((sum, seconds) => sum + Number(seconds || 0), 0) / 60);
  }, [practice]);
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
  // Chỉ bài CÓ phụ đề và CHƯA xong mới "tiếp tục" được. Bài chưa có phụ đề mà đưa
  // vào đây thì bấm vào không làm gì — xem lib/catalogue.mjs.
  const continueLessons = useMemo(() => lessons
    .map((lesson) => ({ lesson, ...videoProgress(lesson, lessonProgress, "dictation") }))
    .filter((item) => item.total > 0 && item.percent < 100)
    .sort((a, b) => Number(b.percent > 0) - Number(a.percent > 0) || b.percent - a.percent)
    .slice(0, 6), [lessons, lessonProgress]);
  const captionedLessons = useMemo(() => lessons.filter((lesson) => Array.isArray(lesson.sentences) && lesson.sentences.length > 0).length, [lessons]);
  const [rankPeriod, setRankPeriod] = useState<"week" | "month">("week");
  const [rankMetric, setRankMetric] = useState<"minutes" | "xp">("minutes");
  const [rankRows, setRankRows] = useState<Record<string, unknown>[]>([]);
  const [rankStatus, setRankStatus] = useState<"loading" | "ready" | "guest" | "setup">("loading");
  const rankSnapshot = useMemo(
    () => leaderboardSnapshot({ practice, reviews: reviewEntries, attempts }, rankPeriod),
    [practice, reviewEntries, attempts, rankPeriod],
  );
  useEffect(() => {
    let active = true;
    const localRow = {
      user_id: userId ?? "local-user",
      display_name: userId ? safeDisplayName(userName, userId) : "Bạn",
      ...rankSnapshot,
    };
    if (!userId || !supabase) {
      setRankRows([localRow]);
      setRankStatus("guest");
      return () => { active = false; };
    }
    setRankStatus("loading");
    void (async () => {
      const payload = {
        user_id: userId,
        period_type: rankPeriod,
        period_start: rankSnapshot.periodStart,
        display_name: safeDisplayName(userName, userId),
        xp: rankSnapshot.xp,
        minutes: rankSnapshot.minutes,
        reviews: rankSnapshot.reviews,
        updated_at: new Date().toISOString(),
      };
      const { error: writeError } = await supabase.from("leaderboard_scores").upsert(payload, { onConflict: "user_id,period_type,period_start" });
      if (writeError) throw writeError;
      const { data, error } = await supabase.from("leaderboard_scores")
        .select("user_id,display_name,xp,minutes,reviews")
        .eq("period_type", rankPeriod)
        .eq("period_start", rankSnapshot.periodStart)
        .limit(100);
      if (error) throw error;
      if (!active) return;
      setRankRows(data?.length ? data : [localRow]);
      setRankStatus("ready");
    })().catch(() => {
      if (!active) return;
      setRankRows([localRow]);
      setRankStatus("setup");
    });
    return () => { active = false; };
  }, [userId, userName, rankPeriod, rankSnapshot.periodStart, rankSnapshot.xp, rankSnapshot.minutes, rankSnapshot.reviews]);
  const rankedRows = useMemo(() => rankLeaderboard(rankRows, rankMetric), [rankRows, rankMetric]);
  const ownRank = rankedRows.find((row: { userId: string }) => row.userId === (userId ?? "local-user"));
  const visibleRanks = ownRank && ownRank.rank > 4 ? [...rankedRows.slice(0, 4), ownRank] : rankedRows.slice(0, 5);
  const [editingExam, setEditingExam] = useState(false);
  useEscape(() => setEditingExam(false), editingExam);
  const [examDraft, setExamDraft] = useState<ExamGoal>({ date: exam?.date ?? "", label: exam?.label ?? "" });
  // Số từ chưa thuộc, dùng để gợi ý nhịp học mỗi ngày cho kịp ngày thi.
  const wordsLeft = words.filter((word) => wordState(word).key !== "mastered").length;
  // Cùng nguồn với màn Tiến độ — xem todayPlan().
  const plan = useMemo(() => todayPlan(words), [words]);
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
        <div className="home-primary-actions">
          <button className="home-add-video" onClick={openVideoAdd}><Icon name="play" size={16} /> Thêm video YouTube</button>
          {addMenu}
        </div>
      </div>
      <h2 className="screen-group">Việc hôm nay</h2>
      {/* Hai khối dưới đây trước nằm ở Tiến độ. Chúng là VIỆC CỦA HÔM NAY, không
          phải số đo — để ở Tiến độ vừa làm màn đó rối, vừa khiến Trang chủ trống.
          Số liệu lấy từ todayPlan() dùng chung, nên hai màn không lệch nhau.
          Khối chọn nhóm từ đi kèm chúng nay nằm trong chính kỹ năng Từ vựng. */}
      {!!plan.dueAgain.length && (
        <section className="due-reminder">
          <span className="due-reminder-icon">⏰</span>
          <div>
            <b>{plan.dueAgain.length} từ đã học đến hạn ôn lại hôm nay</b>
            <small>{plan.dueGroups.map(([label, count]) => `${label}: ${count} từ`).join(" · ")}{plan.overdue > 0 && ` · ${plan.overdue} từ đã quá hạn`}</small>
          </div>
          <button className="primary" onClick={startDueReview}>Ôn ngay {plan.dueAgain.length} từ →</button>
        </section>
      )}
      <section className="daily-guidance" aria-label="Tóm tắt học tập cá nhân">
        <div><span>Hôm nay đã làm gì?</span><b>{minutesToday > 0 ? `${minutesToday} phút luyện tập` : "Chưa bắt đầu"}</b><small>{todayAttemptCount ? `${todayAttemptCount} bài dùng ngôn ngữ hôm nay` : "Bắt đầu bằng một phiên ôn ngắn"}</small></div>
        <div><span>Đang yếu ở đâu?</span><b>{weakestError ? weakestError.label : "Chưa đủ dữ liệu"}</b><small>{weakestError ? `${weakestError.occurrenceCount} lần xuất hiện · ${MASTERY_LABELS[weakestError.status as keyof typeof MASTERY_LABELS]}` : "AI sẽ xác định sau vài bài nói/viết"}</small></div>
        <div><span>Nên làm gì tiếp?</span><b>{weakestError ? `Luyện lại ${weakestError.label.toLowerCase()}` : plan.dueAgain.length ? `Ôn ${plan.dueAgain.length} từ đến hạn` : "Luyện nghe một đoạn ngắn"}</b><small>Gợi ý dựa trên lịch ôn và lỗi cá nhân</small></div>
      </section>
      <LearningPlan reviewCount={plan.reviewCount} newCount={plan.newCount} weakness={weakestError?.label} startVocabulary={() => startReview(plan.onlyPdf ? "pdf" : undefined)} openPractice={openPractice} openErrors={openErrors} />
      <h2 className="screen-group">Bạn đang ở đâu</h2>
      <div className="home-stats">
        <div className={streak.studiedToday ? "home-stat is-live" : "home-stat"}>
          <span className="home-stat-icon flame"><Icon name="flame" /></span>
          <div>
            <b>{streak.current}</b>
            <small>{streak.current > 0 ? `ngày liên tiếp · kỷ lục ${streak.best}` : "chưa có chuỗi nào"}</small>
            <i className="home-stat-hint">{streak.studiedToday ? "Hôm nay đã học ✓" : streak.current > 0 ? "Học hôm nay để giữ chuỗi" : "Ôn một thẻ để bắt đầu"}</i>
          </div>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon"><Icon name="clock" /></span>
          <div><b>{time.hours}h {time.rest}m</b><small>thời gian luyện tập</small></div>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon"><Icon name="list" /></span>
          <div><b>{words.length}</b><small>từ đã lưu</small></div>
        </div>
        <button className="home-stat as-button" onClick={() => setShowXp((value) => !value)} aria-expanded={showXp}>
          <span className="home-stat-icon"><Icon name="target" /></span>
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

      <div className="goal-row home-goals-primary is-single">
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
              <button onClick={() => setEditingExam(true)} aria-label="Sửa ngày thi">✎</button>
            </>
          ) : (
            <button className="goal-set" onClick={() => setEditingExam(true)}>◷ Đặt ngày thi để đếm ngược →</button>
          )}
        </section>
      </div>

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

        <div className="home-side-stack">
          <section className="panel home-ranking">
            <div className="home-ranking-head">
              <h3>Bảng xếp hạng</h3>
              <div className="ranking-period-tabs">
                {LEADERBOARD_PERIODS.map((period: { key: string; label: string }) => (
                  <button key={period.key} className={rankPeriod === period.key ? "active" : ""} onClick={() => setRankPeriod(period.key as "week" | "month")}>{period.label}</button>
                ))}
              </div>
            </div>
            <div className="ranking-metric-tabs" role="group" aria-label="Tiêu chí xếp hạng">
              {LEADERBOARD_METRICS.map((metric: { key: string; label: string }) => (
                <button key={metric.key} className={rankMetric === metric.key ? "active" : ""} onClick={() => setRankMetric(metric.key as "minutes" | "xp")}>{metric.label}</button>
              ))}
            </div>
            <div className="ranking-list" aria-live="polite">
              {visibleRanks.map((row: { userId: string; name: string; minutes: number; xp: number; rank: number }) => (
                <div key={row.userId} className={`home-ranking-row${row.userId === (userId ?? "local-user") ? " is-me" : ""}${row.rank <= 3 ? ` rank-${row.rank}` : ""}`}>
                  <span>{row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : `#${row.rank}`}</span>
                  <b>{row.userId === (userId ?? "local-user") ? "Bạn" : row.name}</b>
                  <em>{rankMetric === "minutes" ? `${row.minutes} phút` : `${row.xp} XP`}</em>
                </div>
              ))}
              {rankStatus === "loading" && <p className="ranking-note">Đang cập nhật thứ hạng…</p>}
              {rankStatus === "guest" && <button className="ranking-note ranking-join" onClick={openSignIn}>Đăng nhập để tham gia bảng xếp hạng →</button>}
              {rankStatus === "setup" && <p className="ranking-note">Đang hiển thị điểm của bạn. Bảng chung sẽ hoạt động sau khi cài dữ liệu xếp hạng.</p>}
            </div>
          </section>
        </div>
      </div>

      <section className="home-continue" aria-labelledby="home-continue-title">
        <div className="home-section-head">
          <div><h2 id="home-continue-title">Tiếp tục học</h2><p>Các bài nghe và nói đang sẵn sàng trong thư viện của bạn.</p></div>
          <button onClick={() => openPractice("dictation")}>Xem tất cả →</button>
        </div>
        {continueLessons.length ? (
          <div className="home-lesson-grid">
            {continueLessons.map(({ lesson, percent, total }) => (
              <button key={lesson.id} className="home-lesson-card" onClick={() => openLesson(lesson.videoId, "dictation")}>
                <span className="home-lesson-thumb" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${lesson.videoId}/mqdefault.jpg)` }}>
                  <em>{percent > 0 ? `${percent}%` : `${total} câu`}</em>
                  {percent > 0 && <i><i style={{ width: `${percent}%` }} /></i>}
                </span>
                <b>{lesson.title}</b>
                <small>{percent > 0 ? `${percent}% hoàn thành` : "Chưa bắt đầu"}</small>
              </button>
            ))}
          </div>
        ) : captionedLessons > 0 ? (
          <button className="home-continue-empty" onClick={() => openPractice("dictation")}>
            <Icon name="check" /> Bạn đã học hết các bài có phụ đề. Mở thư viện để chọn bài mới →
          </button>
        ) : lessons.length > 0 ? (
          <button className="home-continue-empty" onClick={() => openPractice("dictation")}>
            <Icon name="play" /> Video của bạn chưa có phụ đề. Mở thư viện, bấm “Nhờ AI nghe hộ” hoặc mở trên YouTube →
          </button>
        ) : (
          <button className="home-continue-empty" onClick={openVideoAdd}><Icon name="play" /> Thêm video đầu tiên để bắt đầu luyện nghe</button>
        )}
      </section>

      <Changelog openFeedback={openFeedback} />

      {editingExam && (
        <ModalPortal>
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
        </ModalPortal>
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

// Phiên chính luôn xử lý phần đã học đến hạn trước. Từ mới chỉ lấy ở nhóm của hôm nay
// và được giới hạn để lượng ôn không tăng nhanh hơn khả năng ghi nhớ.
function buildTodayQueue(words: WordCard[]) {
  return buildDailyQueue(words, DAILY_REVIEW_LIMIT, DAILY_NEW_LIMIT) as WordCard[];
}

// Khi người dùng chủ động chọn một folder, đưa toàn bộ từ trong folder vào phiên.
// Thẻ đến hạn vẫn đứng trước, nhưng không loại từ đã thuộc và không cắt còn 20 thẻ.
function buildCollectionQueue(words: WordCard[]) {
  return buildFullCollectionQueue(words) as WordCard[];
}

/**
 * Kế hoạch một buổi học, mỗi bước mở đúng màn của bước đó.
 *
 * Trước đây bước 02 và 03 dùng chung một hàm đã gắn sẵn "dictation", nên bấm
 * "Nói/viết" lại rơi vào Nghe chép. Nay mỗi bước tự khai chế độ nó cần, và thẻ
 * có đủ bốn bước đúng như tiêu đề "4 kỹ năng" của chính nó.
 */
function LearningPlan({ reviewCount, newCount, weakness, startVocabulary, openPractice, openErrors }: {
  reviewCount: number;
  newCount: number;
  weakness?: string;
  startVocabulary: () => void;
  openPractice: (mode: Exclude<PracticeMode, "menu">) => void;
  openErrors: () => void;
}) {
  const steps: { mode: Exclude<PracticeMode, "menu">; label: string; time: string; note: string }[] = [
    { mode: "dictation", label: "Listening", time: "7–10 phút", note: "Chọn Dễ, Bình thường hoặc Thi IELTS" },
    { mode: "shadow", label: "Shadowing", time: "6–8 phút", note: "Nghe → nhại → kể lại → nói tự do" },
    { mode: "speak", label: "Speaking", time: "4–6 phút", note: "Hoàn thành mục tiêu trong tình huống thật" },
  ];
  return (
    <section className="learning-plan panel">
      <div className="panel-title">
        <div>
          <h3>Lộ trình cá nhân hôm nay · 30–45 phút</h3>
          <p>Review → Listening → Shadowing → Speaking → Error Practice; Writing là bước vận dụng cuối.</p>
        </div>
        <span className="plan-rule">5 ngày học · 1 ngày ôn nhẹ · 1 ngày nghỉ</span>
      </div>
      <div className="plan-steps">
        <button onClick={startVocabulary} disabled={!reviewCount && !newCount}>
          <span>01</span><b>Review · 10–15 phút</b>
          <small>{reviewCount} từ đến hạn trước · tối đa {DAILY_NEW_LIMIT} từ mới</small>
          <i>Bắt đầu phiên →</i>
        </button>
        {steps.map((step, position) => (
          <button key={step.mode} onClick={() => openPractice(step.mode)}>
            <span>{String(position + 2).padStart(2, "0")}</span>
            <b>{step.label} · {step.time}</b>
            <small>{step.note}</small>
            <i>Mở {step.label.toLowerCase()} →</i>
          </button>
        ))}
        <button onClick={openErrors}>
          <span>05</span><b>Error Practice · 5 phút</b>
          <small>{weakness ? `Luyện lại điểm yếu: ${weakness}` : "Xem hệ thống lỗi cá nhân và trạng thái thành thạo"}</small>
          <i>Mở luyện lỗi →</i>
        </button>
        <button onClick={() => openPractice("translate")}>
          <span>06</span><b>Writing · 5–8 phút</b>
          <small>Viết hoặc dịch, nhận phản hồi theo 4 tiêu chí</small>
          <i>Mở luyện viết →</i>
        </button>
      </div>
    </section>
  );
}

function DailyStudy({ words, startReview, startTopicReview }: { words: WordCard[]; startReview: (dayIndex: number | "pdf") => void; startTopicReview: (topic: string) => void }) {
  const pdfWords = words.filter(isPdfVocabulary);
  const dailyWords = words.filter((word) => !isPdfVocabulary(word));
  // Folder chủ đề phải khớp chính xác với 27 thư mục của bộ PDF trong trang Từ vựng.
  const topicFolders = (setsFor(pdfWords, "topic") as { label: string; total: number }[])
    .map((folder) => ({ topic: folder.label, count: folder.total }));
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
  if (isPdfVocabulary(word)) return primaryTopic(word);
  return dayNames[addedDayIndex(word)];
}

/**
 * Khối Leitner DUY NHẤT của màn Tiến độ.
 *
 * Trước đây màn này có hai khối cùng nói về Leitner — bảng theo nhóm ở trên và
 * biểu đồ cột ở dưới cùng — nên người xem phải tự đối chiếu hai cách trình bày
 * của cùng một dữ liệu. Nay chỉ còn một: biểu đồ trả lời "tôi đang ở đâu" ngay
 * lập tức, còn bảng chi tiết theo nhóm nằm sau một nút mở vì đó là thứ để tra
 * cứu khi cần chứ không phải thứ đọc mỗi lần ghé vào.
 */
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
  const topicRows = (setsFor(pdfWords, "topic") as { label: string; words: WordCard[] }[])
    .map((folder) => countRow(folder.label, folder.words));
  const tracked = personalWords.length + pdfWords.length;
  const masteredAll = words.filter((w) => wordState(w).key === "mastered").length;
  const boxes = [1, 2, 3, 4, 5, 6].map((box) => ({ box, count: words.filter((w) => w.box === box).length }));
  const max = Math.max(1, ...boxes.map((b) => b.count));
  const [open, setOpen] = useState(false);
  const rows = [...dayRows, ...topicRows];
  return (
    <section className="panel weekly">
      <div className="panel-title">
        <div>
          <h3>Phân bố theo hộp Leitner</h3>
          <p>Trả lời đúng thì từ lên hộp cao hơn và giãn ngày ôn. Lên hộp 6 là đã thuộc.</p>
        </div>
        <span className="mastery-rate">{tracked ? Math.round((masteredAll / tracked) * 100) : 0}% đã thuộc</span>
      </div>
      <div className="bar-chart">
        {boxes.map((b) => (
          <div key={b.box}>
            <span>{b.count}</span>
            <i style={{ height: `${Math.max(8, (b.count / max) * 150)}px` }} />
            <b>Hộp {b.box}</b>
          </div>
        ))}
      </div>
      <button className="weekly-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "▾" : "▸"} Chi tiết theo nhóm · {rows.length} nhóm
      </button>
      {open && (
        <div className="weekly-table">
          <div>
            <b>Nhóm</b>
            <b>Tổng</b>
            <b>Cần ôn</b>
            <b>Chưa tới hạn</b>
            <b>Chưa học</b>
            <b>Đã thuộc</b>
          </div>
          {rows.map((r) => (
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
      )}
    </section>
  );
}

// Rê chuột vào một từ tiếng Anh là tra nghĩa ngay tại chỗ.
//
// Kết quả được nhớ lại trong phiên: đọc một đoạn thì cùng một từ hay lặp lại, tra
// lại mỗi lần vừa chậm vừa phí. Chờ 350ms mới gọi để lướt chuột qua không kích hoạt.
type Glance = { term: string; ipa: string; meaningVi: string; senses: { part: string; definition: string; meaningVi: string; synonyms: string[] }[] };

function speakEnglish(text: string, region: "US" | "UK" = "US") {
  if (!text || typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = region === "US" ? "en-US" : "en-GB";
  const voice = (window.speechSynthesis?.getVoices() ?? []).find((item) => item.lang.replace("_", "-") === utterance.lang);
  if (voice) utterance.voice = voice;
  window.speechSynthesis?.speak(utterance);
}

// Hành động "lưu từ" / "mở Từ điển AI" cho bóng chú giải khi rê chuột vào từ.
// Dùng context để mọi <EnglishText> lồng bên trong app đều có, không phải xâu prop
// qua từng lớp (ReviewView → FlipCard, WordDetail, chấm bài viết…).
const LookupActionsContext = createContext<{ saveWord?: (word: NewWord) => string; openDictionary?: (term: string) => void }>({});

function EnglishText({ text, className }: { text: string; className?: string }) {
  const [active, setActive] = useState<{ word: string; x: number; y: number } | null>(null);
  const [data, setData] = useState<Glance | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "missing">("idle");
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const { saveWord, openDictionary } = useContext(LookupActionsContext);

  function show(word: string, element: HTMLElement) {
    const clean = word.toLowerCase().replace(/[^a-z'-]/g, "");
    if (clean.length < 2) return;
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    // Ghim bóng trong khung nhìn: từ ở sát mép phải hoặc gần đáy thì bóng sẽ tràn
    // ra ngoài và không đọc được.
    const box = element.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const height = 210;
    const x = Math.max(12, Math.min(box.left, window.innerWidth - width - 12));
    const y = box.bottom + height + 12 > window.innerHeight ? Math.max(12, box.top - height - 6) : box.bottom;
    setActive({ word: clean, x, y });
    setSaved(false);
    setData(null);
    setState("loading");
    if (timer.current) window.clearTimeout(timer.current);
    // fetchGlance tự nhớ kết quả trong phiên, nên gọi lại cùng một từ gần như tức thì.
    timer.current = window.setTimeout(async () => {
      try {
        const payload = (await fetchGlance(clean)) as Glance;
        setData(payload);
        setState("idle");
      } catch {
        setState("missing");
      }
    }, 350);
  }
  function hideNow() {
    if (timer.current) window.clearTimeout(timer.current);
    setActive(null);
    setData(null);
    setState("idle");
  }
  // Trễ một nhịp: cho phép rê chuột từ chữ sang chính bóng chú giải (để bấm nút loa)
  // mà bóng không biến mất giữa chừng.
  function hide() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(hideNow, 180);
  }
  function keepOpen() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  }

  // Từ lưu từ các bản cũ có thể thiếu hẳn một trường (cloze, definition, câu ví
  // dụ). Thiếu dòng này thì một ô trống làm SẬP cả phiên học chứ không chỉ ẩn đi
  // một dòng chữ — người dùng thấy màn trắng ngay giữa buổi ôn.
  if (!text) return null;
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
          // Bấm vào chữ = nghe phát âm ngay (và chặn sự kiện để không lật thẻ).
          <span
            key={position}
            className="en-word"
            onMouseOver={(event) => show(piece, event.currentTarget)}
            onFocus={(event) => show(piece, event.currentTarget)}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              show(piece, event.currentTarget);
              speakEnglish(piece.replace(/[^a-zA-Z'-]/g, ""));
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); speakEnglish(piece.replace(/[^a-zA-Z'-]/g, "")); } }}
          >
            {piece}
          </span>
        ),
      )}
      {active && typeof document !== "undefined" && createPortal(
        <span
          className="gloss"
          style={{ left: active.x, top: active.y + 6 }}
          role="tooltip"
          onMouseEnter={keepOpen}
          onMouseLeave={hide}
        >
          <span className="gloss-term-line">
            <b className="gloss-term">{active.word}</b>
            <button type="button" className="gloss-act" aria-label={`Nghe phát âm ${active.word}`} onClick={(event) => { event.stopPropagation(); speakEnglish(active.word); }}>
              <Icon name="volume" size={14} />
            </button>
            {saveWord && data && (
              <button
                type="button"
                className={`gloss-act ${saved ? "is-on" : ""}`}
                aria-label={saved ? "Đã lưu vào Kho từ vựng" : "Lưu vào Kho từ vựng"}
                title={saved ? "Đã lưu" : "Lưu từ này"}
                onClick={(event) => {
                  event.stopPropagation();
                  saveWord({
                    term: data.term || active.word,
                    ipa: data.ipa || "/…/",
                    meaning: data.meaningVi || data.senses[0]?.meaningVi || data.senses[0]?.definition || "Chưa có nghĩa",
                    partOfSpeech: data.senses[0]?.part ?? "",
                    definition: data.senses[0]?.definition ?? "",
                  });
                  setSaved(true);
                }}
              >
                <Icon name={saved ? "check" : "star"} size={14} />
              </button>
            )}
            {openDictionary && (
              <button
                type="button"
                className="gloss-act"
                aria-label="Mở trong Từ điển AI"
                title="Mở trong Từ điển AI"
                onClick={(event) => { event.stopPropagation(); openDictionary(data?.term || active.word); }}
              >
                <Icon name="book" size={14} />
              </button>
            )}
          </span>
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
                  <span>{sense.meaningVi || sense.definition}</span>
                  {!!sense.synonyms.length && <small>{[...new Set(sense.synonyms)].join(", ")}</small>}
                </span>
              ))}
            </>
          )}
        </span>,
        document.body,
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
  useEscape(close);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<WordCard | null>(null);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? words.filter((word) => `${word.term} ${word.meaning}`.toLowerCase().includes(needle)) : words;
  }, [words, query]);
  const speak = (text: string) => window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text));
  return (
    <ModalPortal>
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
    </ModalPortal>
  );
}

function Words({ words, legacyCollections, query, setQuery, toggleStar, add, bulkAdd, openDictionary, remove, importWords, folders, updateFolders, collectionFilter, setCollectionFilter, startWordListReview, setStudyDay, openWordDetail, fillMissingFields, backfill, assignLevels, leveling, onExitTool }: { words: WordCard[]; legacyCollections: boolean; query: string; setQuery: (s: string) => void; toggleStar: (id: string) => void; add: () => void; bulkAdd: () => void; openDictionary: () => void; remove: (id: string) => void; importWords: (w: Omit<WordCard, "id" | "lapses">[]) => void; folders: FolderStore; updateFolders: (next: FolderStore) => void; collectionFilter: "root" | "daily" | "pdf"; setCollectionFilter: (view: "root" | "daily" | "pdf") => void; startWordListReview: (list: WordCard[]) => void; setStudyDay: (id: string, day: number) => void; openWordDetail: (id: string) => void; fillMissingFields: () => void; backfill: { done: number; total: number; failed: number } | null; assignLevels: (targets: WordCard[], quiet?: boolean) => void; leveling: { done: number; total: number } | null; onExitTool?: () => void }) {
  const PAGE_SIZE = 25;
  const fileRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parentId: string } | null>(null);
  const [editing, setEditing] = useState<Folder | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [formError, setFormError] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  // Gom khoảng trắng y như lib/folders làm, để so tên mà không cần biểu thức chính quy.
  const tidy = (value: string) => value.split(" ").filter(Boolean).join(" ");
  // Lấy đường dẫn thay vì tra thẳng mã: danh sách vừa bị xoá thì đường dẫn rỗng,
  // và màn hình tự quay về mức gốc thay vì đứng trơ ở một chỗ không còn tồn tại.
  const trail = folderFilter ? folderPath(folders, folderFilter) : [];
  const openFolder = trail.length ? trail[trail.length - 1] : null;
  const openId = openFolder ? openFolder.id : "";
  const shownFolders = foldersWithCounts(folders, words, openId);
  function closeFolderForm() {
    setCreating(null);
    setEditing(null);
    setDraftName("");
    setDraftNote("");
    setFormError("");
  }
  function openCreateForm(parentId: string) {
    closeFolderForm();
    setCreating({ parentId });
  }
  function openEditForm(folder: Folder) {
    closeFolderForm();
    setEditing(folder);
    setDraftName(folder.name);
    setDraftNote(folder.note);
  }
  function submitFolderForm() {
    const name = tidy(draftName);
    if (!name) return;
    const clash = "Đã có danh sách tên " + name + " ở cùng chỗ này.";
    if (editing) {
      const next = editFolder(folders, editing.id, { name, note: draftNote });
      if (!next.list.some((item) => item.id === editing.id && item.name === name)) return setFormError(clash);
      updateFolders(next);
      return closeFolderForm();
    }
    const added = addFolder(folders, name, { note: draftNote, parentId: creating ? creating.parentId : "" });
    if (added.list.length === folders.list.length) {
      return setFormError(folders.list.length >= MAX_FOLDERS ? `Đã đủ ${MAX_FOLDERS} danh sách, xoá bớt rồi tạo tiếp.` : clash);
    }
    updateFolders(added);
    closeFolderForm();
  }
  function dropFolder(id: string) {
    updateFolders(removeFolder(folders, id));
    // Đang mở đúng danh sách vừa xoá thì lùi về cha, đừng để màn hình trống.
    if (openId === id) setFolderFilter(openFolder && openFolder.parentId ? openFolder.parentId : null);
    setFolderToDelete(null);
  }
  useEscape(() => setFolderToDelete(null), Boolean(folderToDelete));
  useEscape(closeFolderForm, Boolean(creating || editing));
  const [pdfTopic, setPdfTopic] = useState<string | null>(null);
  const [page, setPage] = useState({ key: "", value: 1 });
  const [deleteCandidate, setDeleteCandidate] = useState<WordCard | null>(null);
  useEscape(() => setDeleteCandidate(null), Boolean(deleteCandidate));
  const isPdfWord = isPdfVocabulary;
  const personalWords = words.filter((word) => !isPdfWord(word));
  const pdfWords = words.filter(isPdfWord);
  const pdfTopics = (setsFor(pdfWords, "topic") as { label: string }[]).map((folder) => folder.label);
  const activeCollection: WordCard[] = openId
    ? wordsIn(folders, openId, words)
    : collectionFilter === "pdf" ? (pdfTopic ? pdfWords.filter((word) => primaryTopic(word) === pdfTopic) : pdfWords)
    // Phải lọc luôn theo thứ ở đây, không để dành cho bước lọc sau: nút Ôn tập
    // đọc bộ sưu tập này, mở thư mục Thứ Tư mà nó ghi 174 từ là hứa sai.
    : collectionFilter === "daily" ? (dayFilter === null ? personalWords : personalWords.filter((word) => addedDayIndex(word) === dayFilter))
    : [];
  const visible = activeCollection.filter((w) => (statusFilter === "all" || wordState(w).key === statusFilter) && (dayFilter === null || addedDayIndex(w) === dayFilter));
  // Từ trong thư mục đang mở mà chưa có bậc CEFR — hiện nút "Xếp cấp độ" khi còn.
  const unleveled = (openId || collectionFilter !== "root") ? activeCollection.filter((w) => !w.cefr) : [];
  // Mở một thư mục là tự xếp cấp độ cho các từ chưa có, chạy nền không ồn ào —
  // để badge CEFR hiện lên mà người dùng không phải bấm nút. Chỉ làm một lần cho
  // mỗi thư mục và chỉ khi số từ vừa phải (tránh nện API ở màn "tất cả").
  const autoLeveledKey = useRef("");
  useEffect(() => {
    const key = openId || `${collectionFilter}:${pdfTopic ?? ""}:${dayFilter ?? ""}`;
    if (autoLeveledKey.current === key || !unleveled.length || unleveled.length > 200) return;
    const words = unleveled;
    const timer = setTimeout(() => { autoLeveledKey.current = key; assignLevels(words, true); }, 700);
    return () => clearTimeout(timer);
    // Chỉ chạy lại khi đổi thư mục hoặc số từ chưa xếp đổi; `unleveled` được chụp
    // ngay trong effect nên không cần là dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, collectionFilter, pdfTopic, dayFilter, unleveled.length, assignLevels]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Đổi bộ lọc thì về trang 1, và trang không bao giờ vượt quá số trang hiện có.
  // Suy ra ngay lúc render thay vì dùng effect, tránh một lượt render thừa hiển thị trang rỗng.
  const filterKey = `${query}|${statusFilter}|${dayFilter}|${collectionFilter}|${pdfTopic}|${openId}`;
  const currentPage = page.key === filterKey ? Math.min(page.value, pageCount) : 1;
  const pagedVisible = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const goToPage = (value: number) => setPage({ key: filterKey, value: Math.min(Math.max(1, value), pageCount) });
  // ── Ba tầng: Kho từ vựng → danh sách → thư mục → từ ───────────────────────
  // Không thêm trạng thái mới cho việc này: mấy bộ lọc sẵn có đã tả đủ vị trí,
  // dựng thêm một biến song song chỉ tạo chỗ cho hai thứ lệch nhau.
  const atRoot = collectionFilter === "root" && !openId;
  function goRoot() {
    setCollectionFilter("root");
    setDayFilter(null);
    setPdfTopic(null);
    setFolderFilter(null);
    setQuery("");
  }
  const crumbs: { label: string; go: () => void }[] = [];
  if (!atRoot) {
    crumbs.push({ label: "Kho từ vựng", go: goRoot });
    if (openId) {
      for (const step of trail) crumbs.push({ label: step.name, go: () => setFolderFilter(step.id) });
    } else if (collectionFilter === "daily") {
      crumbs.push({ label: "Từ của tôi", go: () => setDayFilter(null) });
      if (dayFilter !== null) crumbs.push({ label: dayNames[dayFilter], go: () => setDayFilter(dayFilter) });
    } else if (collectionFilter === "pdf") {
      crumbs.push({ label: "Bộ từ vựng PDF", go: () => setPdfTopic(null) });
      if (pdfTopic) crumbs.push({ label: pdfTopic, go: () => setPdfTopic(pdfTopic) });
    }
  }
  // Thẻ ở tầng đang đứng. Danh sách người dùng tạo, thư mục theo thứ và thư mục
  // theo chủ đề đều đổ về một hình dạng, để ba tầng nhìn nhất quán.
  type ShelfCard = { key: string; name: string; meta: string; note: string; count: number; sub: number; open: () => void; edit?: () => void; drop?: () => void };
  const dueIn = (list: WordCard[]) => list.filter(isDueForReview).length;
  const userCards = (): ShelfCard[] => shownFolders.map((folder) => ({
    key: folder.id,
    name: folder.name,
    meta: folderDate(folder.createdAt),
    note: folder.note,
    count: folder.count,
    sub: folder.childCount,
    open: () => setFolderFilter(folder.id),
    edit: () => openEditForm(folder),
    drop: () => setFolderToDelete(folder),
  }));
  const cards: ShelfCard[] = atRoot
    ? [
        {
          key: "mine", name: "Từ của tôi", meta: legacyCollections ? `${dayNames.length} thư mục theo thứ` : "Kho cá nhân của tài khoản",
          note: legacyCollections ? "Từ bạn tự thêm hoặc nhập từ Excel, chia theo thứ trong tuần." : "Tất cả từ bạn đã lưu bằng tra từ hoặc nhập dữ liệu.",
          count: personalWords.length, sub: legacyCollections ? dayNames.length : 0,
          open: () => { setCollectionFilter("daily"); setDayFilter(null); },
        },
        ...(legacyCollections ? [{
          key: "pdf", name: "Bộ từ vựng PDF", meta: `${pdfTopics.length} thư mục theo chủ đề`,
          note: "Bộ từ có sẵn của ứng dụng, chia theo chủ đề.",
          count: pdfWords.length, sub: pdfTopics.length,
          open: () => { setCollectionFilter("pdf"); setPdfTopic(null); },
        }] : []),
        ...userCards(),
      ]
    : openId
    ? userCards()
    : collectionFilter === "daily" && dayFilter === null && legacyCollections
    ? dayNames.map((name, index) => {
        const list = personalWords.filter((word) => addedDayIndex(word) === index);
        return { key: name, name, meta: "Thư mục theo thứ", note: `${dueIn(list)} từ cần ôn.`, count: list.length, sub: 0, open: () => setDayFilter(index) };
      })
    : collectionFilter === "pdf" && !pdfTopic
    ? pdfTopics.map((topic) => {
        const list = pdfWords.filter((word) => primaryTopic(word) === topic);
        return { key: topic, name: topic, meta: "Thư mục theo chủ đề", note: `${dueIn(list)} từ cần ôn.`, count: list.length, sub: 0, open: () => setPdfTopic(topic) };
      })
    : [];
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
            if (parsed) imported.push({ ...parsed, studyDay: legacyCollections ? sheetDay : undefined });
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
            studyDay: legacyCollections ? sheetDay : undefined,
          });
        }
      }
      importWords(imported);
      const days = legacyCollections ? [...new Set(imported.map((item) => item.studyDay).filter((day) => typeof day === "number"))].map((day) => dayNames[day as number]) : [];
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
      .map((item) => ({ ...item, studyDay: legacyCollections ? fileDay : undefined }));
    importWords(items);
    alert(items.length ? `Đã nhập ${items.length} từ${legacyCollections && typeof fileDay === "number" ? ` vào ${dayNames[fileDay]}` : ""}.` : "Không đọc được từ nào. Mỗi dòng nên có dạng: từ (loại từ): nghĩa");
  }
  return (
    <div className="page words-page">
      {onExitTool && atRoot && (
        <BackButton destination="Từ vựng" onClick={onExitTool} />
      )}
      <div className="section-head">
        <div>
          <div className="eyebrow">THƯ VIỆN CỦA BẠN</div>
          <h1>{atRoot ? "Kho từ vựng" : crumbs[crumbs.length - 1].label}</h1>
          <p>{atRoot ? `${cards.length} danh sách · ${words.length} từ trong kho.` : cards.length ? `${activeCollection.length} từ, chia theo ${cards.length} thư mục.` : `${activeCollection.length} từ trong thư mục này.`}</p>
        </div>
        {/* Nút này thêm từ vào KHO, không thêm vào danh sách đang mở — để nó
            đứng trên trang danh sách là hứa sai việc nó làm. */}
        {!openId && <div className="section-actions"><AddMenu onManual={add} onPaste={bulkAdd} onDictionary={openDictionary} /></div>}
      </div>
      <section className="wordlists">
        <div className="wordlists-bar">
          {atRoot ? (
            <button className="primary wordlist-create" onClick={() => openCreateForm("")}>
              <Icon name="plus" /> Tạo danh sách từ
            </button>
          ) : (
            <nav className="wordlist-trail" aria-label="Đường dẫn kho từ vựng">
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.label + index}>
                  {index > 0 && <span aria-hidden="true">›</span>}
                  {index === crumbs.length - 1
                    ? <b aria-current="page">{crumb.label}</b>
                    : <button onClick={crumb.go}>{crumb.label}</button>}
                </Fragment>
              ))}
            </nav>
          )}
          <div className="wordlists-bar-end">
            {openFolder && <button title="Sửa danh sách" aria-label={`Sửa danh sách ${openFolder.name}`} onClick={() => openEditForm(openFolder)}>✎ Sửa</button>}
            {openFolder && <button title="Xoá danh sách" aria-label={`Xoá danh sách ${openFolder.name}`} onClick={() => setFolderToDelete(openFolder)}>× Xoá</button>}
            {openFolder && <button onClick={() => openCreateForm(openFolder.id)}><Icon name="plus" /> Tạo thư mục con</button>}
            {!atRoot && <button className="primary" disabled={!activeCollection.length} onClick={() => startWordListReview(activeCollection)}>Ôn tập ({activeCollection.length} từ)</button>}
          </div>
        </div>
        {/* Ghi chú chỉ có chỗ đứng ở đây: thẻ ngoài lưới quá hẹp cho nó. */}
        {openFolder && openFolder.note && <p className="wordlist-note-line">{openFolder.note}</p>}
        {cards.length > 0 && (
          <div className="wordlist-grid">
            {cards.map((card) => (
              <div className="wordlist-card" key={card.key}>
                <button className="wordlist-open" onClick={card.open}>
                  <b>{card.name}</b>
                  <span className="wordlist-date"><Icon name="clock" /> {card.meta}</span>
                  <p className={card.note ? "" : "muted"}>{card.note || "Không có ghi chú."}</p>
                  <span className="wordlist-foot">
                    <strong>{card.count}</strong> TỪ{card.sub ? ` · ${card.sub} thư mục` : ""}
                  </span>
                </button>
                {(card.edit || card.drop) && (
                  <div className="folder-card-actions">
                    {card.edit && <button title="Sửa" aria-label={`Sửa ${card.name}`} onClick={card.edit}>✎</button>}
                    {card.drop && <button title="Xoá" aria-label={`Xoá ${card.name}`} onClick={card.drop}>×</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {openFolder && !activeCollection.length && !cards.length && (
          <p className="folder-empty">Danh sách này chưa có từ nào. Mở <b>Từ của tôi</b>{legacyCollections && <> hoặc <b>Bộ từ vựng PDF</b></>}, rồi bấm nút ▤ ở đầu mỗi từ để cất vào đây.</p>
        )}
      </section>
      {/* Mức gốc chỉ có các danh sách, chưa có bảng từ nào để hiện. */}
      {!atRoot && <>
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
        {collectionFilter === "daily" && !openId && <button onClick={() => fileRef.current?.click()}>Nhập Excel</button>}
        {!!incomplete.length && (
          <button className="backfill-button" disabled={!!backfill} onClick={fillMissingFields} title={`Còn thiếu trường ở: ${incomplete.map((word) => word.term).slice(0, 8).join(", ")}${incomplete.length > 8 ? "…" : ""}`}>
            {backfill ? `◌ Đang bổ sung ${backfill.done}/${backfill.total}…` : `✦ Bổ sung ${incomplete.length} từ thiếu`}
          </button>
        )}
        {!!unleveled.length && (
          <button className="backfill-button" disabled={!!leveling} onClick={() => assignLevels(activeCollection)} title="Ước lượng bậc CEFR (A1–C2) cho các từ chưa có cấp độ trong thư mục này">
            {leveling ? `◌ Đang xếp cấp độ ${leveling.done}/${leveling.total}…` : `✦ Xếp cấp độ ${unleveled.length} từ`}
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
      {leveling && (
        <div className={leveling.done < leveling.total ? "backfill-status" : "backfill-status done"}>
          {leveling.done < leveling.total
            ? <>Đang xếp bậc CEFR <b>{leveling.done}</b>/{leveling.total} từ… đây là mức <b>ước lượng</b> theo Oxford 5000 và tần suất dùng, không phải điểm thi.</>
            : <>Xong: đã xếp cấp độ <b>{leveling.total}</b> từ. Mở một từ để xem từ đồng nghĩa ở bậc cao hơn.</>}
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
                  {w.cefr && w.cefr !== "?" && <span className="word-cefr" title="Cấp độ CEFR ước lượng">{w.cefr}</span>}
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
              {legacyCollections && !isPdfWord(w) && (
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
      {(creating || editing) && (
        <ModalPortal>
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeFolderForm(); }}>
          <section className="modal wordlist-form" role="dialog" aria-modal="true" aria-labelledby="wordlist-form-title">
            <div className="modal-head">
              <h2 id="wordlist-form-title">{editing ? "Sửa danh sách từ" : creating && creating.parentId ? "Tạo danh sách con" : "Tạo danh sách từ mới"}</h2>
              <button onClick={closeFolderForm} aria-label="Đóng">×</button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); submitFolderForm(); }}>
              <label htmlFor="wordlist-name">
                <span className="field-label">Tiêu đề</span>
                <input
                  id="wordlist-name"
                  ref={(node) => { if (node && document.activeElement !== node) node.focus(); }}
                  value={draftName}
                  onChange={(event) => { setDraftName(event.target.value); setFormError(""); }}
                  placeholder="Ví dụ: Từ vựng IELTS Writing"
                  maxLength={60}
                />
              </label>
              <label htmlFor="wordlist-note">
                <span className="field-label">Ghi chú <span className="label-optional">· không bắt buộc</span></span>
                <textarea
                  id="wordlist-note"
                  value={draftNote}
                  onChange={(event) => setDraftNote(event.target.value)}
                  placeholder="Mô tả ngắn để nhớ danh sách dùng cho việc gì"
                  rows={3}
                  maxLength={300}
                />
              </label>
              {formError && <p className="folder-note" role="status">{formError}</p>}
              <div className="modal-actions">
                <button type="button" onClick={closeFolderForm}>Huỷ</button>
                <button className="primary" type="submit" disabled={!tidy(draftName)}>{editing ? "Lưu thay đổi" : "Tạo danh sách"}</button>
              </div>
            </form>
          </section>
        </div>
        </ModalPortal>
      )}
      {folderToDelete && (
        <ModalPortal>
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFolderToDelete(null); }}>
          <section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="folder-delete-title">
            <span className="confirm-icon">▤</span>
            <div>
              <span className="eyebrow">XÁC NHẬN XOÁ DANH SÁCH</span>
              <h2 id="folder-delete-title">Xoá danh sách “{folderToDelete.name}”?</h2>
              <p>Danh sách con bên trong cũng bị xoá theo. Từ vựng thì vẫn nằm nguyên trong thư viện của bạn.</p>
            </div>
            <div className="confirm-actions">
              <button onClick={() => setFolderToDelete(null)}>Giữ lại</button>
              <button className="danger-button" onClick={() => dropFolder(folderToDelete.id)}>Xoá danh sách</button>
            </div>
          </section>
        </div>
        </ModalPortal>
      )}
      {deleteCandidate && (
        <ModalPortal>
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
        </ModalPortal>
      )}
    </div>
  );
}

function ReviewView({ card, deck, index, total, revealed, answer, setAnswer, reveal, flip, rate, step, shuffle, close, speak, toggleStar, mode, modeSetting, setMode, choices, choice, pickChoice }: { card: WordCard; deck: WordCard[]; index: number; total: number; revealed: boolean; answer: string; setAnswer: (s: string) => void; reveal: () => void; flip: () => void; rate: (r: Rating) => void; step: (delta: number) => void; shuffle: () => void; close: () => void; speak: (s: string) => void; toggleStar: () => void; mode: ReviewMode; modeSetting: ReviewMode; setMode: (m: ReviewMode) => void; choices: WordCard[]; choice: string | null; pickChoice: (id: string) => void }) {
  const displayCard = cardWithRelevantExample(card);
  // Trắc nghiệm cần ít nhất 2 lựa chọn, hàng đợi quá ngắn thì lùi về thẻ Việt → Anh.
  const shownMode: ReviewMode = mode === "quiz" && choices.length < 2 ? "vi_en" : mode;
  const [autoplay, setAutoplay] = useState(false);
  // Bật theo dõi tiến độ thì thẻ ghi nhớ chấm điểm luôn: "Đã biết" = Được, "Đang học"
  // = Quên, để lịch Leitner được cập nhật. Tắt thì chỉ xem lại, không đụng vào lịch.
  // Đây là phiên học/ôn chính, nên mặc định phải ghi nhận đánh giá giống luồng
  // Luyện từ vựng. Người dùng vẫn có thể tắt nếu chỉ muốn xem tự do.
  const [tracking, setTracking] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const classify = (known: boolean) => rate(known ? "good" : "again");
  const selectedMode = reviewModes.find((item) => item.value === modeSetting) ?? reviewModes[0];
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
  const flashBar = (
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
          <b>{index + 1} / {total}</b>
          <button className="track-known-btn" onClick={() => classify(true)}>
            Đã biết
          </button>
        </div>
      ) : (
        <div className="flash-nav">
          <button onClick={() => step(-1)} disabled={index === 0} aria-label="Thẻ trước">←</button>
          <b>{index + 1} / {total}</b>
          <button onClick={() => step(1)} aria-label={index + 1 >= total ? "Kết thúc phiên" : "Thẻ sau"}>→</button>
        </div>
      )}
      <div className="flash-options">
        <button className={autoplay ? "active" : ""} onClick={() => setAutoplay((value) => !value)} aria-label="Tự động phát" title="Tự động phát">
          {autoplay ? "❚❚" : "▶"}
        </button>
        <button onClick={shuffle} aria-label="Xáo trộn" title="Xáo trộn thứ tự thẻ">⇄</button>
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
  );
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
      <section className="review-mode-tabs" aria-labelledby="review-mode-title">
        <span id="review-mode-title" className="sr-only">Chọn cách học</span>
        <div className="review-modes" role="group" aria-label="Chọn cách học">
          {reviewModes.map((item) => (
            <button
              key={item.value}
              type="button"
              className={modeSetting === item.value ? "active" : ""}
              aria-pressed={modeSetting === item.value}
              disabled={!deckSupports(deck, reviewToDrillMode[item.value])}
              onClick={() => {
                // Đổi kiểu thẻ thì dừng tự động phát, không để nó chạy ngầm ở kiểu khác.
                setAutoplay(false);
                setMode(item.value);
              }}
              title={deckSupports(deck, reviewToDrillMode[item.value])
                ? `${item.label}: ${item.description}`
                : `${item.label}: bộ từ này chưa đủ dữ liệu cho cách luyện đó`}
            >
              <span className="review-mode-icon"><Icon name={item.icon} size={15} /></span>
              <span className="review-mode-copy"><b>{item.label}</b></span>
              {item.badge && <em>{item.badge}</em>}
            </button>
          ))}
        </div>
        <p className="review-mode-note" aria-live="polite">
          <b>{selectedMode.label}</b>
          <span>{selectedMode.description}</span>
          {/* Nhãn "Đề xuất" trên tab chỉ còn là một chấm nhỏ để khỏi cắt mất tên
              kiểu luyện; chữ đầy đủ hiện ở đây, đúng lúc kiểu đó đang được chọn. */}
          {selectedMode.badge && <i className="review-mode-flag">{selectedMode.badge}</i>}
        </p>
      </section>
      {shownMode === "card" ? (
        // Dùng chung thẻ lật với Flashcards bên Luyện tập, kể cả nút loa góc phải.
        <div className="review-task-frame review-flash-frame">
          <div className="flash-stage" ref={stageRef}>
            <FlipCard card={displayCard} flipped={revealed} flip={flip} onSwipe={tracking ? classify : undefined} />
            <div className="flash-tools">
              {/* Không lặp nút sao ở đây: header của phiên ôn đã có sẵn một nút cho mọi kiểu thẻ. */}
              <button onClick={() => speak(card.term)} aria-label={`Phát âm ${card.term}`}>
                <Icon name="volume" size={15} />
              </button>
            </div>
          </div>
          <div className="review-task-actions review-flash-actions">{flashBar}</div>
        </div>
      ) : (
      <div className="review-task-frame">
      <section className={`flashcard ${revealed ? "revealed" : ""}`}>
        {!revealed ? (
          <>
            {shownMode === "vi_en" && (
              <>
                <span className="card-label">VIỆT → ANH</span>
                <h1>{card.meaning}</h1>
                <p className="cloze"><EnglishText text={displayCard.cloze} /></p>
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
                    <Icon name="volume" size={15} />
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
                  <Icon name="volume" size={15} />
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
                <Icon name="volume" size={15} />
              </button>
            </div>
            <div className="ipa">{card.ipa}</div>
            {graded !== null && <p className={graded ? "review-verdict good" : "review-verdict"}>{graded ? "✓ Bạn trả lời đúng" : shownMode === "quiz" ? `✗ Bạn chọn: ${choices.find((item) => item.id === choice)?.meaning}` : `✗ Bạn viết: ${answer}`}</p>}
            <p className="review-meaning">{card.meaning}</p>
            {card.collocation && <p className="review-collocation"><b><EnglishText text={card.collocation} /></b>{card.collocationVi && <span>{card.collocationVi}</span>}</p>}
            {(card.synonyms?.length || card.antonyms?.length || card.paraphrases?.length || card.ieltsTopics?.length) && (
              <div className="review-ielts">
                {!!card.synonyms?.length && <p><b>Đồng nghĩa</b><span>{withMeanings(card.synonyms, card.synonymDetails)}</span></p>}
                {!!card.antonyms?.length && <p><b>Trái nghĩa</b><span>{withMeanings(card.antonyms, card.antonymDetails)}</span></p>}
                {!!card.paraphrases?.length && <p><b>Paraphrase</b><span>{card.paraphrases.join(" · ")}</span></p>}
                {!!card.ieltsTopics?.length && <p><b>IELTS topics</b><span>{card.ieltsTopics.join(" · ")}</span></p>}
              </div>
            )}
            <p className="example">
              <EnglishText text={displayCard.example} />
              {displayCard.exampleVi && <em>{displayCard.exampleVi}</em>}
            </p>
            <p className="definition"><EnglishText text={card.definition} /></p>
          </>
        )}
      </section>
      <div className="review-task-actions">
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
      </div>
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
function WordDetail({ word, close, study, speak, folders, updateFolders, onLevel }: { word: WordCard; close: () => void; study?: () => void; speak: (text: string) => void; folders?: FolderStore; updateFolders?: (next: FolderStore) => void; onLevel?: (id: string, level: string) => void }) {
  useEscape(close);
  const [listDraft, setListDraft] = useState("");
  const [listError, setListError] = useState("");
  // Bậc CEFR + từ đồng nghĩa bậc cao hơn: tra khi mở thẻ (fetchGlance nhớ kết quả
  // trong phiên nên mở lại cùng một từ là tức thì; không gọi mô hình AI).
  const [levelInfo, setLevelInfo] = useState<{ level: string | null; upgrades: { word: string; vi: string; level: string }[] }>({ level: null, upgrades: [] });
  useEffect(() => {
    let alive = true;
    fetchGlance(word.term)
      .then((glance: { level?: string | null; upgrades?: { word: string; vi: string; level: string }[] }) => {
        if (!alive) return;
        setLevelInfo({ level: glance.level ?? null, upgrades: Array.isArray(glance.upgrades) ? glance.upgrades : [] });
        if (glance.level && (!word.cefr || word.cefr === "?")) onLevel?.(word.id, glance.level);
      })
      .catch(() => { /* từ không có trong từ điển thì bỏ qua phần cấp độ */ });
    return () => { alive = false; };
  }, [word.id, word.term, word.cefr, onLevel]);
  const cefr = word.cefr && word.cefr !== "?" ? word.cefr : levelInfo.level;
  const upgrades = levelInfo.upgrades;
  // Chỉ hiện phần danh sách khi nơi gọi thật sự đưa kho xuống. Ba nơi gọi khác
  // của thẻ này là màn hình học, ở đó cất từ vào danh sách không có nghĩa gì.
  const canFile = Boolean(folders && updateFolders);
  const inside = folders ? foldersOf(folders, word.id) : [];
  function makeList() {
    if (!folders || !updateFolders) return;
    const name = listDraft.split(" ").filter(Boolean).join(" ");
    if (!name) return;
    const added = addFolder(folders, name);
    if (added.list.length === folders.list.length) return setListError("Đã có danh sách tên " + name + ".");
    updateFolders(addWords(added, added.list[added.list.length - 1].id, [word.id]));
    setListDraft("");
    setListError("");
  }
  // Một từ thay thế chỉ nên xuất hiện ở một nơi. Khi có lựa chọn bậc cao hơn,
  // ưu tiên chúng; danh sách đồng nghĩa khi đó chỉ lặp lại cùng một ý học.
  const synonymDetails = (word.synonymDetails ?? []).slice(0, 4);
  const synonyms = [...new Set(word.synonyms ?? [])].slice(0, 6);
  const antonymDetails = (word.antonymDetails ?? []).slice(0, 4);
  const antonyms = [...new Set(word.antonyms ?? [])].slice(0, 6);
  const useUpgrades = upgrades.length > 0;
  return (
    <div className="modal-backdrop word-detail-backdrop" onMouseDown={close}>
      <article className="word-detail" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">THẺ TỪ VỰNG ĐẦY ĐỦ</span><h2>{word.term}{cefr && <span className="word-cefr" title="Cấp độ CEFR ước lượng">{cefr}</span>}</h2><p><span className="lexical-type-badge">{lexicalTypeLabel(word.lexicalType || inferLexicalType(word.term, word.partOfSpeech))}</span> {word.ipa} · {word.partOfSpeech || "chưa xác định loại từ"}</p></div>
          <button onClick={close} aria-label="Đóng">×</button>
        </header>
        <button className="detail-speak" onClick={() => speak(word.term)}><Icon name="volume" size={14} /> Nghe phát âm</button>
        <div className="detail-core-grid">
          <section className="detail-meaning"><b>01 · Hiểu từ</b><p>{word.meaning}</p><small>{word.definition || "Chưa có định nghĩa Anh–Anh."}</small></section>
          <section className="detail-example"><b>02 · Ví dụ</b><p><EnglishText text={word.example} /></p>{word.exampleVi && <small>{word.exampleVi}</small>}</section>
        </div>
        {word.collocation && <section className="detail-collocation"><span>03 · CỤM NÊN HỌC</span><h3><EnglishText text={word.collocation} /></h3><p>{word.collocationVi}</p></section>}
        <section className={`detail-upgrades${useUpgrades ? "" : " is-synonym"}`}>
          <div className="detail-section-heading">
            <b>{useUpgrades ? `04 · Nâng band${cefr ? ` từ ${cefr}` : ""}` : "04 · Từ thay thế"}</b>
            <small>{useUpgrades ? "Ưu tiên từ gần nghĩa ở bậc cao hơn; mức CEFR là ước lượng." : "Chưa có lựa chọn bậc cao hơn, dùng từ đồng nghĩa phù hợp ngữ cảnh."}</small>
          </div>
          {useUpgrades ? (
            <div className="legacy-related detail-upgrade-list">
              {upgrades.slice(0, 6).map((item) => (
                <span key={item.word}><b>{item.word}</b><i className="word-cefr">{item.level}</i>{item.vi && <small>{item.vi}</small>}</span>
              ))}
            </div>
          ) : synonymDetails.length ? (
            <div className="detail-synonym-list">
              {synonymDetails.map((item) => (
                <article key={item.term}>
                  <h4>{item.term}</h4>
                  {item.meaningVi && <strong>{item.meaningVi}</strong>}
                  {item.example && <p><EnglishText text={item.example} /></p>}
                </article>
              ))}
            </div>
          ) : synonyms.length ? (
            <div className="legacy-related">{synonyms.map((value) => <span key={value}>{value}</span>)}</div>
          ) : (
            <small className="detail-empty">Chưa có từ thay thế phù hợp.</small>
          )}
        </section>
        <div className="detail-field-grid detail-secondary-grid">
          <section>
            <b>Trái nghĩa</b>
            {antonymDetails.length ? (
              <div>{antonymDetails.map((item) => <span key={item.term}><strong>{item.term}</strong>{item.meaningVi && <small>{item.meaningVi}</small>}</span>)}</div>
            ) : antonyms.length ? (
              <div>{antonyms.map((value) => <span key={value}>{value}</span>)}</div>
            ) : <small>Không có từ trái nghĩa thông dụng.</small>}
          </section>
          <section>
            <b>Ứng dụng IELTS</b>
            {word.ieltsTopics?.length ? <div>{word.ieltsTopics.map((value) => <span key={value}>{value}</span>)}</div> : <small>Chưa có chủ đề phù hợp.</small>}
          </section>
        </div>
        {canFile && folders && updateFolders && (
          <section className="detail-lists">
            <b>Cất vào danh sách</b>
            {folders.list.length > 0 && (
              <ul className="folder-check-list">
                {folders.list.map((folder) => {
                  const ticked = inside.includes(folder.id);
                  const parent = folder.parentId ? folderPath(folders, folder.id).slice(0, -1).map((step) => step.name).join(" › ") : "";
                  return (
                    <li key={folder.id}>
                      <button className={ticked ? "active" : ""} aria-pressed={ticked} onClick={() => updateFolders(toggleWord(folders, folder.id, word.id))}>
                        <i aria-hidden="true">{ticked ? "✓" : "＋"}</i>
                        <b>{folder.name}</b>
                        <small>{parent || "Danh sách gốc"}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <form className="folder-new" onSubmit={(event) => { event.preventDefault(); makeList(); }}>
              <input value={listDraft} onChange={(event) => { setListDraft(event.target.value); setListError(""); }} placeholder="Tên danh sách mới" aria-label="Tên danh sách mới" maxLength={60} />
              <button className="primary" type="submit" disabled={!listDraft.trim()}>Tạo và cất vào</button>
            </form>
            {listError && <p className="folder-note" role="status">{listError}</p>}
          </section>
        )}
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
        <h1>{total} thẻ đã hoàn thành</h1>
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
            ? `Bạn vừa học ${total} thẻ ở chế độ xem tự do. Chọn theo dõi tiến độ để cập nhật lịch ôn.`
            : excellent
              ? streak.current > 1
                ? `Giữ chuỗi ${streak.current} ngày rồi — kỷ lục của bạn là ${streak.best} ngày.`
                : "Kết quả đã được đồng bộ vào lịch ôn tiếp theo của bạn."
              : "Những thẻ bạn còn quên sẽ quay lại sớm hơn trong lịch ôn."}
        </p>
        <div className="summary-actions">
          <button onClick={close}>Hoàn tất</button>
          <button className="primary" onClick={restart}>
            Học lại
          </button>
        </div>
      </section>
    </main>
  );
}

/**
 * Chọn giao diện: bốn tông màu, mỗi tông một bản sáng và một bản tối.
 *
 * Đặt ở đáy thanh bên vì đây là cài đặt, không phải chỗ để đi tới. Menu bung lên
 * trên cho khỏi tràn khỏi màn hình.
 */
function ThemeMenu({ current, choose }: { current: string; choose: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const now = themeById(current);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="theme-menu" ref={holder}>
      <button className="theme-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
        <Icon name={now.mode === "dark" ? "moon" : "sun"} />
        <b>{now.label}</b>
        <Icon name="chevron" size={15} className={open ? "add-menu-caret open" : "add-menu-caret"} />
      </button>
      {open && (
        <div className="theme-menu-list" role="menu">
          {themeGroups().map((group: { id: string; label: string; mode: string; hue: number }[]) => (
            <div className="theme-menu-group" key={group[0].hue}>
              {group.map((item) => (
                <button
                  key={item.id}
                  role="menuitemradio"
                  aria-checked={item.id === current}
                  className={item.id === current ? "active" : ""}
                  onClick={() => {
                    choose(item.id);
                    setOpen(false);
                  }}
                >
                  {/* Chấm màu cho thấy đúng tông của lựa chọn đó, không phải tông đang dùng. */}
                  <i className="theme-swatch" style={{ background: `hsl(${item.hue} ${item.mode === "dark" ? "87% 73%" : "74% 55%"})` }} />
                  <Icon name={item.mode === "dark" ? "moon" : "sun"} size={16} />
                  <span>{item.label}</span>
                  {item.id === current && <Icon name="check" size={15} />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Nút "Thêm từ" kèm menu ba lối thêm.
 *
 * Đặt ngay đầu màn hình Danh sách từ chứ không nhét ở đáy thanh bên: thêm từ là
 * việc làm TRÊN danh sách từ, để tận đáy cột trái thì vừa xa chỗ đang nhìn vừa
 * biến thanh điều hướng thành chỗ chứa nút.
 */
function AddMenu({ onManual, onPaste, onDictionary }: { onManual: () => void; onPaste: () => void; onDictionary: () => void }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: { icon: IconName; label: string; hint: string; key: string; run: () => void }[] = [
    { icon: "pen", label: "Thêm thủ công", hint: "Nhập từng từ bằng tay", key: "⌘ K", run: onManual },
    { icon: "list", label: "Dán danh sách", hint: "Dán nhiều từ cùng lúc", key: "", run: onPaste },
    { icon: "search", label: "Tra từ điển AI", hint: "Tra nghĩa rồi lưu vào danh sách", key: "", run: onDictionary },
  ];

  return (
    <div className="add-menu" ref={holder}>
      <button className="primary add-menu-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
        <Icon name="plus" size={17} />
        <span>Thêm từ</span>
        <Icon name="chevron" size={15} className={open ? "add-menu-caret open" : "add-menu-caret"} />
      </button>
      {open && (
        <div className="add-menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <span className="add-menu-icon"><Icon name={item.icon} size={17} /></span>
              <span>
                <b>{item.label}</b>
                <small>{item.hint}</small>
              </span>
              {item.key && <kbd>{item.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Một bài nghe lấy từ video. Kho bài nằm ở lib/lessons.mjs. */
type VideoLesson = { id: string; videoId: string; title: string; author: string; seconds: number; source: string; captionVersion?: number; sentences: { index: number; start: number; end: number; text: string }[] };
type VideoDraft = Omit<VideoLesson, "id"> & { estimated?: boolean };
type VideoImport = Omit<VideoDraft, "sentences"> & {
  thumbnail?: string;
  sentences: VideoDraft["sentences"];
  error?: string;
};

/**
 * Nhờ tiện ích Chrome lấy phụ đề trong chính phiên YouTube của người dùng.
 * Máy chủ thường nhận thân rỗng từ timedtext; trình duyệt đang mở YouTube thì
 * có đủ token/cookie để lấy timestamp thật. Bridge chỉ tồn tại trên localhost.
 */
function lessonFromExtension(url: string): Promise<VideoImport> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let acknowledged = false;
    let noExtension = 0;
    let timedOut = 0;

    const finish = (error?: Error, lesson?: VideoImport) => {
      window.clearTimeout(noExtension);
      window.clearTimeout(timedOut);
      window.removeEventListener("message", receive);
      if (error) reject(error);
      else if (lesson) resolve(lesson);
      else reject(new Error("Tiện ích không trả về bài học."));
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== "lexilo-extension" || event.data?.requestId !== requestId) return;
      if (event.data.type === "LEXILO_IMPORT_YOUTUBE_ACK") {
        acknowledged = true;
        window.clearTimeout(noExtension);
        return;
      }
      if (event.data.type !== "LEXILO_IMPORT_YOUTUBE_RESULT") return;
      const result = event.data.result as { ok?: boolean; lesson?: VideoImport; error?: string } | undefined;
      if (!result?.ok || !result.lesson) finish(new Error(result?.error || "Tiện ích không lấy được phụ đề."));
      else finish(undefined, result.lesson);
    };

    window.addEventListener("message", receive);
    noExtension = window.setTimeout(() => {
      if (!acknowledged) finish(new Error("Chưa kết nối được tiện ích Lexilo 0.2.0."));
    }, 900);
    timedOut = window.setTimeout(() => finish(new Error("Lấy phụ đề quá lâu. Hãy thử lại sau khi tải lại trang YouTube.")), 30000);
    window.postMessage({ source: "lexilo-web", type: "LEXILO_IMPORT_YOUTUBE", requestId, url }, window.location.origin);
  });
}

function VideoImportModal({ close, save }: { close: () => void; save: (lesson: VideoDraft) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [video, setVideo] = useState<VideoImport | null>(null);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [close]);

  async function inspect(event: FormEvent) {
    event.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setStatus("Đang đọc thông tin video…");
    setError("");
    setVideo(null);
    let fallback: VideoImport | null = null;
    let apiError = "";
    try {
      const response = await fetch("/api/youtube", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
      const data = await response.json() as { videoId?: string; title?: string; author?: string; seconds?: number; thumbnail?: string; captionVersion?: number; sentences?: VideoDraft["sentences"]; error?: string };
      if (response.ok && data.videoId) {
        fallback = {
          videoId: data.videoId,
          title: data.title || "Video YouTube",
          author: data.author || "",
          seconds: data.seconds || 0,
          thumbnail: data.thumbnail,
          source: data.sentences?.length ? "extension" : "paste",
          captionVersion: data.captionVersion,
          sentences: data.sentences || [],
          error: data.error,
        };
        if (fallback.sentences.length) {
          setVideo(fallback);
          return;
        }
      } else apiError = data.error || "Không đọc được video YouTube này.";
    } catch (reason) {
      apiError = reason instanceof Error ? reason.message : "Không đọc được video YouTube này.";
    }

    try {
      setStatus("Đang lấy phụ đề và timestamp từ YouTube…");
      setVideo(await lessonFromExtension(url.trim()));
    } catch (reason) {
      const extensionError = reason instanceof Error ? reason.message : "Tiện ích không lấy được phụ đề.";
      if (fallback) setVideo({ ...fallback, error: `${extensionError} Bạn vẫn có thể dán transcript bên dưới.` });
      else setError([apiError, extensionError].filter(Boolean).join(" "));
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  function commit() {
    if (!video) return;
    const sentences = video.sentences.length
      ? video.sentences
      : (alignTranscript(transcript, video.seconds || 60) as VideoDraft["sentences"]);
    if (!sentences.length) {
      setError("Hãy dán lời thoại tiếng Anh để tạo các đoạn Shadowing.");
      return;
    }
    save({
      videoId: video.videoId,
      title: video.title,
      author: video.author,
      seconds: video.seconds,
      source: video.sentences.length ? video.source : "paste",
      captionVersion: video.captionVersion,
      estimated: !video.sentences.length,
      sentences,
    });
  }

  return (
    <div className="modal-backdrop video-import-backdrop" role="presentation" onMouseDown={close}>
      <section className="video-import-modal" role="dialog" aria-modal="true" aria-labelledby="video-import-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><i><Icon name="play" size={19} /></i><div><h2 id="video-import-title">Thêm video YouTube</h2><p>Tạo bài Dictation và Shadowing từ phụ đề tiếng Anh.</p></div><button onClick={close} aria-label="Đóng">×</button></header>
        <form onSubmit={inspect}>
          <label htmlFor="youtube-url">Liên kết YouTube</label>
          <div className="video-url-row"><input id="youtube-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." /><button className="primary" disabled={loading || !url.trim()}>{loading ? "Đang lấy…" : "Lấy video"}</button></div>
        </form>
        {loading && status && <p className="video-import-status"><span aria-hidden="true" />{status}</p>}
        {error && <p className="video-import-error">{error}</p>}
        {video && (
          <div className="video-import-preview">
            <img src={video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`} alt="" />
            <div><b>{video.title}</b><span>{video.author || "YouTube"}{video.seconds ? ` · ${Math.max(1, Math.round(video.seconds / 60))} phút` : ""}</span><small>{video.sentences.length ? `${video.sentences.length} đoạn phụ đề đã tìm thấy` : "Chưa lấy được phụ đề tự động"}</small></div>
          </div>
        )}
        {video && !video.sentences.length && (
          <div className="video-transcript-field">
            <div className="transcript-head">
              <label htmlFor="video-transcript">Lời thoại tiếng Anh</label>
              {/* Video không có phụ đề thì trước đây phải tự gõ tay cả bài. Nhờ
                  AI nghe hộ, còn mốc giờ vẫn để app ước lượng: mốc AI trả về đo
                  ra sai hẳn, có video dài 121 giây mà mốc cuối chỉ 61,7. */}
              <button
                className="transcript-ai"
                disabled={listening || loading}
                onClick={async () => {
                  setListening(true);
                  setError("");
                  setStatus("Đang nhờ AI nghe video… video dài thì mất một lúc.");
                  try {
                    const response = await fetch("/api/transcribe", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ url, seconds: video.seconds }),
                    });
                    const data = (await response.json()) as { transcript?: string; error?: string };
                    if (!response.ok || data.error) throw new Error(data.error ?? "Không đọc được lời thoại.");
                    setTranscript(data.transcript ?? "");
                    setStatus("AI đã nghe xong. Đọc lại một lượt rồi sửa chỗ nào sai trước khi tạo bài.");
                  } catch (problem) {
                    setStatus("");
                    setError(problem instanceof Error ? problem.message : "Không đọc được lời thoại.");
                  } finally {
                    setListening(false);
                  }
                }}
              >
                {listening ? "◌ AI đang nghe…" : "✦ Nhờ AI nghe hộ"}
              </button>
            </div>
            <p>{video.error || "Dán transcript, hoặc nhờ AI nghe hộ khi video không có phụ đề. Lexilo tự chia câu và ước lượng mốc thời gian."}</p>
            <textarea
              id="video-transcript"
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="Paste the English transcript here…"
              rows={7}
            />
          </div>
        )}
        {video && <footer><button onClick={close}>Hủy</button><button className="primary" onClick={commit} disabled={!video.sentences.length && !transcript.trim()}>Thêm vào thư viện</button></footer>}
      </section>
    </div>
  );
}

/**
 * Kho bài lấy từ video.
 *
 * Để ở Trang chủ vì màn hình học trên video chưa dựng xong: bài nhập vào phải nhìn
 * thấy và xoá được ngay, chứ không nằm im trong bộ nhớ máy mà người dùng không biết.
 */
const practiceShellSessionKey = "lexilo:practice-shell:v1";
type PracticeShellSession = {
  intent: Exclude<PracticeMode, "menu"> | null;
  mode: PracticeMode;
  pendingMode: Exclude<PracticeMode, "menu"> | null;
  practiceWordIds: string[];
  lessonVideoId: string | null;
  translating: boolean;
};

// Màn luyện tập bị tháo khỏi cây khi người dùng sang trang khác. Vì vậy trạng thái
// điều hướng bên trong phải được lưu riêng, giống phiên flashcard và phiên luyện viết.
function Practice({ words, intent, launch, openLesson, initialLibraryFilter, lessons, onStudied, onResult, onToggleStar, onAddVideo, onPromoteVideo, onStartReview, onExitTool, lookupVocab }: { words: WordCard[]; intent?: Exclude<PracticeMode, "menu"> | null; launch: number; openLesson: { videoId: string; mode: "dictation" | "shadow"; nonce: number } | null; initialLibraryFilter: "video" | null; lessons: VideoLesson[]; onAddVideo: () => void; onPromoteVideo: (lesson: VideoLesson | VideoLesson[]) => Promise<void>; onStudied: () => void; onResult: (id: string, rating: Rating) => void; onToggleStar: (id: string) => void; onStartReview: (words: WordCard[], mode: ReviewMode) => void; onExitTool: () => void; lookupVocab?: LookupVocab }) {
  // Bài video đang mở; null nghĩa là đang ở màn hình chọn.
  const [lesson, setLesson] = useState<VideoLesson | null>(() =>
    openLesson ? (lessons.find((item) => item.videoId === openLesson.videoId) ?? null) : null,
  );
  // Đang mở phần dịch Việt → Anh bên trong mục Luyện viết.
  const [translating, setTranslating] = useState(false);
  // Nghe chép chính tả và nói nhại học theo thư viện bài, không theo folder từ
  // vựng, nên vào thẳng chứ không qua bước chọn folder.
  // Luyện viết mở thẳng thư viện đề. Riêng luồng "Viết bằng từ vựng của bạn"
  // sẽ chủ động mở FolderPicker từ thẻ chức năng trong WritingPractice.
  const skipsFolder = (value: PracticeMode | null | undefined) =>
    value === "shadow" || value === "dictation" || value === "vocab" || value === "translate" || value === "speak";
  const [mode, setMode] = useState<PracticeMode>(openLesson?.mode ?? (initialLibraryFilter ? "dictation" : skipsFolder(intent) ? (intent as PracticeMode) : intent ? "menu" : "vocab"));
  const [pendingMode, setPendingMode] = useState<Exclude<PracticeMode, "menu"> | null>(skipsFolder(intent) ? null : intent ?? null);
  const [practiceWords, setPracticeWords] = useState<WordCard[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const handledLaunch = useRef(launch);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(practiceShellSessionKey);
      const saved = raw ? (JSON.parse(raw) as Partial<PracticeShellSession>) : null;
      const validModes: PracticeMode[] = ["menu", "vocab", "learn", "test", "match", "dictation", "shadow", "speak", "translate"];
      // Chỉ nối lại khi đây đúng là mục người dùng đang quay lại. Nếu họ chọn một
      // mục khác trên sidebar thì luồng đổi chế độ ở effect bên dưới sẽ xử lý.
      if (!openLesson && !initialLibraryFilter && saved && saved.intent === (intent ?? null) && validModes.includes(saved.mode as PracticeMode)) {
        setMode(saved.mode as PracticeMode);
        setPendingMode(validModes.includes(saved.pendingMode as PracticeMode) ? (saved.pendingMode as Exclude<PracticeMode, "menu">) : null);
        setPracticeWords(words.filter((word) => saved.practiceWordIds?.includes(word.id)));
        setLesson(lessons.find((item) => item.videoId === saved.lessonVideoId) ?? null);
        setTranslating(!!saved.translating);
      }
    } catch {
      // Bản lưu hỏng không được làm hỏng màn luyện tập.
    } finally {
      setSessionReady(true);
    }
  }, []);

  useEffect(() => {
    // Lần mount là khôi phục phiên, không phải yêu cầu mở bài mới.
    if (handledLaunch.current === launch) return;
    handledLaunch.current = launch;
    if (!intent) return;
    setMode(skipsFolder(intent) ? intent : "menu");
    setPendingMode(skipsFolder(intent) ? null : intent);
    setPracticeWords([]);
    setLesson(null);
    setTranslating(false);
  }, [intent, launch]);

  useEffect(() => {
    if (!sessionReady) return;
    const snapshot: PracticeShellSession = {
      intent: intent ?? null,
      mode,
      pendingMode,
      practiceWordIds: practiceWords.map((word) => word.id),
      lessonVideoId: lesson?.videoId ?? null,
      translating,
    };
    try {
      localStorage.setItem(practiceShellSessionKey, JSON.stringify(snapshot));
    } catch {
      // Chế độ riêng tư có thể chặn localStorage; phiên hiện tại vẫn tiếp tục.
    }
  }, [sessionReady, intent, mode, pendingMode, practiceWords, lesson, translating]);
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
  // Thư viện video là một luồng độc lập: người mới chưa lưu từ nào vẫn phải mở
  // được Nghe chép/Nói nhại, thêm video và tiếp tục bài đang dở. Chỉ các bài
  // luyện thực sự dùng kho từ mới cần chặn bằng màn hình hướng dẫn bên dưới.
  const worksWithoutVocabulary = mode === "dictation" || mode === "shadow" || mode === "speak" || mode === "translate" || translating;
  if (!words.length && !worksWithoutVocabulary)
    return (
      <div className="page practice-empty-page">
        <section className="practice-empty-state">
          <span className="practice-empty-icon"><Icon name="book" size={28} /></span>
          <div className="eyebrow">CHUẨN BỊ BUỔI HỌC</div>
          <h1>Thêm vài từ để bắt đầu luyện tập</h1>
          <p>Chỉ cần lưu từ đầu tiên. Lexilo sẽ dùng chính kho từ của bạn để tạo thẻ ghi nhớ, bài nghe, nói và luyện viết có ngữ cảnh.</p>
          <div className="practice-empty-actions">
            <BackButton destination="Từ vựng" onClick={onExitTool} />
            <button className="primary" onClick={() => lookupVocab?.openDictionary("")}><Icon name="search" size={17} /> Tra và lưu từ</button>
            <button onClick={onAddVideo}><Icon name="play" size={17} /> Thêm video luyện nghe</button>
          </div>
          <small>Dữ liệu được lưu riêng theo tài khoản và có thể đưa một từ vào nhiều danh sách.</small>
        </section>
      </div>
    );
  const activeWords = practiceWords.length ? practiceWords : words;
  const personalWords = words.filter((item) => !isPdfVocabulary(item));
  const pdfWords = words.filter(isPdfVocabulary);

  function chooseFolder(folderWords: WordCard[]) {
    if (!pendingMode || !folderWords.length) return;
    setPracticeWords(folderWords);
    setMode(pendingMode);
    setPendingMode(null);
  }
  // Các màn con của Luyện từ vựng quay về trang chọn bài từ vựng. Còn nút
  // "Chọn chức năng khác" ở màn gốc phải thoát về đúng không gian kỹ năng.
  function returnToVocabPractice() {
    setMode("vocab");
    setPendingMode(null);
    setPracticeWords([]);
  }
  if (mode === "menu" && pendingMode)
    return (
      <FolderPicker
        mode={pendingMode}
        backLabel={translating ? "Viết" : "Từ vựng"}
        personalWords={personalWords}
        pdfWords={pdfWords}
        choose={chooseFolder}
        close={() => {
          setPendingMode(null);
          if (translating) {
            setTranslating(false);
            setPracticeWords([]);
            setMode("translate");
            return;
          }
          setMode("vocab");
        }}
      />
    );
  if (mode === "match") return <MatchGame words={activeWords} close={returnToVocabPractice} onResult={onResult} />;
  if (mode === "speak") return <SpeakingPractice close={onExitTool} onStudied={onStudied} />;
  // Dictation và Shadowing dùng chung một thư viện: bài từ video và bài có sẵn.
  if (mode === "dictation" || mode === "shadow") {
    const listening = mode === "shadow" ? "shadowing" : "dictation";
    if (lesson)
      return (
        <VideoLesson
          lesson={lesson}
          mode={listening}
          close={() => setLesson(null)}
          onStudied={onStudied}
          // Đổi chế độ ngay trong bài: giữ nguyên bài, chỉ đổi cách luyện.
          onMode={(next) => setMode(next === "shadowing" ? "shadow" : "dictation")}
          vocab={lookupVocab}
        />


      );
    return (
      <LessonLibrary
        mode={listening}
        lessons={lessons}
        initialFilter={initialLibraryFilter ?? undefined}
        addVideo={onAddVideo}
        promoteVideo={onPromoteVideo}
        pickVideo={setLesson}
        close={onExitTool}
      />
    );
  }
  if (mode === "vocab")
    return (
      <VocabPractice
        words={activeWords}
        close={onExitTool}
        onStudied={markStudiedToday}
        onResult={onResult}
        onToggleStar={onToggleStar}
        onStartReview={onStartReview}
        onPickOther={(next) => setMode(next as PracticeMode)}
      />
    );
  if (mode === "learn") return <LearnMode words={activeWords} setMode={setMode} onResult={onResult} />;
  if (mode === "test") return <TestMode words={activeWords} setMode={setMode} onResult={onResult} />;
  // Luyện viết: thư viện đề trước, phần dịch Việt → Anh là một lựa chọn bên trong.
  if (translating)
    return (
      <TranslateMode
        words={activeWords}
        back={() => {
          setTranslating(false);
          setPracticeWords([]);
          setMode("translate");
        }}
      />
    );
  return (
    <WritingPractice
      onStudied={onStudied}
      openTranslate={() => {
        setTranslating(true);
        setPracticeWords([]);
        setPendingMode("translate");
        setMode("menu");
      }}
    />
  );
}

// Thứ tự và nhãn của các chế độ khi hiện ở thanh bên trái.
// Xếp theo việc người học đang muốn làm, không theo tên chế độ. Nhóm trên là học
// thuộc mặt chữ và nghĩa; nhóm dưới là dùng vốn từ đó vào nghe, nói, viết.
const practiceNav: { value: Exclude<PracticeMode, "menu">; label: string; icon: IconName; skill: string }[] = [
  { value: "dictation", label: "Nghe chép", icon: "headphones", skill: "dictation" },
  { value: "shadow", label: "Nói nhại", icon: "mic", skill: "shadowing" },
  { value: "speak", label: "Luyện nói", icon: "volume", skill: "shadowing" },
  { value: "translate", label: "Viết", icon: "pen", skill: "writing" },
  { value: "vocab", label: "Luyện từ vựng", icon: "book", skill: "vocab" },
];

// Ba chế độ này cũng tính giờ vào kỹ năng từ vựng, dù không có mặt ở thanh bên.
// ── Bốn kỹ năng ────────────────────────────────────────────────────────────
// Điều hướng xếp theo MỤC TIÊU HỌC, không theo tính năng của app. Người học nghĩ
// "hôm nay luyện nghe", chứ không nghĩ "mở mục Nghe chép trong nhóm Luyện tập".
//
// Trước đây cột trái là mười mục phẳng chia ba nhóm TỔNG QUAN / LUYỆN TẬP /
// THƯ VIỆN — trùng gần như từng dòng với bố cục của đối thủ. Gom lại thành bốn
// kỹ năng vừa khác hẳn, vừa bớt cho người dùng tám lựa chọn phải cân nhắc mỗi
// lần mở app.
//
// KHÔNG mất tính năng nào: mỗi công cụ cũ vẫn tới được, chỉ nằm sau một cú bấm
// vào kỹ năng chứa nó.
type SkillId = "listen" | "speak" | "vocab" | "write";

/** Không gian nhận lại người dùng khi thoát khỏi một công cụ luyện tập. */
function skillHubForPractice(intent: Exclude<PracticeMode, "menu"> | null | undefined): SkillId {
  if (intent === "dictation") return "listen";
  if (intent === "shadow" || intent === "speak") return "speak";
  if (intent === "translate") return "write";
  return "vocab";
}

type SkillTool =
  | { kind: "practice"; value: Exclude<PracticeMode, "menu">; label: string; icon: IconName; note: string }
  | { kind: "tab"; value: "words" | "dictionary"; label: string; icon: IconName; note: string };

const SKILL_SPACES: {
  id: SkillId;
  label: string;
  icon: IconName;
  blurb: string;
  /** Khoá thống kê thời gian trong lib/practice-log.mjs — có thể gộp nhiều khoá. */
  timeKeys: string[];
  tools: SkillTool[];
}[] = [
  {
    id: "listen",
    label: "Nghe",
    icon: "headphones",
    blurb: "Nghe video thật rồi gõ lại từng câu.",
    timeKeys: ["dictation"],
    tools: [
      { kind: "practice", value: "dictation", label: "Nghe chép", icon: "headphones", note: "Nghe từng đoạn rồi gõ lại, AI soát lỗi ngay" },
    ],
  },
  {
    id: "speak",
    label: "Nói",
    icon: "mic",
    blurb: "Nói theo người bản xứ và nói trong tình huống thật.",
    timeKeys: ["shadowing"],
    tools: [
      { kind: "practice", value: "shadow", label: "Nói nhại", icon: "mic", note: "Nói đuổi theo video, AI chấm ngữ điệu" },
      { kind: "practice", value: "speak", label: "Luyện nói", icon: "volume", note: "Hội thoại tình huống, AI đóng vai" },
    ],
  },
  {
    id: "vocab",
    label: "Từ vựng",
    icon: "book",
    blurb: "Gom từ, ôn theo lịch, tra khi cần.",
    timeKeys: ["vocab", "review"],
    tools: [
      { kind: "practice", value: "vocab", label: "Luyện từ vựng", icon: "book", note: "Thẻ ghi nhớ và sáu kiểu luyện" },
      { kind: "tab", value: "words", label: "Kho từ vựng", icon: "list", note: "Toàn bộ từ đã lưu, chia theo danh sách" },
      { kind: "tab", value: "dictionary", label: "Từ điển AI", icon: "search", note: "Tra nghĩa, cụm từ và từ nâng bậc" },
    ],
  },
  {
    id: "write",
    label: "Viết",
    icon: "pen",
    blurb: "Dịch và viết, nhận nhận xét từng câu.",
    timeKeys: ["writing"],
    tools: [
      { kind: "practice", value: "translate", label: "Viết", icon: "pen", note: "Dịch Việt–Anh và viết theo đề thi" },
    ],
  },
];

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
  speak: "Luyện nói theo tình huống",
  match: "Nối cặp",
  translate: "Viết bằng từ vựng của bạn",
};

function FolderPicker({ mode, personalWords, pdfWords, choose, close, backLabel }: { mode: Exclude<PracticeMode, "menu">; personalWords: WordCard[]; pdfWords: WordCard[]; choose: (words: WordCard[]) => void; close: () => void; backLabel?: string }) {
  const dailyFolders = (setsFor(personalWords, "week") as { label: string; words: WordCard[] }[]).map((folder) => ({ name: folder.label, words: folder.words }));
  const topicFolders = (setsFor(pdfWords, "topic") as { label: string; words: WordCard[] }[]).map((folder) => ({ name: folder.label, words: folder.words }));
  return (
    <div className="page folder-picker-page">
      <BackButton destination={backLabel ?? "Từ vựng"} onClick={close} />
      {/* Không đánh số bước nữa: cùng màn này vào từ Luyện viết là bước 2 trong
          ba bước, vào từ chỗ khác lại là bước cuối. Đếm kiểu nào cũng sai một
          đường, mà tên bước thì luôn đúng. */}
      <div className="eyebrow">BƯỚC CHỌN FOLDER</div>
      <h1>Chọn folder cho {practiceModeNames[mode]}</h1>
      <p className="page-sub">Chức năng chỉ sử dụng các từ trong folder bạn chọn.</p>
      {!personalWords.length && !pdfWords.length && (
        <section className="practice-empty-state">
          <span className="practice-empty-icon"><Icon name="book" size={26} /></span>
          <h2>Chưa có từ để tạo bài viết</h2>
          <p>Quay lại màn Viết hoặc lưu vài từ trước khi chọn lộ trình này.</p>
        </section>
      )}
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
type PracticeMode = "menu" | "vocab" | "learn" | "test" | "match" | "dictation" | "shadow" | "speak" | "translate";
// Bốn cách luyện từ vựng, hiện ngay trong mục Luyện từ vựng để đổi qua lại nhanh.
const practiceModeBar: { value: PracticeMode; label: string; icon: IconName }[] = [
  { value: "vocab", label: "Luyện thẻ", icon: "cards" },
  { value: "learn", label: "Học tới khi thuộc", icon: "pen" },
  { value: "test", label: "Kiểm tra", icon: "target" },
  { value: "match", label: "Nối cặp", icon: "shuffle" },
];
function PracticeModeBar({ mode, setMode }: { mode: PracticeMode; setMode: (m: PracticeMode) => void }) {
  return (
    <div className="mode-bar" role="group" aria-label="Chế độ luyện tập">
      {practiceModeBar.map((item) => (
        <button key={item.value} className={mode === item.value ? "active" : ""} onClick={() => setMode(item.value)}>
          <span><Icon name={item.icon} size={16} /></span>
          {item.label}
        </button>
      ))}
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
// Người học chọn học từng câu độc lập hoặc ghép thành đoạn tiếng Việt. Ở cả hai
// kiểu, app đối chiếu câu trả lời với câu mẫu rồi chỉ ra chỗ lệch. Chế độ đã chọn
// phải đi xuyên suốt từ lúc gọi API tới cách trình bày đề bài.
function TranslateMode({ words, back }: { words: WordCard[]; back: () => void }) {
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
  useEffect(() => {
    const saved = localStorage.getItem(exampleLayoutModeKey);
    if (saved === "passage" || saved === "sentences") setExtraMode(saved);
  }, []);
  function chooseExtraMode(mode: "passage" | "sentences") {
    setExtraMode(mode);
    localStorage.setItem(exampleLayoutModeKey, mode);
  }
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
    () => buildPassages(
      chosen.map((word) => ({ word, vi: cleanStudyVietnamese(word.exampleVi!), en: word.example!.trim() })),
      // "Một đoạn liền mạch" → dồn thành vài đoạn dài (min 4 câu) thay vì chục đoạn
      // một câu. "Từng câu riêng" hiện từng câu một nên tách kiểu gì cũng được.
      { areas: ieltsAreaData as [string, string[]][], minSize: extraMode === "passage" ? 4 : 0 },
    ),
    [chosen, extraMode],
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
  // Câu tiếng Anh người học đã viết đúng và đi qua — để thay dần vào đoạn văn.
  const [written, setWritten] = useState<Record<string, string>>({});
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
      const terms = fallbackTasks.map((task) => task.word.term);
      const response = await aiFetch("/api/ai/passage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Một nhóm chủ đề đôi khi chỉ có một từ nên luôn là câu độc lập. Với nhóm
        // nhiều từ, tôn trọng đúng lựa chọn ở bước trước thay vì ép thành passage.
        body: JSON.stringify({ terms, topic: passage.topic, mode: terms.length < 2 ? "sentences" : extraMode }),
      });
      const data = (await response.json()) as { sentences?: { term: string; vi: string; en: string }[]; error?: string };
      if (!response.ok || !data.sentences?.length) throw new Error(data.error ?? (extraMode === "passage" ? "Không dựng được đoạn văn." : "Không tạo được các câu ví dụ."));
      // Ghép câu Gemini viết trở lại đúng thẻ từ vựng, giữ nguyên thứ tự đã gửi đi.
      const rebuilt = data.sentences
        .map((item, position) => ({
          word: fallbackTasks.find((task) => task.word.term.toLowerCase() === item.term.toLowerCase())?.word ?? fallbackTasks[position]?.word,
          // Chuẩn hoá phản hồi trước khi đưa vào giao diện để dữ liệu nguồn cũ
          // không làm tái xuất hiện lỗi khoảng trắng và dấu câu.
          vi: cleanStudyVietnamese(item.vi),
          en: item.en.normalize("NFC").replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim(),
        }))
        .filter((item): item is { word: WordCard; vi: string; en: string } => Boolean(item.word));
      if (rebuilt.length < Math.min(2, fallbackTasks.length)) throw new Error(extraMode === "passage" ? "Đoạn văn không khớp với từ trong folder." : "Các câu ví dụ không khớp với từ trong folder.");
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

  // Khi bắt đầu học, dựng nội dung theo đúng kiểu người dùng đã chọn.
  useEffect(() => {
    if (choosing || !passage || storyState !== "idle") return;
    void buildStory();
  }, [choosing, passageIndex, passage, storyState, extraMode]);

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
      issues: grade?.issues,
      assessedTypes: errorTypes,
      // Bài dịch thường, không phải bài luyện một lỗi cụ thể.
      practiceType: null,
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
    // Ghi lại câu tiếng Anh cho câu vừa xong: bản người học viết nếu đúng, còn
    // sai thì lấy bản sửa của AI để đoạn văn ghép lại vẫn chuẩn.
    if (current) {
      const mine = typed.trim();
      const best = aiGrade && aiGrade.correct === false && aiGrade.suggestion?.trim() ? aiGrade.suggestion.trim() : mine;
      if (best) setWritten((map) => ({ ...map, [current.word.id]: best }));
    }
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
    setWritten({});
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
    setWritten({});
  }

  // Folder rỗng vẫn cho vào bước chọn, vì có thể học bằng danh sách tự nhập.
  if (!pool.length && !choosing)
    return (
      <div className="page practice-session">
        <BackButton destination="chọn chế độ" onClick={back} />
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
        <BackButton destination="chọn chế độ" onClick={back} />
        <div className="eyebrow">BƯỚC CHỌN TỪ</div>
        <h1>Chọn từ để luyện dịch</h1>
        <p className="page-sub">Folder có {usable.length} từ đủ dữ liệu. Chọn từ muốn học rồi quyết định luyện từng câu riêng hay ghép thành đoạn liền mạch.</p>

        <section className="extra-list">
          <b>Danh sách riêng của bạn</b>
          <p>Nhập từ không có trong folder — mỗi dòng một từ, hoặc ngăn nhau bằng dấu phẩy. App sẽ viết câu ví dụ kèm bản dịch cho chúng.</p>
          <textarea value={extraText} onChange={(event) => setExtraText(event.target.value)} placeholder={"deadline\nnegotiate\nbudget cut"} />
          <div className="extra-actions">
            <div className="bulk-example-modes" role="group" aria-label="Kiểu ví dụ cho danh sách riêng">
              <button type="button" className={extraMode === "sentences" ? "active" : ""} onClick={() => chooseExtraMode("sentences")}>
                Từng câu riêng
              </button>
              <button type="button" className={extraMode === "passage" ? "active" : ""} onClick={() => chooseExtraMode("passage")}>
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
          <b>Đã chọn {chosen.length} từ{extraMode === "passage" && passages.length ? ` · ${passages.length} đoạn` : ""}</b>
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
        <BackButton destination="chọn từ" onClick={backToPicker} />
        <div className="panel practice-card">
          <h2>Những từ đã chọn chưa dùng được</h2>
          <p className="page-sub">Câu ví dụ của chúng là câu khuôn nói về chính từ đó nên không hợp để luyện dịch. Hãy chọn từ khác hoặc bổ sung lại ví dụ.</p>
        </div>
      </div>
    );

  // Xong nhóm hiện tại mà còn nhóm khác thì mời sang nhóm kế, chưa tổng kết vội.
  if (index >= tasks.length && passageIndex + 1 < passages.length)
    return (
      <div className="page practice-session">
        <div className="panel practice-card">
          <span className="summary-mark">✓</span>
          <h2>Xong {extraMode === "passage" ? "đoạn" : "nhóm"} {passageIndex + 1} / {passages.length}</h2>
          <p className="page-sub">{extraMode === "passage" ? "Đoạn" : "Nhóm"} tiếp theo — <b>{passages[passageIndex + 1].topic}</b>, {passages[passageIndex + 1].tasks.length} câu.</p>
          <div className="summary-actions">
            <button onClick={back}>Thoát</button>
            <button className="primary" onClick={nextPassage}>{extraMode === "passage" ? "Đoạn" : "Nhóm"} tiếp theo →</button>
          </div>
        </div>
      </div>
    );

  if (index >= tasks.length)
    return (
      <div className="page practice-session">
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
      <header className="translation-session-head">
        <div>
          <span className="eyebrow">LUYỆN VIỆT → ANH · {extraMode === "passage" ? "ĐOẠN VĂN LIỀN MẠCH" : "TỪNG CÂU RIÊNG"}</span>
          <h1>{passage.topic}</h1>
        </div>
        <div className="translation-session-stats">
          <span><b>{chosen.length}</b> từ đã chọn</span>
          <span><b>{scores.length ? average : 0}%</b> độ chính xác</span>
          <span><b>{index + 1}/{tasks.length}</b> câu</span>
        </div>
      </header>
      <div className="translation-progress" role="progressbar" aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={index}>
        <i style={{ width: `${tasks.length ? (index / tasks.length) * 100 : 0}%` }} />
      </div>
      <div className="translate-grid">
        <section className="translate-source">
          <div className="translate-head">
            <div>
              <span className="eyebrow">{extraMode === "passage" ? "ĐOẠN TIẾNG VIỆT" : "CÂU TIẾNG VIỆT"}</span>
              <small>{passage.topic}{extraMode === "passage" ? ` · Đoạn ${passageIndex + 1}/${passages.length}` : ""}</small>
            </div>
            <b>Câu {index + 1} / {tasks.length}</b>
          </div>
          {storyState === "ready" && <em className="story-flag">✦ {extraMode === "passage" ? "Đoạn văn liền mạch" : "Câu ví dụ độc lập"} do AI tạo từ các từ đã chọn</em>}
          <div className={`translate-paragraph ${extraMode === "sentences" ? "is-sentence" : ""} ${storyState !== "ready" ? "is-loading" : ""}`} aria-busy={storyState === "loading"}>
            {storyState !== "ready" ? (
              <div className={`story-loading-state ${storyState === "failed" ? "story-failed-state" : ""}`}>
                {storyState === "failed" ? (
                  <>
                    <b>{extraMode === "passage" ? "Chưa tạo được đoạn văn đạt chuẩn" : "Chưa tạo được câu ví dụ đạt chuẩn"}</b>
                    <small>Nội dung lỗi đã được ẩn. Hãy thử tạo lại để tiếp tục luyện.</small>
                  </>
                ) : (
                  <>
                    <span className="story-loading-spinner" aria-hidden="true" />
                    <b>{extraMode === "passage" ? "Đang tạo đoạn văn tiếng Việt…" : "Đang tạo các câu tiếng Việt…"}</b>
                    <small>{extraMode === "passage" ? "AI đang viết nội dung mạch lạc từ những từ bạn đã chọn." : "AI đang viết một ngữ cảnh độc lập cho mỗi từ."}</small>
                  </>
                )}
              </div>
            ) : (
              (extraMode === "sentences" && current ? [current] : tasks).map((task, position) => {
                const isActive = extraMode === "sentences" || position === index;
                const isDone = !isActive && position < index;
                // Câu đã xong thì hiện chính câu tiếng Anh người học vừa viết —
                // đoạn văn dần chuyển từ tiếng Việt sang bản dịch của mình.
                const englishDone = isDone && written[task.word.id];
                return (
                  <span key={task.word.id} className={`translation-sentence ${isActive ? "active" : isDone ? "done" : ""} ${englishDone ? "written" : ""} ${replaced[task.word.id] ? "swapped" : ""}`}>
                    {englishDone ? written[task.word.id] : cleanStudyVietnamese(task.vi)}
                  </span>
                );
              })
            )}
          </div>
          <div className="translate-input">
            <div className="translate-input-head">
              <label htmlFor="translation-answer">Bản dịch tiếng Anh của bạn</label>
              <div>
                <button type="button" onClick={() => speakWord(current.word.term)} title={`Nghe phát âm ${current.word.term}`}>
                  <Icon name="volume" size={14} /> {current.word.term}
                </button>
                <span>{typed.trim() ? typed.trim().split(/\s+/).length : 0} từ</span>
              </div>
            </div>
            <textarea
              id="translation-answer"
              aria-label="Bản dịch tiếng Anh của bạn"
              disabled={storyState !== "ready"}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                // Khi sửa bài sau lúc chấm, đóng ngay phản hồi và câu mẫu để người
                // học tự viết lại, đồng thời bỏ điểm tạm của chính lượt vừa chấm.
                if (checked) {
                  setChecked(false);
                  setAiGrade(null);
                  setHintCount(0);
                  setScores((list) => list.slice(0, -1));
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (checked) next();
                  else check();
                }
              }}
              placeholder="Viết câu tiếng Anh cho câu đang tô sáng…"
            />
            <div className="translate-input-help">
              <span><kbd>Enter</kbd> chấm câu · <kbd>Shift</kbd> + <kbd>Enter</kbd> xuống dòng</span>
              {typed && <button type="button" onClick={() => setTyped("")}>Xóa nội dung</button>}
            </div>
          </div>
          {storyState !== "ready" && storyState !== "auto" && (
            <button className="story-build" type="button" disabled={storyState === "loading"} onClick={() => void buildStory()}>
              {storyState === "loading"
                ? extraMode === "passage" ? "◌ Đang viết đoạn văn…" : "◌ Đang viết từng câu…"
                : storyState === "failed"
                  ? extraMode === "passage" ? "↻ Thử viết lại đoạn văn liền mạch" : "↻ Thử tạo lại từng câu"
                  : extraMode === "passage" ? "✦ Viết lại thành đoạn văn liền mạch" : "✦ Viết lại từng câu riêng"}
            </button>
          )}
          {swapNote && <p className="story-note">{swapNote}</p>}
          <div className="translate-actions">
            <BackButton destination="chọn từ" onClick={backToPicker} />
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
              <button className="primary" disabled={!typed.trim() || storyState !== "ready"} onClick={check}>Chấm câu này</button>
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
              <span>▤ TRA TỪ</span>
              <b>{current.word.term} →</b>
            </button>
            {/* Có chấm bằng mô hình thì hiện điểm thật. "Khớp câu mẫu" chỉ là độ
                giống một cách dịch, không phải điểm đúng/sai — đừng để nó đứng
                ngang hàng và nói ngược lại kết luận. */}
            <div>
              <span>◎ {aiGrade ? "ĐỘ CHÍNH XÁC" : "KHỚP CÂU MẪU"}</span>
              <b>{aiGrade ? `${aiGrade.score}/100` : checked && result ? `${result.accuracy}%` : "—"}</b>
            </div>
          </div>
          <div className="translate-feedback-title">
            <div><span>PHẢN HỒI</span><b>{checked ? "Kết quả câu hiện tại" : "Sẵn sàng chấm bài"}</b></div>
            <em>{checked && (aiGrade?.correct || result?.verdict === "perfect") ? "✓" : "◎"}</em>
          </div>
          {!checked ? (
            <div className="translate-ready">
              <p className="translate-empty">Viết câu tiếng Anh rồi bấm <b>Chấm câu này</b>. Hệ thống sẽ kiểm tra kỹ ý nghĩa, ngữ pháp và cách diễn đạt.</p>
              <ul>
                <li><span>1</span>Dịch đúng ý của câu đang được tô sáng</li>
                <li><span>2</span>Dùng từ khóa <b>{current.word.term}</b> nếu phù hợp</li>
                <li><span>3</span>Sửa câu đến khi đạt rồi mới chuyển tiếp</li>
              </ul>
            </div>
          ) : (
            result && (
              <>
                {grading && <p className="translate-empty">◌ Đang chấm bài…</p>}
                {aiGrade && (
                  <section className={aiGrade.correct ? "ai-grade correct" : "ai-grade"}>
                    <div className="ai-grade-head">
                      <div><small>ĐIỂM TỔNG</small><b>{aiGrade.correct ? "✓ Truyền đạt đúng ý" : "Cần sửa trước khi tiếp tục"}</b></div>
                      <strong>{aiGrade.score}<small>/100</small></strong>
                    </div>
                    <div className="ai-criteria" aria-label="Điểm theo bốn tiêu chí">
                      {([['meaning', 'Đúng nghĩa'], ['grammar', 'Ngữ pháp'], ['vocabulary', 'Từ vựng'], ['naturalness', 'Tự nhiên']] as [GradeCriterion, string][]).map(([key, label]) => (
                        <div key={key}><span>{label}</span><b>{aiGrade.criteria?.[key] ?? 0}</b></div>
                      ))}
                    </div>
                    {aiGrade.comment && <div className="ai-feedback-block"><h4>Nhận xét chung</h4><p>{aiGrade.comment}</p></div>}
                    {aiGrade.good && <div className="ai-feedback-block is-good"><h4>✓ Bạn đã làm tốt</h4><p>{aiGrade.good}</p></div>}
                    {aiGrade.errors?.length > 0 && (
                      <div className="ai-feedback-block is-error">
                        <h4>Lỗi cần sửa <span>{aiGrade.errors.length}/3</span></h4>
                        <ol className="ai-feedback-list">
                          {aiGrade.errors.map((issue, position) => (
                            <li key={position}>
                              <div><em>LỖI</em><span>{issue.type.replaceAll('_', ' ')}</span></div>
                              {issue.wrong && issue.right && <p className="ai-correction"><b>{issue.wrong}</b><span>→</span><strong>{issue.right}</strong></p>}
                              <p>{issue.why}</p>
                              {issue.rule && <small><b>Quy tắc:</b> {issue.rule}</small>}
                              {issue.example && <small><b>Ví dụ:</b> <EnglishText text={issue.example} /></small>}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {aiGrade.improvements?.length > 0 && (
                      <div className="ai-feedback-block is-improvement">
                        <h4>Gợi ý diễn đạt hay hơn</h4>
                        {aiGrade.improvements.map((issue, position) => (
                          <p key={position}><em>GỢI Ý</em> {issue.wrong && issue.right ? <><b>{issue.wrong}</b> → <strong>{issue.right}</strong> · </> : null}{issue.why}</p>
                        ))}
                      </div>
                    )}
                    {aiGrade.errors?.[0] && <div className="ai-priority"><span>Ưu tiên cần nhớ</span><b>{aiGrade.errors[0].rule || aiGrade.errors[0].why}</b></div>}
                    {aiGrade.suggestion && <div className="ai-feedback-block"><h4>Câu gợi ý</h4><p className="ai-grade-suggestion"><EnglishText text={aiGrade.suggestion} /></p></div>}
                    {aiGrade.alternatives?.length > 0 && <div className="ai-feedback-block"><h4>Cách nói tự nhiên khác</h4><ul>{aiGrade.alternatives.map((text, position) => <li key={position}><EnglishText text={text} /></li>)}</ul></div>}
                    {aiGrade.chunks?.length > 0 && <div className="ai-feedback-block"><h4>Cụm nên học</h4><div className="ai-chunks">{aiGrade.chunks.slice(0, 3).map((chunk, position) => <span key={position}><b>{chunk.text}</b><small>{chunk.meaning}</small></span>)}</div></div>}
                    {aiGrade.errors?.some((issue) => issue.wrong && issue.right) && <div className="ai-feedback-block"><h4>Đối chiếu từ/cụm từ</h4><div className="ai-word-comparison">{aiGrade.errors.filter((issue) => issue.wrong && issue.right).map((issue, position) => <span key={position}><del>{issue.wrong}</del><b>→ {issue.right}</b></span>)}</div></div>}
                    {aiGrade.errors?.length > 0 && <div className="ai-error-tags" aria-label="Nhãn lỗi">{[...new Set(aiGrade.errors.map((issue) => issue.type))].map((type) => <span key={type}>#{type}</span>)}</div>}
                  </section>
                )}
                {/* Phần đối chiếu luôn hiện đầy đủ sau khi chấm để người học xem ngay.
                    Câu mẫu vẫn được ghi rõ là một cách tham khảo, tránh biến khác biệt
                    cách diễn đạt thành lỗi khi mô hình đã chấm câu là đúng. */}
                {aiGrade ? (
                  <section className="reference-fold">
                    <h3>Đối chiếu từng từ với một cách dịch mẫu</h3>
                    <p className="translate-diff">
                      {result.operations.map((item, position) => (
                        <span key={position} className={item.type}>
                          {item.type === "extra" ? item.answer : item.reference}
                        </span>
                      ))}
                    </p>
                    <p className="translate-reference"><b>Một cách dịch:</b> <EnglishText text={current.en} /></p>
                    <p className="translate-caveat">Đây chỉ là một cách dịch để bạn tham khảo. Câu của bạn khác nó không có nghĩa là sai — phần chấm ở trên mới là kết luận.</p>
                  </section>
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
                {!aiGrade && <p className="translate-caveat">Chưa kết nối được AI nên lượt này chỉ so với câu mẫu; một cách dịch đúng khác vẫn có thể bị báo là lệch.</p>}
              </>
            )
          )}

          <section className="translation-achievements">
            <h3>Tiến độ buổi học</h3>
            <div>
              <article><strong>{scores.length}</strong><span>Câu đã hoàn thành</span></article>
              <article><strong>{scores.filter((score) => score >= 90).length}</strong><span>Câu đạt từ 90%</span></article>
              <article><strong>{hintCount}</strong><span>Gợi ý câu hiện tại</span></article>
            </div>
          </section>
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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onSwipe) return;
    startX.current = event.clientX;
    moved.current = false;
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onSwipe || startX.current === null) return;
    const offset = event.clientX - startX.current;
    // 12px là mức xê dịch quen thuộc của một cú bấm hơi rung tay; quá mức đó mới coi là kéo.
    // Chỉ "bắt" con trỏ khi ĐÃ kéo thật — nếu bắt ngay từ pointerdown thì cú bấm
    // vào một chữ trong câu ví dụ bị nuốt mất, không tra được từ.
    if (Math.abs(offset) > 12) {
      moved.current = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* con trỏ đã nhả */ }
      }
    }
    if (moved.current) setDrag(offset);
  }
  function onPointerUp() {
    if (!onSwipe || startX.current === null) return;
    startX.current = null;
    if (Math.abs(drag) > SWIPE_THRESHOLD) onSwipe(drag > 0);
    setDrag(0);
  }

  return (
    // div role=button chứ không phải <button>: câu ví dụ bên trong có các chữ bấm
    // được để tra nghĩa / nghe phát âm, mà <button> thì không được lồng phần tử
    // tương tác khác.
    <div
      className={`quizlet-flashcard ${flipped ? "is-flipped" : ""} ${drag ? "is-dragging" : ""} ${decided ? `swipe-${decided}` : ""}`}
      role="button"
      tabIndex={0}
      aria-label={flipped ? `Nghĩa: ${card.meaning}. Nhấn để lật lại.` : `Từ: ${card.term}. Nhấn để lật thẻ.`}
      // Kéo xong thì đừng lật thẻ, nếu không mỗi lần phân loại sẽ lật oan một cái.
      onClick={() => {
        if (!moved.current) flip();
        moved.current = false;
      }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); flip(); } }}
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
        <em className="flash-example"><EnglishText text={card.example} /></em>
        <i>Di chuột / bấm vào từ để tra nghĩa và nghe phát âm</i>
      </span>
      <span className="flash-back">
        <small>TIẾNG VIỆT</small>
        <b>{card.meaning}</b>
        <em>{card.exampleVi || "(chưa có bản dịch câu ví dụ)"}</em>
        <i>Nhấn để lật lại</i>
      </span>
    </div>
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

function LearnMode({ words, setMode, onResult }: { words: WordCard[]; setMode: (m: PracticeMode) => void; onResult: (id: string, rating: Rating) => void }) {
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
    onResult(current.id, correct ? "good" : "again");
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
            {askViToEn && <p className="learn-cloze"><EnglishText text={current.cloze} /></p>}
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
              {!feedback.correct && <small className="learn-hint"> · <EnglishText text={current.example} /></small>}
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

function TestMode({ words, setMode, onResult }: { words: WordCard[]; setMode: (m: PracticeMode) => void; onResult: (id: string, rating: Rating) => void }) {
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
      <BackButton destination="thiết lập bài kiểm tra" onClick={() => setStarted(false)} />
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
                  Đáp án: <b>{question.kind === "tf" ? (question.shown?.id === question.word.id ? "Đúng" : "Sai") : answerText(question.word)}</b> · <EnglishText text={question.word.example} />
                </p>
              )}
            </div>
          );
        })}
      </div>
      {!submitted && (
        <button className="primary test-submit" disabled={answered < questions.length} onClick={() => {
          questions.forEach((question, position) => onResult(question.word.id, isCorrect(question, answers[position]) ? "good" : "again"));
          setSubmitted(true);
        }}>
          {answered < questions.length ? `Còn ${questions.length - answered} câu chưa làm` : "Nộp bài"}
        </button>
      )}
    </div>
  );
}


function MatchGame({ words, close, onResult }: { words: WordCard[]; close: () => void; onResult: (id: string, rating: Rating) => void }) {
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
      onResult(tile.id, "good");
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
      <BackButton destination="Từ vựng" onClick={close} />
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

const PERIODS = [
  { key: 7, label: "7 ngày qua" },
  { key: 30, label: "30 ngày qua" },
  { key: 365, label: "365 ngày qua" },
] as const;

/**
 * Việc của HÔM NAY, tính thuần từ kho từ.
 *
 * Dùng chung cho Trang chủ và Tiến độ. Trước đây mỗi màn tự tính lại, nên hai
 * nơi hoàn toàn có thể nói hai con số khác nhau về cùng một ngày.
 */
function todayPlan(words: WordCard[]) {
  const personal = words.filter((word) => !isPdfVocabulary(word));
  const onlyPdf = !personal.length && words.length > 0;
  const dueAgain = words.filter(isDueAgain);
  const today = localDateString();
  const queue = onlyPdf
    ? buildCollectionQueue(words.filter(isPdfVocabulary)).slice(0, PDF_DAILY_PREVIEW_LIMIT)
    : buildTodayQueue(personal);
  const newCount = queue.filter((word) => wordState(word).key === "new").length;
  const dueGroups = [...dueAgain.reduce(
    (map, word) => map.set(groupLabelOf(word), (map.get(groupLabelOf(word)) ?? 0) + 1),
    new Map<string, number>(),
  )].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return {
    onlyPdf,
    newCount,
    reviewCount: queue.length - newCount,
    dueAgain,
    overdue: dueAgain.filter((word) => word.dueDate && word.dueDate < today).length,
    dueGroups,
  };
}

function Stats({ words, scopeLabel, streak }: { words: WordCard[]; scopeLabel: string; streak: { current: number; best: number } }) {
  // Dùng chung cách đếm với màn Luyện từ vựng, để hai chỗ không nói hai kiểu.
  const personal = words.filter((word) => !isPdfVocabulary(word));
  const pdfCount = words.length - personal.length;
  const masteredWords = words.filter((word) => wordState(word).key === "mastered");
  const learningWords = words.filter((word) => wordState(word).key !== "mastered");
  const reviewedWords = words.filter((word) => (word.reviewCount ?? 0) > 0).sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
  const reviewedAllTime = words.reduce((total, word) => total + (word.reviewCount ?? 0), 0);
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
  // Lỗi lặp nhiều nhất theo hai quãng, để thấy được mình đang đỡ dần hay nặng thêm.
  const recurring = useMemo(() => {
    const rank = (list: TranslationAttempt[]) => {
      const counts = new Map<string, number>();
      for (const entry of list) for (const type of entry.errorTypes ?? []) counts.set(type, (counts.get(type) ?? 0) + 1);
      return counts;
    };
    const week = rank(attemptsSince(attempts, 7) as TranslationAttempt[]);
    const month = rank(attemptsSince(attempts, 30) as TranslationAttempt[]);
    // Trạng thái xét trên TOÀN BỘ nhật ký: cắt theo quãng thì số ngày sạch bị mất.
    return (errorStats(attempts) as { type: string; label: string; occurrenceCount: number; status: string }[])
      .map((row) => ({ ...row, week: week.get(row.type) ?? 0, month: month.get(row.type) ?? 0 }))
      .filter((row) => row.month > 0)
      .sort((a, b) => b.month - a.month || b.week - a.week)
      .slice(0, 5);
  }, [attempts]);
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
  const [errorPractice, setErrorPractice] = useState<{ type: string; label: string } | null>(null);
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
      <h1>Tiến độ</h1>
      <p className="page-sub">Tổng quan được tính trực tiếp trên {scopeLabel.toLowerCase()}.</p>

      <h2 className="screen-group">Bạn đang ở đâu</h2>
      <div className="stats-grid progress-library-stats">
        <Stat label="Tổng số từ" value={String(words.length)} note={pdfCount ? `${personal.length} từ của bạn · ${pdfCount} từ bộ PDF` : "Trong thư viện của bạn"} icon="▤" tone="purple"
          onOpen={() => setStatList({ title: "Tổng số từ", note: "TOÀN BỘ THƯ VIỆN", words })} />
        <Stat label="Đang học" value={String(learningWords.length)} note="Chưa lên hộp 6" icon="◔" tone="orange"
          onOpen={() => setStatList({ title: "Đang học", note: "CHƯA LÊN HỘP 6", words: learningWords })} />
        <Stat label="Đã thuộc" value={String(masteredWords.length)} note="Đã lên hộp 6" icon="✓" tone="green"
          onOpen={() => setStatList({ title: "Đã thuộc", note: "ĐÃ LÊN HỘP 6", words: masteredWords })} />
        <Stat label="Lượt đã ôn" value={String(reviewedAllTime)} note="Toàn bộ thư viện" icon="♨" tone="pink"
          onOpen={() => setStatList({ title: "Từ đã được ôn", note: "XẾP THEO SỐ LƯỢT ÔN", words: reviewedWords })} />
      </div>
      <WeeklyTracker words={words} />

      <h2 className="screen-group">Bạn đã học thế nào</h2>
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
      <h2 className="screen-group">Cần chú ý</h2>
      <div className="dashboard-grid">
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
            {recurring.length > 0 && (
              <div className="recurring">
                <div className="recurring-head">
                  <b>Lỗi lặp nhiều nhất</b>
                  <span>7 ngày · 30 ngày</span>
                </div>
                {recurring.map((row) => (
                  <div key={row.type} className={`recurring-row is-${row.status}`}>
                    <b>{row.label}</b>
                    <em>{MASTERY_LABELS[row.status as keyof typeof MASTERY_LABELS]}</em>
                    <span>{row.week}</span>
                    <span>{row.month}</span>
                    <button type="button" onClick={() => setErrorPractice({ type: row.type, label: row.label })}>Luyện lỗi này →</button>
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
      {errorPractice && (
        <ErrorPractice
          error={errorPractice}
          detail={practiceForError(attempts, errorPractice.type)}
          close={() => setErrorPractice(null)}
          onLogged={(entry) => setAttempts((current) => [...current, entry] as TranslationAttempt[])}
        />
      )}
      {statList && <WordListModal title={statList.title} note={statList.note} words={statList.words} close={() => setStatList(null)} />}
    </div>
  );
}

function ErrorPractice({ error, detail, close, onLogged }: {
  error: { type: string; label: string };
  detail: { wrong?: string; right?: string; why?: string; rule?: string; example?: string; vietnamese?: string; reference?: string } | null;
  close: () => void;
  onLogged: (entry: unknown) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(false);
  const expected = detail?.right || detail?.reference || "";
  const normal = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
  const correct = Boolean(expected && normal(answer) === normal(expected));

  function submit() {
    if (!answer.trim() || !expected) return;
    setChecked(true);
    const entry = makeAttempt({
      term: error.label,
      vietnamese: detail?.vietnamese || `Viết lại câu để sửa lỗi ${error.label.toLowerCase()}.`,
      answer,
      reference: expected,
      score: correct ? 100 : 45,
      correct,
      gradedBy: "reference",
      errorTypes: correct ? [] : [error.type],
      assessedTypes: [error.type],
      practiceType: error.type,
      issues: correct ? [] : [{ type: error.type, wrong: answer, right: expected, why: detail?.why, rule: detail?.rule, example: detail?.example }],
    });
    logAttempt(entry);
    markStudiedToday();
    onLogged(entry);
  }

  return (
    <div className="modal-backdrop error-practice-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="modal error-practice-modal" role="dialog" aria-modal="true" aria-labelledby="error-practice-title">
        <div className="modal-head">
          <div><span className="eyebrow">ERROR PRACTICE · {error.label.toUpperCase()}</span><h2 id="error-practice-title">Sửa lại lỗi bạn hay mắc</h2></div>
          <button type="button" onClick={close} aria-label="Đóng">×</button>
        </div>
        {!detail ? (
          <p className="period-empty">Nhật ký cũ chỉ có nhãn lỗi, chưa có câu sửa chi tiết. Hãy làm thêm một bài Dịch Việt → Anh để Lexilo tạo bài luyện cho lỗi này.</p>
        ) : (
          <>
            {detail.vietnamese && <div className="error-practice-source"><small>CÂU CẦN DIỄN ĐẠT</small><p>{detail.vietnamese}</p></div>}
            {detail.wrong && <div className="error-practice-wrong"><small>CÂU TRƯỚC CỦA BẠN</small><del>{detail.wrong}</del></div>}
            <label>Viết lại câu đúng
              <textarea
                ref={(node) => node?.focus()}
                value={answer}
                onChange={(event) => { setAnswer(event.target.value); setChecked(false); }}
                placeholder="Nhập câu đã sửa…"
              />
            </label>
            {checked && (
              <div className={correct ? "error-practice-result correct" : "error-practice-result"}>
                <b>{correct ? "✓ Chính xác — một lượt sạch đã được ghi" : "Chưa khớp, hãy sửa rồi thử lại"}</b>
                {!correct && <p><span>Đáp án cần đạt:</span> <EnglishText text={expected} /></p>}
                {detail.why && <p>{detail.why}</p>}
                {detail.rule && <p><b>Quy tắc:</b> {detail.rule}</p>}
                {detail.example && <p><b>Ví dụ:</b> <EnglishText text={detail.example} /></p>}
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" onClick={close}>Đóng</button>
          {detail && <button type="button" className="primary" disabled={!answer.trim()} onClick={submit}>{checked ? "Chấm lại" : "Kiểm tra"}</button>}
        </div>
      </section>
    </div>
  );
}

function BulkAddWords({ close, save, existingWords, legacyCollections }: { close: () => void; save: (items: Omit<WordCard, "id" | "box" | "lapses">[]) => void; existingWords: WordCard[]; legacyCollections: boolean }) {
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
  useEffect(() => {
    const saved = localStorage.getItem(exampleLayoutModeKey);
    if (saved === "passage" || saved === "sentences") setExampleMode(saved);
  }, []);
  function chooseExampleMode(mode: "passage" | "sentences") {
    setExampleMode(mode);
    localStorage.setItem(exampleLayoutModeKey, mode);
  }
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
        studyDay: legacyCollections ? studyDay : undefined,
      };
    }));
  }
  return (
    <div className="full-screen-form">
      <form className="modal bulk-add-modal form-screen" onSubmit={submit}>
        <BackButton destination="danh sách từ" onClick={close} />
        <div className="form-screen-head">
          <span className="eyebrow">THÊM TỪ</span>
          <h1>Dán danh sách từ</h1>
          <p>Mỗi dòng một từ. App tự tách nghĩa và bỏ qua từ đã có trong danh sách.</p>
        </div>
        <p className="bulk-help">Mỗi dòng là một từ hoặc cụm từ. Có thể giữ nguyên dấu “/”, ví dụ: <b>shopping cart / trolley</b>.</p>
        <label>Danh sách của bạn<textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder={"grocery shopping\nshopping cart / trolley\nbuggy\ndepartment/section\naisle"} /></label>
        {legacyCollections && <label>Folder ngày học<select value={studyDay} onChange={(event) => setStudyDay(Number(event.target.value))}>{dayNames.map((name, index) => <option value={index} key={name}>{name}</option>)}</select></label>}
        {!!valid.length && (
          <section className="bulk-examples">
            <b>Ví dụ tiếng Việt cho các từ này</b>
            <div className="bulk-example-modes" role="group" aria-label="Kiểu ví dụ">
              <button type="button" className={exampleMode === "sentences" ? "active" : ""} onClick={() => chooseExampleMode("sentences")}>
                Từng câu riêng<small>Mỗi từ một câu độc lập</small>
              </button>
              <button type="button" className={exampleMode === "passage" ? "active" : ""} onClick={() => chooseExampleMode("passage")}>
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
        <div className="modal-actions"><button type="button" onClick={close}>Hủy</button><button className="primary" type="submit" disabled={!valid.length}>Thêm {valid.length || ""} từ{legacyCollections ? ` vào ${dayNames[studyDay]}` : " vào Từ của tôi"}</button></div>
      </form>
    </div>
  );
}

function AddWord({ close, save, existingWords, legacyCollections, folders, updateFolders, backDestination }: { close: () => void; save: (w: Omit<WordCard, "id" | "box" | "lapses">, folderIds: string[]) => void; existingWords: WordCard[]; legacyCollections: boolean; folders: FolderStore; updateFolders: (next: FolderStore) => void; backDestination?: string }) {
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const [example, setExample] = useState("");
  const [exampleVi, setExampleVi] = useState("");
  const [topic, setTopic] = useState("Từ vựng chung");
  const [ipa, setIpa] = useState("");
  const [partOfSpeech, setPartOfSpeech] = useState("");
  const [lexicalType, setLexicalType] = useState<LexicalType>("word");
  const [lexicalTypeChosen, setLexicalTypeChosen] = useState(false);
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
  const [folderIds, setFolderIds] = useState<string[]>([]);
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
    if (!lexicalTypeChosen) setLexicalType(inferLexicalType(word, partOfSpeech) as LexicalType);
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
      if (!lexicalTypeChosen) setLexicalType(inferLexicalType(word, data.part_of_speech || "") as LexicalType);
      setMeaning((current) => current.trim() || data.meaning_vi || "");
      setSenses(data.senses || []);
      // Kết quả đầu tiên chỉ là gợi ý tự động của từ điển. Chỉ đánh dấu một
      // nghĩa là "đã chọn" khi chính người dùng bấm vào nghĩa đó.
      setChosenSense(sense === undefined ? undefined : data.sense);
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
    // Nghĩa, cụm từ và các gợi ý AI đều là nội dung bổ trợ. Người dùng có thể
    // lưu ngay từ họ tự nhập rồi bổ sung thông tin vào lần sau.
    lookupRequest.current++;
    setLoading(false);
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
      lexicalType,
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
      studyDay: legacyCollections ? studyDay : undefined,
      status: "new",
      reviewCount: 0,
    }, folderIds);
  }
  return (
    <div className="full-screen-form" role="dialog" aria-modal="true" aria-label="Thêm từ mới">
      <form className="modal form-screen" onSubmit={submit}>
        <BackButton destination={backDestination || "màn trước"} onClick={close} />
        <div className="form-screen-head">
          <span className="eyebrow">THÊM TỪ</span>
          <h1>Từ mới của bạn</h1>
          <p>Chỉ cần nhập từ là có thể lưu. Tra tự động và các lựa chọn bên dưới đều là gợi ý không bắt buộc.</p>
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
              if (!lexicalTypeChosen) setLexicalType(inferLexicalType(e.target.value, partOfSpeech) as LexicalType);
              setSenses([]);
              setChosenSense(undefined);
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
            <div className="term-suggest">
              <div className="term-suggest-head"><b>Gợi ý từ</b><small>Không bắt buộc</small></div>
              <div role="listbox">
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
              <button className="term-suggest-skip" type="button" onClick={() => setPickedSuggestion(true)}>
                Giữ “{term.trim()}” và tiếp tục nhập →
              </button>
            </div>
          )}
        </label>
        {duplicate && <p className="duplicate-warning">⚠ Từ “{duplicate.term}” đã được thêm trước đó{duplicate.addedDate ? ` vào ngày ${duplicate.addedDate}` : ""}{duplicate.topic ? ` · Chủ đề: ${duplicate.topic}` : ""}.</p>}
        <fieldset className="lexical-type-picker">
          <legend>Đây là loại đơn vị nào?</legend>
          <p>Chọn đúng loại để ví dụ, lịch ôn và bài luyện dùng đúng ngữ cảnh.</p>
          <div>
            {(lexicalTypeOptions as { value: LexicalType; label: string; hint: string }[]).map((item) => (
              <button
                type="button"
                key={item.value}
                className={lexicalType === item.value ? "active" : ""}
                aria-pressed={lexicalType === item.value}
                onClick={() => { setLexicalType(item.value); setLexicalTypeChosen(true); }}
              >
                <b>{item.label}</b><small>{item.hint}</small>
              </button>
            ))}
          </div>
        </fieldset>
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
        <section className="add-word-block">
          <header className="add-word-block-head">
            <b>Thông tin cơ bản</b>
            <span>Kiểm tra nghĩa chính trước khi lưu</span>
          </header>
          <div className="form-grid add-word-basics">
          <label className="field-wide">
            Nghĩa tiếng Việt
            <input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder="Tự động điền nghĩa..." />
          </label>
          {legacyCollections && <label>
            Ngày học
            <select value={studyDay} onChange={(e) => setStudyDay(Number(e.target.value))}>
              {dayNames.map((name, index) => (
                <option value={index} key={name}>
                  {String(index + 1).padStart(2, "0")} {name}
                  {index === weekdayIndex() ? " (hôm nay)" : ""}
                </option>
              ))}
            </select>
          </label>}
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
          {senses.length > 1 && (
            // Một từ có thể mang nhiều nghĩa xa nhau. Thu gọn mặc định để kết quả
            // tra không làm cả biểu mẫu nhảy xuống hàng trăm pixel.
            <details className="sense-picker">
              <summary>
                <span><b>Gợi ý {senses.length} nghĩa từ từ điển</b><small>Không bắt buộc chọn — bạn có thể nhập nghĩa riêng ở ô trên.</small></span>
                <em>Mở để đổi nghĩa</em>
              </summary>
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
            </details>
          )}
        </section>
        {!legacyCollections && <WordListPicker
          folders={folders}
          updateFolders={updateFolders}
          selectedFolderIds={folderIds}
          onSelectedFolderIdsChange={setFolderIds}
          compact
        />}
        <section className="add-word-block">
          <header className="add-word-block-head"><b>Cách dùng</b><span>Định nghĩa và cụm từ đi cùng</span></header>
          <label>
            Định nghĩa Anh–Anh
            <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder="English definition" />
          </label>
          <div className="form-grid collocation-fields">
            <label>
              Cụm nên học <small>(không bắt buộc)</small>
              <input value={collocation} onChange={(e) => setCollocation(e.target.value)} placeholder="Ví dụ: pull out weeds" />
            </label>
            <label>
              Nghĩa của cụm <small>(không bắt buộc)</small>
              <input value={collocationVi} onChange={(e) => setCollocationVi(e.target.value)} placeholder="Ví dụ: nhổ cỏ dại" />
            </label>
          </div>
        </section>
        <section className="ielts-word-family">
          <b>Mở rộng từ vựng IELTS</b>
          <div className="form-grid">
            <label>Từ đồng nghĩa<input value={synonyms} onChange={(e) => updateUsageList(e.target.value, setSynonyms, setSynonymDetails)} placeholder="Các từ cách nhau bằng dấu phẩy" /></label>
            <label>Từ trái nghĩa<input value={antonyms} onChange={(e) => updateUsageList(e.target.value, setAntonyms, setAntonymDetails)} placeholder="Các từ cách nhau bằng dấu phẩy" /></label>
          </div>
          {(synonymDetails.length > 0 || antonymDetails.length > 0) && (
            <div className="add-usage-details">
              <p>Gợi ý sử dụng — các nội dung dưới đây sẽ được lưu cùng thẻ từ.</p>
              {usagePreview("Ngữ cảnh từ đồng nghĩa", synonymDetails)}
              {usagePreview("Ngữ cảnh từ trái nghĩa", antonymDetails)}
            </div>
          )}
          <label>Cách paraphrase<textarea value={paraphrases} onChange={(e) => setParaphrases(e.target.value)} placeholder="Các cách diễn đạt cách nhau bằng dấu chấm phẩy" /></label>
          <label>Chủ đề IELTS có thể áp dụng<input value={ieltsTopics} onChange={(e) => setIeltsTopics(e.target.value)} placeholder="Environment, Education, Technology…" /></label>
        </section>
        <section className="add-word-block">
          <header className="add-word-block-head"><b>Câu ví dụ</b><span>Ngữ cảnh giúp nhớ và dùng đúng từ</span></header>
          <label>
            Câu tiếng Anh
            <textarea value={example} onChange={(e) => setExample(e.target.value)} placeholder="Một câu trong ngữ cảnh tự nhiên" />
          </label>
          <label>
            Nghĩa tiếng Việt
            <textarea value={exampleVi} onChange={(e) => setExampleVi(e.target.value)} placeholder="Bản dịch tiếng Việt của câu ví dụ" />
          </label>
        </section>
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Hủy
          </button>
          <button className="primary" type="submit" disabled={!!duplicate || !term.trim()} title={duplicate ? "Từ này đã tồn tại trong kho của bạn" : !term.trim() ? "Nhập một từ hoặc cụm từ trước khi lưu" : "Lưu từ bạn đã nhập; các gợi ý không bắt buộc"}>
            Lưu từ mới
          </button>
        </div>
      </form>
    </div>
  );
}
