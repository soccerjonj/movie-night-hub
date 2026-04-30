import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Heart, ThumbsUp, ThumbsDown } from 'lucide-react';

interface Props {
  userId: string;
  groupId: string;
  profiles: Profile[];
}

interface Insight {
  users: { userId: string; displayName: string; avatarUrl: string | null }[];
  avgRank: number;
}

const RankingInsights = ({ userId, groupId, profiles }: Props) => {
  const [favoritePicker, setFavoritePicker] = useState<Insight | null>(null);
  const [biggestFan, setBiggestFan] = useState<Insight | null>(null);
  const [biggestCritic, setBiggestCritic] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);

  const getProfile = (uid: string) => profiles.find(p => p.user_id === uid);

  useEffect(() => {
    const compute = async () => {
      setLoading(true);

      // Get completed/reviewing seasons for this group
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

      // Fetch rankings and picks in parallel
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

      // Build co-pick map: movie_pick_id -> Set of picker user_ids
      // Movies with same season_id + watch_order are co-picks
      const pickGroupMap = new Map<string, string[]>(); // "seasonId:watchOrder" -> user_ids
      picks.forEach(p => {
        if (p.watch_order != null) {
          const key = `${p.season_id}:${p.watch_order}`;
          if (!pickGroupMap.has(key)) pickGroupMap.set(key, []);
          pickGroupMap.get(key)!.push(p.user_id);
        }
      });

      // movie_pick_id -> all picker user_ids (including co-pickers)
      const moviePickerMap = new Map<string, string[]>();
      picks.forEach(p => {
        if (p.watch_order != null) {
          const key = `${p.season_id}:${p.watch_order}`;
          moviePickerMap.set(p.id, pickGroupMap.get(key) || [p.user_id]);
        } else {
          moviePickerMap.set(p.id, [p.user_id]);
        }
      });

      // 1. Favorite Picker: Which picker's movies does this user rank highest?
      // For each ranking by this user, attribute to all pickers of that movie
      const pickerScoresFromUser: Record<string, { total: number; count: number }> = {};
      rankings
        .filter(r => r.user_id === userId)
        .forEach(r => {
          const pickers = moviePickerMap.get(r.movie_pick_id) || [];
          pickers.forEach(pickerId => {
            if (pickerId === userId) return; // skip own picks
            if (!pickerScoresFromUser[pickerId]) pickerScoresFromUser[pickerId] = { total: 0, count: 0 };
            pickerScoresFromUser[pickerId].total += r.rank;
            pickerScoresFromUser[pickerId].count += 1;
          });
        });

      // 2. Biggest Fan & Critic: How do others rank this user's picks?
      // Find all movie_pick_ids where this user is a picker (including co-picks)
      const userPickIds = new Set<string>();
      picks.forEach(p => {
        const pickers = moviePickerMap.get(p.id) || [];
        if (pickers.includes(userId)) {
          userPickIds.add(p.id);
        }
      });

      const rankerScoresForUser: Record<string, { total: number; count: number }> = {};
      rankings
        .filter(r => r.user_id !== userId && userPickIds.has(r.movie_pick_id))
        .forEach(r => {
          if (!rankerScoresForUser[r.user_id]) rankerScoresForUser[r.user_id] = { total: 0, count: 0 };
          rankerScoresForUser[r.user_id].total += r.rank;
          rankerScoresForUser[r.user_id].count += 1;
        });

      // Compute insights
      const toUser = (uid: string) => {
        const p = getProfile(uid);
        return { userId: uid, displayName: p?.display_name || '?', avatarUrl: p?.avatar_url || null };
      };

      const findTied = (entries: [string, { total: number; count: number }][], mode: 'min' | 'max'): Insight | null => {
        if (entries.length === 0) return null;
        const avgs = entries.map(([id, v]) => ({ id, avg: v.total / v.count }));
        const targetAvg = mode === 'min'
          ? Math.min(...avgs.map(a => a.avg))
          : Math.max(...avgs.map(a => a.avg));
        const tied = avgs.filter(a => Math.abs(a.avg - targetAvg) < 0.001);
        return { users: tied.map(t => toUser(t.id)), avgRank: targetAvg };
      };

      // Favorite picker = lowest avg rank (best)
      const pickerEntries = Object.entries(pickerScoresFromUser).filter(([, v]) => v.count > 0);
      setFavoritePicker(findTied(pickerEntries, 'min'));

      // Biggest fan = lowest avg rank (ranks user's picks highest)
      // Biggest critic = highest avg rank
      const rankerEntries = Object.entries(rankerScoresForUser).filter(([, v]) => v.count > 0);
      setBiggestFan(findTied(rankerEntries, 'min'));
      setBiggestCritic(rankerEntries.length > 1 ? findTied(rankerEntries, 'max') : null);

      setLoading(false);
    };

    compute();
  }, [userId, groupId, profiles]);

  if (loading) return null;
  if (!favoritePicker && !biggestFan && !biggestCritic) return null;

  const InsightCard = ({ icon, label, insight, color, borderColor }: { icon: React.ReactNode; label: string; insight: Insight; color: string; borderColor: string }) => {
    const firstUser = insight.users[0];
    const names = insight.users.map(u => u.displayName).join(', ');
    return (
      <div className={`flex items-center gap-2 rounded-xl bg-muted/20 p-2.5 border-l-2 ${borderColor}`}>
        <div className={`w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-xs font-bold shrink-0 ${color}`}>
          {firstUser.avatarUrl ? (
            <img src={firstUser.avatarUrl} alt={firstUser.displayName} className="w-full h-full object-cover" />
          ) : (
            firstUser.displayName.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            {icon}
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
          </div>
          <p className="text-sm font-medium truncate">{names}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-muted-foreground">avg {insight.avgRank.toFixed(1)}</p>
        </div>
      </div>
    );
  };

  return (
    <div>
      <h4 className="font-display text-sm font-bold mb-2 flex items-center gap-1.5">
        <Heart className="w-4 h-4 text-primary" />
        Ranking Insights
      </h4>
      <div className="space-y-1.5">
        {favoritePicker && (
          <InsightCard
            icon={<Heart className="w-3 h-3 text-pink-400" />}
            label="Favorite Picker"
            insight={favoritePicker}
            color="bg-pink-500/10 text-pink-400"
            borderColor="border-pink-500/40"
          />
        )}
        {biggestFan && (
          <InsightCard
            icon={<ThumbsUp className="w-3 h-3 text-green-400" />}
            label="Biggest Fan"
            insight={biggestFan}
            color="bg-green-500/10 text-green-400"
            borderColor="border-green-500/40"
          />
        )}
        {biggestCritic && (
          <InsightCard
            icon={<ThumbsDown className="w-3 h-3 text-orange-400" />}
            label="Biggest Critic"
            insight={biggestCritic}
            color="bg-orange-500/10 text-orange-400"
            borderColor="border-orange-500/40"
          />
        )}
      </div>
    </div>
  );
};

export default RankingInsights;
