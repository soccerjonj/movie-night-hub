import { useEffect, useRef, useState } from 'react';
import { Lock, Film, Link2 } from 'lucide-react';
import { MoviePick } from '@/hooks/useGroup';

interface Props {
  /** One entry per film, in the exact order the guessing form lists them. */
  units: MoviePick[][];
  seasonNumber: number;
  onDone: () => void;
}

const GAP = 10;
const ROW_Y = 28;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

/**
 * Plays once per member when the guessing round opens: the sealed cards from
 * the picking lineup flip to reveal their posters, gather, shuffle, and deal
 * back out in the order the form uses. Not skippable by design — it runs once.
 */
const GuessingIntro = ({ units, seasonNumber, onDone }: Props) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [phase, setPhase] = useState<'sealed' | 'shuffling' | 'dealt'>('sealed');
  const [stageW, setStageW] = useState(0);
  const n = units.length;

  // Fit one row: shrink cards on narrow screens rather than wrapping.
  const cardW = stageW ? Math.max(44, Math.min(76, Math.floor((stageW - GAP * (n - 1)) / n))) : 72;
  const cardH = Math.round(cardW * 1.5);
  const slotX = (i: number) => Math.round((stageW - (n * cardW + (n - 1) * GAP)) / 2 + i * (cardW + GAP));
  const centerX = () => Math.round((stageW - cardW) / 2);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!stageW || n === 0) return;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const set = (i: number, left: number, top: number, transform: string, z: number) => {
      const c = cardRefs.current[i];
      if (!c) return;
      c.style.left = `${left}px`;
      c.style.top = `${top}px`;
      c.style.transform = transform;
      c.style.zIndex = String(z);
    };

    // 0) sealed row
    for (let i = 0; i < n; i++) set(i, slotX(i), ROW_Y, 'rotateY(0deg)', 1);

    // 1) flip, staggered
    const flipStart = 600;
    for (let i = 0; i < n; i++) later(() => set(i, slotX(i), ROW_Y, 'rotateY(180deg)', 1), flipStart + i * 90);

    // 2) gather to a stack
    const gatherAt = flipStart + n * 90 + 700;
    later(() => {
      setPhase('shuffling');
      for (let i = 0; i < n; i++) set(i, centerX(), ROW_Y, `rotateY(180deg) rotate(${(i - (n - 1) / 2) * 3}deg)`, 10 + i);
    }, gatherAt);

    // 3) shuffle rounds
    const rounds = 4;
    for (let r = 0; r < rounds; r++) {
      later(() => {
        const pos = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
        for (let i = 0; i < n; i++) {
          const spread = pos[i] - (n - 1) / 2;
          set(i, Math.round(centerX() + spread * cardW * 0.55), ROW_Y + (pos[i] % 2 ? 16 : -12), `rotateY(180deg) rotate(${spread * 4}deg)`, 10 + pos[i]);
        }
      }, gatherAt + 520 + r * 330);
    }

    // 4) deal into form order (index i IS the form order)
    const dealAt = gatherAt + 520 + rounds * 330;
    for (let i = 0; i < n; i++) later(() => set(i, slotX(i), ROW_Y, 'rotateY(180deg) rotate(0deg)', 1), dealAt + i * 70);
    later(() => setPhase('dealt'), dealAt + n * 70 + 450);

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageW, n]);

  const dealt = phase === 'dealt';

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/5 bg-gradient-to-b from-card to-card/60 px-4 sm:px-6 py-5 sm:py-6">
        <div className={`absolute inset-0 transition-colors duration-700 ${dealt
          ? 'bg-[radial-gradient(70%_60%_at_50%_-10%,hsl(262_60%_60%/0.22),transparent_60%)]'
          : 'bg-[radial-gradient(70%_60%_at_50%_-10%,hsl(38_90%_55%/0.22),transparent_60%)]'}`} />
        <div className="relative z-10">
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-sm border px-2.5 py-1 transition-colors duration-500 ${dealt ? 'border-violet-500/40' : 'border-primary/30'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dealt ? 'bg-violet-300' : 'bg-primary'}`} />
              <span className={`text-[10px] font-bold uppercase tracking-[0.16em] ${dealt ? 'text-violet-300' : 'text-primary'}`}>
                {dealt ? 'Guessing Round' : 'Picks are in'}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground">Season {seasonNumber}</span>
          </div>

          <h2 className="font-display text-2xl sm:text-3xl font-bold leading-[1.05] mt-4 min-h-[2.2em]">
            {dealt ? (
              <><span className="text-gradient-gold">Guess who</span> picked what.</>
            ) : (
              <><span className="text-gradient-gold">The picks are in.</span><br />{n} sealed {n === 1 ? 'film' : 'films'}.</>
            )}
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 min-h-[1.5em]">
            {phase === 'sealed' && 'Revealing the lineup…'}
            {phase === 'shuffling' && 'Shuffling so nobody can tell who picked what…'}
            {phase === 'dealt' && 'The lineup is set. Pickers stay secret until watch day.'}
          </p>

          {/* Stage */}
          <div ref={stageRef} className="relative mt-2" style={{ height: cardH + ROW_Y * 2 }}>
            {units.map((unit, i) => {
              const pick = unit[0];
              return (
                <div
                  key={pick.id}
                  ref={(el) => { cardRefs.current[i] = el; }}
                  className="absolute rounded-lg"
                  style={{
                    width: cardW, height: cardH, left: slotX(i), top: ROW_Y,
                    transformStyle: 'preserve-3d',
                    transition: `left .42s ${EASE}, top .42s ${EASE}, transform .55s ${EASE}`,
                    willChange: 'transform, left, top',
                  }}
                >
                  {/* back: sealed */}
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-b from-muted/30 to-card ring-1 ring-primary/40 flex flex-col items-center justify-center gap-1.5" style={{ backfaceVisibility: 'hidden' }}>
                    <span className="w-6 h-6 rounded-full bg-primary/15" />
                    <Lock className="w-3 h-3 text-primary/70" />
                  </div>
                  {/* front: poster */}
                  <div className="absolute inset-0 rounded-lg overflow-hidden ring-1 ring-white/10 bg-muted/30" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                    {pick.poster_url ? (
                      <img src={pick.poster_url} alt={pick.title} className="w-full h-full object-cover" draggable={false} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Film className="w-5 h-5 text-muted-foreground/40" /></div>
                    )}
                    {unit.length > 1 && (
                      <span className="absolute top-1 right-1 rounded bg-black/60 p-0.5"><Link2 className="w-2.5 h-2.5 text-primary" /></span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`text-center transition-opacity duration-500 ${dealt ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button
              onClick={onDone}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary to-amber-300 text-black font-semibold text-sm px-6 py-2.5 shadow-[0_6px_20px_-6px_hsl(38_90%_55%/0.5)] hover:brightness-105 active:scale-[0.98] transition"
            >
              Start guessing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuessingIntro;
