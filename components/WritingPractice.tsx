"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import TaskChart, { type Chart } from "./TaskChart";
import { aiFetch } from "../lib/supabase";
import { CRITERIA, EXAMS, countWords, makeAttempt, readAttempts, saveAttempt, summarise } from "../lib/writing.mjs";
import { TASKS, TASK_MINUTES, filterTasks, groupByPart, minWordsOf } from "../lib/writing-tasks.mjs";

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

export default function WritingPractice({ close, onStudied, openTranslate }: { close: () => void; onStudied?: () => void; openTranslate?: () => void }) {
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
  }, []);

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

  // ── Màn viết bài và xem điểm ──────────────────────────────────────────────
  if (task)
    return (
      <div className="page writing-task">
        <button className="back" onClick={backToLibrary}>← Chọn đề khác</button>

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

  // ── Màn chọn đề ───────────────────────────────────────────────────────────
  return (
    <div className="page writing-library">
      <button className="back" onClick={close}>← Chọn chức năng khác</button>

      <header className="writing-hero">
        <span className="writing-hero-icon"><Icon name="pen" size={20} /></span>
        <div>
          <h1>Luyện viết</h1>
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
          {openTranslate && (
            // Dịch Việt → Anh cũng là luyện viết, chỉ khác ở chỗ có sẵn câu mẫu để
            // đối chiếu. Để nó ở đây thay vì một mục riêng ngoài thanh bên.
            <button className="writing-translate-card" onClick={openTranslate}>
              <span className="writing-translate-icon"><Icon name="swap" size={19} /></span>
              <span>
                <b>Dịch Việt → Anh theo folder từ vựng</b>
                <small>Viết lại câu tiếng Việt bằng tiếng Anh, chấm theo câu mẫu và theo loại lỗi</small>
              </span>
              <em>→</em>
            </button>
          )}

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
