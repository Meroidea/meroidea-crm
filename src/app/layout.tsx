import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });

/*
 * Shared links need absolute addresses. APP_URL is the site's own address in every environment;
 * the fallback is production, so a build without it still never points at localhost.
 */
const siteUrl = new URL(process.env.APP_URL ?? 'https://crm.meroidea.com');
const title = 'Meroidea — One workspace to run your business';
const description =
  'People, sales, rosters, documents and the numbers behind them, in one workspace shaped around how your team already works.';

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: { default: title, template: '%s · Meroidea' },
  description,
  applicationName: 'Meroidea',
  openGraph: {
    type: 'website',
    siteName: 'Meroidea',
    locale: 'en_AU',
    url: '/',
    title,
    description,
  },
  twitter: { card: 'summary_large_image', title, description },
  appleWebApp: { title: 'Meroidea', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: '#4b49ac' };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
