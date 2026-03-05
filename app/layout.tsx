import type { Metadata, Viewport } from 'next';
import { Syne, Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';

const fontDisplay = Syne({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});
const fontBody = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});
const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'https://ika-analytics.vercel.app'
  ),
  title: {
    default: 'IKA Analytics | Sui Staking Dashboard',
    template: '%s | IKA Analytics',
  },
  description:
    'Real-time analytics for IKA staking, iSUI staking, drizzlet rewards on the Sui blockchain.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0A0612',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body className="min-h-screen bg-ika-dark text-ika-text antialiased font-body">
        <div
          aria-hidden="true"
          className="glow-orb w-[500px] h-[500px] bg-ika-pink/[0.12] -top-24 -left-24"
        />
        <div
          aria-hidden="true"
          className="glow-orb w-80 h-80 bg-purple-600/[0.08] bottom-1/3 right-0"
        />
        <div className="relative z-10 flex flex-col min-h-screen">
          <Navbar />
          <main id="main-content" className="flex-1">
            {children}
          </main>
          <footer className="border-t border-ika-border/60 py-4 px-6">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-ika-muted">
              <div className="flex items-center gap-2">
                <span className="font-mono text-ika-dim">IKA Analytics</span>
                <span>·</span>
                <span>Built for the Sui Ecosystem</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-ika-pink font-medium">Indexed every 24h</span>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
