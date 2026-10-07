'use client';

import { useState } from 'react';
import { BarChart3, MoreHorizontal } from 'lucide-react';

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const PERIODS = ['This Year', 'Last 6M', 'Last 3M'] as const;
type Period = (typeof PERIODS)[number];

function getVisibleRange(period: Period, currentMonth: number) {
  if (period === 'Last 3M') return { start: Math.max(0, currentMonth - 2), count: 3 };
  if (period === 'Last 6M') return { start: Math.max(0, currentMonth - 5), count: 6 };
  return { start: 0, count: 12 };
}

export function InteractiveBarChart({
  values,
  peak,
  color = '#0d7a3e',
  label,
}: {
  values: number[];
  peak: number;
  color?: string;
  label: string;
}) {
  const [period, setPeriod] = useState<Period>('This Year');
  const [hovered, setHovered] = useState<number | null>(null);

  const currentMonth = new Date().getMonth();
  const { start, count } = getVisibleRange(period, currentMonth);
  const visibleMonths = Array.from({ length: count }, (_, i) => start + i);

  const W = 560;
  const H = 160;
  const barW = 28;
  const gap = (W - count * barW) / (count + 1);
  const peakVal = Math.max(
    ...visibleMonths.map((i) => (i <= currentMonth ? (values[i] ?? 0) : 0)),
    1,
  );
  const yLabels = [0, Math.round(peakVal * 0.5), peakVal];

  return (
    <div className="rounded-2xl border bg-white p-6" style={{ borderColor: '#e8eeed' }}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4" style={{ color: '#0d7a3e' }} aria-hidden="true" />
          <span className="text-base font-bold" style={{ color: 'var(--fg)' }}>
            Overview
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ background: color }}
              aria-hidden="true"
            />
            <span className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
              {label}
            </span>
          </div>
          {/* Period filter */}
          <div
            className="flex overflow-hidden rounded-xl border"
            style={{ borderColor: '#e8eeed' }}
          >
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className="px-2.5 py-1 text-xs font-semibold transition-colors"
                style={{
                  background: period === p ? '#0d7a3e' : 'transparent',
                  color: period === p ? '#fff' : 'var(--fg-muted)',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* SVG chart */}
      <div className="relative">
        <svg
          viewBox={`-36 0 ${W + 40} ${H + 30}`}
          width="100%"
          aria-label={`Bar chart: ${label}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {yLabels.map((v) => {
            const y = H - (v / peakVal) * H;
            return (
              <g key={v}>
                <line x1={0} y1={y} x2={W} y2={y} stroke="#e8eeed" strokeWidth={1} />
                <text
                  x={-8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#6b7d74"
                  fontFamily="system-ui,sans-serif"
                >
                  {v}
                </text>
              </g>
            );
          })}
          {visibleMonths.map((monthIdx, localIdx) => {
            const month = MONTHS_SHORT[monthIdx] ?? '';
            const rawV = monthIdx <= currentMonth ? (values[monthIdx] ?? 0) : 0;
            const v = rawV;
            const barH = peakVal > 0 ? Math.max(v > 0 ? 4 : 0, (v / peakVal) * H) : 0;
            const x = gap + localIdx * (barW + gap);
            const y = H - barH;
            const isCurrent = monthIdx === currentMonth;
            const isFuture = monthIdx > currentMonth;
            const isHov = hovered === monthIdx;

            return (
              <g key={monthIdx}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  rx={5}
                  fill={isFuture ? '#e8eeed' : color}
                  opacity={isFuture ? 1 : isHov || isCurrent ? 1 : 0.4}
                  style={{
                    cursor: isFuture || v === 0 ? 'default' : 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={() => !isFuture && v > 0 && setHovered(monthIdx)}
                  onMouseLeave={() => setHovered(null)}
                />
                {/* Tooltip: show on hover or current month */}
                {(isHov || isCurrent) && v > 0 && !isFuture && (
                  <g>
                    <rect
                      x={x + barW / 2 - 34}
                      y={y - 36}
                      width={68}
                      height={28}
                      rx={8}
                      fill={color}
                    />
                    <text
                      x={x + barW / 2}
                      y={y - 18}
                      textAnchor="middle"
                      fill="#fff"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="system-ui,sans-serif"
                    >
                      {month} · {v}
                    </text>
                    <polygon
                      points={`${x + barW / 2 - 5},${y - 8} ${x + barW / 2 + 5},${y - 8} ${x + barW / 2},${y - 1}`}
                      fill={color}
                    />
                  </g>
                )}
                <text
                  x={x + barW / 2}
                  y={H + 18}
                  textAnchor="middle"
                  fontSize="11"
                  fill={isCurrent ? color : '#6b7d74'}
                  fontWeight={isCurrent ? '700' : '400'}
                  fontFamily="system-ui,sans-serif"
                >
                  {month}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ─── Three-dot card menu ────────────────────────────────────────────── */

export function CardActionMenu({ items }: { items: { label: string; onClick?: () => void }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg p-1 transition-colors hover:bg-[#f4f7f5]"
        style={{ color: 'var(--fg-muted)' }}
        aria-label="Actions"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute top-8 right-0 z-20 min-w-44 rounded-xl border bg-white p-1"
            style={{ borderColor: '#e8eeed', boxShadow: '0 4px 16px rgba(0,0,0,0.10)' }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[#f8faf9]"
                style={{ color: 'var(--fg)' }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
