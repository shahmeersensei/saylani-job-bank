'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Building2,
  CheckCircle2,
  DollarSign,
  MapPin,
  Plus,
  Search,
  Shield,
  Star,
  TrendingUp,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import NextLink from 'next/link';

/* ── Images ─────────────────────────────────────────────────────────────── */
const IMG_ABOUT =
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=600&h=720&fit=crop&q=85&crop=faces';
const IMG_TEAM =
  'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=520&h=340&fit=crop&q=85';
const IMG_JOB_BG =
  'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=900&h=700&fit=crop&q=80';
const IMG_HIRE_BG =
  'https://images.unsplash.com/photo-1560264418-c4445382edbc?w=900&h=700&fit=crop&q=80';

/* ── Design tokens ───────────────────────────────────────────────────────── */
const C = {
  primary: '#0B4D2C',
  dark: '#0e1f14',
  lime: '#C8F045',
  limeLight: '#EEF9C0',
  bg: '#FFFFFF',
  surface: '#F5F8F2',
  surfaceAlt: '#EDF2E5',
  text: '#0F1A13',
  muted: '#6B7F6E',
  border: 'rgba(0,0,0,0.06)',
  shadow: 'rgba(11,77,44,0.10)',
};

/* ── Pakistan map ────────────────────────────────────────────────────────── */
const PK_PATH = `
  M 155,14 L 175,7 L 200,5 L 230,11 L 258,27 L 282,52
  L 300,78 L 312,108 L 308,142 L 298,170 L 290,198
  L 270,230 L 246,262 L 218,294 L 192,326 L 162,355
  L 130,372 L 96,368 L 62,350 L 36,320 L 21,288
  L 19,255 L 25,224 L 36,195 L 44,168 L 47,142
  L 40,115 L 50,90 L 60,70 L 74,58 L 92,48
  L 112,42 L 132,34 L 148,21 Z
`;
const CITIES = [
  { id: 'karachi', name: 'Karachi', x: 128, y: 358, detail: '2,400+ jobs in Finance & Tech' },
  { id: 'lahore', name: 'Lahore', x: 288, y: 148, detail: '1,800+ IT & Business roles' },
  {
    id: 'islamabad',
    name: 'Islamabad',
    x: 210,
    y: 107,
    detail: '950+ Government & Tech positions',
  },
  {
    id: 'peshawar',
    name: 'Peshawar',
    x: 103,
    y: 74,
    detail: '450+ Healthcare & Engineering roles',
  },
  { id: 'quetta', name: 'Quetta', x: 55, y: 165, detail: '320+ roles in key industries' },
  { id: 'multan', name: 'Multan', x: 258, y: 210, detail: '680+ Agriculture & Trade openings' },
  { id: 'hyderabad', name: 'Hyderabad', x: 166, y: 308, detail: '380+ Education & Retail roles' },
];
const MAP_CARDS = [
  {
    name: 'Fahad Khan',
    role: 'Graphic Designer',
    city: 'Lahore',
    img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=220&fit=crop&crop=face&q=90',
    pos: { left: '68.9%', top: '2.2%' } as React.CSSProperties,
    delay: '0s',
    line: 'M 438,246 C 450,232 502,222 534,220',
    dotDur: '2.5s',
    dotDelay: '0s',
  },
  {
    name: 'Sajid Mehmood',
    role: 'Field Technician',
    city: 'Islamabad',
    img: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=300&h=220&fit=crop&crop=face&q=90',
    pos: { left: '72.9%', top: '39.7%' } as React.CSSProperties,
    delay: '2s',
    line: 'M 362,209 C 400,250 446,305 474,372',
    dotDur: '3s',
    dotDelay: '1s',
  },
  {
    name: 'Usman Ali',
    role: 'Software Developer',
    city: 'Karachi',
    img: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=300&h=220&fit=crop&crop=face&q=90',
    pos: { left: '0.3%', top: '66.2%' } as React.CSSProperties,
    delay: '4s',
    line: 'M 276,458 C 238,460 205,462 176,462',
    dotDur: '2s',
    dotDelay: '0.5s',
  },
];

/* ── Count-up hook ───────────────────────────────────────────────────────── */
function useCountUp(end: number, suffix = '', duration = 2000) {
  const [display, setDisplay] = useState('0' + suffix);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting || started.current) return;
        started.current = true;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - t0) / duration, 1);
          setDisplay(Math.floor((1 - Math.pow(1 - p, 3)) * end).toLocaleString() + suffix);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [end, suffix, duration]);
  return { display, ref };
}

