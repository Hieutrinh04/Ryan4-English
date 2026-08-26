import { NextResponse } from "next/server";
import { identify, spend } from "../../../../lib/ai-guard";
import { catalogueEntry, channelRefFrom, playlistIdFrom, uploadsPlaylistId, usableForPractice } from "../../../../lib/youtube-list.mjs";

// Đọc một playlist hoặc một kênh YouTube thành danh mục video để luyện.
//
// KHÔNG tải và KHÔNG lưu video. Chỉ lấy phần thông tin YouTube cho phép lấy qua
// API chính thức — tiêu đề, tên kênh, thời lượng, ảnh bìa — rồi lúc học thì nhúng
// trình phát của họ. Video luôn phát từ máy chủ YouTube, kênh gốc luôn được ghi.
//
// Phụ đề KHÔNG lấy ở đây: Google chỉ cho chủ kênh tải phụ đề, và phải bằng OAuth
// chứ không phải khoá API (đã đo, xem app/api/youtube/route.ts). Phụ đề vẫn lấy
// qua tiện ích lúc người học mở bài.

const PAGE = 50;
const MAX_VIDEOS = 100;

type PlaylistItem = { snippet?: { title?: string; videoOwnerChannelTitle?: string; channelTitle?: string; resourceId?: { videoId?: string } } };
type VideoItem = { id?: string; contentDetails?: { duration?: string } };

function apiKey() {
  return process.env.YOUTUBE_API_KEY?.trim() ?? "";
}

async function callApi<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const query = new URLSearchParams({ ...params, key: apiKey() });
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${query}`);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Kênh → playlist "uploads" của kênh đó. */
async function uploadsOf(ref: { handle?: string; channelId?: string }) {
  if (ref.channelId) return uploadsPlaylistId(ref.channelId) as string;
  const data = await callApi<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>("channels", {
    part: "contentDetails",
    forHandle: ref.handle ?? "",
  });
  return data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? "";
}

/** Thời lượng của một lô video. Một lượt gọi cho tối đa 50 mã. */
async function durationsOf(ids: string[]) {
  const out = new Map<string, number>();
  for (let at = 0; at < ids.length; at += PAGE) {
    const batch = ids.slice(at, at + PAGE);
    const data = await callApi<{ items?: VideoItem[] }>("videos", { part: "contentDetails", id: batch.join(",") });
    for (const item of data?.items ?? []) {
      if (item.id) out.set(item.id, isoSeconds(item.contentDetails?.duration));
    }
  }
  return out;
}

/** "PT6M12S" → 372. Dạng thời lượng riêng của YouTube. */
function isoSeconds(value?: string) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(value ?? ""));
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return (days || 0) * 86400 + (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
}

export async function POST(request: Request) {
  const { url, limit } = (await request.json()) as { url?: string; limit?: number };
  const want = Math.min(Math.max(Number(limit) || 30, 1), MAX_VIDEOS);
  if (!apiKey()) return NextResponse.json({ error: "Chưa cấu hình YOUTUBE_API_KEY." }, { status: 503 });

  // Chặn gọi dồn dập: mỗi lượt là nhiều lần gọi sang Google, có hạn mức theo ngày.
  const caller = await identify(request);
  const denied = spend(caller);
  if (denied) return denied;

  let playlistId = playlistIdFrom(url) as string;
  if (!playlistId) {
    const ref = channelRefFrom(url) as { handle?: string; channelId?: string } | null;
    if (!ref) {
      return NextResponse.json({ error: "Cần link playlist hoặc link kênh YouTube." }, { status: 400 });
    }
    playlistId = await uploadsOf(ref);
    if (!playlistId) return NextResponse.json({ error: "Không tìm thấy kênh này trên YouTube." }, { status: 404 });
  }

  const raw: { videoId: string; title: string; channel: string }[] = [];
  let pageToken = "";
  while (raw.length < want) {
    const data = await callApi<{ items?: PlaylistItem[]; nextPageToken?: string }>("playlistItems", {
      part: "snippet",
      playlistId,
      maxResults: String(Math.min(PAGE, want - raw.length)),
      ...(pageToken ? { pageToken } : {}),
    });
    if (!data) return NextResponse.json({ error: "YouTube không trả về dữ liệu. Kiểm tra lại link hoặc hạn mức khoá API." }, { status: 502 });
    for (const item of data.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId ?? "";
      if (videoId) {
        raw.push({
          videoId,
          title: item.snippet?.title ?? "",
          channel: item.snippet?.videoOwnerChannelTitle ?? item.snippet?.channelTitle ?? "",
        });
      }
    }
    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }

  const lengths = await durationsOf(raw.map((item) => item.videoId));
  const videos = raw
    .map((item) => catalogueEntry({ ...item, seconds: lengths.get(item.videoId) ?? 0 }))
    .filter(Boolean)
    .filter((entry) => usableForPractice(entry));

  return NextResponse.json({ playlistId, videos, total: videos.length });
}
