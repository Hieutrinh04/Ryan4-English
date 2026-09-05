"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon, { type IconName } from "./Icon";
import BackButton from "./BackButton";
import TaskChart, { type Chart } from "./TaskChart";
import { aiFetch } from "../lib/supabase";
import { CRITERIA, EXAMS, countWords, makeAttempt, readAttempts, saveAttempt, summarise } from "../lib/writing.mjs";
import { TASKS, TASK_MINUTES, filterTasks, groupByPart, minWordsOf } from "../lib/writing-tasks.mjs";
import { gradeTranslation } from "../lib/translation-check.mjs";
import { PARAGRAPHS, type ParagraphTask } from "./writingParagraphs";

// Luyện viết theo dạng đề thi.
//
// Ba màn: chọn đề → viết → xem điểm. Điểm là ƯỚC LƯỢNG do mô hình ngôn ngữ chấm;
// mọi chỗ hiện điểm đều phải nói rõ như vậy, vì một con số trông giống điểm thi
// thật sẽ khiến người học tưởng mình đã sẵn sàng đi thi.

type Task = {
  id: string;
  exam: string;
  part: number;
  kind: string;
  title: string;
  prompt: string;
  chart?: Chart;
};

type Criterion = { key: string; label: string; hint: string };
type Fix = { wrong: string; right: string; why: string };
type Result = {
  scores: Record<string, number>;
  band: number;
  words: number;
  comment: string;
  strengths: string[];
  improvements: string[];
  fixes: Fix[];
};
type Attempt = { at: string; taskTitle: string; band: number; part: number; words: number };

const PARTS = [
  { value: 0, label: "Tất cả" },
  { value: 1, label: "Task 1" },
  { value: 2, label: "Task 2" },
];

type ParagraphProgress = Record<string, { completed: number; best: number; updatedAt: string }>;
type TranslationIssue = { type?: string; wrong?: string; right?: string; why?: string };
type ParagraphAiGrade = { correct: boolean; score: number; suggestion: string; comment: string; issues: TranslationIssue[]; criteria?: Record<string, number> };
type ParagraphRewriteReview = { score: number; comment: string; issues: TranslationIssue[]; notes: { kind: string; text: string }[] };
const PARAGRAPH_PROGRESS_KEY = "lexilo-writing-paragraph-progress-v1";
const PARAGRAPH_SESSION_KEY = "lexilo-writing-paragraph-session-v1";
const WRITING_DRAFT_KEY = "lexilo-writing-exam-draft-v1";
const WRITING_FAVORITES_KEY = "lexilo-writing-favorites-v1";

