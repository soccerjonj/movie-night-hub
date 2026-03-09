import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Star, Film, ThumbsDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface Props {
  seasonIds: string[];
  profiles: Profile[];
}

interface RankedMovie {
  moviePickId: string;
  title: string;
  posterUrl: string | null;
  avgRank: number;
}

interface IndividualRanking {
  userId: string;
  rank: number;
}

const FavoritesBar = ({ seasonIds, profiles }: Props) => {
  const [favorite, setFavorite] = useState<RankedMovie | null>(null);
  const [leastFavorite, setLeastFavorite] = useState<RankedMovie | null>(null);
  const [allRankings, setAllRankings] = useState<{ movie_pick_id: string; user_id: string; rank: number }[]>([]);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  useEffect(() => {
    if (seasonIds.length === 0) { setFavorite(null); setLeastFavorite(null); return; }
    const fetchData = async () => {
      const [rankingsRes, picksRes] = await Promise.all([
        supabase.from('movie_rankings').select('movie_pick_id, rank, user_id').in('season_id', seasonIds),
        supabase.from('movie_picks').select('id, title, poster_url').in('season_id', seasonIds),
      ]);
      const rankings = rankingsRes.data || [];
      const picks = picksRes.data || [];
      setAllRankings(rankings);
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
          return { moviePickId: id, title: pick?.title || '?', posterUrl: pick?.poster_url || null, avgRank: total / count };
        })
        .sort((a, b) => a.avgRank - b.avgRank);

      setFavorite(ranked[0] || null);
      setLeastFavorite(ranked.length > 1 ? ranked[ranked.length - 1] : null);
    };
    fetchData();
  }, [seasonIds.join(',')]);

  const getRankingsForMovie = (moviePickId: string): IndividualRanking[] => {
    return allRankings
      .filter(r => r.movie_pick_id === moviePickId)
      .map(r => ({ userId: r.user_id, rank: r.rank }))
      .sort((a, b) => a.rank - b.rank);
  };

  if (!favorite) return null;

  const renderCard = (movie: RankedMovie, type: 'favorite' | 'least') => {
    const rankings = getRankingsForMovie(movie.moviePickId);
    const isFav = type === 'favorite';

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 min-w-0 w-full text-left transition-colors ${
            isFav ? 'bg-primary/10 ring-1 ring-primary/20 hover:bg-primary/15' : 'bg-muted/30 ring-1 ring-border/20 hover:bg-muted/40'
          }`}>
            {movie.posterUrl ? (
              <img src={movie.posterUrl} alt={movie.title} className="w-7 h-10 rounded object-cover shrink-0" />
            ) : (
              <div className="w-7 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                <Film className="w-3 h-3 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                {isFav ? (
                  <Star className="w-3 h-3 text-primary fill-primary shrink-0" />
                ) : (
                  <ThumbsDown className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                <span className={`text-[10px] font-medium uppercase tracking-wide ${isFav ? 'text-primary' : 'text-muted-foreground'}`}>
                  {isFav ? 'Favorite' : 'Least Fav'}
                </span>
              </div>
              <p className="font-medium text-xs truncate">{movie.title}</p>
              <p className="text-[10px] text-muted-foreground">Avg: {movie.avgRank.toFixed(1)}</p>
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="center" className="p-3 w-56">
          <p className="font-medium text-sm mb-2 truncate">{movie.title}</p>
          <div className="space-y-1">
            {rankings.map(r => {
              const profile = getProfile(r.userId);
              return (
                <div key={r.userId} className="flex items-center justify-between text-xs">
                  <span className="truncate mr-2">{profile?.display_name || 'Unknown'}</span>
                  <span className="font-mono text-muted-foreground shrink-0">#{r.rank}</span>
                </div>
              );
            })}
            {rankings.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No rankings yet</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {renderCard(favorite, 'favorite')}
      {leastFavorite && renderCard(leastFavorite, 'least')}
    </div>
  );
};

export default FavoritesBar;
