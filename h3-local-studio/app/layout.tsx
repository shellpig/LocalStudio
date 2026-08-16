import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "H3 Local Studio",
  description: "在本機使用 MiniMax H3 生成有聲影片。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
