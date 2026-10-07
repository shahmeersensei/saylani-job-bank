import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type StatCardTone = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'teal' | 'indigo';

interface ToneConfig {
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  sparkColor: string;
  accent: string;
  glow: string;
  upTrend: { bg: string; color: string };
  downTrend: { bg: string; color: string };
}

const TONES: Record<StatCardTone, ToneConfig> = {
  green: {
    bg: 'linear-gradient(145deg, rgba(13,122,62,0.06) 0%, rgba(22,160,80,0.02) 100%)',
    border: 'rgba(13,122,62,0.2)',
    iconBg: 'linear-gradient(135deg, #0d7a3e 0%, #16a050 100%)',
    iconColor: '#fff',
    sparkColor: '#0d7a3e',
    accent: '#0d7a3e',
    glow: 'rgba(13,122,62,0.15)',
    upTrend: { bg: 'rgba(21,128,61,0.1)', color: '#15803d' },
    downTrend: { bg: 'rgba(192,38,45,0.1)', color: '#c0262d' },
  },
  blue: {
    bg: 'linear-gradient(145deg, rgba(26,95,172,0.06) 0%, rgba(45,125,210,0.02) 100%)',
    border: 'rgba(26,95,172,0.2)',
    iconBg: 'linear-gradient(135deg, #1a5fac 0%, #2d7dd2 100%)',
    iconColor: '#fff',
    sparkColor: '#1a5fac',
    accent: '#1a5fac',
    glow: 'rgba(26,95,172,0.15)',
    upTrend: { bg: 'rgba(26,95,172,0.1)', color: '#1a5fac' },
    downTrend: { bg: 'rgba(192,38,45,0.1)', color: '#c0262d' },
  },
  amber: {
    bg: 'linear-gradient(145deg, rgba(180,83,9,0.06) 0%, rgba(217,119,6,0.02) 100%)',
    border: 'rgba(180,83,9,0.2)',
    iconBg: 'linear-gradient(135deg, #b45309 0%, #d97706 100%)',
    iconColor: '#fff',
    sparkColor: '#d97706',
    accent: '#b45309',
    glow: 'rgba(180,83,9,0.15)',
    upTrend: { bg: 'rgba(180,83,9,0.1)', color: '#b45309' },
    downTrend: { bg: 'rgba(192,38,45,0.1)', color: '#c0262d' },
  },
  red: {
    bg: 'linear-gradient(145deg, rgba(192,38,45,0.06) 0%, rgba(224,53,64,0.02) 100%)',
    border: 'rgba(192,38,45,0.2)',
    iconBg: 'linear-gradient(135deg, #c0262d 0%, #e03540 100%)',
    iconColor: '#fff',
    sparkColor: '#c0262d',
    accent: '#c0262d',
    glow: 'rgba(192,38,45,0.15)',
    upTrend: { bg: 'rgba(21,128,61,0.1)', color: '#15803d' },
    downTrend: { bg: 'rgba(192,38,45,0.1)', color: '#c0262d' },
  },
  violet: {
    bg: 'linear-gradient(145deg, rgba(109,40,217,0.06) 0%, rgba(159,92,255,0.02) 100%)',
    border: 'rgba(109,40,217,0.2)',
    iconBg: 'linear-gradient(135deg, #7c3aed 0%, #9f5cff 100%)',
    iconColor: '#fff',
    sparkColor: '#7c3aed',
    accent: '#7c3aed',
    glow: 'rgba(109,40,217,0.15)',
    upTrend: { bg: 'rgba(109,40,217,0.1)', color: '#7c3aed' },
    downTrend: { bg: 'rgba(192,38,45,0.1)', color: '#c0262d' },
  },
  teal: {
    bg: 'linear-gradient(145deg, rgba(15,118,110,0.06) 0%, rgba(20,184,166,0.02) 100%)',
    border: 'rgba(15,118,110,0.2)',
    iconBg: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
    iconColor: '#fff',
    sparkColor: '#0f766e',
    accent: '#0f766e',
    glow: 'rgba(15,118,110,0.15)',
    upTrend: { bg: 'rgba(15,118,110,0.1)', color: '#0f766e' },
    downTrend: { bg: 'rgba(192,38,45,0.1)', color: '#c0262d' },
  },
  indigo: {
    bg: 'linear-gradient(145deg, rgba(67,56,202,0.06) 0%, rgba(99,102,241,0.02) 100%)',
    border: 'rgba(67,56,202,0.2)',
    iconBg: 'linear-gradient(135deg, #4338ca 0%, #6366f1 100%)',
    iconColor: '#fff',
    sparkColor: '#4338ca',
    accent: '#4338ca',
    glow: 'rgba(67,56,202,0.15)',
    upTrend: { bg: 'rgba(67,56,202,0.1)', color: '#4338ca' },
    downTrend: { bg: 'rgba(192,38,45,0.1)', color: '#c0262d' },
  },
};

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  const w = 72;
  const h = 28;
  const barW = 7;
  const gap = (w - values.length * barW) / (values.length - 1 || 1);

  return (
    <svg width={w} height={h} aria-hidden="true" style={{ display: 'block' }}>
      {values.map((v, i) => {
        const barH = Math.max(3, (v / max) * h);
        const x = i * (barW + gap);
        const y = h - barH;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={2.5}
            fill={color}
            opacity={0.2 + 0.8 * (v / max)}
          />
        );
      })}
    </svg>
  );
}

export interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: StatCardTone;
  trend?: { value: number; label?: string };
  sub?: string;
  spark?: number[];
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'green',
  trend,
  sub,
  spark,
  className,
}: StatCardProps) {
  const t = TONES[tone];
  const isUp = trend && trend.value >= 0;

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border p-5 transition-colors',
        className,
      )}
      style={{
        background: t.bg,
        borderColor: t.border,
      }}
    >
      {/* Decorative gradient blob */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 -right-8 size-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: t.glow }}
      />

      {/* Top colored strip */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 h-[3px] w-full rounded-t-2xl"
        style={{ background: t.iconBg }}
      />

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1 pt-0.5">
          <span
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: 'var(--fg-muted)' }}
          >
            {label}
          </span>
          <span className="numeric text-fg mt-0.5 text-3xl leading-none font-extrabold tracking-tight">
            {value}
          </span>
        </div>

        <span
          className="grid size-12 shrink-0 place-items-center rounded-xl"
          style={{ background: t.iconBg }}
          aria-hidden="true"
        >
          <Icon className="size-[22px]" style={{ color: t.iconColor }} />
        </span>
      </div>

      {/* Bottom row */}
      <div className="mt-5 flex items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {trend && (
            <span
              className="numeric inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold"
              style={isUp ? t.upTrend : t.downTrend}
            >
              {isUp ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {isUp ? '+' : ''}
              {trend.value}%
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            {trend?.label ?? sub}
          </span>
        </div>
        {spark && <Sparkline values={spark} color={t.sparkColor} />}
      </div>
    </div>
  );
}
