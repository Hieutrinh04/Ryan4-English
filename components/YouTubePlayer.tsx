"use client";

import { useEffect, useRef, useState } from "react";

// Bọc trình phát nhúng của YouTube để mã của app tua được tới từng câu.
//
// Phải dùng IFrame Player API chứ không nhúng iframe trơn: iframe trơn thì không
// tua được, mà cả bài học xoay quanh việc nghe đi nghe lại ĐÚNG một câu.
//
// Video không được tải về — nó vẫn phát từ máy chủ YouTube.

type Player = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
};

type YT = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => Player;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
};

declare global {
  interface Window {
    YT?: YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";

/**
 * Nạp thư viện của YouTube đúng một lần cho cả trang.
 *
 * YouTube gọi lại qua MỘT hàm toàn cục duy nhất, nên nếu mỗi trình phát tự gán
 * hàm đó thì cái sau ghi đè cái trước và cái trước không bao giờ khởi động.
 */
let ready: Promise<YT> | null = null;
function loadApi(): Promise<YT> {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = API_SRC;
      document.head.append(script);
    }
  });
  return ready;
}

export type PlayerHandle = {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  rate(value: number): void;
  time(): number;
  playing(): boolean;
};

export default function YouTubePlayer({
  videoId,
  onReady,
  onTime,
}: {
  videoId: string;
  onReady?: (handle: PlayerHandle) => void;
  onTime?: (seconds: number) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let ticker = 0;

    void loadApi().then((api) => {
      if (!alive || !holder.current) return;
      player.current = new api.Player(holder.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            if (!alive) return;
            const handle: PlayerHandle = {
              play: () => player.current?.playVideo(),
              pause: () => player.current?.pauseVideo(),
              // allowSeekAhead = true để tua được cả tới đoạn chưa tải.
              seek: (seconds) => player.current?.seekTo(Math.max(0, seconds), true),
              rate: (value) => player.current?.setPlaybackRate(value),
              time: () => player.current?.getCurrentTime() ?? 0,
              playing: () => player.current?.getPlayerState() === api.PlayerState.PLAYING,
            };
            onReady?.(handle);
            // Hỏi mốc thời gian bốn lần mỗi giây: đủ mượt để làm nổi câu đang
            // phát, mà không làm trang giật.
            ticker = window.setInterval(() => {
              if (player.current) onTime?.(player.current.getCurrentTime());
            }, 250);
          },
          onError: () => alive && setFailed(true),
        },
      });
    });

    return () => {
      alive = false;
      if (ticker) window.clearInterval(ticker);
      player.current?.destroy();
      player.current = null;
    };
    // Đổi video là dựng lại trình phát; các hàm gọi lại cố tình không nằm trong
    // danh sách phụ thuộc để không dựng lại mỗi lần cha vẽ lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  if (failed)
    return (
      <div className="yt-player yt-failed">
        <p>Không phát được video này. Có thể chủ kênh đã tắt cho phép nhúng.</p>
        <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">
          Mở trên YouTube
        </a>
      </div>
    );

  return <div className="yt-player"><div ref={holder} /></div>;
}