/* ── Single-open FAQ accordion ───────────────────────────────────────────── */
function FAQList({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <button
            onClick={() => setOpen(open === i ? -1 : i)}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '20px 24px',
              background: open === i ? C.dark : C.surface,
              borderRadius: open === i ? '16px 16px 0 0' : 16,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
              transition: 'all .25s',
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 15.5,
                color: open === i ? '#fff' : C.text,
                flex: 1,
                paddingRight: 16,
              }}
            >
              {item.q}
            </span>
            <span
              style={{
                flexShrink: 0,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: open === i ? C.lime : C.surfaceAlt,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all .25s',
                transform: open === i ? 'rotate(45deg)' : 'rotate(0)',
              }}
            >
              <Plus size={15} color={open === i ? C.dark : C.muted} strokeWidth={2.5} />
            </span>
          </button>
          <div
            style={{
              overflow: 'hidden',
              maxHeight: open === i ? 200 : 0,
              transition: 'max-height .35s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            <div
              style={{
                padding: '16px 24px 20px',
                color: C.muted,
                fontSize: 15,
                lineHeight: 1.72,
                background: C.surface,
                borderRadius: '0 0 16px 16px',
              }}
            >
              {item.a}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Data ────────────────────────────────────────────────────────────────── */
const MARQUEE = [
  'Software Engineering',
  'Healthcare',
  'Finance & Banking',
  'Marketing',
  'Education',
  'IT & Technology',
  'Engineering',
  'Human Resources',
  'Business Analysis',
  'Data Science',
];
const FEATURES = [
  {
    icon: Shield,
    title: 'Verified Employers',
    desc: 'Every company is manually reviewed by Saylani staff. Zero scam risk, zero fake listings.',
  },
  {
    icon: Zap,
    title: 'Smart Job Matching',
    desc: 'Our system puts your profile in front of the right employers automatically.',
  },
  {
    icon: Users,
    title: 'Saylani Endorsement',
    desc: 'Your Saylani certified skills earn a badge that puts you ahead of every other applicant.',
  },
  {
    icon: DollarSign,
    title: 'Always Free',
    desc: "No subscriptions, no premium tiers, no hidden costs. Pakistan's job platform for everyone.",
  },
];
const JOBS = [
  {
    i: 'E',
    title: 'Senior React Developer',
    co: 'Engro Corp',
    loc: 'Karachi',
    type: 'Full-time',
    sal: 'PKR 1.2L',
    skills: ['React', 'TypeScript'],
    color: '#0B4D2C',
  },
  {
    i: 'H',
    title: 'Medical Officer',
    co: 'Shifa International',
    loc: 'Islamabad',
    type: 'Full-time',
    sal: 'PKR 95K',
    skills: ['MBBS', 'Clinical'],
    color: '#9b1c1c',
  },
  {
    i: 'B',
    title: 'Senior Accountant',
    co: 'HBL Bank',
    loc: 'Lahore',
    type: 'Full-time',
    sal: 'PKR 70K',
    skills: ['ACCA', 'SAP'],
    color: '#1e40af',
  },
  {
    i: 'J',
    title: 'Digital Marketing Lead',
    co: 'Jazz Telecom',
    loc: 'Islamabad',
    type: 'Part-time',
    sal: 'PKR 55K',
    skills: ['SEO', 'Meta Ads'],
    color: '#6b21a8',
  },
  {
    i: 'C',
    title: 'Customer Success Lead',
    co: 'Careem',
    loc: 'Karachi',
    type: 'Full-time',
    sal: 'PKR 60K',
    skills: ['CRM', 'Analytics'],
    color: '#92400e',
  },
  {
    i: 'S',
    title: 'Business Analyst',
    co: 'Systems Ltd',
    loc: 'Lahore',
    type: 'Full-time',
    sal: 'PKR 90K',
    skills: ['SQL', 'Power BI'],
    color: '#0B4D2C',
  },
];
const STEPS = [
  {
    n: '01',
    icon: Upload,
    title: 'Create Your Profile',
    desc: 'Sign up free in 2 minutes. Add your Saylani certifications and skills.',
  },
  {
    n: '02',
    icon: Search,
    title: 'Get Matched to Jobs',
    desc: 'Our system surfaces the best-fit roles from 500+ verified employers.',
  },
  {
    n: '03',
    icon: Briefcase,
    title: 'Apply with One Click',
    desc: 'Send your profile directly to employers — no cover letters needed.',
  },
  {
    n: '04',
    icon: CheckCircle2,
    title: 'Land the Interview',
    desc: 'Our average time-to-interview is 4 days. Faster than any other platform.',
  },
];
const FAQS = [
  {
    q: 'Is Saylani Job Bank completely free for job seekers?',
    a: 'Yes — 100% free for all job seekers. Create a profile, browse listings, and apply with no subscription, no hidden fees, and no premium tier. It is a Saylani Welfare initiative.',
  },
  {
    q: 'How does Saylani verify employers?',
    a: 'Every employer is manually reviewed by our Saylani team. We verify business registration, contact details, and legitimacy before any jobs are posted. Only verified employers appear.',
  },
  {
    q: 'Do I need a Saylani certificate to use the platform?',
    a: 'No — any Pakistani job seeker can register and apply. However, Saylani-certified skills earn you an "Endorsed" badge, which significantly increases employer visibility.',
  },
  {
    q: 'Can employers post jobs for free?',
    a: 'Yes. Basic job postings are completely free for verified employers. We are a welfare-driven platform and our mission is to reduce unemployment, not profit from it.',
  },
];
const COMPANIES = [
  { name: 'Engro Corp', sector: 'Energy & Conglomerate', jobs: 12 },
  { name: 'HBL Bank', sector: 'Fintech & Banking', jobs: 20 },
  { name: 'Jazz Telecom', sector: 'Telecommunications', jobs: 15 },
  { name: 'Careem', sector: 'Mobility & Tech', jobs: 11 },
  { name: 'Systems Ltd', sector: 'Enterprise Software', jobs: 18 },
  { name: 'Telenor', sector: 'Telecom & Digital', jobs: 9 },
];

/* ── Phone mockup component ──────────────────────────────────────────────── */
function PhoneMockup() {
  return (
    <div style={{ position: 'relative', width: 260, margin: '0 auto' }}>
      {/* Glow behind */}
      <div
        style={{
          position: 'absolute',
          top: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 240,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(200,240,69,0.22) 0%, transparent 65%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      {/* Phone shell */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: 220,
          margin: '0 auto',
          background: 'linear-gradient(145deg, #1a2e1e 0%, #0e1f14 100%)',
          borderRadius: 36,
          padding: 8,
          boxShadow:
            '0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        {/* Screen bezel */}
        <div
          style={{
            borderRadius: 30,
            overflow: 'hidden',
            background: '#0B1A0F',
            minHeight: 420,
            position: 'relative',
          }}
        >
          {/* Status bar */}
          <div
            style={{
              padding: '10px 18px 8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: 700 }}>
              9:41
            </span>
            <div style={{ width: 56, height: 14, background: '#0e1f14', borderRadius: 7 }} />
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9 }}>●●●</span>
          </div>
          {/* App header */}
          <div style={{ padding: '0 14px 14px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <div>
                <div
                  style={{
                    color: 'rgba(255,255,255,0.45)',
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                  }}
                >
                  SAYLANI JOB BANK
                </div>
                <div style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>
                  Good Morning, Ali 👋
                </div>
              </div>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: C.lime,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 900, color: C.dark }}>A</span>
              </div>
            </div>
            {/* Search bar */}
            <div
              style={{
                background: 'rgba(255,255,255,0.07)',
                borderRadius: 10,
                padding: '7px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 14,
              }}
            >
              <Search size={11} color="rgba(255,255,255,0.3)" strokeWidth={2.5} />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>Search jobs...</span>
            </div>
            {/* Stats mini row */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {[
                ['5.2K+', 'Jobs'],
                ['500+', 'Companies'],
                ['Free', 'Always'],
              ].map(([n, l]) => (
                <div
                  key={l}
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: 8,
                    padding: '7px 0',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ color: C.lime, fontSize: 11, fontWeight: 800, lineHeight: 1 }}>
                    {n}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, marginTop: 2 }}>
                    {l}
                  </div>
                </div>
              ))}
            </div>
            {/* Job cards */}
            <div
              style={{
                color: 'rgba(255,255,255,0.45)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}
            >
              LIVE OPENINGS
            </div>
            {[
              { title: 'React Developer', co: 'Engro Corp', sal: '1.2L/mo', tag: 'Tech' },
              { title: 'Medical Officer', co: "Shifa Int'l", sal: '95K/mo', tag: 'Health' },
              { title: 'Business Analyst', co: 'Systems Ltd', sal: '90K/mo', tag: 'Finance' },
            ].map((j) => (
              <div
                key={j.title}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 10,
                  padding: '9px 11px',
                  marginBottom: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ color: '#fff', fontSize: 10, fontWeight: 700, marginBottom: 2 }}>
                    {j.title}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 8 }}>{j.co}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: C.lime, fontSize: 10, fontWeight: 800 }}>{j.sal}</div>
                  <div
                    style={{
                      background: 'rgba(200,240,69,0.12)',
                      borderRadius: 4,
                      padding: '1px 5px',
                      marginTop: 2,
                    }}
                  >
                    <span style={{ color: C.lime, fontSize: 7, fontWeight: 700 }}>{j.tag}</span>
                  </div>
                </div>
              </div>
            ))}
            {/* Apply button */}
            <div
              style={{
                background: C.lime,
                borderRadius: 10,
                padding: '10px',
                textAlign: 'center',
                marginTop: 4,
              }}
            >
              <span style={{ color: C.dark, fontSize: 11, fontWeight: 800 }}>Apply Now →</span>
            </div>
          </div>
        </div>
      </div>
      {/* Side button */}
      <div
        style={{
          position: 'absolute',
          top: 80,
          right: -4,
          width: 4,
          height: 40,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '0 3px 3px 0',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 60,
          left: -4,
          width: 4,
          height: 26,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '3px 0 0 3px',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 94,
          left: -4,
          width: 4,
          height: 26,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '3px 0 0 3px',
        }}
      />
      {/* Floating notification */}
      <div
        className="float-slow"
        style={{
          position: 'absolute',
          bottom: -12,
          right: -32,
          background: '#fff',
          borderRadius: 12,
          padding: '10px 14px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
          minWidth: 140,
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: '#EEF9C0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CheckCircle2 size={14} color={C.primary} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 11, color: C.text }}>Interview Booked!</div>
            <div style={{ color: C.muted, fontSize: 9, marginTop: 1 }}>
              Engro Corp — Tomorrow 10am
            </div>
          </div>
        </div>
      </div>
      <div
        className="float"
        style={{
          position: 'absolute',
          top: 36,
          left: -40,
          background: C.lime,
          borderRadius: 12,
          padding: '10px 14px',
          boxShadow: '0 12px 32px rgba(200,240,69,0.35)',
          zIndex: 20,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 18, color: C.dark, lineHeight: 1 }}>5,200+</div>
        <div style={{ color: C.primary, fontSize: 9, fontWeight: 700, marginTop: 2 }}>
          Live Jobs
        </div>
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────────────── */
export default function LandingPage({
  signedIn: _s,
  dashboardHref: _d,
}: {
  signedIn: boolean;
  dashboardHref: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [activeTab, setActiveTab] = useState('All');
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);
  const [howTab, setHowTab] = useState<'applicants' | 'employers'>('applicants');

  const s1 = useCountUp(5200, '+');
  const s2 = useCountUp(50000, '+');
  const s3 = useCountUp(500, '+');
  const s4 = useCountUp(98, '%');

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  return (
    <div style={{ background: C.bg, overflowX: 'hidden', fontFamily: 'inherit', color: C.text }}>
      <style>{`
        @keyframes mqScroll    { 0%{transform:translateX(0)}  100%{transform:translateX(-50%)} }
        @keyframes floatY      { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-10px)} }
        @keyframes floatYSlow  { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-6px)} }
        @keyframes fadeUp      { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn      { from{opacity:0} to{opacity:1} }
        @keyframes pulse       { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes ringPulse   { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.8);opacity:0} }
        @keyframes mapShimmer  { 0%,100%{opacity:.75} 50%{opacity:1} }
        @keyframes shimmer     { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
        @keyframes slideInUp   { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
        @keyframes scaleIn     { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }

        .mq        { animation: mqScroll 38s linear infinite; }
        .float     { animation: floatY 5.5s ease-in-out infinite; }
        .float-slow{ animation: floatYSlow 7s ease-in-out infinite; }
        .a1 { animation: fadeUp .65s .00s ease both }
        .a2 { animation: fadeUp .65s .10s ease both }
        .a3 { animation: fadeUp .65s .22s ease both }
        .a4 { animation: fadeUp .65s .34s ease both }
        .dot-pulse { animation: pulse 2s ease-in-out infinite; }
        .ring { transform-box: fill-box; transform-origin: center; }
        .ring-1 { animation: ringPulse 2.8s ease-out infinite 0.0s; }
        .ring-2 { animation: ringPulse 2.8s ease-out infinite 0.9s; }
        .ring-3 { animation: ringPulse 2.8s ease-out infinite 1.8s; }

        .nav-link { color:${C.muted}; font-size:14px; font-weight:500; text-decoration:none; transition:color .2s; }
        .nav-link:hover { color:${C.primary}; }

        .feat-card { transition:transform .22s,box-shadow .22s; cursor:default; }
        .feat-card:hover { transform:translateY(-7px); box-shadow:0 28px 60px rgba(11,77,44,0.14)!important; }

        .job-row { transition:background .18s, transform .18s; }
        .job-row:hover { background:${C.surface}!important; transform:translateX(4px); }

        .step-card { transition:transform .2s, box-shadow .2s; }
        .step-card:hover { transform:translateY(-5px); box-shadow:0 20px 48px rgba(0,0,0,0.09)!important; }

        .cta-btn-lime { transition:all .22s; }
        .cta-btn-lime:hover { transform:translateY(-2px); box-shadow:0 14px 36px rgba(200,240,69,0.45)!important; }

        .tab-pill { transition:all .18s; cursor:pointer; font-family:inherit; border:none; }
        .tab-pill:hover { background:${C.primary}!important; color:#fff!important; }

        .apply-btn { transition:all .18s; cursor:pointer; font-family:inherit; border:none; }
        .apply-btn:hover { background:${C.primary}!important; color:#fff!important; }

        .company-card { transition:all .2s; cursor:default; }
        .company-card:hover { transform:translateY(-3px); background:#fff!important; box-shadow:0 12px 32px rgba(11,77,44,0.10)!important; }

        .footer-link { color:rgba(255,255,255,0.38); font-size:14px; text-decoration:none; transition:color .2s; }
        .footer-link:hover { color:${C.lime}; }

        .city-dot-grp { cursor: pointer; }

        .path-card { transition:transform .28s, box-shadow .28s; }
        .path-card:hover { transform:translateY(-5px); box-shadow:0 32px 72px rgba(0,0,0,0.28)!important; }

        .social-btn { transition:all .2s; }
        .social-btn:hover { background:rgba(200,240,69,0.15)!important; color:${C.lime}!important; }

        .how-tab { transition:all .2s; cursor:pointer; border:none; font-family:inherit; }
        .how-tab:hover { background:${C.surfaceAlt}!important; }
      `}</style>

      {/* ═══ NAVBAR ═══════════════════════════════════════════════════════ */}
      <nav
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 500,
          background: scrolled ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(20px)',
          boxShadow: scrolled
            ? '0 1px 0 rgba(0,0,0,0.08),0 4px 24px rgba(0,0,0,0.06)'
            : '0 1px 0 rgba(0,0,0,0.04)',
          height: 66,
          display: 'flex',
          alignItems: 'center',
          transition: 'all .3s',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 40px',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <NextLink
            href="/"
            style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: C.dark,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 4px 12px ${C.shadow}`,
              }}
            >
              <Briefcase size={16} color={C.lime} strokeWidth={2.2} />
            </div>
            <span
              style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: '-0.025em', color: C.text }}
            >
              Saylani <span style={{ color: C.primary }}>Job Bank</span>
            </span>
          </NextLink>
          <div style={{ display: 'flex', gap: 36 }}>
            {['Home', 'About Us', 'How It Works', 'Contact'].map((l) => (
              <a key={l} href="#" className="nav-link">
                {l}
              </a>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <NextLink
              href="/login"
              style={{
                color: C.muted,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                padding: '8px 16px',
                borderRadius: 8,
              }}
            >
              Log In
            </NextLink>
            <NextLink
              href="/register"
              style={{
                background: C.dark,
                color: C.lime,
                fontSize: 14,
                fontWeight: 700,
                padding: '9px 22px',
                borderRadius: 10,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                boxShadow: `0 4px 16px rgba(14,31,20,0.25)`,
                letterSpacing: '-0.01em',
              }}
            >
              Sign Up <ArrowRight size={13} />
            </NextLink>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══════════════════════════════════════════════════════════ */}
      <section
        style={{
          paddingTop: 66,
          minHeight: '100vh',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          overflow: 'hidden',
        }}
      >
        {/* LEFT */}
        <div
          style={{
            background: C.surface,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '72px 48px 72px 10vw',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: -100,
              right: -80,
              width: 380,
              height: 380,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(200,240,69,0.12) 0%, transparent 65%)',
              pointerEvents: 'none',
            }}
          />

          <div
            className="a1"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: C.limeLight,
              borderRadius: 100,
              padding: '6px 16px',
              marginBottom: 26,
              width: 'fit-content',
            }}
          >
            <div
              className="dot-pulse"
              style={{ width: 7, height: 7, borderRadius: '50%', background: C.primary }}
            />
            <span style={{ color: C.primary, fontSize: 13, fontWeight: 700 }}>
              Pakistan's #1 Free Job Platform
            </span>
          </div>

          <h1
            className="a2"
            style={{
              fontSize: 'clamp(40px,4.6vw,70px)',
              fontWeight: 900,
              lineHeight: 1.04,
              letterSpacing: '-0.045em',
              margin: '0 0 20px',
              color: C.text,
            }}
          >
            Rizq,
            <br />
            <span style={{ color: C.primary }}>Opportunity</span>
            <br />
            &amp; Purpose.
          </h1>

          <p
            className="a3"
            style={{
              fontSize: 16,
              color: C.muted,
              lineHeight: 1.75,
              maxWidth: 400,
              margin: '0 0 28px',
            }}
          >
            Saylani Job Bank connects talented individuals with meaningful job opportunities — and
            helps businesses find the right people, completely free.
          </p>

          <div
            className="a3"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: C.bg,
              borderRadius: 14,
              padding: '8px 8px 8px 18px',
              boxShadow: '0 4px 28px rgba(0,0,0,0.08)',
              marginBottom: 18,
            }}
          >
            <Search size={16} color={C.muted} strokeWidth={2} style={{ flexShrink: 0 }} />
            <span style={{ color: C.muted, fontSize: 14, flex: 1 }}>
              Job title, skills, or company...
            </span>
            <NextLink
              href="/register"
              style={{
                background: C.dark,
                color: C.lime,
                padding: '11px 22px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              Find Jobs
            </NextLink>
          </div>

          <div
            className="a3"
            style={{
              display: 'flex',
              gap: 7,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: 36,
            }}
          >
            <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Popular:</span>
            {['Software', 'Healthcare', 'Finance', 'Education', 'Engineering'].map((cat) => (
              <a
                key={cat}
                href="#"
                style={{
                  background: C.bg,
                  color: C.text,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '5px 13px',
                  borderRadius: 100,
                  textDecoration: 'none',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                }}
              >
                {cat}
              </a>
            ))}
          </div>

          <div
            className="a4"
            style={{ display: 'flex', gap: 28, paddingTop: 28, borderTop: `1px solid ${C.border}` }}
          >
            {[
              ['5,200+', 'Open Roles'],
              ['500+', 'Companies'],
              ['100%', 'Free'],
            ].map(([n, l]) => (
              <div key={l}>
                <div
                  style={{
                    fontWeight: 900,
                    fontSize: 24,
                    color: C.text,
                    letterSpacing: '-0.04em',
                    lineHeight: 1,
                  }}
                >
                  {n}
                </div>
                <div style={{ color: C.muted, fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                  {l}
                </div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex' }}>
                {['#4ADE80', '#34D399', '#10B981', '#059669'].map((col, i) => (
                  <div
                    key={i}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: col,
                      border: '2.5px solid white',
                      marginLeft: i === 0 ? 0 : -8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: 9, fontWeight: 900, color: '#fff' }}>
                      {['A', 'R', 'S', 'M'][i]}
                    </span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: 'flex', gap: 1.5 }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} size={10} color="#F59E0B" fill="#F59E0B" />
                  ))}
                </div>
                <span style={{ color: C.muted, fontSize: 11, fontWeight: 500 }}>
                  50K+ Job Seekers
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — Pakistan map */}
        <div
          style={{
            background: 'linear-gradient(150deg, #F2FAF5 0%, #E6F4EB 100%)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'radial-gradient(rgba(11,77,44,0.055) 1.5px, transparent 1.5px)',
              backgroundSize: '28px 28px',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '42%',
              left: '55%',
              transform: 'translate(-50%,-50%)',
              width: 420,
              height: 420,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(200,240,69,0.14) 0%, transparent 65%)',
              pointerEvents: 'none',
            }}
          />

          <div style={{ width: '88%', maxWidth: 480, position: 'relative' }}>
            <svg viewBox="0 0 650 680" style={{ width: '100%', height: 'auto', display: 'block' }}>
              <defs>
                <linearGradient id="pkFillL" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="rgba(168,220,185,0.92)" />
                  <stop offset="100%" stopColor="rgba(136,198,160,0.82)" />
                </linearGradient>
                <filter id="pinGlow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <marker
                  id="arrG"
                  markerWidth="7"
                  markerHeight="7"
                  refX="5.5"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M 0,0 L 7,3.5 L 0,7 Z" fill="rgba(11,77,44,0.38)" />
                </marker>
              </defs>

              <g transform="translate(150, 100)">
                <path
                  d={PK_PATH}
                  fill="url(#pkFillL)"
                  stroke="#5DB87A"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <text
                  x="200"
                  y="30"
                  textAnchor="middle"
                  fontSize="7.5"
                  fill="#3A8A54"
                  fontWeight="700"
                  letterSpacing="0.12em"
                  opacity="0.72"
                >
                  GILGIT BALTISTAN
                </text>
                <text
                  x="100"
                  y="90"
                  textAnchor="middle"
                  fontSize="7.5"
                  fill="#3A8A54"
                  fontWeight="700"
                  letterSpacing="0.10em"
                  opacity="0.68"
                >
                  KPK
                </text>
                <text
                  x="225"
                  y="182"
                  textAnchor="middle"
                  fontSize="10"
                  fill="#3A8A54"
                  fontWeight="800"
                  letterSpacing="0.10em"
                  opacity="0.70"
                >
                  PUNJAB
                </text>
                <text
                  x="83"
                  y="242"
                  textAnchor="middle"
                  fontSize="7.5"
                  fill="#3A8A54"
                  fontWeight="700"
                  letterSpacing="0.08em"
                  opacity="0.68"
                >
                  BALOCHISTAN
                </text>
                <text
                  x="165"
                  y="328"
                  textAnchor="middle"
                  fontSize="8.5"
                  fill="#3A8A54"
                  fontWeight="700"
                  letterSpacing="0.08em"
                  opacity="0.68"
                >
                  SINDH
                </text>

                {CITIES.map((city) => {
                  const active = hoveredCity === city.id;
                  return (
                    <g
                      key={city.id}
                      className="city-dot-grp"
                      onMouseEnter={() => setHoveredCity(city.id)}
                      onMouseLeave={() => setHoveredCity(null)}
                    >
                      <circle cx={city.x} cy={city.y} r={20} fill="transparent" />
                      <circle
                        className="ring ring-1"
                        cx={city.x}
                        cy={city.y}
                        r={9}
                        fill="none"
                        stroke={active ? C.primary : 'rgba(11,77,44,0.42)'}
                        strokeWidth="1.4"
                      />
                      <circle
                        cx={city.x}
                        cy={city.y}
                        r={active ? 10 : 8}
                        fill={active ? 'rgba(11,77,44,0.17)' : 'rgba(11,77,44,0.10)'}
                        style={{ transition: 'all .2s' }}
                      />
                      <circle
                        cx={city.x}
                        cy={city.y}
                        r={active ? 6.5 : 5.5}
                        fill={C.primary}
                        filter="url(#pinGlow)"
                        style={{ transition: 'r .2s' }}
                      />
                      <circle cx={city.x} cy={city.y} r={2.8} fill="#fff" />
                    </g>
                  );
                })}
              </g>

              {MAP_CARDS.map((cand) => (
                <g key={cand.name + '-line'}>
                  <path
                    d={cand.line}
                    fill="none"
                    stroke="rgba(11,77,44,0.25)"
                    strokeWidth="1.8"
                    strokeDasharray="5,4"
                    markerEnd="url(#arrG)"
                  />
                  <circle r="4.5" fill={C.primary} opacity="0.7">
                    <animateMotion
                      dur={cand.dotDur}
                      repeatCount="indefinite"
                      begin={cand.dotDelay}
                      path={cand.line}
                    />
                  </circle>
                </g>
              ))}
            </svg>

            {MAP_CARDS.map((cand) => (
              <div
                key={cand.name}
                className="float"
                style={{
                  position: 'absolute',
                  ...cand.pos,
                  animationDelay: cand.delay,
                  width: '26.5%',
                  borderRadius: 16,
                  overflow: 'hidden',
                  background: '#fff',
                  boxShadow: '0 18px 52px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.07)',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    paddingTop: '78%',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={cand.img}
                    alt={cand.name}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'top center',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background:
                        'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.15) 100%)',
                    }}
                  />
                </div>
                <div style={{ padding: '10px 12px 11px' }}>
                  <div
                    style={{ fontWeight: 800, fontSize: 12.5, color: C.text, marginBottom: 1.5 }}
                  >
                    {cand.name}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 7 }}>{cand.role}</div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: '#EF4444',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>
                        {cand.city}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        background: C.limeLight,
                        borderRadius: 100,
                        padding: '2px 8px',
                      }}
                    >
                      <div
                        style={{ width: 4, height: 4, borderRadius: '50%', background: C.primary }}
                      />
                      <span style={{ fontSize: 9, fontWeight: 800, color: C.primary }}>
                        Available
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {hoveredCity &&
              (() => {
                const city = CITIES.find((c) => c.id === hoveredCity)!;
                const xPct = ((150 + city.x) / 650) * 100;
                const yPct = ((100 + city.y) / 680) * 100;
                const isLow = yPct > 64;
                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${xPct}%`,
                      ...(isLow ? { bottom: `${100 - yPct + 2}%` } : { top: `${yPct + 2.2}%` }),
                      transform: 'translateX(-50%)',
                      background: '#fff',
                      borderRadius: 12,
                      padding: '9px 13px',
                      boxShadow: '0 8px 28px rgba(0,0,0,0.14)',
                      minWidth: 152,
                      maxWidth: 190,
                      zIndex: 40,
                      pointerEvents: 'none',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: '50%',
                        ...(isLow ? { bottom: -5 } : { top: -5 }),
                        transform: 'translateX(-50%) rotate(45deg)',
                        width: 9,
                        height: 9,
                        background: '#fff',
                      }}
                    />
                    <div
                      style={{ fontWeight: 800, fontSize: 12.5, color: C.text, marginBottom: 3 }}
                    >
                      {city.name}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.55 }}>
                      {city.detail}
                    </div>
                  </div>
                );
              })()}

            <div
              className="float"
              style={{
                position: 'absolute',
                left: '72.3%',
                top: '86.8%',
                animationDelay: '1s',
                background: C.lime,
                borderRadius: 16,
                padding: '14px 18px',
                boxShadow: '0 12px 36px rgba(200,240,69,0.40)',
                zIndex: 10,
              }}
            >
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 24,
                  color: C.dark,
                  lineHeight: 1,
                  letterSpacing: '-0.04em',
                }}
              >
                5,200+
              </div>
              <div style={{ color: C.primary, fontSize: 10, fontWeight: 700, marginTop: 3 }}>
                Live Jobs Now
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ STATS STRIP ════════════════════════════════════════════════════ */}
      <section style={{ background: C.bg, padding: '0 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', padding: '56px 0' }}
          >
            {[
              { r: s1.ref, d: s1.display, l: 'Open Roles', s: 'Across Pakistan', icon: Briefcase },
              { r: s2.ref, d: s2.display, l: 'Job Seekers', s: 'Registered & Active', icon: Users },
              {
                r: s3.ref,
                d: s3.display,
                l: 'Employers',
                s: 'Verified & Trusted',
                icon: Building2,
              },
              {
                r: s4.ref,
                d: s4.display,
                l: 'Success Rate',
                s: 'Of applicants hired',
                icon: TrendingUp,
              },
            ].map(({ r, d, l, s, icon: Icon }, i) => (
              <div
                key={l}
                ref={r}
                style={{
                  textAlign: 'center',
                  padding: '0 32px',
                  borderRight: i < 3 ? `1px solid ${C.border}` : 'none',
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: C.limeLight,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 14px',
                  }}
                >
                  <Icon size={20} color={C.primary} />
                </div>
                <div
                  style={{
                    fontSize: 'clamp(32px,4vw,52px)',
                    fontWeight: 900,
                    color: C.text,
                    lineHeight: 1,
                    marginBottom: 6,
                    letterSpacing: '-0.04em',
                  }}
                >
                  {d}
                </div>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 3 }}>
                  {l}
                </div>
                <div style={{ color: C.muted, fontSize: 12 }}>{s}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ MARQUEE STRIP ══════════════════════════════════════════════════ */}
      <section style={{ background: C.primary, padding: '14px 0', overflow: 'hidden' }}>
        <div className="mq" style={{ display: 'flex', width: 'max-content' }}>
          {[...MARQUEE, ...MARQUEE, ...MARQUEE].map((item, i) => (
            <span
              key={i}
              style={{ display: 'flex', alignItems: 'center', gap: 24, paddingRight: 24 }}
            >
              <span
                style={{
                  color: 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                {item}
              </span>
              <span style={{ color: C.lime, fontSize: 12 }}>✦</span>
            </span>
          ))}
        </div>
      </section>

      {/* ═══ TRUSTED COMPANIES ══════════════════════════════════════════════ */}
      <section style={{ background: C.surface, padding: '72px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <h2
              style={{
                fontSize: 'clamp(24px,3vw,40px)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                margin: '0 0 12px',
                color: C.text,
              }}
            >
              Trusted by Leading Companies &amp; Enterprises
            </h2>
            <p style={{ color: C.muted, fontSize: 15, maxWidth: 500, margin: '0 auto' }}>
              Over 500+ verified organizations and industry leaders recruit qualified, pre-screened
              talent from Saylani Job Bank.
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
              maxWidth: 820,
              margin: '0 auto 36px',
            }}
          >
            {COMPANIES.map((co) => (
              <div
                key={co.name}
                className="company-card"
                style={{
                  background: C.bg,
                  borderRadius: 14,
                  padding: '18px 22px',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 14,
                      color: C.text,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    {co.name}
                    <CheckCircle2 size={13} color={C.primary} strokeWidth={2.5} />
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>{co.sector}</div>
                </div>
                <div style={{ background: C.limeLight, borderRadius: 8, padding: '4px 10px' }}>
                  <span style={{ color: C.primary, fontSize: 11, fontWeight: 700 }}>
                    {co.jobs} Openings
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 40, justifyContent: 'center' }}>
            {[
              '500+ Registered Companies',
              'Direct Hiring Without Brokerage',
              '100% Pre-Evaluated Talent',
            ].map((t) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <CheckCircle2 size={15} color={C.primary} strokeWidth={2.5} />
                <span style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TWO PATHWAYS ═══════════════════════════════════════════════════ */}
      <section style={{ background: C.bg, padding: '100px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: C.limeLight,
                borderRadius: 100,
                padding: '6px 18px',
                marginBottom: 18,
              }}
            >
              <span style={{ color: C.primary, fontSize: 13, fontWeight: 700 }}>
                Two Pathways. One Goal.
              </span>
            </div>
            <h2
              style={{
                fontSize: 'clamp(30px,4vw,52px)',
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: '-0.035em',
                margin: '0 0 16px',
                color: C.text,
              }}
            >
              What are you looking for?
            </h2>
            <p
              style={{
                color: C.muted,
                fontSize: 16,
                lineHeight: 1.7,
                maxWidth: 500,
                margin: '0 auto',
              }}
            >
              Whether you're building your career or growing your team, Saylani Job Bank makes the
              process simple and effective.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Job Seeker card — with bg image */}
            <div
              className="path-card"
              style={{
                borderRadius: 28,
                padding: 44,
                position: 'relative',
                overflow: 'hidden',
                minHeight: 380,
                boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
              }}
            >
              {/* Background image */}
              <img
                src={IMG_JOB_BG}
                alt=""
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center',
                }}
              />
              {/* Overlay */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(135deg, rgba(245,248,242,0.95) 0%, rgba(237,242,229,0.88) 100%)',
                }}
              />
              {/* Content */}
              <div style={{ position: 'relative', zIndex: 2 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 18,
                    background: C.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 22,
                    boxShadow: '0 8px 24px rgba(11,77,44,0.12)',
                  }}
                >
                  <Briefcase size={26} color={C.primary} />
                </div>
                <h3
                  style={{
                    fontWeight: 900,
                    fontSize: 28,
                    color: C.text,
                    letterSpacing: '-0.03em',
                    margin: '0 0 14px',
                    lineHeight: 1.1,
                  }}
                >
                  I'm looking
                  <br />
                  for a job
                </h3>
                <p
                  style={{
                    color: C.muted,
                    fontSize: 15,
                    lineHeight: 1.75,
                    margin: '0 0 32px',
                    maxWidth: 300,
                  }}
                >
                  Explore thousands of job opportunities from trusted, verified employers across
                  Pakistan. Your dream job is one click away.
                </p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <NextLink
                    href="/register"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      background: C.dark,
                      color: C.lime,
                      padding: '13px 26px',
                      borderRadius: 12,
                      fontWeight: 700,
                      fontSize: 14,
                      textDecoration: 'none',
                    }}
                  >
                    Find Jobs <ArrowRight size={14} />
                  </NextLink>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['Software', 'Finance', 'Health'].map((t) => (
                      <span
                        key={t}
                        style={{
                          background: C.bg,
                          color: C.primary,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '5px 12px',
                          borderRadius: 100,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Hiring card — with bg image */}
            <div
              className="path-card"
              style={{
                borderRadius: 28,
                padding: 44,
                position: 'relative',
                overflow: 'hidden',
                minHeight: 380,
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              }}
            >
              {/* Background image */}
              <img
                src={IMG_HIRE_BG}
                alt=""
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center',
                }}
              />
              {/* Overlay */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(135deg, rgba(14,31,20,0.93) 0%, rgba(11,77,44,0.85) 100%)',
                }}
              />
              {/* Content */}
              <div style={{ position: 'relative', zIndex: 2 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 18,
                    background: 'rgba(200,240,69,0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 22,
                    border: '1px solid rgba(200,240,69,0.2)',
                  }}
                >
                  <Building2 size={26} color={C.lime} />
                </div>
                <h3
                  style={{
                    fontWeight: 900,
                    fontSize: 28,
                    color: '#fff',
                    letterSpacing: '-0.03em',
                    margin: '0 0 14px',
                    lineHeight: 1.1,
                  }}
                >
                  I'm hiring
                  <br />
                  talent
                </h3>
                <p
                  style={{
                    color: 'rgba(255,255,255,0.55)',
                    fontSize: 15,
                    lineHeight: 1.75,
                    margin: '0 0 32px',
                    maxWidth: 300,
                  }}
                >
                  Find skilled, reliable, and motivated talent for your team — pre-screened, Saylani
                  endorsed, and ready to contribute from day one.
                </p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <NextLink
                    href="/register"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      background: C.lime,
                      color: C.dark,
                      padding: '13px 26px',
                      borderRadius: 12,
                      fontWeight: 700,
                      fontSize: 14,
                      textDecoration: 'none',
                    }}
                  >
                    Post a Job <ArrowRight size={14} />
                  </NextLink>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['500+ Candidates', 'Free', 'Verified'].map((t) => (
                      <span
                        key={t}
                        style={{
                          background: 'rgba(200,240,69,0.12)',
                          color: C.lime,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '5px 12px',
                          borderRadius: 100,
                          border: '1px solid rgba(200,240,69,0.18)',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ LIVE JOB LISTINGS ══════════════════════════════════════════════ */}
      <section style={{ background: C.surface, padding: '100px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              marginBottom: 40,
            }}
          >
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: C.bg,
                  borderRadius: 100,
                  padding: '5px 14px',
                  marginBottom: 16,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                }}
              >
                <div
                  className="dot-pulse"
                  style={{ width: 7, height: 7, borderRadius: '50%', background: '#22C55E' }}
                />
                <span
                  style={{
                    color: C.muted,
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  Live Openings
                </span>
              </div>
              <h2
                style={{
                  fontSize: 'clamp(28px,3.5vw,46px)',
                  fontWeight: 800,
                  lineHeight: 1.1,
                  letterSpacing: '-0.035em',
                  margin: 0,
                  color: C.text,
                }}
              >
                Roles worth looking at.
              </h2>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {['All', 'Full-time', 'Part-time'].map((t) => (
                <button
                  key={t}
                  className="tab-pill"
                  onClick={() => setActiveTab(t)}
                  style={{
                    background: activeTab === t ? C.primary : C.bg,
                    color: activeTab === t ? '#fff' : C.muted,
                    borderRadius: 100,
                    padding: '8px 20px',
                    fontSize: 13,
                    fontWeight: 600,
                    boxShadow: activeTab === t ? 'none' : '0 2px 8px rgba(0,0,0,0.05)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '3fr 2fr 1.5fr 1.5fr 1.2fr 140px',
              gap: 16,
              padding: '12px 24px',
              marginBottom: 8,
            }}
          >
            {['Job Title', 'Company', 'Location', 'Type', 'Salary', ''].map((h) => (
              <div
                key={h}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                }}
              >
                {h}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {JOBS.filter((j) => activeTab === 'All' || j.type === activeTab).map((job) => (
              <div
                key={job.title}
                className="job-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '3fr 2fr 1.5fr 1.5fr 1.2fr 140px',
                  gap: 16,
                  padding: '18px 24px',
                  background: C.bg,
                  borderRadius: 16,
                  alignItems: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      background: job.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {job.i}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{job.title}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      {job.skills.map((s) => (
                        <span
                          key={s}
                          style={{
                            background: C.limeLight,
                            color: C.primary,
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 6,
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>{job.co}</div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 13,
                    color: C.muted,
                  }}
                >
                  <MapPin size={11} />
                  {job.loc}
                </div>
                <div>
                  <span
                    style={{
                      background: job.type === 'Full-time' ? '#F0FDF4' : '#FAF5FF',
                      color: job.type === 'Full-time' ? '#16A34A' : '#7C3AED',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 12px',
                      borderRadius: 100,
                    }}
                  >
                    {job.type}
                  </span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{job.sal}</div>
                <button
                  className="apply-btn"
                  style={{
                    background: C.limeLight,
                    color: C.primary,
                    borderRadius: 10,
                    padding: '9px 18px',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  Apply Now →
                </button>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <NextLink
              href="/register"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: C.dark,
                color: C.lime,
                padding: '13px 28px',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: 'none',
              }}
            >
              Browse All Jobs <ArrowRight size={14} />
            </NextLink>
          </div>
        </div>
      </section>

      {/* ═══ FEATURES ═══════════════════════════════════════════════════════ */}
      <section style={{ background: C.bg, padding: '100px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '44% 1fr',
              gap: 64,
              alignItems: 'center',
              marginBottom: 64,
            }}
          >
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: C.limeLight,
                  borderRadius: 100,
                  padding: '6px 18px',
                  marginBottom: 18,
                }}
              >
                <span style={{ color: C.primary, fontSize: 13, fontWeight: 700 }}>
                  Why Choose Us
                </span>
              </div>
              <h2
                style={{
                  fontSize: 'clamp(28px,3.5vw,48px)',
                  fontWeight: 800,
                  lineHeight: 1.1,
                  letterSpacing: '-0.035em',
                  margin: 0,
                  color: C.text,
                }}
              >
                Essential features for
                <br />
                modern job hunting.
              </h2>
            </div>
            <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.76, margin: 0 }}>
              Built from the ground up for Pakistani professionals — verified employers, smart
              matching, and Saylani endorsement to help you stand out.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="feat-card"
                style={{
                  background: i === 1 ? C.dark : i === 2 ? C.primary : C.surface,
                  borderRadius: 24,
                  padding: '32px 28px',
                  boxShadow:
                    i === 0 || i === 3
                      ? '0 4px 20px rgba(0,0,0,0.05)'
                      : '0 16px 48px rgba(14,31,20,0.2)',
                }}
              >
                <div
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 14,
                    background:
                      i === 1
                        ? 'rgba(200,240,69,0.12)'
                        : i === 2
                          ? 'rgba(255,255,255,0.15)'
                          : C.limeLight,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 20,
                  }}
                >
                  <f.icon size={22} color={i === 1 ? C.lime : i === 2 ? '#fff' : C.primary} />
                </div>
                <h3
                  style={{
                    fontWeight: 800,
                    fontSize: 18,
                    letterSpacing: '-0.025em',
                    margin: '0 0 10px',
                    lineHeight: 1.2,
                    color: i === 1 || i === 2 ? '#fff' : C.text,
                  }}
                >
                  {f.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.72,
                    margin: '0 0 20px',
                    color:
                      i === 1
                        ? 'rgba(255,255,255,0.45)'
                        : i === 2
                          ? 'rgba(255,255,255,0.55)'
                          : C.muted,
                  }}
                >
                  {f.desc}
                </p>
                <a
                  href="#"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontWeight: 700,
                    fontSize: 13,
                    color: i === 1 || i === 2 ? C.lime : C.primary,
                    textDecoration: 'none',
                  }}
                >
                  Learn More <ArrowUpRight size={13} />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS (tabbed) ══════════════════════════════════════════ */}
      <section style={{ background: C.surface, padding: '100px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: C.bg,
                borderRadius: 100,
                padding: '6px 18px',
                marginBottom: 18,
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              }}
            >
              <span style={{ color: C.primary, fontSize: 13, fontWeight: 700 }}>
                Getting Started is Easy
              </span>
            </div>
            <h2
              style={{
                fontSize: 'clamp(28px,3.5vw,48px)',
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: '-0.035em',
                margin: '0 0 24px',
                color: C.text,
              }}
            >
              Getting started is easy.
            </h2>
            {/* Tabs */}
            <div
              style={{
                display: 'inline-flex',
                background: C.bg,
                borderRadius: 12,
                padding: 4,
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                gap: 2,
              }}
            >
              {(['applicants', 'employers'] as const).map((tab) => (
                <button
                  key={tab}
                  className="how-tab"
                  onClick={() => setHowTab(tab)}
                  style={{
                    padding: '10px 28px',
                    borderRadius: 10,
                    fontWeight: 700,
                    fontSize: 14,
                    background: howTab === tab ? C.dark : 'transparent',
                    color: howTab === tab ? C.lime : C.muted,
                  }}
                >
                  {tab === 'applicants' ? 'For Applicants' : 'For Employers'}
                </button>
              ))}
            </div>
          </div>

          {howTab === 'applicants' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
              {STEPS.map((step, i) => (
                <div
                  key={step.n}
                  className="step-card"
                  style={{
                    background: C.bg,
                    borderRadius: 24,
                    padding: '32px 24px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 14,
                        background: i === 1 ? C.lime : C.limeLight,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <step.icon size={22} color={i === 1 ? C.dark : C.primary} />
                    </div>
                    <span
                      style={{
                        fontSize: 32,
                        fontWeight: 900,
                        color: C.surfaceAlt,
                        letterSpacing: '-0.04em',
                        lineHeight: 1,
                      }}
                    >
                      {step.n}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontWeight: 800,
                      fontSize: 17,
                      color: C.text,
                      letterSpacing: '-0.02em',
                      margin: '0 0 10px',
                      lineHeight: 1.2,
                    }}
                  >
                    {step.title}
                  </h3>
                  <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: 0 }}>
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          )}

          {howTab === 'employers' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
              {[
                {
                  n: '01',
                  icon: Building2,
                  title: 'Register Your Company',
                  desc: 'Submit your business details for Saylani verification. Approval takes 24-48 hours.',
                },
                {
                  n: '02',
                  icon: Briefcase,
                  title: 'Post Your Vacancy',
                  desc: 'Describe the role, requirements, and salary range. Completely free to post.',
                },
                {
                  n: '03',
                  icon: Search,
                  title: 'Review Applications',
                  desc: 'Browse matched applicants with Saylani skill endorsements attached to their profiles.',
                },
                {
                  n: '04',
                  icon: CheckCircle2,
                  title: 'Hire the Best Fit',
                  desc: 'Message candidates directly and schedule interviews — no brokerage, no middleman.',
                },
              ].map((step, i) => (
                <div
                  key={step.n}
                  className="step-card"
                  style={{
                    background: C.bg,
                    borderRadius: 24,
                    padding: '32px 24px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 14,
                        background: i === 2 ? C.lime : C.limeLight,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <step.icon size={22} color={i === 2 ? C.dark : C.primary} />
                    </div>
                    <span
                      style={{
                        fontSize: 32,
                        fontWeight: 900,
                        color: C.surfaceAlt,
                        letterSpacing: '-0.04em',
                        lineHeight: 1,
                      }}
                    >
                      {step.n}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontWeight: 800,
                      fontSize: 17,
                      color: C.text,
                      letterSpacing: '-0.02em',
                      margin: '0 0 10px',
                      lineHeight: 1.2,
                    }}
                  >
                    {step.title}
                  </h3>
                  <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: 0 }}>
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              marginTop: 40,
              background: C.bg,
              borderRadius: 24,
              padding: '36px 48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 20,
                  color: C.text,
                  letterSpacing: '-0.03em',
                  margin: '0 0 6px',
                }}
              >
                Create your free account today
              </div>
              <div style={{ color: C.muted, fontSize: 14 }}>
                Sign up → Fill your profile → Discover matches → Find your next job
              </div>
            </div>
            <NextLink
              href="/register"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: C.dark,
                color: C.lime,
                padding: '13px 26px',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              Get Started Free <ArrowRight size={14} />
            </NextLink>
          </div>
        </div>
      </section>

      {/* ═══ ABOUT ══════════════════════════════════════════════════════════ */}
      <section style={{ background: C.bg, padding: '100px 40px' }}>
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '48% 52%',
            gap: 80,
            alignItems: 'center',
          }}
        >
          <div style={{ position: 'relative' }}>
            <div
              style={{
                borderRadius: 28,
                overflow: 'hidden',
                height: 520,
                boxShadow: '0 28px 72px rgba(0,0,0,0.12)',
              }}
            >
              <img
                src={IMG_ABOUT}
                alt="Professional at work"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center top',
                }}
              />
            </div>
            <div
              className="float"
              style={{
                position: 'absolute',
                bottom: 40,
                right: -28,
                background: C.dark,
                borderRadius: 20,
                padding: '20px 24px',
                boxShadow: '0 20px 52px rgba(0,0,0,0.2)',
              }}
            >
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 900,
                  color: C.lime,
                  lineHeight: 1,
                  letterSpacing: '-0.04em',
                }}
              >
                50K+
              </div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 }}>
                Job Seekers
              </div>
            </div>
            <div
              style={{
                position: 'absolute',
                top: 40,
                left: -24,
                background: C.bg,
                borderRadius: 18,
                padding: '16px 20px',
                boxShadow: '0 16px 44px rgba(0,0,0,0.10)',
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  color: C.primary,
                  lineHeight: 1,
                  letterSpacing: '-0.04em',
                }}
              >
                500+
              </div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                Verified Employers
              </div>
            </div>
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: -36,
                transform: 'translateY(-50%)',
                background: C.lime,
                borderRadius: 16,
                padding: '14px 18px',
                boxShadow: '0 12px 36px rgba(200,240,69,0.3)',
              }}
            >
              <div style={{ display: 'flex', gap: 2, marginBottom: 5 }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} size={11} color={C.dark} fill={C.dark} />
                ))}
              </div>
              <div style={{ fontWeight: 900, color: C.dark, fontSize: 18, lineHeight: 1 }}>
                4.9/5.0
              </div>
              <div style={{ color: C.primary, fontSize: 10, marginTop: 3, fontWeight: 700 }}>
                12K+ Reviews
              </div>
            </div>
          </div>
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: C.limeLight,
                borderRadius: 100,
                padding: '6px 18px',
                marginBottom: 22,
              }}
            >
              <span style={{ color: C.primary, fontSize: 13, fontWeight: 700 }}>Who We Are</span>
            </div>
            <h2
              style={{
                fontSize: 'clamp(28px,3.5vw,48px)',
                fontWeight: 800,
                lineHeight: 1.12,
                letterSpacing: '-0.035em',
                margin: '0 0 18px',
                color: C.text,
              }}
            >
              Empowering Pakistan's
              <br />
              workforce, for free.
            </h2>
            <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.76, margin: '0 0 32px' }}>
              Powered by Saylani Welfare International Trust — Pakistan's largest nonprofit — we've
              built a completely free, scam-free, employer-verified job platform that puts Pakistani
              professionals first.
            </p>
            {[
              '100% free forever — no hidden fees',
              'Only manually verified employers',
              'Saylani endorsement for your skills',
              'Matches you to roles that fit your profile',
            ].map((item) => (
              <div
                key={item}
                style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: C.limeLight,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle2 size={14} color={C.primary} strokeWidth={2.5} />
                </div>
                <span style={{ color: C.text, fontSize: 15, fontWeight: 500 }}>{item}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 14, marginTop: 36, alignItems: 'center' }}>
              <NextLink
                href="/register"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: C.dark,
                  color: C.lime,
                  padding: '13px 26px',
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 14,
                  textDecoration: 'none',
                }}
              >
                Join Free Today <ArrowRight size={14} />
              </NextLink>
              <a
                href="#"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: C.primary,
                  fontWeight: 600,
                  fontSize: 14,
                  textDecoration: 'none',
                }}
              >
                More About Us <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FAQ ════════════════════════════════════════════════════════════ */}
      <section style={{ background: C.surface, padding: '100px 40px' }}>
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '38% 1fr',
            gap: 72,
            alignItems: 'start',
          }}
        >
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: C.bg,
                borderRadius: 100,
                padding: '6px 18px',
                marginBottom: 20,
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              }}
            >
              <span style={{ color: C.primary, fontSize: 13, fontWeight: 700 }}>FAQ</span>
            </div>
            <h2
              style={{
                fontSize: 'clamp(26px,3.2vw,44px)',
                fontWeight: 800,
                lineHeight: 1.12,
                letterSpacing: '-0.035em',
                margin: '0 0 16px',
                color: C.text,
              }}
            >
              Frequently Asked Questions
            </h2>
            <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.72, margin: '0 0 36px' }}>
              Still have questions? Reach out at{' '}
              <strong style={{ color: C.primary }}>jobbank@saylani.org</strong>
            </p>
            <div
              style={{
                borderRadius: 24,
                overflow: 'hidden',
                position: 'relative',
                boxShadow: '0 16px 44px rgba(0,0,0,0.10)',
              }}
            >
              <img
                src={IMG_TEAM}
                alt="Saylani team"
                style={{ width: '100%', height: 240, objectFit: 'cover', display: 'block' }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `linear-gradient(to top, ${C.dark}ee 0%, transparent 50%)`,
                }}
              />
              <div style={{ position: 'absolute', bottom: 22, left: 22 }}>
                <div
                  style={{
                    color: C.lime,
                    fontWeight: 900,
                    fontSize: 28,
                    letterSpacing: '-0.03em',
                    lineHeight: 1,
                  }}
                >
                  10K+
                </div>
                <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 4 }}>
                  Successful Placements This Year
                </div>
              </div>
            </div>
          </div>
          <FAQList items={FAQS} />
        </div>
      </section>

      {/* ═══ CTA — with phone mockup ════════════════════════════════════════ */}
      <section style={{ background: C.surface, padding: '0 40px 100px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div
            style={{
              background: C.dark,
              borderRadius: 36,
              overflow: 'hidden',
              display: 'grid',
              gridTemplateColumns: '55% 1fr',
              gap: 0,
              minHeight: 420,
              position: 'relative',
              boxShadow: '0 32px 80px rgba(14,31,20,0.3)',
            }}
          >
            {/* Ambient bg */}
            <div
              style={{
                position: 'absolute',
                top: -100,
                left: 200,
                width: 400,
                height: 400,
                background: 'radial-gradient(circle, rgba(200,240,69,0.08) 0%, transparent 70%)',
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: -80,
                right: 280,
                width: 300,
                height: 300,
                background: 'radial-gradient(circle, rgba(11,77,44,0.6) 0%, transparent 70%)',
                pointerEvents: 'none',
              }}
            />

            {/* LEFT — text */}
            <div
              style={{
                padding: '68px 56px',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(200,240,69,0.10)',
                  borderRadius: 100,
                  padding: '6px 16px',
                  marginBottom: 24,
                  width: 'fit-content',
                }}
              >
                <div
                  className="dot-pulse"
                  style={{ width: 7, height: 7, borderRadius: '50%', background: C.lime }}
                />
                <span style={{ color: C.lime, fontSize: 13, fontWeight: 600 }}>
                  Join 50,000+ Pakistanis — free forever
                </span>
              </div>
              <h2
                style={{
                  fontSize: 'clamp(28px,3.8vw,54px)',
                  fontWeight: 900,
                  color: '#fff',
                  margin: '0 0 16px',
                  letterSpacing: '-0.04em',
                  lineHeight: 1.06,
                }}
              >
                Your next Rizq
                <br />
                starts right here.
              </h2>
              <p
                style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 16,
                  lineHeight: 1.65,
                  margin: '0 0 36px',
                  maxWidth: 380,
                }}
              >
                Backed by Saylani Welfare International Trust. Connecting Pakistan's talent with
                Pakistan's best employers.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <NextLink
                  href="/register"
                  className="cta-btn-lime"
                  style={{
                    background: C.lime,
                    color: C.dark,
                    padding: '14px 28px',
                    borderRadius: 13,
                    fontWeight: 800,
                    fontSize: 15,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  Get Started Free <ArrowRight size={15} />
                </NextLink>
                <NextLink
                  href="/register"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.65)',
                    padding: '14px 28px',
                    borderRadius: 13,
                    fontWeight: 600,
                    fontSize: 15,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  Post a Job Free <Building2 size={15} />
                </NextLink>
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 36 }}>
                {[
                  ['50K+', 'Job Seekers'],
                  ['5.2K+', 'Live Jobs'],
                  ['500+', 'Employers'],
                ].map(([n, l]) => (
                  <div key={l}>
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: 20,
                        color: C.lime,
                        letterSpacing: '-0.03em',
                        lineHeight: 1,
                      }}
                    >
                      {n}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 3 }}>
                      {l}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT — phone mockup */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '48px 20px 48px 0',
                position: 'relative',
              }}
            >
              <PhoneMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═════════════════════════════════════════════════════════ */}
      <footer style={{ background: '#060d08' }}>
        {/* Top footer */}
        <div style={{ padding: '72px 40px 52px', maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2.6fr 1fr 1fr 1fr', gap: 52 }}>
            {/* Brand col */}
            <div>
              <NextLink
                href="/"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  textDecoration: 'none',
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    background: C.primary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 16px rgba(11,77,44,0.3)',
                  }}
                >
                  <Briefcase size={17} color={C.lime} strokeWidth={2.2} />
                </div>
                <span style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>
                  Saylani <span style={{ color: C.lime }}>Job Bank</span>
                </span>
              </NextLink>
              <p
                style={{
                  color: 'rgba(255,255,255,0.28)',
                  fontSize: 14,
                  lineHeight: 1.75,
                  margin: '0 0 24px',
                  maxWidth: 270,
                }}
              >
                Pakistan's most trusted free employment platform, powered by Saylani Welfare
                International Trust. Connecting talent with opportunity.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap' }}>
                {[
                  { l: 'Free Forever', bg: 'rgba(200,240,69,0.08)', c: C.lime },
                  { l: 'Verified', bg: 'rgba(255,255,255,0.05)', c: 'rgba(255,255,255,0.5)' },
                  { l: 'Endorsed', bg: 'rgba(255,255,255,0.05)', c: 'rgba(255,255,255,0.5)' },
                ].map((tag) => (
                  <div
                    key={tag.l}
                    style={{
                      background: tag.bg,
                      borderRadius: 6,
                      padding: '4px 12px',
                      fontSize: 11,
                      color: tag.c,
                      fontWeight: 600,
                    }}
                  >
                    {tag.l}
                  </div>
                ))}
              </div>
              {/* Social icons */}
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { label: 'FB', title: 'Facebook' },
                  { label: 'X', title: 'Twitter/X' },
                  { label: 'in', title: 'LinkedIn' },
                  { label: '📷', title: 'Instagram' },
                ].map((s) => (
                  <a
                    key={s.title}
                    href="#"
                    title={s.title}
                    className="social-btn"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: 'rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(255,255,255,0.45)',
                      textDecoration: 'none',
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>

            {/* Links */}
            {[
              {
                title: 'For Job Seekers',
                links: [
                  { l: 'Browse Jobs', href: '#' },
                  { l: 'Create Profile', href: '#' },
                  { l: 'Get Saylani Endorsed', href: '#' },
                  { l: 'Career Tips & Guides', href: '#' },
                  { l: 'Resume Builder', href: '#' },
                ],
              },
              {
                title: 'For Employers',
                links: [
                  { l: 'Post a Job', href: '#' },
                  { l: 'Find Talent', href: '#' },
                  { l: 'Partner With Us', href: '#' },
                  { l: 'Employer Dashboard', href: '#' },
                  { l: 'Pricing Plans', href: '#' },
                ],
              },
              {
                title: 'Company',
                links: [
                  { l: 'About Saylani', href: '#' },
                  { l: 'Contact Us', href: '#' },
                  { l: 'Privacy Policy', href: '#' },
                  { l: 'Terms of Use', href: '#' },
                  { l: 'Sitemap', href: '#' },
                ],
              },
            ].map((col) => (
              <div key={col.title}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, marginBottom: 22 }}>
                  {col.title}
                </div>
                {col.links.map(({ l, href }) => (
                  <div key={l} style={{ marginBottom: 13 }}>
                    <a href={href} className="footer-link">
                      {l}
                    </a>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: 'rgba(255,255,255,0.04)',
            maxWidth: 1200,
            margin: '0 auto',
          }}
        />

        {/* Bottom bar */}
        <div
          style={{
            padding: '24px 40px',
            maxWidth: 1200,
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 13 }}>
            © 2025 Saylani Job Bank. All rights reserved.
          </span>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            {['Privacy Policy', 'Terms of Use', 'Cookie Policy'].map((l) => (
              <a
                key={l}
                href="#"
                style={{ color: 'rgba(255,255,255,0.18)', fontSize: 12, textDecoration: 'none' }}
              >
                {l}
              </a>
            ))}
          </div>
          <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 13 }}>
            A Saylani Welfare International Trust initiative
          </span>
        </div>
      </footer>
    </div>
  );
}
