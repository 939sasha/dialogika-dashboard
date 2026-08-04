import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Диалогика — аналитика переписок",
  description: "ИИ-анализ диалогов сообщества: цели, качество ответов, потери и рекомендации.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
