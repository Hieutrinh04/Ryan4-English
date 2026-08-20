"use client";

import { useEffect, useState } from "react";

// Từ điển AI: tra một từ rồi lưu thẳng vào danh sách từ.
//
// Dùng lại /api/ai/glance — cùng route với phần rê chuột để xem nghĩa, nên không
// thêm chi phí mạng nào mới. Route đó tra từ điển mở và dịch, KHÔNG gọi mô hình
// ngôn ngữ, nên tra bao nhiêu lần cũng được và không bị giới hạn lượt.

type Sense = { part: string; definition: string; synonyms: string[] };
type Lookup = { term: string; ipa: string; meaningVi: string; senses: Sense[] };

export type NewWord = { term: string; ipa: string; meaning: string; partOfSpeech: string; definition: string };

const historyKey = "lexilo:dictionary-history:v1";

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(historyKey);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 12) : [];
  } catch {
    return [];
  }
}

function speak(text: string, region: "US" | "UK") {
  if (!text) return;
  window.speechSynthesis?.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = region === "US" ? "en-US" : "en-GB";
  const voice = (window.speechSynthesis?.getVoices() ?? []).find((item) => item.lang.replace("_", "-") === utterance.lang);
  if (voice) utterance.voice = voice;
  window.speechSynthesis?.speak(utterance);
}

export default function Dictionary({ onSave, has }: { onSave: (word: NewWord) => void; has: (term: string) => boolean }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setHistory(readHistory());
  }, []);

  async function lookup(term: string) {
    const word = term.trim().toLowerCase();
    if (!word) return;
    setLoading(true);
    setError("");
    setResult(null);
    setSaved("");
    try {
      const response = await fetch(`/api/ai/glance?q=${encodeURIComponent(word)}`);
      const data = (await response.json()) as Lookup & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "Không tra được từ này.");
      setResult(data);
      const next = [word, ...history.filter((item) => item !== word)].slice(0, 12);
      setHistory(next);
      try {
        localStorage.setItem(historyKey, JSON.stringify(next));
      } catch {
        // Trình duyệt chặn lưu thì vẫn tra được, chỉ mất lịch sử.
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Không tra được từ này.");
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!result) return;
    onSave({
      term: result.term,
      ipa: result.ipa || "/…/",
      meaning: result.meaningVi || result.senses[0]?.definition || "Chưa bổ sung nghĩa",
      partOfSpeech: result.senses[0]?.part ?? "",
      definition: result.senses[0]?.definition ?? "",
    });
    setSaved(result.term);
  }

  const already = result ? has(result.term) : false;

  return (
    <div className="page dictionary-page">
      <div className="eyebrow">THƯ VIỆN</div>
      <h1>Từ điển AI</h1>
      <p className="page-sub">Tra nghĩa, phiên âm và cách dùng của một từ tiếng Anh, rồi lưu thẳng vào danh sách từ của bạn.</p>

      <form
        className="dictionary-search"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(query);
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nhập một từ tiếng Anh…"
          aria-label="Từ cần tra"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="primary" type="submit" disabled={loading || !query.trim()}>
          {loading ? "Đang tra…" : "Tra từ"}
        </button>
      </form>

      {error && <p className="dictionary-error">{error}</p>}

      {result && (
        <section className="panel dictionary-card">
          <div className="dictionary-head">
            <div>
              <h2>{result.term}</h2>
              {result.ipa && <em>{result.ipa}</em>}
            </div>
            <div className="dictionary-voices">
              <button onClick={() => speak(result.term, "US")}>◖)) US</button>
              <button onClick={() => speak(result.term, "UK")}>◖)) UK</button>
            </div>
          </div>

          {result.meaningVi && <p className="dictionary-meaning">{result.meaningVi}</p>}

          {result.senses.length > 0 && (
            <ul className="dictionary-senses">
              {result.senses.map((sense) => (
                <li key={sense.part}>
                  <b>{sense.part}</b>
                  <span>{sense.definition}</span>
                  {sense.synonyms.length > 0 && <small>Đồng nghĩa: {sense.synonyms.join(", ")}</small>}
                </li>
              ))}
            </ul>
          )}

          {/* Đã có trong danh sách thì nói rõ, thay vì lưu trùng một từ hai lần. */}
          {already ? (
            <p className="dictionary-note">Từ này đã có trong danh sách từ của bạn.</p>
          ) : saved === result.term ? (
            <p className="dictionary-note done">Đã thêm “{saved}” vào danh sách từ.</p>
          ) : (
            <button className="primary dictionary-save" onClick={save}>
              ＋ Thêm vào danh sách từ
            </button>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="dictionary-history">
          <h3>Vừa tra</h3>
          <div>
            {history.map((word) => (
              <button
                key={word}
                onClick={() => {
                  setQuery(word);
                  void lookup(word);
                }}
              >
                {word}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
