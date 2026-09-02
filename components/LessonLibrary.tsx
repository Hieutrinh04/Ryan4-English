"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { groupByLesson, readSaved, removeSentence } from "../lib/saved-sentences.mjs";
import { addLessonsToCatalogue, addToCatalogue, countNew, groupByChannel, readCatalogue, removeFromCatalogue, shelves, videoProgress, withLessonState } from "../lib/catalogue.mjs";
import { readableLength } from "../lib/youtube-list.mjs";
import { readLessonProgress } from "../lib/lessons.mjs";
import { LEVELS, lessonLevel, matchesLevel } from "../lib/level-estimate.mjs";
import { DEFAULT_CHANNEL, SUGGESTED_CHANNELS, alreadyAdded, channelUrl } from "../lib/suggested-channels.mjs";
import { topicById, topicShelves, videosInTopic } from "../lib/topics.mjs";

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
type ShelfVideo = CatalogueVideo & { lesson: VideoLessonCard | null; done: number; total: number; percent: number };
type Suggested = { handle: string; name: string; levels: string; blurb: string; added?: boolean };
type Saved = { key: string; lessonId: string; lessonTitle: string; index: number; text: string; translation: string };
type SavedGroup = { lessonId: string; title: string; items: Saved[] };

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Kho video" },
  { value: "video", label: "Video của tôi" },
  { value: "saved", label: "Câu đã lưu" },
];

const SEEDED = "lexilo:catalogue-seeded:v1";
// Chuyển đúng một lần những bài mà các bản cũ của tiện ích đã lưu vào kho bài
// nhưng quên thêm vào danh mục. Không chạy mãi để người dùng vẫn có thể chủ động
// bỏ một thẻ khỏi danh mục mà nó không tự xuất hiện lại ở lần mở sau.
const LESSONS_CATALOGUED = "lexilo:catalogue-lessons-migrated:v1";

// Thứ tự kệ: việc đang dở lên trước, việc chưa làm được đẩy xuống cuối.
const SHELVES = [
  { key: "doing", title: "Tiếp tục học", hint: "Bài bạn đang làm dở" },
  { key: "fresh", title: "Bài học mới", hint: "Đã có phụ đề, chưa bắt đầu" },
  { key: "noCaption", title: "Cần lấy phụ đề", hint: "Mở trên YouTube rồi bấm Lexilo" },
  { key: "finished", title: "Đã hoàn thành", hint: "Xem lại bất cứ lúc nào" },
] as const;

type ShelfKey = (typeof SHELVES)[number]["key"];

/** Dòng chữ dưới mỗi thẻ, nói đúng việc tiếp theo của thẻ đó. */
function shelfLabel(key: ShelfKey, video: { percent: number; done: number; total: number }) {
  if (key === "noCaption") return "Chưa có phụ đề";
  if (key === "finished") return "Đã xong · học lại";
  if (key === "doing") return `${video.percent}% hoàn thành`;
  return video.total ? `${video.total} phân đoạn` : "Sẵn sàng học";
}

/** Nhãn trạng thái khi bày theo chủ đề, chưa xếp theo tiến độ. */
function topicLabel(video: { percent: number; total: number; lesson: unknown }) {
  if (!video.lesson) return "Chưa có phụ đề";
  if (video.percent >= 100) return "Đã xong · học lại";
  if (video.percent > 0) return `${video.percent}% hoàn thành`;
  return "Chưa bắt đầu";
}

