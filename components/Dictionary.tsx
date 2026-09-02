"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import WordListPicker from "./WordListPicker";
import { fetchGlance } from "../lib/glance.mjs";
import { foldersOf } from "../lib/folders.mjs";
import { accountStorageKey } from "../lib/storage";

type Sense = { part: string; definition: string; meaningVi: string; synonyms: string[] };
type Collocation = { en: string; vi: string };
type Upgrade = { word: string; vi: string; level: string };
type Lookup = { term: string; ipa: string; meaningVi: string; isPhrase: boolean; level: string | null; senses: Sense[]; collocations: Collocation[]; upgrades: Upgrade[] };
export type NewWord = { term: string; ipa: string; meaning: string; partOfSpeech: string; definition: string };
type FolderStore = Parameters<typeof foldersOf>[0];

const historyKey = "lexilo:dictionary-history:v1";


function readHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(accountStorageKey(historyKey)) ?? "[]") as string[];
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

export default function Dictionary({ onSave, wordId, collectionOf, studyDayOf, setStudyDay, folders, updateFolders, initialWord, legacyCollections = false }: {
  onSave: (word: NewWord) => string;
  wordId: (term: string) => string | null;
  collectionOf: (term: string) => "mine" | "pdf";
  studyDayOf: (term: string) => number | null;
  setStudyDay: (wordId: string, day: number | null) => void;
  folders: FolderStore;
  updateFolders: (next: FolderStore) => void;
  initialWord?: string;
  legacyCollections?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [savedWordId, setSavedWordId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Bảng chọn danh sách phải bay ra khỏi thẻ: thẻ nằm trong .page (có animation nên
  // tạo lớp xếp chồng riêng), để nguyên tại chỗ thì menu dài bị thanh điều hướng
  // dưới cùng đè lên và cắt mất mấy dòng cuối. Neo theo nút 📖 và tự cuộn bên trong.
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const [popStyle, setPopStyle] = useState<CSSProperties>({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc sau khi hydrate
    setHistory(readHistory());
  }, []);

  const lastInitial = useRef("");
  useEffect(() => {
    const word = (initialWord ?? "").trim();
    if (!word || word.toLowerCase() === lastInitial.current) return;
    lastInitial.current = word.toLowerCase();
    setQuery(word);
    void lookup(word);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi từ nạp sẵn đổi
  }, [initialWord]);

  useEffect(() => {
    if (!listOpen) return;
    function place() {
      const anchor = listButtonRef.current;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const left = Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12));
      const top = Math.min(box.bottom + 8, window.innerHeight - 160);
      setPopStyle({ position: "fixed", left, top, width, maxHeight: window.innerHeight - top - 16 });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setListOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [listOpen]);

  async function lookup(term: string) {
    const word = term.replace(/\s+/g, " ").trim().toLowerCase();
    if (!word) return;
    setLoading(true);
    setError("");
    setResult(null);
    setSavedWordId(null);
    setListOpen(false);
    setCopied(false);
    try {
      const data = (await fetchGlance(word)) as Lookup;
      setResult(data);
      const next = [word, ...history.filter((item) => item !== word)].slice(0, 12);
      setHistory(next);
      try { localStorage.setItem(accountStorageKey(historyKey), JSON.stringify(next)); } catch { /* lịch sử là tùy chọn */ }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Không tra được từ này.");
    } finally {
      setLoading(false);
    }
  }

  const existingWordId = result ? wordId(result.term) : null;
  // Mã trong kho là nguồn sự thật. `savedWordId` chỉ lấp khoảng trống trong một
  // render ngay sau khi bấm lưu; không được lấn át mã thật sau khi kho cập nhật.
  const activeWordId = existingWordId ?? savedWordId;

  function save(openPicker = true) {
    if (!result) return;
    const id = onSave({
      term: result.term,
      ipa: result.ipa || "/…/",
      meaning: result.meaningVi || result.senses[0]?.definition || "Chưa bổ sung nghĩa",
      partOfSpeech: result.senses[0]?.part ?? "",
      definition: result.senses[0]?.definition ?? "",
    });
    setSavedWordId(id);
    setListOpen(openPicker);
  }

  function openLists() {
    if (activeWordId) setListOpen((open) => !open);
    else save(true);
  }

  async function copyWord() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(`${result.term}${result.ipa ? ` ${result.ipa}` : ""}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard có thể bị trình duyệt chặn */ }
  }

  const parts = result ? [...new Set(result.senses.map((sense) => sense.part).filter(Boolean))] : [];
  const synonymCount = result?.senses.reduce((count, sense) => count + sense.synonyms.length, 0) ?? 0;
  const collocations = result?.collocations ?? [];
  const upgrades = result?.upgrades ?? [];
  const isPhrase = Boolean(result?.isPhrase);

  return (
    <div className="page dictionary-page">
      <form className="dictionary-search" onSubmit={(event) => { event.preventDefault(); void lookup(query); }}>
        <Icon name="search" size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm kiếm từ tiếng Anh…" aria-label="Từ cần tra" autoComplete="off" spellCheck={false} />
        <button type="submit" disabled={loading || !query.trim()}>{loading ? "Đang tra…" : "Tra từ"}</button>
      </form>

      {error && <p className="dictionary-error">{error}</p>}

      {result && (
        <div className="dictionary-results">
          <section className="panel dictionary-word-card">
            <div className="dictionary-word-main">
              <div className="dictionary-title-line"><h2>{result.term}</h2>{result.ipa && <em>{result.ipa}</em>}</div>
              <div className="dictionary-meta">
                {isPhrase
                  ? <i>cụm từ</i>
                  : <>{result.level && <b className="dictionary-cefr" title="Cấp độ CEFR ước lượng">{result.level}</b>}<span aria-hidden="true">••</span>{parts.map((part) => <i key={part}>{part}</i>)}</>}
              </div>
            </div>
            <div className="dictionary-actions">
              <button onClick={() => speak(result.term, "US")} title="Nghe phát âm"><Icon name="volume" size={18} /></button>
              <button className={activeWordId ? "active" : ""} onClick={() => activeWordId ? setListOpen((open) => !open) : save(false)} title="Lưu vào Kho từ vựng"><Icon name="star" size={18} /></button>
              <button ref={listButtonRef} className={listOpen ? "active" : ""} onClick={openLists} title="Chọn danh sách từ"><Icon name="book" size={18} /></button>
              <button onClick={() => void copyWord()} title="Sao chép"><Icon name={copied ? "check" : "cards"} size={18} /></button>
            </div>
            <div className="dictionary-pronunciations">
              <button onClick={() => speak(result.term, "US")}><b>US</b><Icon name="volume" size={13} /><span>{result.ipa || "/…/"}</span></button>
              <button onClick={() => speak(result.term, "UK")}><b>UK</b><Icon name="volume" size={13} /><span>{result.ipa || "/…/"}</span></button>
            </div>
          </section>

          {activeWordId && listOpen && typeof document !== "undefined" && createPortal(
            <>
              <div className="dictionary-list-overlay" role="presentation" onMouseDown={() => setListOpen(false)} />
              <div className="dictionary-list-popover" style={popStyle} role="dialog" aria-label="Chọn danh sách trong Kho từ vựng">
                <WordListPicker compact legacyCollections={legacyCollections} folders={folders} wordId={activeWordId} updateFolders={updateFolders} collection={collectionOf(result.term)} studyDay={studyDayOf(result.term)} onStudyDayChange={(day) => setStudyDay(activeWordId, day)} onDone={() => setListOpen(false)} />
              </div>
            </>,
            document.body,
          )}

          <section className="panel dictionary-detail-card">
            <div className="dictionary-section-title"><Icon name="swap" size={17} /><b>{isPhrase ? "Nghĩa cụm" : "Bản dịch"}</b>{!isPhrase && <span>({result.senses.length || 1})</span>}</div>
            {result.meaningVi
              ? <p className="dictionary-meaning">{result.meaningVi}</p>
              : isPhrase && <p className="dictionary-meaning dictionary-meaning-empty">Chưa dịch được cụm này. Thử tra từng từ.</p>}
            {result.senses.length > 0 && (
              <ul className="dictionary-senses">
                {result.senses.map((sense) => (
                  <li key={`${sense.part}-${sense.definition}`}>
                    <b>{sense.part}</b>
                    <span>{sense.meaningVi || sense.definition}</span>
                    {sense.meaningVi && sense.definition && <small>{sense.definition}</small>}
                  </li>
                ))}
              </ul>
            )}
            {collocations.length > 0 && (
              <details className="dictionary-detail-row" open={isPhrase}>
                <summary><span>Cụm từ kết hợp</span><small>({collocations.length})</small></summary>
                <ul className="dictionary-collocations">
                  {collocations.map((item) => (
                    <li key={item.en}>
                      <button type="button" onClick={() => { setQuery(item.en); void lookup(item.en); }}>{item.en}</button>
                      {item.vi && <em>{item.vi}</em>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!isPhrase && upgrades.length > 0 && (
              <details className="dictionary-detail-row" open>
                <summary><span>Nâng cấp từ vựng</span><small>({upgrades.length})</small></summary>
                <p className="dictionary-upgrade-hint">Từ gần nghĩa ở cấp độ cao hơn{result.level ? ` ${result.level}` : ""} — dùng khi muốn viết/nói “nặng ký” hơn.</p>
                <ul className="dictionary-collocations dictionary-upgrades">
                  {upgrades.map((item) => (
                    <li key={item.word}>
                      <button type="button" onClick={() => { setQuery(item.word); void lookup(item.word); }}>{item.word}</button>
                      <span className="dictionary-cefr" title="Cấp độ CEFR ước lượng">{item.level}</span>
                      {item.vi && <em>{item.vi}</em>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!isPhrase && (
              <>
                <details className="dictionary-detail-row" open>
                  <summary><span>Định nghĩa</span><small>({result.senses.length})</small></summary>
                  <div>{result.senses.map((sense) => <p key={sense.definition}>{sense.definition}</p>)}</div>
                </details>
                {upgrades.length === 0 && (
                  <details className="dictionary-detail-row">
                    <summary><span>Từ đồng nghĩa</span><small>({synonymCount})</small></summary>
                    <div>{result.senses.flatMap((sense) => sense.synonyms).join(", ") || "Chưa có dữ liệu đồng nghĩa."}</div>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {history.length > 0 && (
        <section className="dictionary-history">
          <h3>Vừa tra</h3>
          <div>{history.map((word) => <button key={word} onClick={() => { setQuery(word); void lookup(word); }}>{word}</button>)}</div>
        </section>
      )}
    </div>
  );
}
