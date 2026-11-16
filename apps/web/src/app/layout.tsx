import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/molecules/Toast';
import '@/design-system/global.css';
import { ThemeProvider } from '@/design-system/theme-provider';
import { themeScript } from '@/design-system/theme-script';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Saylani Job Bank', template: '%s · Saylani Job Bank' },
  description: 'Job Bank management and employment matchmaking platform.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f7a3d' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1210' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Audit 2026-11-11 (M-20): the theme script is the only author-written
  // inline script. It carries the per-request CSP nonce middleware sets on
  // the `x-nonce` request header, so it runs under a nonce-only script-src.
  // (Next.js applies the same nonce to its own hydration scripts.)
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // suppressHydrationWarning: the theme script sets data-theme before React hydrates.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
          suppressHydrationWarning on the script itself: the browser hides
          a script's nonce attribute value once it is in the document, so
          at hydration React reads nonce="" from the DOM while its own
          render carries the real per-request nonce — a dev-only warning
          about an attribute that is already correct, not a content
          difference. The flag on <html> does not cover a child's
          attributes, so the script needs its own.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className="min-h-dvh">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