/** Một thẻ video. Dùng chung cho mọi dãy trong thư viện. */
function VideoCard({
  video,
  level,
  label,
  tone,
  onOpen,
  onRemove,
  onPromote,
}: {
  video: ShelfVideo;
  level: string | null;
  label: string;
  tone?: string;
  onOpen: () => void;
  onRemove?: () => void;
  onPromote?: () => void;
}) {
  return (
    <div className="catalogue-card">
      <button className="catalogue-open" onClick={onOpen}>
        <span className="catalogue-thumb" style={{ backgroundImage: `url(${video.thumbnail})` }}>
          {level && (
            <em className="level-badge" title="Cấp độ ước lượng từ độ dài câu và độ dài từ trong phụ đề">
              {level}
            </em>
          )}
          {video.lesson?.source === "system" && <em className="system-badge">Hệ thống</em>}
          {video.seconds > 0 && <em className="duration-badge">◷ {readableLength(video.seconds)}</em>}
          {/* Thanh tiến độ nằm ngay trên ảnh: lướt mắt là thấy còn bao nhiêu,
              không phải đọc số. */}
          {video.percent > 0 && <i className="catalogue-bar"><i style={{ width: `${video.percent}%` }} /></i>}
        </span>
        <b>{video.title}</b>
        <small className={tone}>{label}</small>
      </button>
      {onRemove && (
        <button className="catalogue-remove" onClick={onRemove} aria-label={`Bỏ ${video.title} khỏi danh mục`}>
          ×
        </button>
      )}
      {onPromote && (
        <button className="catalogue-promote" onClick={onPromote} aria-label={`Đặt ${video.title} làm video mặc định`}>
          Hệ thống ＋
        </button>
      )}
    </div>
  );
}

