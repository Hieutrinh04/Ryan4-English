import type { Metadata } from "next";
import "./globals.css";
import "./extras.css";

export const metadata: Metadata = {
  title: "Lexilo — Học từ vựng thông minh",
  description: "Ghi nhớ từ vựng bền vững với spaced repetition và chủ động gợi nhớ.",
  metadataBase: new URL("https://lexilo.pages.dev"),
  openGraph: {
    title: "Lexilo — Học từ vựng thông minh",
    description: "Ghi nhớ từ vựng. Dùng được mỗi ngày.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Lexilo" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
