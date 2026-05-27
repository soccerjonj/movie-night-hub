import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Heart, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  userId: string;
  groupId: string;
  profiles: Profile[];
  /** default = always show all cards. teaser = compact summary + expand for full breakdown. */
  variant?: 'default' | 'teaser';
  /** Tighter padding and type for profile sheets. */
  dense?: boolean;
  /** Omit the "Ranking insights" heading (use when a parent section label is enough). */
  hideTitle?: boolean;
}

interface BreakdownRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  avg: number;
  count: number;
}

interface Insight {
  users: { userId: string; displayName: string; avatarUrl: string | null }[];
  avgRank: number;
  /** Full per-member ranking, best (lowest avg) first, for the expanded view. */
  breakdown: BreakdownRow[];
}

const RankingInsights = ({ userId, groupId, profiles, variant = 'default', dense = false, hideTitle = false }: Props) => {
  const [favoritePicker, setFavoritePicker] = useState<Insight | null>(null);
  const [biggestFan, setBiggestFan] = useState<Insight | null>(null);
  const [biggestCritic, setBiggestCritic] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  /** Which insight row is expanded inline (Club Taste interactivity). */
  const [openRow, setOpenRow] = useState<string | null>(null);

  const getProfile = (uid: string) => profiles.find(p => p.user_id === uid);

  useEffect(() => {
    setExpanded(false);
    setOpenRow(null);
  }, [userId, groupId]);

  useEffect(() => {
    const compute = async () => {
      setLoading(true);

      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id')
        .eq('group_id', groupId)
        .in('status', ['completed', 'reviewing']);

      const seasonIds = (seasonData || []).map(s => s.id);
      if (seasonIds.length === 0) {
        setLoading(false);
        return;
      }

      const [rankingsRes, picksRes] = await Promise.all([
        supabase
          .from('movie_rankings')
          .select('user_id, movie_pick_id, rank')
          .in('season_id', seasonIds),
        supabase
          .from('movie_picks')
          .select('id, user_id, watch_order, season_id')
          .in('season_id', seasonIds),
      ]);

      const rankings = rankingsRes.data || [];
      const picks = picksRes.data || [];

      const pickGroupMap = new Map<string, string[]>();
      picks.forEach(p => {
        if (p.watch_order != null) {
          const key = `${p.season_id}:${p.watch_order}`;
          if (!pickGroupMap.has(key)) pickGroupMap.set(key, []);
          pickGroupMap.get(key)!.push(p.user_id);
        }
      });

      const moviePickerMap = new Map<string, string[]>();
      picks.forEach(p => {
        if (p.watch_order != null) {
          const key = `${p.season_id}:${p.watch_order}`;
          moviePickerMap.set(p.id, pickGroupMap.get(key) || [p.user_id]);
        } else {
          moviePickerMap.set(p.id, [p.user_id]);
        }
      });

      /** All movie_pick ids for the same slot (co-picks share one slot, multiple row ids). */
      const slotToPickIds = new Map<string, string[]>();
      picks.forEach(p => {
        const slot = p.watch_order != null ? `${p.season_id}:${p.watch_order}` : `solo:${p.id}`;
        if (!slotToPickIds.has(slot)) slotToPickIds.set(slot, []);
        slotToPickIds.get(slot)!.push(p.id);
      });

      /**
       * Pick ids that represent "this member's movies" for fan/critic — includes sibling co-pick rows.
       * Rankings often reference only one co-picker's row; without this, co-pickers saw empty insights.
       */
      const userPickIds = new Set<string>();
      picks.forEach(p => {
        const pickers = moviePickerMap.get(p.id) || [];
        if (!pickers.includes(userId)) return;
        const slot = p.watch_order != null ? `${p.season_id}:${p.watch_order}` : `solo:${p.id}`;
        for (const id of slotToPickIds.get(slot) || [p.id]) userPickIds.add(id);
      });

      const pickerScoresFromUser: Record<string, { total: number; count: number }> = {};
      rankings
        .filter(r => r.user_id === userId)
        .forEach(r => {
          const pickers = moviePickerMap.get(r.movie_pick_id) || [];
          pickers.forEach(pickerId => {
            if (pickerId === userId) return;
            if (!pickerScoresFromUser[pickerId]) pickerScoresFromUser[pickerId] = { total: 0, count: 0 };
            pickerScoresFromUser[pickerId].total += r.rank;
            pickerScoresFromUser[pickerId].count += 1;
          });
        });

      const rankerScoresForUser: Record<string, { total: number; count: number }> = {};
      rankings
        .filter(r => r.user_id !== userId && userPickIds.has(r.movie_pick_id))
        .forEach(r => {
          if (!rankerScoresForUser[r.user_id]) rankerScoresForUser[r.user_id] = { total: 0, count: 0 };
          rankerScoresForUser[r.user_id].total += r.rank;
          rankerScoresForUser[r.user_id].count += 1;
        });

      const toUser = (uid: string) => {
        const p = getProfile(uid);
        return { userId: uid, displayName: p?.display_name || '?', avatarUrl: p?.avatar_url || null };
      };

      const findTied = (entries: [string, { total: number; count: number }][], mode: 'min' | 'max'): Insight | null => {
        if (entries.length === 0) return null;
        const avgs = entries.map(([id, v]) => ({ id, avg: v.total / v.count, count: v.count }));
        const targetAvg = mode === 'min'
          ? Math.min(...avgs.map(a => a.avg))
          : Math.max(...avgs.map(a => a.avg));
        const tied = avgs.filter(a => Math.abs(a.avg - targetAvg) < 0.001);
        // Breakdown is always ranked best (lowest avg) → worst so the expanded
        // view reads consistently regardless of which superlative opened it.
        const breakdown: BreakdownRow[] = avgs
          .slice()
          .sort((a, b) => a.avg - b.avg)
          .map(a => { const u = toUser(a.id); return { ...u, avg: a.avg, count: a.count }; });
        return { users: tied.map(t => toUser(t.id)), avgRank: targetAvg, breakdown };
      };

      const pickerEntries = Object.entries(pickerScoresFromUser).filter(([, v]) => v.count > 0);
      setFavoritePicker(findTied(pickerEntries, 'min'));

      const rankerEntries = Object.entries(rankerScoresForUser).filter(([, v]) => v.count > 0);
      setBiggestFan(findTied(rankerEntries, 'min'));
      setBiggestCritic(rankerEntries.length > 0 ? findTied(rankerEntries, 'max') : null);

      setLoading(false);
    };

    compute();
  }, [userId, groupId, profiles]);

  if (loading) {
    if (variant === 'teaser') {
      return (
        <div className="rounded-xl border border-border/40 bg-muted/10 px-3 py-2.5">
          <div className="h-3 w-32 bg-muted/50 rounded animate-pulse" />
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!favoritePicker && !biggestFan && !biggestCritic) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-3 py-3.5 text-left space-y-2">
        <p className="text-xs font-semibold text-foreground/90">No taste signals yet</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="block">Favorite picker appears after you rank other members&apos; movies in completed or reviewing seasons.</span>
          <span className="block mt-1.5">Biggest fan and biggest critic use how others ranked movies you picked — including co-picks, as long as someone ranked that title.</span>
        </p>
      </div>
    );
  }

  const subjectName = getProfile(userId)?.display_name || 'this member';

  /** Plain-English explanation of each stat, shown in the expanded panel. */
  const explainFor = (id: string): string => {
    switch (id) {
      case 'favorite_picker':
        return `Whose movies ${subjectName} ranks highest. Lower average rank means ${subjectName} consistently put their picks near the top.`;
      case 'biggest_fan':
        return `Who ranks ${subjectName}'s picks highest. Lower average means this member keeps putting ${subjectName}'s movies near the top of their list.`;
      case 'biggest_critic':
        return `Who ranks ${subjectName}'s picks lowest. A higher average means this member tends to place ${subjectName}'s movies toward the bottom.`;
      default:
        return '';
    }
  };

  const InsightCard = ({ id, icon, label, insight, color, borderColor, accentText, barColor }: { id: string; icon: React.ReactNode; label: string; insight: Insight; color: string; borderColor: string; accentText: string; barColor: string }) => {
    const firstUser = insight.users[0];
    const names = insight.users.map(u => u.displayName).join(', ');
    const isOpen = openRow === id;
    const explanation = explainFor(id);
    const maxAvg = Math.max(...insight.breakdown.map(b => b.avg), 1);
    const avatarSize = dense ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs';

    return (
      <div className={`rounded-lg overflow-hidden bg-muted/15 border-l-2 ${borderColor} transition-colors ${isOpen ? 'bg-muted/25' : 'hover:bg-muted/25'}`}>
        <button
          type="button"
          onClick={() => setOpenRow(isOpen ? null : id)}
          aria-expanded={isOpen}
          className={`w-full flex items-center gap-1.5 text-left ${dense ? 'py-1 px-2' : 'p-2.5 gap-2'}`}
        >
          <div className={`${avatarSize} rounded-full overflow-hidden flex items-center justify-center font-bold shrink-0 ${color}`}>
            {firstUser.avatarUrl ? (
              <img src={firstUser.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              firstUser.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`flex items-center gap-0.5 ${dense ? '' : 'mb-0.5'}`}>
              {icon}
              <span className={`font-medium text-muted-foreground uppercase tracking-wide ${dense ? 'text-[9px]' : 'text-[10px]'}`}>{label}</span>
            </div>
            <p className={`font-medium truncate leading-tight ${dense ? 'text-[11px]' : 'text-sm'}`}>{names}</p>
          </div>
          <span className={`tabular-nums font-semibold shrink-0 ${accentText} ${dense ? 'text-[10px]' : 'text-xs'}`}>{insight.avgRank.toFixed(1)}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/70 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className={`${dense ? 'px-2 pb-2' : 'px-2.5 pb-2.5'} pt-0.5 space-y-2`}>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{explanation}</p>
                <div className="space-y-1">
                  {insight.breakdown.map(row => {
                    const isHighlight = insight.users.some(u => u.userId === row.userId);
                    const barPct = Math.max(8, (row.avg / maxAvg) * 100);
                    return (
                      <div key={row.userId} className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full overflow-hidden flex items-center justify-center text-[8px] font-bold shrink-0 ${isHighlight ? color : 'bg-muted/40 text-muted-foreground'}`}>
                          {row.avatarUrl ? (
                            <img src={row.avatarUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            row.displayName.charAt(0).toUpperCase()
                          )}
                        </div>
                        <span className={`text-[11px] truncate flex-1 min-w-0 ${isHighlight ? 'font-semibold' : 'text-muted-foreground'}`}>{row.displayName}</span>
                        <div className="w-12 h-1 rounded-full bg-muted/30 overflow-hidden shrink-0">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barPct}%` }} />
                        </div>
                        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0 w-7 text-right">{row.avg.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const teaserInsight = favoritePicker || biggestFan || biggestCritic;
  const teaserLabel = favoritePicker ? 'Favorite picker' : biggestFan ? 'Biggest fan' : 'Biggest critic';
  const teaserInsightData = favoritePicker || biggestFan || biggestCritic!;
  const insightCount = [favoritePicker, biggestFan, biggestCritic].filter(Boolean).length;

  if (variant === 'teaser' && !expanded) {
    return (
      <div className="rounded-xl border border-primary/15 bg-primary/5 p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Heart className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Taste highlights</p>
            {teaserInsight && (
              <p className="text-sm font-medium mt-1">
                <span className="text-muted-foreground">{teaserLabel}:</span>{' '}
                {teaserInsightData.users.map(u => u.displayName).join(', ')}
                <span className="text-muted-foreground text-xs font-normal"> · avg {teaserInsightData.avgRank.toFixed(1)}</span>
              </p>
            )}
          </div>
        </div>
        {insightCount > 1 && (
          <Button variant="ghost" size="sm" className="w-full h-8 text-xs" onClick={() => setExpanded(true)}>
            <ChevronDown className="w-3.5 h-3.5 mr-1" />
            Show all {insightCount} insights
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      {!hideTitle && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
            <Heart className="w-4 h-4 text-primary" />
            Ranking insights
          </h4>
          {variant === 'teaser' && expanded && (
            <Button variant="ghost" size="sm" className="h-7 text-[10px] shrink-0" onClick={() => setExpanded(false)}>
              <ChevronUp className="w-3 h-3 mr-0.5" />
              Collapse
            </Button>
          )}
        </div>
      )}
      <div className={dense ? 'space-y-1' : 'space-y-1.5'}>
        {favoritePicker && (
          <InsightCard
            id="favorite_picker"
            icon={<Heart className="w-3 h-3 text-pink-400" />}
            label="Favorite Picker"
            insight={favoritePicker}
            color="bg-pink-500/10 text-pink-400"
            borderColor="border-pink-500/40"
            accentText="text-pink-400"
            barColor="bg-pink-400/70"
          />
        )}
        {biggestFan && (
          <InsightCard
            id="biggest_fan"
            icon={<ThumbsUp className="w-3 h-3 text-green-400" />}
            label="Biggest Fan"
            insight={biggestFan}
            color="bg-green-500/10 text-green-400"
            borderColor="border-green-500/40"
            accentText="text-green-400"
            barColor="bg-green-400/70"
          />
        )}
        {biggestCritic && (
          <InsightCard
            id="biggest_critic"
            icon={<ThumbsDown className="w-3 h-3 text-orange-400" />}
            label="Biggest Critic"
            insight={biggestCritic}
            color="bg-orange-500/10 text-orange-400"
            borderColor="border-orange-500/40"
            accentText="text-orange-400"
            barColor="bg-orange-400/70"
          />
        )}
      </div>
    </div>
  );
};

export default RankingInsights;
