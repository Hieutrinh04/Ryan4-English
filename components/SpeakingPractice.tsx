"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon, { type IconName } from "./Icon";
import { aiFetch } from "../lib/supabase";
import { createRecogniser, hasRecognition, micError, type Recognition } from "../lib/speech";
import { LEVELS, SCENARIOS, filterScenarios, isComplete, makeSession, mergeGoals, readSessions, saveSession, summarise } from "../lib/speaking.mjs";

// Luyện nói theo tình huống: người học đóng một vai, mô hình đóng vai còn lại.
//
// Khác Shadowing ở chỗ căn bản: Shadowing là nhại lại câu có sẵn, ở đây người học
// TỰ NGHĨ ra câu. Vì vậy không có "câu đúng" để so — cái chấm được là đã làm xong
// việc mà tình huống đòi hỏi chưa, nên màn hình bám vào danh sách mục tiêu.

type Scenario = {
  id: string;
  level: string;
  icon: IconName;
  title: string;
  titleEn: string;
  setting: string;
  partner: string;
  you: string;
  starter: string;
  goals: string[];
};

type Turn = { who: "you" | "partner"; text: string };
type Correction = { wrong: string; right: string; why: string };
type Session = { at: string; scenarioId: string; title: string; goalsDone: number; goalsTotal: number };

/** Đọc câu của đối phương bằng giọng máy — nghe rồi mới đáp mới giống nói thật. */
function speak(text: string) {
  if (!text) return;
  window.speechSynthesis?.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  const voice = (window.speechSynthesis?.getVoices() ?? []).find((item) => item.lang.replace("_", "-") === "en-US");
  if (voice) utterance.voice = voice;
  window.speechSynthesis?.speak(utterance);
}

