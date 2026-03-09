import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Star, Film, ThumbsDown } from 'lucide-react';

interface Props {
  seasonIds: string[];
  profiles: Profile[];
}

interface RankedMovie {
  title: string;
  posterUrl: string | null;
  avgRank: number;
}

const FavoritesBar = ({ seasonIds, profiles }: Props) => {
  const [favorite, setFavorite] = useState<RankedMovie | null>(null);
  const [leastFavorite, setLeastFavorite] = useState<RankedMovie | null>(null);

  useEffect(() => {
    if (seasonIds.length === 0) { setFavorite(null); setLeastFavorite(null); return; }
    const fetch = async () => {
      const [rankingsRes, picksRes] = await Promise.all([
        supabase.from('movie_rankings').select('movie_pick_id, rank').in('season_id', seasonIds),
        supabase.from('movie_picks').select('id, title, poster_url').in('season_id', seasonIds),
      ]);
      const rankings = rankingsRes.data || [];
      const picks = picksRes.data || [];
      if (rankings.length === 0) { setFavorite(null); setLeastFavorite(null); return; }

      const scoreMap: Record<string, { total: number; count: number }> = {};
      rankings.forEach(r => {
        if (!scoreMap[r.movie_pick_id]) scoreMap[r.movie_pick_id] = { total: 0, count: 0 };
        scoreMap[r.movie_pick_id].total += r.rank;
        scoreMap[r.movie_pick_id].count += 1;
      });

      const pickMap = new Map(picks.map(p => [p.id, p]));
      const ranked = Object.entries(scoreMap)
        .map(([id, { total, count }]) => {
          const pick = pickMap.get(id);
          return { title: pick?.title || '?', posterUrl: pick?.poster_url || null, avgRank: total / count };
        })
        .sort((a, b) => a.avgRank - b.avgRank);

      setFavorite(ranked[0] || null);
      setLeastFavorite(ranked.length > 1 ? ranked[ranked.length - 1] : null);
    };
    fetch();
  }, [seasonIds.join(',')]);

  if (!favorite) return null;

  return (
    <div className="flex gap-2">
      <div className="flex-1 flex items-center gap-2 rounded-xl bg-primary/10 ring-1 ring-primary/20 px-2.5 py-1.5">
        {favorite.posterUrl ? (
          <img src={favorite.posterUrl} alt={favorite.title} className="w-7 h-10 rounded object-cover shrink-0" />
        ) : (
          <div className="w-7 h-10 rounded bg-muted flex items-center justify-center shrink-0">
            <Film className="w-3 h-3 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <Star className="w-3 h-3 text-primary fill-primary shrink-0" />
            <span className="text-[10px] font-medium text-primary uppercase tracking-wide">Favorite</span>
          </div>
          <p className="font-medium text-xs truncate">{favorite.title}</p>
        </div>
      </div>

      {leastFavorite && (
        <div className="flex-1 flex items-center gap-2 rounded-xl bg-muted/30 ring-1 ring-border/20 px-2.5 py-1.5">
          {leastFavorite.posterUrl ? (
            <img src={leastFavorite.posterUrl} alt={leastFavorite.title} className="w-7 h-10 rounded object-cover shrink-0" />
          ) : (
            <div className="w-7 h-10 rounded bg-muted flex items-center justify-center shrink-0">
              <Film className="w-3 h-3 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <ThumbsDown className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Least Fav</span>
            </div>
            <p className="font-medium text-xs truncate">{leastFavorite.title}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FavoritesBar;
