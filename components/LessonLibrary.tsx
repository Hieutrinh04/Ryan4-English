"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { groupByLesson, readSaved, removeSentence } from "../lib/saved-sentences.mjs";
import { addToCatalogue, countNew, groupByChannel, readCatalogue, removeFromCatalogue, withLessonState } from "../lib/catalogue.mjs";
import { readableLength } from "../lib/youtube-list.mjs";
import { DEFAULT_CHANNEL, SUGGESTED_CHANNELS, alreadyAdded, channelUrl } from "../lib/suggested-channels.mjs";

// Màn hình vào của Dictation và Shadowing.
//
// Trước đây hai màn này bắt chọn folder TỪ VỰNG trước, rồi hiện chồng bảng chọn
// bài video lên trên thư viện bài có sẵn — hai màn hình khác nhau trên cùng một
// trang, và folder từ vựng thì chẳng liên quan gì tới bài nghe.
//
// Nay chỉ còn một thư viện: bài lấy từ video và bài có sẵn nằm chung một chỗ,
// lọc bằng cùng một hàng nút.

export type VideoLessonCard = {
  id: string;
  videoId: string;
  title: string;
  author: string;
  seconds: number;
  source: string;
  // Giữ đúng dạng câu như nơi khác dùng: khai báo hẹp hơn thì chỗ gọi phải ép kiểu.
  sentences: { index: number; start: number; end: number; text: string }[];
};

type Filter = "all" | "video" | "builtin" | "saved";
type CatalogueVideo = { videoId: string; title: string; channel: string; seconds: number; thumbnail: string; ready?: boolean };
type ChannelGroup = { channel: string; videos: CatalogueVideo[] };
type Suggested = { handle: string; name: string; levels: string; blurb: string; added?: boolean };
type Saved = { key: string; lessonId: string; lessonTitle: string; index: number; text: string; translation: string };
type SavedGroup = { lessonId: string; title: string; items: Saved[] };

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "video", label: "Video của tôi" },
  { value: "builtin", label: "Thư viện Lexilo" },
  { value: "saved", label: "Câu đã lưu" },
];

const SEEDED = "lexilo:catalogue-seeded:v1";

function minutes(seconds: number) {
  if (!seconds) return "";
  return `${Math.max(1, Math.round(seconds / 60))} phút`;
}