function formatAcceptedTranslation(value: string) {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "";
  // Giữ cách diễn đạt của người học, chỉ chuẩn hóa hình thức hiển thị để các câu
  // tiếng Anh đã hoàn thành đọc như một đoạn văn thật sự.
  const capitalized = compact.replace(/^(["'“‘([]*)([a-z])/, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
  return /[.!?]["'”’)]?$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function hideRewriteAnswers(issues: TranslationIssue[]) {
  return issues.map((issue) => {
    const answer = issue.right?.trim();
    const why = answer && issue.why
      ? issue.why.replace(new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "cách diễn đạt phù hợp")
      : issue.why;
    return { ...issue, right: undefined, why };
  });
}

const THUMBNAILS: Record<string, { icon: IconName; label: string; className: string }> = {
  "Nhật ký": { icon: "pen", label: "MY DAY", className: "diary" },
  Email: { icon: "heart", label: "HELLO!", className: "email" },
  Truyện: { icon: "book", label: "STORY", className: "story" },
  "Bài luận": { icon: "briefcase", label: "IDEAS", className: "essay" },
  "Báo cáo": { icon: "chart", label: "REPORT", className: "report" },
  "Bài báo": { icon: "sparkles", label: "FOCUS", className: "article" },
};

export default function WritingPractice({ onStudied, openTranslate }: { onStudied?: () => void; openTranslate?: () => void }) {
  const [route, setRoute] = useState<"home" | "paragraphs" | "exams">("home");
  const [paragraphLevel, setParagraphLevel] = useState("Tất cả");
  const [paragraphKind, setParagraphKind] = useState("Tất cả");
  const [paragraphTask, setParagraphTask] = useState<ParagraphTask | null>(null);
  const [paragraphIndex, setParagraphIndex] = useState(0);
  const [paragraphAnswer, setParagraphAnswer] = useState("");
  const [paragraphChecked, setParagraphChecked] = useState(false);
  const [paragraphScores, setParagraphScores] = useState<number[]>([]);
  const [paragraphComplete, setParagraphComplete] = useState(false);
  const [paragraphGrading, setParagraphGrading] = useState(false);
  const [paragraphGradeError, setParagraphGradeError] = useState("");
  const [paragraphAiGrade, setParagraphAiGrade] = useState<ParagraphAiGrade | null>(null);
  const [paragraphDictionaryOpen, setParagraphDictionaryOpen] = useState(false);
  const [paragraphDictionaryQuery, setParagraphDictionaryQuery] = useState("");
  const [paragraphAcceptedAnswers, setParagraphAcceptedAnswers] = useState<string[]>([]);
  const [paragraphRewriteReview, setParagraphRewriteReview] = useState<ParagraphRewriteReview | null>(null);
  const [paragraphSessionReady, setParagraphSessionReady] = useState(false);
  const paragraphGradeRequest = useRef(0);
  const [paragraphProgress, setParagraphProgress] = useState<ParagraphProgress>({});
  const [paragraphQuery, setParagraphQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [exam, setExam] = useState("ielts");
  const [part, setPart] = useState(0);
  const [task, setTask] = useState<Task | null>(null);
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setAttempts(readAttempts());
    try {
      setParagraphProgress(JSON.parse(localStorage.getItem(PARAGRAPH_PROGRESS_KEY) || "{}") as ParagraphProgress);
      setFavorites(JSON.parse(localStorage.getItem(WRITING_FAVORITES_KEY) || "[]") as string[]);
      const savedSession = JSON.parse(localStorage.getItem(PARAGRAPH_SESSION_KEY) || "null") as null | {
        taskId?: string; index?: number; answer?: string; checked?: boolean; scores?: number[];
        complete?: boolean; aiGrade?: ParagraphAiGrade | null; gradeError?: string;
        acceptedAnswers?: string[]; rewriteReview?: ParagraphRewriteReview | null;
      };
      const savedTask = PARAGRAPHS.find((item) => item.id === savedSession?.taskId);
      if (savedTask && savedSession) {
        const safeIndex = Math.max(0, Math.min(savedTask.sentences.length - 1, Number(savedSession.index) || 0));
        setRoute("paragraphs");
        setParagraphTask(savedTask);
        setParagraphIndex(safeIndex);
        setParagraphAnswer(savedSession.answer || "");
        setParagraphAiGrade(savedSession.aiGrade || null);
        setParagraphChecked(Boolean(savedSession.checked && savedSession.aiGrade));
        setParagraphScores(Array.isArray(savedSession.scores) ? savedSession.scores : []);
        setParagraphComplete(Boolean(savedSession.complete));
        setParagraphGradeError(savedSession.gradeError || "");
        setParagraphAcceptedAnswers(Array.isArray(savedSession.acceptedAnswers) ? savedSession.acceptedAnswers : []);
        setParagraphRewriteReview(savedSession.rewriteReview || null);
      }
    } catch { /* dữ liệu cũ hỏng thì bắt đầu lại */ }
    setParagraphSessionReady(true);
  }, []);

  useEffect(() => {
    if (!paragraphSessionReady) return;
    if (!paragraphTask) {
      localStorage.removeItem(PARAGRAPH_SESSION_KEY);
      return;
    }
    localStorage.setItem(PARAGRAPH_SESSION_KEY, JSON.stringify({
      taskId: paragraphTask.id,
      index: paragraphIndex,
      answer: paragraphAnswer,
      checked: paragraphChecked && !paragraphGrading,
      scores: paragraphScores,
      complete: paragraphComplete,
      aiGrade: paragraphAiGrade,
      gradeError: paragraphGradeError,
      acceptedAnswers: paragraphAcceptedAnswers,
      rewriteReview: paragraphRewriteReview,
      updatedAt: new Date().toISOString(),
    }));
  }, [paragraphSessionReady, paragraphTask, paragraphIndex, paragraphAnswer, paragraphChecked, paragraphScores, paragraphComplete, paragraphGrading, paragraphAiGrade, paragraphGradeError, paragraphAcceptedAnswers, paragraphRewriteReview]);

  useEffect(() => {
    if (!task || result) return;
    const saved = localStorage.getItem(WRITING_DRAFT_KEY);
    if (!saved) return;
    try {
      const draft = JSON.parse(saved) as { taskId?: string; answer?: string };
      if (draft.taskId === task.id && draft.answer) setAnswer(draft.answer);
    } catch { /* bỏ qua bản nháp không hợp lệ */ }
  }, [task, result]);

  useEffect(() => {
    if (!task || result) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(WRITING_DRAFT_KEY, JSON.stringify({ taskId: task.id, answer, updatedAt: new Date().toISOString() }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [answer, task, result]);

  const groups = useMemo(() => groupByPart(filterTasks(TASKS, { exam, part })) as { part: number; tasks: Task[] }[], [exam, part]);
  const progress = useMemo(() => summarise(attempts), [attempts]);
  const words = countWords(answer) as number;
  const needed = task ? (minWordsOf(task) as number) : 0;

  async function grade() {
    if (!task || grading) return;
    setGrading(true);
    setError("");
    try {
      const response = await aiFetch("/api/ai/writing", {
        method: "POST",
        body: JSON.stringify({ prompt: task.prompt, answer, part: task.part, exam: task.exam }),
      });
      const data = (await response.json()) as Result & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "Không chấm được bài.");
      setResult(data);
      localStorage.removeItem(WRITING_DRAFT_KEY);
      setAttempts(
        saveAttempt(
          makeAttempt({
            taskId: task.id,
            taskTitle: task.title,
            exam: task.exam,
            part: task.part,
            answer,
            scores: data.scores,
            band: data.band,
            comment: data.comment,
          }),
        ),
      );
      onStudied?.();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Không chấm được bài.");
    } finally {
      setGrading(false);
    }
  }

  function backToLibrary() {
    setTask(null);
    setAnswer("");
    setResult(null);
    setError("");
  }

  const paragraphShown = PARAGRAPHS.filter((item) =>
    (paragraphLevel === "Tất cả" || item.level === paragraphLevel) &&
    (paragraphKind === "Tất cả" || item.kind === paragraphKind) &&
    (!favoriteOnly || favorites.includes(item.id)) &&
    (!paragraphQuery.trim() || `${item.title} ${item.topic} ${item.kind}`.toLocaleLowerCase("vi").includes(paragraphQuery.trim().toLocaleLowerCase("vi"))));
  const paragraphSentence = paragraphTask?.sentences[paragraphIndex];
  const paragraphResult = paragraphChecked && paragraphSentence
    ? gradeTranslation(paragraphSentence.en, paragraphAnswer, "") as { accuracy: number; verdict: string; notes: { kind: string; text: string }[] }
    : null;
  // Không dùng độ giống câu mẫu để kết luận đúng/sai. Một ý có thể được dịch đúng
  // bằng nhiều cấu trúc khác nhau; chỉ kết quả chấm ngữ nghĩa mới quyết định.
  const paragraphScore = paragraphAiGrade?.score ?? 0;
  const paragraphPassed = Boolean(paragraphAiGrade && (paragraphAiGrade.correct || paragraphAiGrade.score >= 90));

  function openParagraph(item: ParagraphTask) {
    paragraphGradeRequest.current += 1;
    setParagraphTask(item); setParagraphIndex(0); setParagraphAnswer(""); setParagraphChecked(false); setParagraphScores([]); setParagraphComplete(false); setParagraphAiGrade(null); setParagraphGradeError(""); setParagraphAcceptedAnswers([]); setParagraphRewriteReview(null);
  }

  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    setFavorites(next); localStorage.setItem(WRITING_FAVORITES_KEY, JSON.stringify(next));
  }

  async function checkParagraphSentence() {
    if (!paragraphSentence || !paragraphAnswer.trim()) return;
    setParagraphChecked(true);
    setParagraphAiGrade(null);
    setParagraphRewriteReview(null);
    setParagraphGradeError("");
    await requestParagraphAiGrade();
    onStudied?.();
  }

  async function requestParagraphAiGrade() {
    if (!paragraphSentence || !paragraphAnswer.trim() || paragraphGrading) return;
    const requestId = ++paragraphGradeRequest.current;
    setParagraphGrading(true);
    setParagraphGradeError("");
    try {
      const response = await aiFetch("/api/ai/grade", {
        method: "POST",
        body: JSON.stringify({ vietnamese: paragraphSentence.vi, answer: paragraphAnswer, reference: paragraphSentence.en }),
      });
      const data = (await response.json()) as ParagraphAiGrade & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "AI chưa thể chấm câu này.");
      if (requestId !== paragraphGradeRequest.current) return;
      setParagraphAiGrade(data);
      setParagraphScores((current) => [...current, data.score]);
      if (data.correct || data.score >= 90) setParagraphAcceptedAnswers((current) => { const next = [...current]; next[paragraphIndex] = formatAcceptedTranslation(paragraphAnswer); return next; });
    } catch (problem) {
      if (requestId !== paragraphGradeRequest.current) return;
      // Nói đúng lý do hỏng. Hết lượt trong ngày và mô hình nghẽn là hai chuyện
      // khác nhau — gộp thành một câu thì người học ngồi thử lại một việc vô ích.
      setParagraphGradeError(
        problem instanceof Error && problem.message
          ? problem.message
          : "AI đang bận hoặc đã hết lượt tạm thời. Bạn có thể thử lại sau.",
      );
      setParagraphAiGrade(null);
    } finally {
      if (requestId === paragraphGradeRequest.current) setParagraphGrading(false);
    }
  }

  function retryParagraphSentence() {
    if (paragraphResult) setParagraphRewriteReview({ score: paragraphScore, comment: paragraphAiGrade?.comment || "Câu này chưa đạt 90%. Hãy sửa các điểm bên dưới rồi chấm lại.", issues: hideRewriteAnswers(paragraphAiGrade?.issues || []), notes: [] });
    paragraphGradeRequest.current += 1;
    setParagraphGrading(false);
    setParagraphAnswer("");
    setParagraphChecked(false);
    setParagraphAiGrade(null);
    setParagraphGradeError("");
    setParagraphScores((current) => current.slice(0, -1));
  }

  function changeParagraphAnswer(value: string) {
    if (paragraphChecked && !paragraphPassed) {
      if (paragraphResult) setParagraphRewriteReview({ score: paragraphScore, comment: paragraphAiGrade?.comment || "Câu này chưa đạt 90%. Hãy sửa các điểm bên dưới rồi chấm lại.", issues: hideRewriteAnswers(paragraphAiGrade?.issues || []), notes: [] });
      paragraphGradeRequest.current += 1;
      setParagraphChecked(false);
      setParagraphAiGrade(null);
      setParagraphGradeError("");
      setParagraphGrading(false);
      setParagraphScores((current) => current.slice(0, -1));
    }
    setParagraphAnswer(value);
  }

  function lookUpParagraphWord() {
    const word = paragraphDictionaryQuery.trim().toLowerCase().replace(/[^a-z'-]/g, "");
    if (!word) return;
    window.open(`https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)}`, "_blank", "noopener,noreferrer");
  }

  function nextParagraphSentence() {
    if (!paragraphTask) return;
    paragraphGradeRequest.current += 1;
    setParagraphGrading(false);
    if (paragraphIndex + 1 >= paragraphTask.sentences.length) {
      const average = Math.round(paragraphScores.reduce((sum, score) => sum + score, 0) / Math.max(1, paragraphScores.length));
      const next = { ...paragraphProgress, [paragraphTask.id]: { completed: (paragraphProgress[paragraphTask.id]?.completed ?? 0) + 1, best: Math.max(paragraphProgress[paragraphTask.id]?.best ?? 0, average), updatedAt: new Date().toISOString() } };
      setParagraphProgress(next); localStorage.setItem(PARAGRAPH_PROGRESS_KEY, JSON.stringify(next)); setParagraphComplete(true); return;
    }
    setParagraphIndex((value) => value + 1); setParagraphAnswer(""); setParagraphChecked(false); setParagraphAiGrade(null); setParagraphGradeError(""); setParagraphRewriteReview(null);
  }

  if (paragraphTask && paragraphSentence)
    return (
      <div className="page paragraph-session translate-page">
        <BackButton destination="thư viện đoạn văn" onClick={() => setParagraphTask(null)} />
        <header className="paragraph-session-head translation-session-head">
          <div><span className="eyebrow">LUYỆN VIỆT → ANH · ĐOẠN VĂN</span><h1>{paragraphTask.title}</h1></div>
          <div className="translation-session-stats">
            <span><b>{paragraphIndex + 1}/{paragraphTask.sentences.length}</b> câu</span>
            <span><b>{Math.round(((paragraphIndex + Number(paragraphChecked && paragraphPassed)) / paragraphTask.sentences.length) * 100)}%</b> tiến độ</span>
          </div>
        </header>
        <div className="translation-progress"><i style={{ width: `${((paragraphIndex + Number(paragraphChecked)) / paragraphTask.sentences.length) * 100}%` }} /></div>
        {paragraphComplete ? <section className="panel paragraph-complete">
          <span className="writing-hero-icon"><Icon name="check" size={22} /></span>
          <p className="eyebrow">HOÀN THÀNH BÀI DỊCH</p><h2>{paragraphTask.title}</h2>
          <strong>{Math.round(paragraphScores.reduce((sum, score) => sum + score, 0) / Math.max(1, paragraphScores.length))}%</strong>
          <p>Độ tương đồng trung bình của {paragraphTask.sentences.length} câu. Kết quả này dùng để luyện tập, không phải điểm thi.</p>
          <div><button onClick={() => openParagraph(paragraphTask)}>Làm lại</button><button className="primary" onClick={() => setParagraphTask(null)}>Chọn bài khác →</button></div>
        </section> : <div className="paragraph-session-grid translate-grid">
          <section className="panel paragraph-source translate-source">
            <div className="translate-head">
              <div><span className="eyebrow">ĐOẠN TIẾNG VIỆT</span><small>{paragraphTask.level} · {paragraphTask.kind}</small></div>
              <b>Câu {paragraphIndex + 1} / {paragraphTask.sentences.length}</b>
            </div>
            <p className="paragraph-story translate-paragraph">
              {paragraphTask.sentences.map((line, position) => {
                const accepted = formatAcceptedTranslation(paragraphAcceptedAnswers[position] || "");
                const className = ["paragraph-story-sentence", position === paragraphIndex ? "active" : position < paragraphIndex ? "done" : "", accepted ? "translated" : ""].filter(Boolean).join(" ");
                return <span key={position} className={className} title={accepted ? `Câu tiếng Việt: ${line.vi}` : undefined}>{accepted || line.vi}</span>;
              })}
            </p>
            <div className="translate-input">
              <div className="paragraph-answer-head translate-input-head">
                <label htmlFor="paragraph-answer">Bản dịch tiếng Anh của bạn</label>
                <span>{paragraphAnswer.trim() ? paragraphAnswer.trim().split(/\s+/).length : 0} từ</span>
              </div>
              <textarea
                id="paragraph-answer"
                value={paragraphAnswer}
                onChange={(event) => changeParagraphAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !paragraphChecked && paragraphAnswer.trim() && !paragraphGrading) {
                    event.preventDefault();
                    void checkParagraphSentence();
                  }
                }}
                disabled={paragraphChecked && paragraphPassed}
                placeholder="Viết câu tiếng Anh cho câu đang tô sáng…"
              />
              <div className="paragraph-input-help translate-input-help"><span><kbd>Enter</kbd> chấm câu · <kbd>Shift</kbd> + <kbd>Enter</kbd> xuống dòng</span>{paragraphAnswer && !paragraphChecked ? <button type="button" onClick={() => setParagraphAnswer("")}>Xóa nội dung</button> : null}</div>
            </div>
            <div className="paragraph-actions translate-actions">
              <button onClick={() => setParagraphAnswer(paragraphSentence.en.split(" ").slice(0, 2).join(" "))}>♦ Gợi ý</button>
              {!paragraphChecked ? <button className="primary" disabled={!paragraphAnswer.trim() || paragraphGrading} onClick={() => void checkParagraphSentence()}>Chấm câu này</button> : paragraphGrading ? <button className="primary" disabled>Đang chấm ngữ nghĩa…</button> : paragraphGradeError ? <button className="primary retry" type="button" onClick={() => void requestParagraphAiGrade()}>Chấm lại bằng AI</button> : paragraphPassed ? <button className="primary" onClick={nextParagraphSentence}>{paragraphIndex + 1 === paragraphTask.sentences.length ? "Xem tổng kết →" : "Câu tiếp →"}</button> : <button className="primary retry" type="button" onClick={retryParagraphSentence}>Viết lại câu này</button>}
            </div>
          </section>
          <aside className="panel paragraph-feedback translate-feedback">
            <div className="paragraph-side-tools translate-meta">
              <button onClick={() => setParagraphDictionaryOpen((value) => !value)}><Icon name="book" size={18} /><span>Từ điển</span></button>
              <div><Icon name="target" size={18} /><strong>{paragraphAiGrade ? `${paragraphScore}%` : paragraphGrading ? "…" : "—"}</strong><span>Độ chính xác ngữ nghĩa</span></div>
            </div>
            {paragraphDictionaryOpen && <div className="paragraph-dictionary"><label htmlFor="paragraph-dictionary">Tra nhanh từ tiếng Anh</label><div><input id="paragraph-dictionary" value={paragraphDictionaryQuery} onChange={(event) => setParagraphDictionaryQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") lookUpParagraphWord(); }} placeholder="Nhập một từ…" /><button disabled={!paragraphDictionaryQuery.trim()} onClick={lookUpParagraphWord}>Tra từ</button></div><small>Mở định nghĩa, phát âm và ví dụ trong tab mới.</small></div>}
            <div className="translate-feedback-title">
              <div><span>PHẢN HỒI</span><b>{paragraphResult || paragraphRewriteReview ? "Kết quả câu hiện tại" : "Sẵn sàng chấm bài"}</b></div>
              <em>{paragraphPassed ? "✓" : "◎"}</em>
            </div>
            {!paragraphResult ? paragraphRewriteReview ? <div className="paragraph-review-kept">
              <div className="paragraph-score-row"><strong>{paragraphRewriteReview.score}%</strong><span>Nhận xét lần chấm trước</span></div>
              <p>{paragraphRewriteReview.comment}</p>
              {paragraphRewriteReview.issues.length ? <section className="paragraph-issues"><h4>Hướng dẫn sửa câu</h4>{paragraphRewriteReview.issues.map((issue, index) => <div key={`${issue.type}-${index}`}><b>{issue.wrong || "Cách diễn đạt cần xem lại"}</b><p>{issue.why}</p></div>)}</section> : null}
              <div className="paragraph-tip"><Icon name="sparkles" size={16} /><span><b>Hãy tự sửa:</b> Đối chiếu từng lỗi ở trên và viết lại bằng cách diễn đạt của bạn. Câu mẫu đã được ẩn trong lúc làm lại.</span></div>
            </div> : <div className="paragraph-ready translate-ready"><p className="translate-empty">Viết câu tiếng Anh rồi bấm <b>Chấm câu này</b>. Hệ thống sẽ phân tích ý nghĩa, ngữ pháp, từ vựng và độ tự nhiên.</p><ul><li><span>1</span>Dịch đúng ý của câu đang được tô sáng</li><li><span>2</span>Nhấn <b>Gợi ý</b> nếu chưa biết cách bắt đầu</li><li><span>3</span>Sửa câu đến khi đạt rồi mới chuyển tiếp</li></ul></div> : <>
              <div className="paragraph-score-row"><strong>{paragraphAiGrade ? `${paragraphScore}%` : paragraphGrading ? "…" : "—"}</strong><span>Đánh giá theo ý nghĩa</span></div>
              <p className={paragraphPassed ? "good" : ""}>{paragraphGrading ? "Đang kiểm tra câu của bạn theo ý nghĩa tiếng Việt, ngữ pháp và độ tự nhiên…" : paragraphGradeError || paragraphAiGrade?.comment || "Chưa có kết quả chấm ngữ nghĩa."}</p>
              {paragraphGrading && <div className="paragraph-ai-loading"><Icon name="sparkles" size={16} /><span>Đang kiểm tra ý nghĩa, ngữ pháp và cách diễn đạt…</span></div>}
              {paragraphAiGrade?.criteria && <div className="paragraph-criteria">{[["meaning", "Đúng & đủ ý"], ["grammar", "Ngữ pháp"], ["vocabulary", "Từ vựng"], ["naturalness", "Tự nhiên"]].map(([key, label]) => <div key={key}><span>{label}</span><i><b style={{ width: `${paragraphAiGrade.criteria?.[key] || 0}%` }} /></i><strong>{paragraphAiGrade.criteria?.[key] || 0}</strong></div>)}</div>}
              {paragraphAiGrade?.issues?.length ? <section className="paragraph-issues"><h4>Điểm cần cải thiện</h4>{paragraphAiGrade.issues.map((issue, index) => <div key={`${issue.type}-${index}`}><b>{issue.wrong || "Cách diễn đạt"}{issue.right ? <> → <em>{issue.right}</em></> : null}</b><p>{issue.why}</p></div>)}</section> : null}
              {paragraphAiGrade && <div className="paragraph-reference"><span>Một cách dịch tự nhiên</span><b>{paragraphAiGrade.suggestion || paragraphSentence.en}</b></div>}
              {paragraphAiGrade && <div className="paragraph-tip"><Icon name="sparkles" size={16} /><span><b>Cách cải thiện:</b> Sửa các lỗi thực sự về ý nghĩa hoặc ngữ pháp ở trên. Bạn không cần viết giống câu tham khảo nếu cách diễn đạt của bạn vẫn đúng và tự nhiên.</span></div>}
              {paragraphGradeError && <small className="paragraph-grade-note">{paragraphGradeError}</small>}
            </>}
            <section className="paragraph-achievements translation-achievements"><h3>Tiến độ buổi học</h3><div><article><strong>{paragraphIndex + (paragraphPassed ? 1 : 0)}</strong><span>Câu đã hoàn thành</span></article><article><strong>{paragraphScores.filter((score) => score >= 90).length}</strong><span>Câu đạt từ 90%</span></article><article><strong>{paragraphIndex + 1}</strong><span>Câu hiện tại</span></article></div></section>
          </aside>
        </div>}
      </div>
    );

  // ── Màn viết bài và xem điểm ──────────────────────────────────────────────
  if (task)
    return (
      <div className="page writing-task">
        <BackButton destination="chọn đề" onClick={backToLibrary} />

        <div className="writing-task-body">
          <section className="panel writing-prompt">
            <div className="writing-prompt-head">
              <span className="writing-part">Task {task.part}</span>
              <span className="writing-kind">{task.kind}</span>
              <span className="writing-minutes">◷ {TASK_MINUTES[task.part as 1 | 2]} phút</span>
            </div>
            <h1>{task.title}</h1>
            <p className="writing-prompt-text">{task.prompt}</p>
            {task.chart && <TaskChart chart={task.chart} title={task.title} />}
          </section>

          <section className="panel writing-editor">
            <div className="writing-editor-head">
              <b>Bài viết của bạn</b>
              <span className={words >= needed ? "enough" : ""}>
                {words}/{needed} từ
              </span>
              {!result && answer.trim() && <small className="writing-saved">Đã tự lưu trên máy</small>}
            </div>
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Viết bài của bạn ở đây…"
              spellCheck={false}
              aria-label="Bài viết"
              disabled={Boolean(result)}
            />
            {words > 0 && words < needed && (
              <p className="writing-warn">
                Đề yêu cầu tối thiểu {needed} từ. Viết thiếu sẽ bị trừ ở tiêu chí trả lời đúng yêu cầu.
              </p>
            )}
            {error && <p className="writing-warn bad">{error}</p>}

            {!result && (
              <button className="primary" onClick={() => void grade()} disabled={grading || words < 30}>
                {grading ? "Đang chấm…" : "Chấm bài"}
              </button>
            )}
          </section>

          {result && (
            <section className="panel writing-result">
              <div className="writing-band">
                <div>
                  <b>{result.band}</b>
                  <small>band ước lượng</small>
                </div>
                {/* Nói thẳng đây không phải điểm thi thật — một con số trông giống
                    điểm thi sẽ khiến người học tưởng mình đã sẵn sàng. */}
                <p>Điểm do mô hình ngôn ngữ chấm, dùng để biết mình đang quanh mức nào và yếu chỗ nào. Không phải điểm thi thật.</p>
              </div>

              <div className="writing-criteria">
                {(CRITERIA as Criterion[]).map((item) => (
                  <div key={item.key}>
                    <span>{item.label}</span>
                    <i><em style={{ width: `${((result.scores[item.key] ?? 0) / 9) * 100}%` }} /></i>
                    <b>{result.scores[item.key] ?? 0}</b>
                  </div>
                ))}
              </div>

              {result.comment && <p className="writing-comment">{result.comment}</p>}

              {result.strengths.length > 0 && (
                <div className="writing-points good">
                  <b>Làm tốt</b>
                  <ul>{result.strengths.map((item, at) => <li key={at}>{item}</li>)}</ul>
                </div>
              )}
              {result.improvements.length > 0 && (
                <div className="writing-points">
                  <b>Cần sửa</b>
                  <ul>{result.improvements.map((item, at) => <li key={at}>{item}</li>)}</ul>
                </div>
              )}

              {result.fixes.length > 0 && (
                <div className="writing-fixes">
                  <b>Lỗi cụ thể</b>
                  <ul>
                    {result.fixes.map((fix, at) => (
                      <li key={at}>
                        <s>{fix.wrong}</s>
                        <strong>{fix.right}</strong>
                        <span>{fix.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="writing-result-actions">
                <button onClick={backToLibrary}>Chọn đề khác</button>
                <button
                  className="primary"
                  onClick={() => {
                    setResult(null);
                    setAnswer("");
                  }}
                >
                  Viết lại đề này
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    );

  // ── Cửa vào chung: ba lộ trình, cùng một ngôn ngữ giao diện ───────────────
  if (route === "home")
    return (
      <div className="page writing-hub">
        {/* Không có nút quay lại: đây là màn gốc, bấm thẳng từ cột trái (và từ
            thanh dưới trên điện thoại). Nút "về trang chủ" ở đây chỉ lặp lại thứ
            đã luôn hiện sẵn. */}
        <header className="writing-hub-head">
          <span className="writing-hero-icon"><Icon name="pen" size={20} /></span>
          <div><h1>Viết</h1><p>Chọn đúng mục tiêu của bạn. Mỗi lộ trình có nội dung và cách chấm riêng.</p></div>
        </header>
        <div className="writing-paths">
          <button onClick={() => setRoute("paragraphs")}>
            <i>01</i><span><b>Dịch đoạn văn có sẵn</b><small>Luyện Việt → Anh theo từng câu, phân theo trình độ và loại nội dung.</small><em>Cơ bản · Trung cấp · Nâng cao</em></span><strong>→</strong>
          </button>
          <button onClick={() => setRoute("exams")}>
            <i>02</i><span><b>Viết theo kỳ thi</b><small>Làm đề IELTS, TOEIC, VSTEP và nhận điểm cùng nhận xét chi tiết.</small><em>Task 1 · Task 2 · Chấm band</em></span><strong>→</strong>
          </button>
          <button onClick={() => openTranslate?.()}>
            <i>03</i><span><b>Viết bằng từ vựng của bạn</b><small>Chọn từ trong folder, tạo đoạn văn hoặc từng câu để luyện dịch.</small><em>Folder từ vựng · AI tạo nội dung</em></span><strong>→</strong>
          </button>
        </div>
        <section className="writing-flow-note">
          <b>Một luồng thống nhất</b><span>Chọn lộ trình</span><i>→</i><span>Chọn bài</span><i>→</i><span>Viết</span><i>→</i><span>Nhận phản hồi</span><i>→</i><span>Xem tiến độ</span>
        </section>
      </div>
    );

  if (route === "paragraphs")
    return (
      <div className="page paragraph-library">
        <BackButton destination="Viết" onClick={() => setRoute("home")} />
        <header className="writing-hub-head"><span className="writing-hero-icon"><Icon name="book" size={20} /></span><div><h1>Đoạn văn có sẵn</h1><p>Chọn trình độ và nội dung, sau đó dịch từng câu trong một mạch văn hoàn chỉnh.</p></div></header>
        <div className="paragraph-toolbar">
          <label><Icon name="search" size={16} /><input value={paragraphQuery} onChange={(event) => setParagraphQuery(event.target.value)} placeholder="Tìm theo tên bài hoặc chủ đề…" /></label>
          <button className={favoriteOnly ? "active" : ""} onClick={() => setFavoriteOnly((value) => !value)}><Icon name="flag" size={15} /> Đã lưu ({favorites.length})</button>
        </div>
        <div className="paragraph-filters">
          <div><span>Trình độ</span>{["Tất cả", "Cơ bản", "Trung cấp", "Nâng cao"].map((value) => <button key={value} className={paragraphLevel === value ? "active" : ""} onClick={() => setParagraphLevel(value)}>{value}</button>)}</div>
          <div><span>Loại nội dung</span>{["Tất cả", ...new Set(PARAGRAPHS.map((item) => item.kind))].map((value) => <button key={value} className={paragraphKind === value ? "active" : ""} onClick={() => setParagraphKind(value)}>{value}</button>)}</div>
        </div>
        <div className="paragraph-grid">
          {paragraphShown.map((item) => { const saved = paragraphProgress[item.id]; const thumb = THUMBNAILS[item.kind] ?? THUMBNAILS.Truyện; const favorite = favorites.includes(item.id); return <article key={item.id} className="paragraph-card">
            <div className={`paragraph-thumb ${thumb.className}`}><span><Icon name={thumb.icon} size={28} /><b>{thumb.label}</b><small>{item.topic}</small></span><button className={favorite ? "saved" : ""} aria-label={favorite ? `Bỏ lưu ${item.title}` : `Lưu ${item.title}`} onClick={() => toggleFavorite(item.id)}><Icon name="flag" size={16} /></button></div>
            <div className="paragraph-meta"><span>{item.level}</span><em>{item.kind}</em>{saved && <em className="completed">✓ Đã học · tốt nhất {saved.best}%</em>}</div><h3>{item.title}</h3><p>{item.sentences.map((line) => line.vi).join(" ")}</p><footer><small>{item.topic} · {item.sentences.length} câu</small><button onClick={() => openParagraph(item)}>{saved ? "Luyện lại →" : "Bắt đầu →"}</button></footer></article>; })}
        </div>
        {!paragraphShown.length && <div className="paragraph-empty"><Icon name="search" size={25} /><h3>Không tìm thấy bài phù hợp</h3><p>Thử bỏ bộ lọc hoặc tìm bằng một chủ đề khác.</p><button onClick={() => { setParagraphQuery(""); setParagraphLevel("Tất cả"); setParagraphKind("Tất cả"); setFavoriteOnly(false); }}>Xóa bộ lọc</button></div>}
      </div>
    );

  // ── Màn chọn đề kỳ thi ────────────────────────────────────────────────────
  return (
    <div className="page writing-library">
      <BackButton destination="Viết" onClick={() => setRoute("home")} />

      <header className="writing-hero">
        <span className="writing-hero-icon"><Icon name="pen" size={20} /></span>
        <div>
          <h1>Viết theo kỳ thi</h1>
          <p>Viết theo đề rồi được chấm theo bốn tiêu chí như đề thi.</p>
        </div>
        <div className="writing-exams" role="group" aria-label="Kỳ thi">
          {(EXAMS as { key: string; label: string }[]).map((item) => (
            <button key={item.key} className={exam === item.key ? "active" : ""} onClick={() => setExam(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="writing-layout">
        <div className="writing-main">
          <div className="writing-parts" role="group" aria-label="Lọc theo phần">
            {PARTS.map((item) => (
              <button key={item.value} className={part === item.value ? "active" : ""} onClick={() => setPart(item.value)}>
                {item.label}
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <p className="empty">Chưa có đề nào cho kỳ thi này. Chọn kỳ thi khác nhé.</p>
          ) : (
            groups.map((group) => (
              <section key={group.part} className="writing-block">
                <h3>Task {group.part} — {group.part === 1 ? "Mô tả số liệu, thư, email" : "Bài luận nêu ý kiến"}</h3>
                <div className="writing-grid">
                  {group.tasks.map((item) => (
                    <button key={item.id} className="writing-card" onClick={() => setTask(item)}>
                      {item.chart ? (
                        <span className="writing-card-chart"><TaskChart chart={item.chart} title={item.title} /></span>
                      ) : (
                        <span className="writing-card-chart plain"><Icon name="pen" size={26} /></span>
                      )}
                      <b>{item.title}</b>
                      <span className="writing-card-tags">
                        <em>{item.kind}</em>
                        <em className="muted">tối thiểu {minWordsOf(item) as number} từ</em>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <aside className="writing-side">
          <section className="panel">
            <h3>Tiến độ của bạn</h3>
            {progress.count ? (
              <>
                <div className="writing-side-band">
                  <b>{progress.latest}</b>
                  <span>/9</span>
                  <small>band gần nhất</small>
                </div>
                <div className="writing-side-bar"><i style={{ width: `${(progress.latest / 9) * 100}%` }} /></div>
                <p className="writing-side-note">
                  {progress.trend > 0
                    ? `Tăng ${progress.trend} band so với bài trước.`
                    : progress.trend < 0
                      ? `Giảm ${Math.abs(progress.trend)} band so với bài trước.`
                      : "Bằng bài trước."}
                  {" "}Cao nhất {progress.best} · trung bình {progress.average} · {progress.count} bài.
                </p>

                <div className="writing-side-criteria">
                  {(progress.byCriterion as { key: string; label: string; score: number }[]).map((item) => (
                    <div key={item.key}>
                      <span>{item.label}</span>
                      <b>{item.score}</b>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="writing-side-empty">Chưa có bài nào được chấm. Viết một đề rồi quay lại đây xem tiến độ.</p>
            )}
          </section>

          {attempts.length > 0 && (
            <section className="panel">
              <h3>Bài gần đây</h3>
              <ul className="writing-recent">
                {attempts.slice(0, 5).map((item) => (
                  <li key={item.at}>
                    <span>
                      <b>{item.taskTitle || "Đề không tên"}</b>
                      <small>Task {item.part} · {item.words} từ</small>
                    </span>
                    <em>{item.band}</em>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
