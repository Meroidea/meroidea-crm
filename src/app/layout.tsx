import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { NavigationProgress } from '@/components/motion/navigation-progress';

import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'Meroidea', template: '%s · Meroidea' },
  description: 'One workspace for the people, sales and work of your business.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // data-scroll-behavior: smooth scrolling for anchor links, but an instant jump to the top
    // when Next.js moves between pages.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <NavigationProgress />
        {children}
      </body>
    </html>
  );
}