export default function LessonLibrary({
  mode,
  lessons,
  initialFilter,
  pickVideo,
  addVideo,
  promoteVideo,
  close,
}: {
  mode: "dictation" | "shadowing";
  lessons: VideoLessonCard[];
  initialFilter?: Extract<Filter, "video">;
  pickVideo: (lesson: VideoLessonCard) => void;
  addVideo: () => void;
  promoteVideo: (lesson: VideoLessonCard | VideoLessonCard[]) => Promise<void>;
  close: () => void;
}) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const [controlsHeight, setControlsHeight] = useState(228);
  const [filter, setFilter] = useState<Filter>(initialFilter ?? "all");
  // Chủ đề đang mở. Rỗng nghĩa là đang đứng ở màn hình chọn chủ đề.
  const [topic, setTopic] = useState("");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueVideo[]>([]);
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [progress, setProgress] = useState<Record<string, unknown>>({});
  const [promoting, setPromoting] = useState("");
  const [promotionNote, setPromotionNote] = useState("");
  const rows = useRef<Record<string, HTMLDivElement | null>>({});

  // Khung điều khiển dùng position:fixed nên cần một khoảng giữ chỗ đúng bằng
  // chiều cao thật của nó. ResizeObserver cập nhật cả khi chip xuống dòng, đổi
  // chủ đề làm xuất hiện bộ lọc kênh, hoặc màn hình đổi kích thước.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const measure = () => setControlsHeight(Math.ceil(controls.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  /** Cuộn một kệ đi đúng một màn. Băng chuyền dài thì kéo tay rất mỏi. */
  function slide(key: string, direction: number) {
    const row = rows.current[key];
    if (row) row.scrollBy({ left: direction * row.clientWidth * 0.9, behavior: "smooth" });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc một lần sau khi hydrate
    setSaved(readSaved() as Saved[]);
    let saved = readCatalogue() as CatalogueVideo[];
    try {
      if (!localStorage.getItem(LESSONS_CATALOGUED)) {
        saved = addLessonsToCatalogue(lessons) as CatalogueVideo[];
        localStorage.setItem(LESSONS_CATALOGUED, "1");
      }
    } catch {
      // Trình duyệt chặn lưu trữ thì danh mục hiện tại vẫn dùng được.
    }
    setCatalogue(saved);
    setProgress(readLessonProgress() as Record<string, unknown>);
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

  // Khi tiện ích gửi bài vào đúng lúc thư viện đang mở, parent cập nhật `lessons`
  // nhưng state danh mục ở đây không tự biết localStorage vừa đổi. Đọc lại để thẻ
  // mới hiện ngay, không bắt người dùng tải lại cả website.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đồng bộ với thao tác nhập bài ở parent
    setCatalogue(readCatalogue() as CatalogueVideo[]);
  }, [lessons]);

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

  /**
   * Nạp mọi kênh của một chủ đề, lần lượt chứ không song song: mỗi lượt là một
   * lần gọi ra ngoài và có tính vào hạn mức chung, bắn cùng lúc thì dễ bị chặn.
   */
  async function loadTopic(id: string) {
    const found = topicById(id) as { name: string; channels: string[] } | null;
    if (!found || loading) return;
    for (const handle of found.channels) {
      await loadFrom(channelUrl(handle) as string, true);
    }
    setNote(`Đã nạp bài cho chủ đề ${found.name}. Video phát trực tiếp từ YouTube, kênh gốc ghi trên từng thẻ.`);
  }

  const savedGroups = useMemo(() => groupByLesson(saved) as SavedGroup[], [saved]);
  // `lessons` mới là nguồn sự thật cho “Video của tôi”. Catalogue có bộ lọc
  // thời lượng dành cho playlist (bỏ Shorts/quá dài), vì vậy một bài đã lưu phụ
  // đề vẫn có thể không còn entry catalogue và trước đây tạo ra cảnh số đếm > 0
  // nhưng màn hình trống. Thiếu metadata thì dựng thẻ tối thiểu từ chính lesson.
  const userLessons = useMemo(() => lessons.filter((lesson) => lesson.source !== "system"), [lessons]);
  const lessonCatalogue = useMemo(() => {
    const byId = new Map(catalogue.map((video) => [video.videoId, video]));
    return userLessons.map((lesson) => byId.get(lesson.videoId) ?? {
      videoId: lesson.videoId,
      title: lesson.title,
      channel: lesson.author || "Video của tôi",
      seconds: lesson.seconds || 0,
      thumbnail: `https://i.ytimg.com/vi/${lesson.videoId}/hqdefault.jpg`,
      ready: true,
    });
  }, [catalogue, userLessons]);
  // “Video của tôi” phải thật sự chỉ hiện các bài người dùng đã lấy phụ đề,
  // không phải lặp lại toàn bộ danh mục hàng trăm video. Sắp theo `lessons` vì
  // saveLesson luôn đặt bài vừa thêm lên đầu — nhờ vậy thông báo “đã thêm” và
  // thẻ người dùng cần tìm luôn ở cùng một chỗ.
  const visibleCatalogue = useMemo(() => {
    if (filter !== "video") return catalogue;
    return lessonCatalogue;
  }, [catalogue, filter, lessonCatalogue]);
  // Kệ riêng cho bài người dùng vừa thêm, luôn xếp bài mới nhất trước. Bài vẫn
  // có thể xuất hiện trong chủ đề tương ứng ở bên dưới, nhưng không còn bị lẫn
  // giữa hàng trăm video khiến thông báo thành công trông như không có tác dụng.
  const personalVideos = useMemo(() => {
    const byId = new Map(lessonCatalogue.map((video) => [video.videoId, video]));
    return userLessons
      .map((lesson) => {
        const video = byId.get(lesson.videoId);
        if (!video) return null;
        return { ...video, lesson, ...videoProgress(lesson, progress, mode) } as ShelfVideo;
      })
      .filter((video): video is ShelfVideo => Boolean(video))
      .slice(0, 8);
  }, [lessonCatalogue, mode, progress, userLessons]);

  async function promote(lesson: VideoLessonCard) {
    if (promoting) return;
    setPromoting(lesson.videoId);
    setPromotionNote("");
    try {
      await promoteVideo(lesson);
      setPromotionNote(`Đã đưa “${lesson.title}” vào kho video mặc định của hệ thống.`);
    } catch (problem) {
      setPromotionNote(problem instanceof Error ? problem.message : "Không đưa được video vào kho hệ thống.");
    } finally {
      setPromoting("");
    }
  }
  async function promoteAll() {
    if (promoting || !userLessons.length) return;
    setPromoting("all");
    setPromotionNote("");
    try {
      await promoteVideo(userLessons);
      setPromotionNote(`Đã đưa ${userLessons.length} video vào kho mặc định của hệ thống.`);
    } catch (problem) {
      setPromotionNote(problem instanceof Error ? problem.message : "Không đưa được video vào kho hệ thống.");
    } finally {
      setPromoting("");
    }
  }
  const allGroups = useMemo(
    () => groupByChannel(withLessonState(visibleCatalogue, lessons)) as ChannelGroup[],
    [visibleCatalogue, lessons],
  );
  // Trình độ đo từ chính lời thoại của bài, nên chỉ có với video đã lấy được
  // phụ đề. Tính một lần rồi dùng lại cho cả bộ lọc lẫn nhãn trên thẻ.
  const levelOf = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const lesson of lessons) map.set(lesson.videoId, lessonLevel(lesson) as string | null);
    return map;
  }, [lessons]);

  const shelfTopics = useMemo(
    () => topicShelves(visibleCatalogue, lessons) as { id: string; name: string; blurb: string; levels: string; icon: string; count: number; ready: number }[],
    [visibleCatalogue, lessons],
  );
  const openTopic = topic ? (shelfTopics.find((item) => item.id === topic) ?? null) : null;
  const shelf = useMemo(() => {
    let list = topic ? (videosInTopic(visibleCatalogue, topic) as CatalogueVideo[]) : visibleCatalogue;
    if (channelFilter) list = list.filter((item) => item.channel === channelFilter);
    if (levelFilter) list = list.filter((item) => matchesLevel(levelOf.get(item.videoId) ?? null, levelFilter));
    return shelves(list, lessons, progress, mode) as Record<ShelfKey, ShelfVideo[]>;
  }, [visibleCatalogue, lessons, progress, channelFilter, levelFilter, levelOf, mode, topic]);
  // Chỉ còn một nguồn video: video bạn tự thêm. Kho bài "hệ thống" cũ đã bỏ —
  // nó gắn nhãn "Video hệ thống" nhưng không có video nào, chỉ là từng câu chữ
  // lẻ kèm icon micro, nhại một câu rời như vậy không luyện được gì.
  const showVideo = filter === "all" || filter === "video";
  const showSaved = filter === "all" || filter === "saved";

  return (
    <div className="page lesson-library lesson-library-v2">
      <div ref={controlsRef} className="library-sticky-controls">
      <header className="library-hero">
        <div className="library-title-row">
          <button className="library-back" onClick={close} aria-label="Quay lại không gian kỹ năng">←</button>
          <span className="library-mode-icon"><Icon name={mode === "dictation" ? "headphones" : "mic"} size={19} /></span>
          <div>
            <h1>{mode === "dictation" ? "Nghe chép" : "Nói nhại"}</h1>
            <p>{mode === "dictation" ? "Chọn chủ đề để luyện kỹ năng nghe" : "Chọn chủ đề để luyện kỹ năng nói"}</p>
          </div>
        </div>
        <div className="library-summary">
          <span>▣ <b>{shelf.doing.length}</b> đang học</span>
          <i />
          <span className="complete">✓ <b>{shelf.finished.length}</b> đã hoàn thành</span>
          {/* Thêm một video lẻ bằng link. Khác với ô thêm cả playlist ở cuối trang:
              đường này lấy luôn phụ đề nên học được ngay. */}
          <button className="library-add-video" onClick={addVideo}>
            <Icon name="plus" size={14} /> Thêm video
          </button>
        </div>
      </header>

      <div className="library-filter-panel">
        {/* Hàng chip chủ đề. Chủ đề chưa có bài nào vẫn hiện, kèm nút nạp — ẩn đi
            thì người học tưởng app không có chủ đề đó. */}
        <div className="topic-chips" role="group" aria-label="Lọc theo chủ đề">
            <button className={topic ? "" : "active"} onClick={() => { setTopic(""); setChannelFilter(""); }}>
              Tất cả <em>{visibleCatalogue.length}</em>
            </button>
            {shelfTopics.map((item) =>
              item.count ? (
                <button
                  key={item.id}
                  className={topic === item.id ? "active" : ""}
                  onClick={() => { setTopic(item.id); setChannelFilter(""); }}
                >
                  {item.name} <em>{item.count}</em>
                </button>
              ) : (
                <button key={item.id} className="topic-chip-empty" disabled={loading} onClick={() => void loadTopic(item.id)}>
                  {item.name} <em>{loading ? "…" : "＋"}</em>
                </button>
              ),
            )}
        </div>
        <div className="library-filter-meta">
          <div className="library-filters" role="group" aria-label="Lọc nguồn bài">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                className={filter === item.value ? "active" : ""}
                onClick={() => {
                  setFilter(item.value);
                  // Bài vừa thêm có thể thuộc một chủ đề khác với chủ đề đang mở.
                  // Trở về gốc để “Video của tôi” không trông như một danh sách rỗng.
                  if (item.value === "video") {
                    setTopic("");
                    setChannelFilter("");
                    setLevelFilter("");
                  }
                }}
              >
                {item.label}
                {item.value === "video" && userLessons.length > 0 && <em>{userLessons.length}</em>}
                {item.value === "saved" && saved.length > 0 && <em>{saved.length}</em>}
              </button>
            ))}
          </div>
          {visibleCatalogue.length > 0 && (
            <div className="catalogue-filter levels" role="group" aria-label="Lọc theo cấp độ">
              <button className={levelFilter ? "" : "active"} onClick={() => setLevelFilter("")}>
                Tất cả cấp độ
              </button>
                            {(LEVELS as string[]).map((item) => (
                <button
                  key={item}
                  className={levelFilter === item ? "active" : ""}
                  onClick={() => setLevelFilter(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Bộ lọc đặt ngay dưới tiêu đề, không để tận cuối trang: nó là thứ
            người học dùng trước khi chọn bài, chứ không phải thứ tìm thấy sau
            khi đã cuộn qua hết danh sách. */}
        {/* Lọc theo kênh và cấp độ chỉ có nghĩa khi đã vào trong một chủ đề.
            Để ở màn hình chọn chủ đề thì nó đếm gộp cả kho, mâu thuẫn với con số
            ghi trên từng thẻ ngay bên dưới. */}
        {visibleCatalogue.length > 0 && topic && (
          <div className="catalogue-filter library-channel-filter" role="group" aria-label="Lọc theo kênh">
                    <button className={channelFilter ? "" : "active"} onClick={() => setChannelFilter("")}>
                      Tất cả <em>{visibleCatalogue.length}</em>
                    </button>
                    {allGroups.map((group) => (
                      <button
                        key={group.channel}
                        className={channelFilter === group.channel ? "active" : ""}
                        onClick={() => setChannelFilter(group.channel)}
                      >
                        {group.channel} <em>{group.videos.length}</em>
                      </button>
                    ))}
          </div>
        )}
      </div>
      </div>
      <div className="library-sticky-spacer" style={{ height: controlsHeight }} aria-hidden="true" />


      {showVideo && filter === "all" && !topic && personalVideos.length > 0 && (
        <section className="library-block library-catalogue library-personal-shelf" aria-labelledby="personal-video-title">
          <div className="catalogue-shelf">
            <div className="catalogue-shelf-head">
              <b id="personal-video-title">Video của tôi</b>
              <em>{userLessons.length}</em>
              <small>Bài bạn vừa thêm — mới nhất ở đầu</small>
              <button className="shelf-more promote-all" disabled={Boolean(promoting)} onClick={() => void promoteAll()}>
                {promoting === "all" ? "Đang lưu…" : "Đặt tất cả làm mặc định"}
              </button>
              <button className="shelf-more" onClick={() => setFilter("video")}>Xem tất cả</button>
              <span className="catalogue-arrows">
                <button onClick={() => slide("personal", -1)} aria-label="Lùi video của tôi">←</button>
                <button onClick={() => slide("personal", 1)} aria-label="Xem thêm video của tôi">→</button>
              </span>
            </div>
            <div className="catalogue-row" ref={(node) => { rows.current.personal = node; }}>
              {personalVideos.map((video, index) => (
                <VideoCard
                  key={video.videoId}
                  video={video}
                  level={levelOf.get(video.videoId) ?? null}
                  label={index === 0 ? "Vừa thêm · bấm để mở" : topicLabel(video)}
                  tone={index === 0 ? "recent" : undefined}
                  onOpen={() => pickVideo(video.lesson as VideoLessonCard)}
                  onPromote={() => void promote(video.lesson as VideoLessonCard)}
                />
              ))}
            </div>
          </div>
        </section>
      )}
      {promotionNote && <p className="catalogue-note system-promotion-note">{promotionNote}</p>}

      {showVideo && !topic && !visibleCatalogue.length && filter === "video" && (
        <p className="catalogue-empty">Chưa có video nào trong “Video của tôi”. Hãy bấm “Thêm video” để tạo bài đầu tiên.</p>
      )}

      {showVideo && visibleCatalogue.length > 0 && (
        <section className="library-block library-catalogue">
          {openTopic && (
            <nav className="topic-trail" aria-label="Đường dẫn chủ đề">
              <button onClick={() => { setTopic(""); setChannelFilter(""); setLevelFilter(""); }}>Tất cả chủ đề</button>
              <span aria-hidden="true">›</span>
              <b aria-current="page">{openTopic.name}</b>
              {openTopic.levels && <em>{openTopic.levels}</em>}
            </nav>
          )}
          {visibleCatalogue.length > 0 && (
            <>
              {/* Xếp theo TRẠNG THÁI HỌC chứ không theo kênh: mở lên là thấy ngay
                  việc cần làm tiếp, không phải tự nhớ hôm qua đang dở bài nào. */}
              {/* Lọc ra rỗng thì nói rõ, đừng để một mảng trống bên dưới bộ lọc
                  khiến người dùng tưởng màn hình bị lỗi. */}
              {SHELVES.every(({ key }) => !shelf[key].length) && (
                <p className="catalogue-empty">
                  Không có video nào khớp bộ lọc này.
                  {levelFilter && " Cấp độ chỉ đo được ở video đã lấy phụ đề."}
                </p>
              )}

              {SHELVES.map(({ key, title, hint }) => {
                const videos = shelf[key];
                if (!videos.length) return null;
                return (
                  <div key={key} className="catalogue-shelf">
                    <div className="catalogue-shelf-head">
                      <b>{title}</b>
                      <em>{videos.length}</em>
                      <small>{hint}</small>
                      <span className="catalogue-arrows">
                        <button onClick={() => slide(key, -1)} aria-label="Lùi lại">←</button>
                        <button onClick={() => slide(key, 1)} aria-label="Tiếp theo">→</button>
                      </span>
                    </div>
                    <div className="catalogue-row" ref={(node) => { rows.current[key] = node; }}>
                      {videos.map((video) => (
                        <VideoCard
                          key={video.videoId}
                          video={video}
                          level={levelOf.get(video.videoId) ?? null}
                          label={shelfLabel(key, video)}
                          tone={key}
                          onOpen={() => {
                            if (video.lesson) pickVideo(video.lesson);
                            else window.open(`https://www.youtube.com/watch?v=${video.videoId}`, "_blank", "noopener");
                          }}
                          onRemove={video.lesson?.source === "system" ? undefined : () => setCatalogue(removeFromCatalogue(video.videoId) as CatalogueVideo[])}
                        />                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}

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
