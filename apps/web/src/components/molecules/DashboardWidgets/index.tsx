/**
 * Rich visual widgets for role dashboards:
 *  - HeroBanner       — gradient hero card with big number
 *  - CircularProgress — SVG ring gauge
 *  - ActivityFeed     — timestamped list
 *  - FunnelBar        — horizontal progress bar row
 *  - QuickAction      — icon + label action card
 *  - SectionCard      — wrapper card with title
 */

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/* ──────────────────────────────────────────────────────── */
/* HeroBanner                                               */
/* ──────────────────────────────────────────────────────── */

export interface HeroBannerProps {
  greeting: string;
  name: string;
  role: string;
  /** E.g. "Active since Oct 2026" */
  sub?: string;
  /** Primary metric shown prominently */
  metric?: { label: string; value: string | number; color?: string };
  /** Secondary metrics row */
  chips?: { label: string; value: string | number }[];
  /** Background gradient override */
  gradient?: string;
  children?: React.ReactNode;
}

export function HeroBanner({
  greeting,
  name,
  role,
  sub,
  metric,
  chips,
  gradient,
  children,
}: HeroBannerProps) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-7"
      style={{
        background:
          gradient ?? 'linear-gradient(135deg, var(--sidebar-bg) 0%, #0a2818 50%, #0d3d20 100%)',
      }}
    >
      {/* decorative blobs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-16 size-64 rounded-full opacity-20 blur-3xl"
        style={{ background: 'var(--primary)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-1/3 size-48 rounded-full opacity-10 blur-3xl"
        style={{ background: '#1a5fac' }}
      />

      {/* grid dot overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-6">
        {/* Left: greeting + role badge */}
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-lg px-2.5 py-1 text-xs font-bold tracking-wider uppercase"
              style={{
                background: 'rgba(13,122,62,0.3)',
                color: '#7dd9a8',
                border: '1px solid rgba(13,122,62,0.4)',
              }}
            >
              {role}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {greeting}
            </p>
            <h1
              className="text-3xl font-extrabold tracking-tight"
              style={{ color: '#fff', lineHeight: 1.1 }}
            >
              {name}
            </h1>
          </div>
          {sub && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {sub}
            </p>
          )}
          {chips && chips.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-3">
              {chips.map((c) => (
                <div
                  key={c.label}
                  className="rounded-xl px-3 py-1.5"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.10)',
                  }}
                >
                  <span className="block text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {c.label}
                  </span>
                  <span
                    className="numeric block text-lg font-bold"
                    style={{ color: '#fff', lineHeight: 1 }}
                  >
                    {c.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: big metric */}
        {metric && (
          <div className="text-right">
            <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {metric.label}
            </p>
            <p
              className="numeric text-5xl font-black tracking-tighter"
              style={{ color: metric.color ?? '#2ebd6a', lineHeight: 1 }}
            >
              {metric.value}
            </p>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────── */
/* CircularProgress                                         */
/* ──────────────────────────────────────────────────────── */

export function CircularProgress({
  percent,
  size = 96,
  stroke = 8,
  color = 'var(--primary)',
  label,
  sublabel,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(percent, 100) / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--surface-sunken)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        {label !== undefined && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="numeric text-fg text-xl font-extrabold" style={{ lineHeight: 1 }}>
              {label}
            </span>
            {sublabel && <span className="text-fg-muted text-xs">{sublabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────── */
/* FunnelBar (horizontal progress bar with label)           */
/* ──────────────────────────────────────────────────────── */

export function FunnelBar({
  label,
  value,
  max,
  color = 'var(--primary)',
  sub,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  sub?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {sub && <span className="text-fg-muted text-xs">{sub}</span>}
          <span className="numeric text-fg text-sm font-bold">{value}</span>
        </div>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--surface-sunken)' }}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────── */
/* ActivityFeed                                             */
/* ──────────────────────────────────────────────────────── */

export interface ActivityItem {
  id: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  title: string;
  sub?: string;
  time?: string;
  badge?: { label: string; color: string; bg: string };
}

export function ActivityFeed({
  items,
  title,
  emptyText = 'No recent activity.',
}: {
  items: ActivityItem[];
  title: string;
  emptyText?: string;
}) {
  return (
    <SectionCard title={title}>
      {items.length === 0 ? (
        <p className="text-fg-muted py-4 text-center text-sm">{emptyText}</p>
      ) : (
        <ul className="grid gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.id}
                className="group hover:bg-surface-muted flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors"
              >
                <span
                  className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl"
                  style={{
                    background: item.iconBg ?? 'var(--primary-soft)',
                  }}
                  aria-hidden="true"
                >
                  <Icon className="size-4" style={{ color: item.iconColor ?? 'var(--primary)' }} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-fg truncate text-sm font-semibold">{item.title}</span>
                  {item.sub && <span className="text-fg-muted truncate text-xs">{item.sub}</span>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {item.badge && (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-bold"
                      style={{ background: item.badge.bg, color: item.badge.color }}
                    >
                      {item.badge.label}
                    </span>
                  )}
                  {item.time && <span className="text-fg-subtle text-xs">{item.time}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────────────────────────────── */
/* QuickAction grid                                         */
/* ──────────────────────────────────────────────────────── */

export function QuickAction({
  icon: Icon,
  label,
  sub,
  color,
  bg,
  href,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  color: string;
  bg: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-2xl border p-4 transition-colors hover:opacity-90"
      style={{
        background: bg,
        borderColor: `${color}22`,
      }}
    >
      <span
        className="grid size-10 shrink-0 place-items-center rounded-xl"
        style={{ background: color + '22' }}
        aria-hidden="true"
      >
        <Icon className="size-5" style={{ color }} />
      </span>
      <div className="grid gap-0.5">
        <span className="text-fg text-sm font-semibold group-hover:underline">{label}</span>
        {sub && <span className="text-fg-muted text-xs">{sub}</span>}
      </div>
    </a>
  );
}

/* ──────────────────────────────────────────────────────── */
/* SectionCard                                              */
/* ──────────────────────────────────────────────────────── */

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('bg-surface rounded-2xl border p-5', className)}
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-fg text-base font-bold">{title}</h2>
        {action && <div className="text-fg-muted text-sm">{action}</div>}
      </div>
      {children}
    </section>
  );
}