export default function SpeakingPractice({ close, onStudied }: { close: () => void; onStudied?: () => void }) {
  const [level, setLevel] = useState("all");
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [goalsDone, setGoalsDone] = useState<number[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [note, setNote] = useState("");
  const [ended, setEnded] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [typed, setTyped] = useState("");

  const engine = useRef<Recognition | null>(null);
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setSessions(readSessions());
  }, []);

  useEffect(() => () => engine.current?.stop(), []);

  // Luôn cuộn xuống lượt mới nhất, nếu không người học phải tự cuộn sau mỗi câu.
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking]);

  const list = useMemo(() => filterScenarios(SCENARIOS, level) as Scenario[], [level]);
  const progress = useMemo(() => summarise(sessions), [sessions]);
  const doneIds = useMemo(() => new Set(progress.done as string[]), [progress]);

  function start(item: Scenario) {
    setScenario(item);
    setTurns([{ who: "partner", text: item.starter }]);
    setGoalsDone([]);
    setCorrections([]);
    setNote("");
    setEnded(false);
    setTyped("");
    speak(item.starter);
  }

  function finish(item: Scenario, done: number[], fixes: Correction[], history: Turn[]) {
    setSessions(
      saveSession(
        makeSession({
          scenarioId: item.id,
          title: item.title,
          level: item.level,
          turns: history.filter((turn) => turn.who === "you").length,
          goalsDone: done.length,
          goalsTotal: item.goals.length,
          corrections: fixes.length,
        }),
      ),
    );
    onStudied?.();
  }

  async function send(text: string) {
    const said = text.trim();
    if (!scenario || !said || thinking) return;
    const history = [...turns, { who: "you" as const, text: said }];
    setTurns(history);
    setTyped("");
    setThinking(true);
    setNote("");
    try {
      const response = await aiFetch("/api/ai/speaking", {
        method: "POST",
        body: JSON.stringify({ scenario, history, said }),
      });
      const data = (await response.json()) as { reply?: string; goalsDone?: number[]; correction?: Correction | null; ended?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "Không tiếp tục được hội thoại.");

      const next = [...history, { who: "partner" as const, text: data.reply ?? "" }];
      setTurns(next);
      speak(data.reply ?? "");

      const done = mergeGoals(goalsDone, data.goalsDone, scenario.goals.length) as number[];
      setGoalsDone(done);
      const fixes = data.correction ? [...corrections, data.correction] : corrections;
      if (data.correction) setCorrections(fixes);

      if (data.ended || isComplete(done, scenario.goals.length)) {
        setEnded(true);
        finish(scenario, done, fixes, next);
      }
    } catch (problem) {
      setNote(problem instanceof Error ? problem.message : "Không tiếp tục được hội thoại.");
    } finally {
      setThinking(false);
    }
  }

  function stop() {
    if (!scenario) return;
    engine.current?.stop();
    window.speechSynthesis?.cancel();
    setEnded(true);
    finish(scenario, goalsDone, corrections, turns);
  }

  function listen() {
    if (listening || thinking) return;
    const recogniser = createRecogniser();
    if (!recogniser) return;
    engine.current = recogniser;
    setNote("");
    recogniser.onresult = (event) => {
      const said = Array.from(event.results, (item) => item[0]?.transcript ?? "").join(" ").trim();
      if (said) void send(said);
    };
    recogniser.onerror = (event) => setNote(micError(event.error));
    recogniser.onend = () => setListening(false);
    setListening(true);
    recogniser.start();
  }

  // ── Màn hội thoại ─────────────────────────────────────────────────────────
  if (scenario) {
    const total = scenario.goals.length;
    return (
      <div className="page speaking-room">
        <button className="back" onClick={() => setScenario(null)}>← Chọn tình huống khác</button>

        <div className="speaking-layout">
          <div className="speaking-main">
            <header className="speaking-head">
              <span className="speaking-icon"><Icon name={scenario.icon} size={20} /></span>
              <div>
                <h1>{scenario.title}</h1>
                <p>{scenario.titleEn} · {scenario.level}</p>
              </div>
              <span className="speaking-progress">{goalsDone.length}/{total}</span>
            </header>

            <div className="speaking-feed" ref={feed}>
              <p className="speaking-setting">{scenario.setting}</p>
              {turns.map((turn, at) => (
                <div key={at} className={`speaking-turn ${turn.who}`}>
                  <b>{turn.who === "you" ? "Bạn" : "Đối phương"}</b>
                  <p>{turn.text}</p>
                  {turn.who === "partner" && (
                    <button onClick={() => speak(turn.text)} aria-label="Nghe lại câu này">
                      <Icon name="volume" size={14} />
                    </button>
                  )}
                </div>
              ))}
              {thinking && <div className="speaking-turn partner thinking"><p>đang trả lời…</p></div>}
            </div>

            {note && <p className="speaking-warn">{note}</p>}

            {ended ? (
              <div className="speaking-done">
                <b>{goalsDone.length >= total ? "Xong tình huống này" : "Đã dừng buổi nói"}</b>
                <p>
                  Bạn đã làm xong {goalsDone.length}/{total} mục tiêu qua {turns.filter((turn) => turn.who === "you").length} lượt nói.
                  {goalsDone.length < total && " Nói lại lần nữa để làm nốt phần còn lại nhé."}
                </p>
                <div className="speaking-done-actions">
                  <button onClick={() => setScenario(null)}>Chọn tình huống khác</button>
                  <button className="primary" onClick={() => start(scenario)}>Nói lại từ đầu</button>
                </div>
              </div>
            ) : (
              <div className="speaking-input">
                {listening ? (
                  <button className="primary listening" onClick={() => engine.current?.stop()}>■ Dừng nói</button>
                ) : (
                  <button className="primary" onClick={listen} disabled={thinking || !hasRecognition()}>
                    <Icon name="mic" size={17} /> Nhấn để nói
                  </button>
                )}
                {/* Gõ thay cho nói: máy không có micro, hoặc đang ở chỗ không nói to được. */}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send(typed);
                  }}
                >
                  <input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder={hasRecognition() ? "…hoặc gõ câu trả lời" : "Gõ câu trả lời bằng tiếng Anh"}
                    disabled={thinking}
                    aria-label="Câu trả lời"
                  />
                  <button type="submit" disabled={thinking || !typed.trim()}>Gửi</button>
                </form>
                <button className="speaking-stop" onClick={stop} disabled={thinking}>Kết thúc</button>
              </div>
            )}
          </div>

          <aside className="speaking-side">
            <section className="panel">
              <h3>Việc cần làm</h3>
              <ul className="speaking-goals">
                {scenario.goals.map((goal, index) => (
                  <li key={goal} className={goalsDone.includes(index) ? "done" : ""}>
                    <i>{goalsDone.includes(index) ? "✓" : ""}</i>
                    <span>{goal}</span>
                  </li>
                ))}
              </ul>
              <p className="speaking-role">
                Bạn là <b>{scenario.you}</b>. Đối phương là <b>{scenario.partner}</b>.
              </p>
            </section>

            {corrections.length > 0 && (
              <section className="panel">
                <h3>Chỗ nên sửa</h3>
                {/* Chỉ hiện lỗi đáng sửa: sửa mọi thứ sẽ làm người học ngại nói. */}
                <ul className="speaking-fixes">
                  {corrections.map((fix, at) => (
                    <li key={at}>
                      {fix.wrong && <s>{fix.wrong}</s>}
                      <strong>{fix.right}</strong>
                      <span>{fix.why}</span>
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

  // ── Màn chọn tình huống ───────────────────────────────────────────────────
  return (
    <div className="page speaking-library">
      <button className="back" onClick={close}>← Quay lại không gian kỹ năng</button>

      <header className="writing-hero">
        <span className="writing-hero-icon"><Icon name="volume" size={20} /></span>
        <div>
          <h1>Luyện nói</h1>
          <p>Nói tiếng Anh trong tình huống thật, đối phương do AI đóng vai.</p>
        </div>
        {progress.count > 0 && (
          <span className="speaking-summary">
            {progress.count} buổi · {progress.goalRate}% mục tiêu đạt
          </span>
        )}
      </header>

      {!hasRecognition() && (
        <p className="speaking-warn">
          Trình duyệt này không có sẵn phần nhận dạng giọng nói. Bạn vẫn luyện được bằng cách gõ câu trả lời; muốn nói thì dùng Chrome hoặc Edge trên máy tính.
        </p>
      )}

      <div className="speaking-levels" role="group" aria-label="Lọc theo trình độ">
        <button className={level === "all" ? "active" : ""} onClick={() => setLevel("all")}>Tất cả</button>
        {(LEVELS as string[]).map((item) => (
          <button key={item} className={level === item ? "active" : ""} onClick={() => setLevel(item)}>{item}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="empty">Chưa có tình huống nào ở mức này. Chọn mức khác nhé.</p>
      ) : (
        <div className="speaking-grid">
          {list.map((item) => (
            <button key={item.id} className="speaking-card" onClick={() => start(item)}>
              <span className="speaking-card-top">
                <span className="speaking-icon"><Icon name={item.icon} size={22} /></span>
                <em className="speaking-level">{item.level}</em>
                {doneIds.has(item.id) && <em className="speaking-tick">✓ đã làm</em>}
              </span>
              <b>{item.title}</b>
              <small>{item.titleEn}</small>
              <span className="speaking-card-setting">{item.setting}</span>
              <em className="speaking-card-goals">{item.goals.length} việc cần làm</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
