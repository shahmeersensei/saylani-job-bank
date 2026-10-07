import NextLink from 'next/link';
import { BrandMark } from '@/components/brand';
import type { AuthLayoutProps } from './authLayout.types';

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(26rem,36rem)_1fr]">
      {/* Left panel — form */}
      <main className="page-gutter bg-surface flex flex-col py-6">
        <div className="flex items-center justify-between">
          <NextLink href="/" className="focus-visible:focus-ring rounded-lg">
            <BrandMark />
          </NextLink>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="grid w-full max-w-sm gap-6">
            <div className="grid gap-1.5">
              <h1 className="text-fg text-2xl font-bold">{title}</h1>
              {subtitle && <p className="text-fg-muted text-sm leading-relaxed">{subtitle}</p>}
            </div>
            {children}
            {footer && <div className="text-fg-muted text-center text-sm">{footer}</div>}
          </div>
        </div>
      </main>

      {/* Right panel — illustration */}
      <aside
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:p-10"
        style={{
          background: 'linear-gradient(150deg, #0d3d20 0%, #0a2616 50%, #051a0f 100%)',
        }}
      >
        {/* Grid overlay */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,1) 39px,rgba(255,255,255,1) 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,1) 39px,rgba(255,255,255,1) 40px)',
          }}
        />
        {/* Glow blobs */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/4 left-1/4 size-80 rounded-full opacity-15 blur-3xl"
          style={{ background: 'var(--primary)' }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-1/4 bottom-1/4 size-64 rounded-full opacity-10 blur-3xl"
          style={{ background: '#1a5fac' }}
        />

        {/* Illustration */}
        <div className="relative flex flex-col items-center gap-8">
          <svg
            viewBox="0 0 480 400"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full max-w-md"
            aria-hidden="true"
          >
            {/* Background circle */}
            <circle cx="240" cy="200" r="160" fill="rgba(46,189,106,0.06)" />
            <circle cx="240" cy="200" r="120" fill="rgba(46,189,106,0.05)" />

            {/* Desk */}
            <rect x="80" y="270" width="320" height="14" rx="7" fill="#1a5c35" />
            <rect x="100" y="284" width="12" height="60" rx="6" fill="#1a5c35" />
            <rect x="368" y="284" width="12" height="60" rx="6" fill="#1a5c35" />

            {/* Laptop body */}
            <rect x="140" y="200" width="200" height="68" rx="8" fill="#0f2e1c" />
            <rect x="148" y="207" width="184" height="54" rx="5" fill="#0d7a3e" opacity="0.3" />
            {/* Laptop screen content */}
            <rect x="155" y="214" width="80" height="6" rx="3" fill="rgba(46,189,106,0.6)" />
            <rect x="155" y="226" width="55" height="5" rx="2.5" fill="rgba(255,255,255,0.25)" />
            <rect x="155" y="237" width="65" height="5" rx="2.5" fill="rgba(255,255,255,0.20)" />
            <rect x="155" y="248" width="45" height="5" rx="2.5" fill="rgba(255,255,255,0.18)" />
            {/* Chart bars on screen */}
            <rect x="255" y="248" width="12" height="15" rx="3" fill="rgba(46,189,106,0.8)" />
            <rect x="272" y="240" width="12" height="23" rx="3" fill="rgba(46,189,106,0.9)" />
            <rect x="289" y="232" width="12" height="31" rx="3" fill="#2ebd6a" />
            <rect x="306" y="245" width="12" height="18" rx="3" fill="rgba(46,189,106,0.7)" />
            {/* Laptop base */}
            <rect x="120" y="268" width="240" height="8" rx="4" fill="#0d2e1c" />

            {/* Person sitting */}
            {/* Head */}
            <circle cx="240" cy="158" r="28" fill="#F5C28A" />
            {/* Hair */}
            <ellipse cx="240" cy="137" rx="28" ry="16" fill="#3d2010" />
            <ellipse cx="218" cy="148" rx="10" ry="16" fill="#3d2010" />
            <ellipse cx="262" cy="148" rx="10" ry="16" fill="#3d2010" />
            {/* Face features */}
            <circle cx="232" cy="160" r="3.5" fill="#3d2010" />
            <circle cx="248" cy="160" r="3.5" fill="#3d2010" />
            <path
              d="M 233 170 Q 240 176 247 170"
              stroke="#3d2010"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
            {/* Neck */}
            <rect x="233" y="184" width="14" height="16" rx="7" fill="#F5C28A" />
            {/* Body / shirt */}
            <rect x="198" y="196" width="84" height="72" rx="16" fill="#0d7a3e" />
            {/* Arms */}
            <rect x="168" y="200" width="36" height="20" rx="10" fill="#0d7a3e" />
            <rect x="276" y="200" width="36" height="20" rx="10" fill="#0d7a3e" />
            {/* Hands */}
            <ellipse cx="162" cy="210" rx="12" ry="10" fill="#F5C28A" />
            <ellipse cx="318" cy="210" rx="12" ry="10" fill="#F5C28A" />

            {/* Chair */}
            <rect x="205" y="268" width="70" height="10" rx="5" fill="#1a4a2a" />
            <rect x="220" y="278" width="10" height="30" rx="5" fill="#1a4a2a" />
            <rect x="250" y="278" width="10" height="30" rx="5" fill="#1a4a2a" />
            <rect x="210" y="305" width="60" height="8" rx="4" fill="#1a4a2a" />

            {/* Floating badges/cards */}
            {/* Badge 1 — top left */}
            <rect x="50" y="100" width="110" height="52" rx="10" fill="rgba(13,122,62,0.9)" />
            <rect x="62" y="114" width="50" height="6" rx="3" fill="rgba(255,255,255,0.9)" />
            <rect x="62" y="126" width="70" height="5" rx="2.5" fill="rgba(255,255,255,0.5)" />
            <rect x="62" y="137" width="55" height="5" rx="2.5" fill="rgba(255,255,255,0.4)" />
            <circle cx="140" cy="113" r="6" fill="rgba(46,189,106,1)" />

            {/* Badge 2 — top right */}
            <rect x="318" y="80" width="112" height="56" rx="10" fill="rgba(26,95,172,0.85)" />
            <rect x="330" y="95" width="60" height="6" rx="3" fill="rgba(255,255,255,0.9)" />
            <rect x="330" y="107" width="78" height="5" rx="2.5" fill="rgba(255,255,255,0.5)" />
            <rect x="330" y="118" width="45" height="5" rx="2.5" fill="rgba(255,255,255,0.4)" />
            <rect x="330" y="125" width="30" height="14" rx="7" fill="rgba(46,189,106,0.8)" />

            {/* Check mark badge */}
            <circle cx="390" cy="240" r="22" fill="rgba(46,189,106,0.2)" />
            <circle cx="390" cy="240" r="16" fill="rgba(46,189,106,0.9)" />
            <path
              d="M 382 240 L 388 246 L 399 233"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />

            {/* Star rating */}
            <circle cx="90" cy="240" r="22" fill="rgba(180,83,9,0.2)" />
            <circle cx="90" cy="240" r="16" fill="rgba(180,83,9,0.85)" />
            <path
              d="M 90 228 L 92.5 235 L 100 235 L 94 239.5 L 96.5 247 L 90 242.5 L 83.5 247 L 86 239.5 L 80 235 L 87.5 235 Z"
              fill="white"
            />

            {/* Dots decoration */}
            <circle cx="60" cy="320" r="4" fill="rgba(46,189,106,0.4)" />
            <circle cx="80" cy="340" r="3" fill="rgba(46,189,106,0.3)" />
            <circle cx="420" cy="310" r="4" fill="rgba(26,95,172,0.4)" />
            <circle cx="400" cy="340" r="3" fill="rgba(26,95,172,0.3)" />
          </svg>

          {/* Tagline */}
          <div className="text-center">
            <p className="text-2xl leading-snug font-bold" style={{ color: '#ffffff' }}>
              Your career, one step
              <br />
              <span style={{ color: '#2ebd6a' }}>closer to home.</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Register once. Get matched with verified employers near you.
              <br />
              Attend interviews through your nearest Saylani branch.
            </p>
          </div>

          {/* Trust indicators */}
          <div className="flex gap-6">
            {[
              { value: '10K+', label: 'Job Seekers' },
              { value: '500+', label: 'Employers' },
              { value: '40+', label: 'Branches' },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-xl font-extrabold" style={{ color: '#2ebd6a' }}>
                  {value}
                </p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