export default function LessonLibrary({
  mode,
  lessons,
  pickVideo,
  addVideo,
  close,
}: {
  mode: "dictation" | "shadowing";
  lessons: VideoLessonCard[];
  pickVideo: (lesson: VideoLessonCard) => void;
  addVideo: () => void;
  close: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueVideo[]>([]);
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setSaved(readSaved() as Saved[]);
    const saved = readCatalogue() as CatalogueVideo[];
    setCatalogue(saved);
    // Lần đầu vào mà chưa có gì thì tự nạp một kênh cho có bài sẵn. Chỉ thử đúng
    // một lần: đánh dấu TRƯỚC khi gọi, để mạng hỏng cũng không gọi lại mỗi lần mở.
    try {
      if (!saved.length && !localStorage.getItem(SEEDED)) {
        localStorage.setItem(SEEDED, "1");
        void loadFrom(channelUrl(DEFAULT_CHANNEL.handle) as string, true);
      }
    } catch {
      // Trình duyệt chặn lưu trữ thì bỏ qua phần nạp sẵn.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Đọc một playlist hoặc kênh thành danh mục.
   *
   * Chỉ lấy phần thông tin YouTube cho phép lấy qua API chính thức. Phụ đề KHÔNG
   * lấy ở đây — Google chỉ cho chủ kênh tải phụ đề — nên video mới thêm vào chưa
   * học được ngay, phải mở trên YouTube rồi dùng tiện ích.
   */
  async function loadFrom(url: string, quiet = false) {
    if (loading || !url) return;
    setLoading(true);
    if (!quiet) setNote("");
    try {
      const response = await fetch("/api/youtube/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, limit: 50 }),
      });
      const data = (await response.json()) as { videos?: CatalogueVideo[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "Không đọc được danh sách này.");
      const videos = data.videos ?? [];
      const fresh = countNew(videos, catalogue) as number;
      setCatalogue(addToCatalogue(videos) as CatalogueVideo[]);
      setLink("");
      if (!quiet || fresh > 0) {
        setNote(
          fresh > 0
            ? `Đã thêm ${fresh} video mới. Video phát trực tiếp từ YouTube, kênh gốc được ghi trên từng thẻ.`
            : "Danh mục đã có đủ những video này rồi.",
        );
      }
    } catch (problem) {
      // Lần nạp sẵn tự động thì im lặng: người dùng có yêu cầu gì đâu mà báo lỗi.
      if (!quiet) setNote(problem instanceof Error ? problem.message : "Không đọc được danh sách này.");
    } finally {
      setLoading(false);
    }
  }

  const fetchList = () => loadFrom(link.trim());

  const savedGroups = useMemo(() => groupByLesson(saved) as SavedGroup[], [saved]);
  // Chỉ còn một nguồn video: video bạn tự thêm. Kho bài "hệ thống" cũ đã bỏ —
  // nó gắn nhãn "Video hệ thống" nhưng không có video nào, chỉ là từng câu chữ
  // lẻ kèm icon micro, nhại một câu rời như vậy không luyện được gì.
  const showVideo = mode === "shadowing" || filter === "all" || filter === "video";
  const showSaved = filter === "all" || filter === "saved";

  return (
    <div className="page lesson-library lesson-library-v2">
      <header className="library-hero">
        <div className="library-title-row">
          <button className="library-back" onClick={close} aria-label="Quay lại">←</button>
          <span className="library-mode-icon"><Icon name={mode === "dictation" ? "headphones" : "mic"} size={19} /></span>
          <div>
            <h1>{mode === "dictation" ? "Nghe chép" : "Nói nhại"}</h1>
            <p>{mode === "dictation" ? "Chọn chủ đề để luyện kỹ năng nghe" : "Chọn chủ đề để luyện kỹ năng nói"}</p>
          </div>
        </div>
        <div className="library-summary"><span>▣ <b>{lessons.length}</b> video của bạn</span><i /> <span className="complete">✓ <b>0</b> đã hoàn thành</span></div>
      </header>

      <div className="library-filter-panel">
        {mode === "dictation" ? (
          <div className="library-filters" role="group" aria-label="Lọc nguồn bài">
            {FILTERS.map((item) => (
              <button key={item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>
                {item.label}
                {item.value === "video" && lessons.length > 0 && <em>{lessons.length}</em>}
                {item.value === "saved" && saved.length > 0 && <em>{saved.length}</em>}
              </button>
            ))}
          </div>
        ) : (
          <div className="library-source-summary" aria-label="Nguồn video">
            <div><i><Icon name="play" size={17} /></i><span><b>Video của bạn</b><small>Video thêm từ YouTube</small></span><em>{lessons.length}</em></div>
          </div>
        )}
      </div>

      {showVideo && (
        <section className="library-block library-user-videos">
          <div className="library-section-title"><div><small>THƯ VIỆN CÁ NHÂN</small><h2>{mode === "shadowing" ? "Video của bạn" : "Tiếp tục học"}</h2></div><span>{lessons.length ? `${lessons.length} video đã thêm` : "Thêm video từ YouTube để bắt đầu"}</span><button className="library-add-video" onClick={addVideo}><Icon name="plus" size={14} /> Thêm video</button></div>
          {lessons.length ? (
            <div className="library-grid">
              {lessons.map((lesson) => (
                <button key={lesson.id} className="library-card video" onClick={() => pickVideo(lesson)}>
                  {/* Ảnh bìa lấy thẳng từ YouTube theo mã video, không phải tải về lưu. */}
                  <span className="library-thumb" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${lesson.videoId}/mqdefault.jpg)` }}>
                    <em className="level-badge">B1</em><em className="duration-badge">◷ {minutes(lesson.seconds)}</em>
                  </span>
                  <span className="library-card-copy"><b>{lesson.title}</b><small>{lesson.author || "Video của tôi"}</small><strong>{lesson.sentences.length} phân đoạn</strong></span>
                </button>
              ))}
            </div>
          ) : (
            // Chưa có bài thì phải nói rõ cách lấy, chứ không để một ô trống khiến
            // người dùng tưởng tính năng chưa tồn tại.
            <div className="library-empty">
              <Icon name="headphones" size={22} />
              <div>
                <b>Chưa có bài nào từ video</b>
                <p>Dán liên kết YouTube để Lexilo lấy thông tin và phụ đề tiếng Anh, hoặc dùng tiện ích trên trang YouTube.</p>
                <button className="library-empty-action" onClick={addVideo}>Dán link YouTube</button>
              </div>
            </div>
          )}
        </section>
      )}

      {showVideo && (
        <section className="library-block library-catalogue">
          <div className="library-section-title">
            <div><small>DANH MỤC CỦA BẠN</small><h2>Thêm cả playlist hoặc cả kênh</h2></div>
            <span>{catalogue.length ? `${catalogue.length} video trong danh mục` : "Dán link playlist hoặc kênh YouTube"}</span>
          </div>

          {/* Video vẫn phát từ YouTube. Ở đây chỉ lấy tiêu đề, kênh, thời lượng và
              ảnh bìa qua API chính thức — không tải video về, không lưu video. */}
          <form
            className="catalogue-add"
            onSubmit={(event) => {
              event.preventDefault();
              void fetchList();
            }}
          >
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://www.youtube.com/@bbclearningenglish hoặc link playlist…"
              aria-label="Link playlist hoặc kênh YouTube"
              disabled={loading}
            />
            <button className="primary" type="submit" disabled={loading || !link.trim()}>
              {loading ? "Đang đọc…" : "Lấy danh sách"}
            </button>
          </form>
          {note && <p className="catalogue-note">{note}</p>}

          {/* Kênh gợi ý: bấm một cái là có cả danh sách bài, không phải đi tìm link.
              Chỉ lưu tên kênh trong mã, danh sách video luôn đọc mới từ API. */}
          <div className="catalogue-suggested">
            <span>Kênh gợi ý</span>
            <div>
              {(alreadyAdded(SUGGESTED_CHANNELS, catalogue) as Suggested[]).map((channel) => (
                <button
                  key={channel.handle}
                  className={channel.added ? "added" : ""}
                  disabled={loading || channel.added}
                  onClick={() => void loadFrom(channelUrl(channel.handle) as string)}
                  title={channel.blurb}
                >
                  {channel.name}
                  <em>{channel.added ? "đã thêm" : channel.levels}</em>
                </button>
              ))}
            </div>
          </div>

          {catalogue.length > 0 && (
            <div className="catalogue-groups">
              {(groupByChannel(withLessonState(catalogue, lessons)) as ChannelGroup[]).map((group) => (
                <div key={group.channel} className="catalogue-group">
                  <div className="catalogue-group-head">
                    <b>{group.channel}</b>
                    <em>{group.videos.length} video</em>
                  </div>
                  <div className="library-grid">
                    {group.videos.map((video) => {
                      const lesson = lessons.find((item) => item.videoId === video.videoId);
                      return (
                        <div key={video.videoId} className="library-card video catalogue-card">
                          <button
                            className="catalogue-open"
                            onClick={() => {
                              if (lesson) pickVideo(lesson);
                              else window.open(`https://www.youtube.com/watch?v=${video.videoId}`, "_blank", "noopener");
                            }}
                          >
                            <span className="library-thumb" style={{ backgroundImage: `url(${video.thumbnail})` }}>
                              {video.seconds > 0 && <em className="duration-badge">◷ {readableLength(video.seconds)}</em>}
                              {video.ready && <em className="level-badge">Có phụ đề</em>}
                            </span>
                            <span className="library-card-copy">
                              <b>{video.title}</b>
                              <small>{video.channel}</small>
                              {/* Phụ đề chỉ lấy được từ trong trang YouTube: Google không
                                  cho tải phụ đề bằng khoá API. Nói rõ để khỏi tưởng hỏng. */}
                              <strong>{video.ready ? "Vào học →" : "Mở trên YouTube rồi bấm Lexilo để lấy phụ đề"}</strong>
                            </span>
                          </button>
                          <button
                            className="catalogue-remove"
                            onClick={() => setCatalogue(removeFromCatalogue(video.videoId) as CatalogueVideo[])}
                            aria-label={`Bỏ ${video.title} khỏi danh mục`}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {showSaved && (saved.length > 0 || filter === "saved") && (
        <section className="library-block">
          <div className="library-section-title">
            <h2>Câu đã lưu</h2>
            <span>{saved.length ? `${saved.length} câu · ${savedGroups.length} bài` : "Bấm Lưu câu trong lúc luyện để cất câu hay vào đây"}</span>
          </div>
          {saved.length ? (
            <div className="saved-list">
              {savedGroups.map((group) => (
                <div key={group.lessonId} className="saved-group">
                  <b>{group.title}</b>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.key}>
                        <em>#{item.index}</em>
                        <div>
                          <p>{item.text}</p>
                          {item.translation && <small>{item.translation}</small>}
                        </div>
                        <button onClick={() => setSaved(removeSentence(item.key) as Saved[])} aria-label="Bỏ lưu câu này">×</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="library-empty">
              <Icon name="check" size={22} />
              <div>
                <b>Chưa lưu câu nào</b>
                <p>Trong lúc luyện, bấm <b>Lưu câu</b> ở đầu khung làm bài để cất lại câu bạn muốn quay lại.</p>
              </div>
            </div>
          )}
        </section>
      )}

    </div>
  );
}
