import { BadgeDef, BadgeId } from '@/lib/memberBadges';

interface Theme {
  base: string;
  light: string;
  dark: string;
}

// Each badge gets a distinct metallic colorway so the set feels collectible.
const THEMES: Record<BadgeId, Theme> = {
  crowd_pleaser:  { base: '#f59e0b', light: '#fde68a', dark: '#b45309' }, // gold
  hidden_gems:    { base: '#06b6d4', light: '#a5f3fc', dark: '#0e7490' }, // cyan
  futurist:       { base: '#3b82f6', light: '#bfdbfe', dark: '#1d4ed8' }, // blue
  time_traveler:  { base: '#b08d57', light: '#e6d2a8', dark: '#7c5e34' }, // bronze
  epic_picker:    { base: '#6366f1', light: '#c7d2fe', dark: '#4338ca' }, // indigo
  quick_watch:    { base: '#eab308', light: '#fef08a', dark: '#a16207' }, // yellow
  critics_choice: { base: '#f5c542', light: '#fdeaa0', dark: '#b8860b' }, // bright gold
  group_favorite: { base: '#f43f5e', light: '#fecdd3', dark: '#be123c' }, // rose
  bold_choices:   { base: '#a855f7', light: '#e9d5ff', dark: '#7e22ce' }, // violet
  casual_viewer:  { base: '#94a3b8', light: '#e2e8f0', dark: '#64748b' }, // silver/slate
};

const DEFAULT_THEME: Theme = { base: '#9ca3af', light: '#e5e7eb', dark: '#6b7280' };

type Size = 'xs' | 'sm' | 'md' | 'lg';

const DIMS: Record<Size, number> = { xs: 22, sm: 30, md: 56, lg: 76 };

interface Props {
  badge: BadgeDef;
  size?: Size;
  /** Render ribbon tails below the medallion (auto-off for sm). */
  ribbon?: boolean;
  className?: string;
}

export function BadgeMedallion({ badge, size = 'md', ribbon, className = '' }: Props) {
  const t = THEMES[badge.id] ?? DEFAULT_THEME;
  const d = DIMS[size];
  const showRibbon = ribbon ?? (size === 'md' || size === 'lg');
  const tailW = d * 0.32;
  const tailH = d * 0.62;
  const wrapperH = showRibbon ? Math.round(d + tailH * 0.78) : d;

  const tailStyle = (dir: -1 | 1): React.CSSProperties => ({
    position: 'absolute',
    top: d * 0.46,
    left: '50%',
    width: tailW,
    height: tailH,
    marginLeft: dir === -1 ? -tailW + d * 0.04 : -d * 0.04,
    transform: `rotate(${dir * 13}deg)`,
    transformOrigin: 'top center',
    background: `linear-gradient(180deg, ${t.base}, ${t.dark})`,
    clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
    zIndex: 0,
  });

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ width: d, height: wrapperH }}
      aria-label={badge.label}
    >
      {/* Ribbon tails */}
      {showRibbon && (
        <>
          <div style={tailStyle(-1)} />
          <div style={tailStyle(1)} />
        </>
      )}

      {/* Medallion seal */}
      <div className="absolute left-0 top-0" style={{ width: d, height: d, zIndex: 1 }}>
        {/* Fluted metallic edge */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `repeating-conic-gradient(${t.light} 0deg 9deg, ${t.dark} 9deg 18deg)`,
            boxShadow: `0 3px 10px -1px ${t.base}66`,
          }}
        />
        {/* Beveled colored band */}
        <div
          className="absolute rounded-full"
          style={{
            inset: d * 0.1,
            background: `linear-gradient(145deg, ${t.light}, ${t.dark})`,
            boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.45), inset 0 -2px 4px rgba(0,0,0,0.4)',
          }}
        />
        {/* Inner disc */}
        <div
          className="absolute rounded-full flex items-center justify-center"
          style={{
            inset: d * 0.2,
            background: 'radial-gradient(circle at 50% 32%, rgba(24,26,33,0.94), rgba(8,9,12,0.99))',
            boxShadow: `inset 0 1px 2px ${t.light}66, inset 0 -1px 3px rgba(0,0,0,0.6)`,
          }}
        >
          <span style={{ fontSize: d * 0.42, lineHeight: 1 }} className="select-none drop-shadow">
            {badge.emoji}
          </span>
        </div>
        {/* Top gloss highlight */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            inset: d * 0.1,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.4), transparent 42%)',
          }}
        />
      </div>
    </div>
  );
}

export default BadgeMedallion;
