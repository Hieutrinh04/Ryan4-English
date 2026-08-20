import { NextResponse } from "next/server";
import { identify, spend } from "../../../lib/ai-guard";
import { cuesFromJson3, pickEnglishTrack, secondsFromIso, sentencesFrom, sliceJsonArray, videoIdFrom } from "../../../lib/youtube.mjs";

// Đọc một video YouTube thành bài luyện nghe.
//
// KHÔNG tải và KHÔNG lưu video. Chỉ lấy thông tin bài và phần lời; lúc học thì
// nhúng trình phát của YouTube, video vẫn phát từ máy chủ của họ.
//
// Về phần LỜI THOẠI — đã đo bằng khoá thật, ghi lại để sau này khỏi thử lại:
//   videos.list        → 200, lấy đủ tiêu đề, kênh, thời lượng, ảnh bìa
//   captions.list      → 200, liệt kê được các bản phụ đề
//   captions.download  → 401 "API keys are not supported by this API"
// Google chỉ cho CHỦ KÊNH tải phụ đề, và phải bằng OAuth chứ không phải khoá API.
// Đường lấy phụ đề từ trang xem cũng bị chặn: YouTube trả 200 kèm thân rỗng.
// Vì vậy vẫn thử lấy tự động, không được thì để người học dán lời thoại vào.

type Track = { languageCode?: string; kind?: string; baseUrl?: string };

const BROWSER = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

type Meta = { title: string; author: string; seconds: number; thumbnail: string };

/** Thông tin video qua API chính thức. Chỉ cần một lượt gọi và không phải bóc HTML. */
async function metaFromApi(videoId: string): Promise<Meta | null> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}&key=${key}`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      items?: { snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> }; contentDetails?: { duration?: string } }[];
    };
    const item = data.items?.[0];
    if (!item) return null;
    return {
      title: item.snippet?.title ?? "",
      author: item.snippet?.channelTitle ?? "",
      seconds: secondsFromIso(item.contentDetails?.duration) as number,
      thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? "",
    };
  } catch {
    return null;
  }
}

function textBetween(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1] ? match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
}

export async function POST(request: Request) {
  const { url } = (await request.json()) as { url?: string };
  const videoId = videoIdFrom(url) as string;
  if (!videoId) return NextResponse.json({ error: "Đường dẫn YouTube không hợp lệ." }, { status: 400 });

  // Mỗi lượt là một lần gọi ra ngoài nên vẫn tính vào hạn mức chung.
  const caller = await identify(request);
  const denied = spend(caller);
  if (denied) return denied;

  // Trang xem chỉ để lấy đường dẫn phụ đề; thông tin bài lấy từ API cho chắc.
  let page = "";
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: BROWSER });
    if (response.ok) page = await response.text();
  } catch {
    page = "";
  }

  const api = await metaFromApi(videoId);
  const meta: Meta = api ?? {
    title: textBetween(page, /<meta name="title" content="([^"]*)"/),
    author: textBetween(page, /"ownerChannelName":"([^"]*)"/),
    seconds: Number(textBetween(page, /"lengthSeconds":"(\d+)"/)) || 0,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
  if (!meta.title && !page) {
    return NextResponse.json({ error: "Không mở được video. Kiểm tra lại đường dẫn hoặc kết nối mạng." }, { status: 502 });
  }

  let tracks: Track[] = [];
  try {
    const raw = sliceJsonArray(page, '"captionTracks":') as string | null;
    tracks = raw ? (JSON.parse(raw) as Track[]) : [];
  } catch {
    tracks = [];
  }

  const base = { videoId, ...meta, source: api ? "api" : "page", languages: tracks.map((item) => item.languageCode).filter(Boolean) };
  const track = pickEnglishTrack(tracks) as Track | null;

  let sentences: unknown[] = [];
  if (track?.baseUrl) {
    try {
      const response = await fetch(`${track.baseUrl}&fmt=json3`, { headers: { ...BROWSER, referer: `https://www.youtube.com/watch?v=${videoId}` } });
      const body = await response.text();
      // YouTube trả 200 kèm thân rỗng khi từ chối phục vụ phụ đề cho máy chủ.
      if (body.trim().startsWith("{")) sentences = sentencesFrom(cuesFromJson3(JSON.parse(body))) as unknown[];
    } catch {
      sentences = [];
    }
  }

  if (sentences.length) return NextResponse.json({ ...base, sentences, reason: "ok" });

  return NextResponse.json({
    ...base,
    sentences: [],
    reason: track?.baseUrl ? "blocked" : "no-track",
    // Nói đúng chuyện đang xảy ra thay vì báo lỗi chung chung: người dùng cần biết
    // vì sao phải dán tay, nếu không sẽ tưởng app hỏng.
    error: track?.baseUrl
      ? "YouTube không cho máy chủ tải phụ đề của video này. Mở phụ đề trên YouTube, sao chép lời thoại rồi dán vào ô bên dưới — app sẽ tự cắt câu và ước lượng mốc giờ."
      : "Video này không có phụ đề tiếng Anh. Dán lời thoại vào ô bên dưới để tạo bài.",
  });
}
