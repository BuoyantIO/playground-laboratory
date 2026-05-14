import './globals.css';
import type { Metadata } from 'next';
import { I18nProvider } from './lib/i18n';

export const metadata: Metadata = {
  title: 'SMA Demo · Client',
  description: 'Service Mesh Academy demo client',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
