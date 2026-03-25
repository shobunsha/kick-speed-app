import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIキック初速チャレンジ',
  description: '蹴った直後のボール映像から推定初速を表示するイベント向け体験アプリ',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
