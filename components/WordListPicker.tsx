"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Icon from "./Icon";
import { addFolder, addWords, depthOf, foldersOf, toggleWord } from "../lib/folders.mjs";

type FolderStore = Parameters<typeof foldersOf>[0];

/** Bộ chọn duy nhất cho mọi nơi cất từ vào danh sách trong Kho từ vựng. */
export default function WordListPicker({
  folders,
  wordId,
  updateFolders,
  selectedFolderIds,
  onSelectedFolderIdsChange,
  collection = "mine",
  studyDay = null,
  onStudyDayChange,
  onDone,
  compact = false,
  legacyCollections = false,
}: {
  folders: FolderStore;
  wordId?: string;
  updateFolders: (next: FolderStore) => void;
  /** Chế độ chọn trước khi từ được tạo: chỉ lưu lựa chọn, chưa gắn id từ. */
  selectedFolderIds?: string[];
  onSelectedFolderIdsChange?: (ids: string[]) => void;
  collection?: "mine" | "pdf";
  studyDay?: number | null;
  onStudyDayChange?: (day: number | null) => void;
  onDone?: () => void;
  compact?: boolean;
  legacyCollections?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(folders.list.length === 0);
  const [mineOpen, setMineOpen] = useState(collection === "mine");
  const [saved, setSaved] = useState(false);
  const pendingSelection = Array.isArray(selectedFolderIds) && !!onSelectedFolderIdsChange;
  const inside = pendingSelection ? selectedFolderIds : wordId ? foldersOf(folders, wordId) as string[] : [];
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    const ordered = [...folders.list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!query) return ordered;
    return ordered.filter((folder) => folder.name.toLocaleLowerCase("vi").includes(query));
  }, [folders, search]);

  function create() {
    const name = draft.split(/\s+/).filter(Boolean).join(" ");
    if (!name) return;
    const next = addFolder(folders, name);
    if (next.list.length === folders.list.length) {
      setError(`Đã có danh sách “${name}” trong Kho từ vựng.`);
      return;
    }
    const created = next.list[next.list.length - 1];
    if (pendingSelection) {
      // Tạo folder ngay để nó tồn tại trong Kho từ vựng, nhưng chỉ gắn từ sau khi
      // người dùng bấm Lưu từ mới và id của từ đã được tạo.
      updateFolders(next);
      onSelectedFolderIdsChange?.([...new Set([...inside, created.id])]);
    } else if (wordId) {
      updateFolders(addWords(next, created.id, [wordId]));
    }
    setSaved(true);
    setDraft("");
    setError("");
    setCreating(false);
  }

  function chooseFolder(folderId: string) {
    if (pendingSelection) {
      onSelectedFolderIdsChange?.(
        inside.includes(folderId) ? inside.filter((id) => id !== folderId) : [...inside, folderId],
      );
    } else if (wordId) {
      updateFolders(toggleWord(folders, folderId, wordId));
    }
    setSaved(true);
  }

  return (
    <div className={`word-list-picker${compact ? " compact" : ""}`}>
      <div className="word-list-picker-head">
        <b>{pendingSelection ? "Lưu vào danh sách" : "Danh sách trong Kho từ vựng"}</b>
        <small>{inside.length ? `${pendingSelection ? "Sẽ lưu" : "Đã nằm"} trong ${inside.length} danh sách` : "Không bắt buộc · có thể chọn nhiều danh sách"}</small>
      </div>

      {folders.list.length > 0 && (
        <label className="word-list-picker-search">
          <Icon name="search" size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm kiếm…" aria-label="Tìm danh sách trong Kho từ vựng" />
        </label>
      )}

      {!pendingSelection && <ul className="word-list-picker-collections" aria-label="Bộ sưu tập mặc định">
        <li>
          <button type="button" className="collection-entry collection-heading" aria-expanded={legacyCollections ? mineOpen : undefined} disabled={!legacyCollections} onClick={() => setMineOpen((open) => !open)}>
            <Icon name="book" size={15} />
            <span>Từ của tôi<small>{legacyCollections ? (collection === "mine" ? "Ngày học là tùy chọn · bấm lại để bỏ chọn" : "Bộ từ cá nhân") : "Mọi từ bạn lưu của tài khoản này"}</small></span>
            {legacyCollections && <Icon className={mineOpen ? "tree-caret open" : "tree-caret"} name="chevron" size={14} />}
          </button>
        </li>
        {legacyCollections && mineOpen && (
          <li className="word-list-picker-days">
            <ul aria-label="Thư mục trong Từ của tôi">
              {["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"].map((name, index) => (
                <li key={name}>
                  <button type="button" className={collection === "mine" && studyDay === index ? "on day-entry" : "day-entry"} aria-pressed={collection === "mine" && studyDay === index} disabled={collection !== "mine" || !onStudyDayChange} onClick={() => { onStudyDayChange?.(studyDay === index ? null : index); setSaved(true); }}>
                    <i aria-hidden="true">{collection === "mine" && studyDay === index ? <Icon name="check" size={13} /> : <span className="day-checkbox" />}</i>
                    <Icon name="list" size={14} />
                    <span>{name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        )}
        {legacyCollections && <li>
          <button type="button" className={collection === "pdf" ? "on collection-entry" : "collection-entry"} aria-pressed={collection === "pdf"} disabled>
            <i aria-hidden="true">{collection === "pdf" ? <Icon name="check" size={14} /> : <span className="folder-outline" />}</i>
            <Icon name="book" size={15} />
            <span>Bộ từ vựng PDF<small>{collection === "pdf" ? "Từ thuộc bộ hệ thống" : "Chỉ đọc · do hệ thống quản lý"}</small></span>
          </button>
        </li>}
      </ul>}

      {folders.list.length > 0 ? (
        visible.length > 0 ? (
          <ul>
            {visible.map((folder) => {
              const ticked = inside.includes(folder.id);
              const depth = depthOf(folders, folder.id);
              return (
                <li key={folder.id} style={{ "--folder-depth": depth } as CSSProperties}>
                  <button type="button" className={ticked ? "on" : ""} aria-pressed={ticked} onClick={() => chooseFolder(folder.id)}>
                    <i aria-hidden="true">{ticked ? <Icon name="check" size={14} /> : <span className="folder-outline" />}</i>
                    <Icon name="book" size={15} />
                    <span>{folder.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="word-list-picker-empty">Không tìm thấy danh sách phù hợp.</p>
      ) : <p className="word-list-picker-empty">Chưa có danh sách tùy chỉnh. Bạn có thể tạo thêm bên dưới.</p>}

      {creating ? (
        <div className="word-list-picker-create-form">
          <input
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setError(""); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); create(); } }}
            placeholder="Tạo danh sách mới trong Kho từ vựng…"
            aria-label="Tên danh sách mới trong Kho từ vựng"
            maxLength={60}
          />
          <button className="primary" type="button" onClick={create} disabled={!draft.trim()}>{pendingSelection ? "Tạo và chọn" : "Tạo và thêm"}</button>
        </div>
      ) : (
        <button type="button" className="word-list-picker-create" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} />
          <span>Tạo danh sách từ mới</span>
        </button>
      )}
      {error && <p className="word-list-picker-error" role="status">{error}</p>}
      <div className="word-list-picker-save" aria-live="polite">
        <span><Icon name="check" size={14} />{pendingSelection ? (inside.length ? `Đã chọn ${inside.length} danh sách` : "Có thể bỏ qua nếu chưa cần phân loại") : saved ? "Đã lưu vào danh sách" : "Tự động lưu ngay khi tích chọn"}</span>
        {onDone && <button type="button" onClick={onDone}>Xong</button>}
      </div>
    </div>
  );
}
