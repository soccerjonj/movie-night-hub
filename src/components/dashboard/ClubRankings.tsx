import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Trophy, Film, Star, Crown } from 'lucide-react';

interface Props {
  seasonIds: string[];
  profiles: Profile[];
  label?: string;
}

interface RankedMovie {
  moviePickId: string;
  title: string;
  posterUrl: string | null;
  year: string | null;
  avgRank: number;
  rankCount: number;
  pickerName: string;
}

const ClubRankings = ({ seasonIds, profiles, label }: Props) => {
  const [rankedMovies, setRankedMovies] = useState<RankedMovie[]>([]);
  const [loading, setLoading] = useState(true);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  useEffect(() => {
    if (seasonIds.length === 0) {
      setRankedMovies([]);
      setLoading(false);
      return;
    }

    const fetchRankings = async () => {
      setLoading(true);
      const [rankingsRes, picksRes] = await Promise.all([
        supabase
          .from('movie_rankings')
          .select('movie_pick_id, rank')
          .in('season_id', seasonIds),
        supabase
          .from('movie_picks')
          .select('id, title, poster_url, year, user_id, watch_order, season_id')
          .in('season_id', seasonIds),
      ]);

      const rankings = rankingsRes.data || [];
      const picks = picksRes.data || [];

      if (rankings.length === 0) {
        setRankedMovies([]);
        setLoading(false);
        return;
      }

      // Aggregate rankings per movie_pick_id
      const scoreMap: Record<string, { total: number; count: number }> = {};
      rankings.forEach(r => {
        if (!scoreMap[r.movie_pick_id]) scoreMap[r.movie_pick_id] = { total: 0, count: 0 };
        scoreMap[r.movie_pick_id].total += r.rank;
        scoreMap[r.movie_pick_id].count += 1;
      });

      // Build ranked list
      const pickMap = new Map(picks.map(p => [p.id, p]));
      const ranked: RankedMovie[] = Object.entries(scoreMap)
        .map(([moviePickId, { total, count }]) => {
          const pick = pickMap.get(moviePickId);
          // For co-picks, find all pickers with same watch_order
          let pickerName = '?';
          if (pick) {
            const coPicks = picks.filter(
              p => p.season_id === pick.season_id && p.watch_order === pick.watch_order
            );
            pickerName = coPicks
              .map(p => getProfile(p.user_id)?.display_name || '?')
              .join(' & ');
          }
          return {
            moviePickId,
            title: pick?.title || '?',
            posterUrl: pick?.poster_url || null,
            year: pick?.year || null,
            avgRank: total / count,
            rankCount: count,
            pickerName,
          };
        })
        .sort((a, b) => a.avgRank - b.avgRank);

      setRankedMovies(ranked);
      setLoading(false);
    };

    fetchRankings();
  }, [seasonIds.join(','), profiles]);

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-4 sm:p-6">
        <div className="text-center text-muted-foreground py-6 text-sm">Loading rankings...</div>
      </div>
    );
  }

  if (rankedMovies.length === 0) return null;

  const getMedal = (i: number) => {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return null;
  };

  const favorite = rankedMovies[0];
  const leastFavorite = rankedMovies[rankedMovies.length - 1];

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Crown className="w-5 h-5 text-primary" />
        <h2 className="font-display text-lg sm:text-xl font-bold">
          {label || 'Club Rankings'}
        </h2>
      </div>

      {/* Highlight cards for top & bottom */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl bg-primary/10 ring-1 ring-primary/20 p-3 flex items-center gap-3">
          <div className="shrink-0">
            {favorite.posterUrl ? (
              <img src={favorite.posterUrl} alt={favorite.title} className="w-12 rounded-lg object-cover" />
            ) : (
              <div className="w-12 h-16 rounded-lg bg-muted flex items-center justify-center">
                <Film className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Star className="w-3.5 h-3.5 text-primary fill-primary" />
              <span className="text-[11px] font-medium text-primary uppercase tracking-wide">Club Favorite</span>
            </div>
            <p className="font-medium text-sm truncate">{favorite.title}</p>
            <p className="text-[11px] text-muted-foreground">
              Avg rank: {favorite.avgRank.toFixed(1)} · {favorite.rankCount} votes
            </p>
          </div>
        </div>

        {rankedMovies.length > 1 && (
          <div className="rounded-xl bg-muted/30 ring-1 ring-border/20 p-3 flex items-center gap-3">
            <div className="shrink-0">
              {leastFavorite.posterUrl ? (
                <img src={leastFavorite.posterUrl} alt={leastFavorite.title} className="w-12 rounded-lg object-cover" />
              ) : (
                <div className="w-12 h-16 rounded-lg bg-muted flex items-center justify-center">
                  <Film className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Least Favorite</span>
              </div>
              <p className="font-medium text-sm truncate">{leastFavorite.title}</p>
              <p className="text-[11px] text-muted-foreground">
                Avg rank: {leastFavorite.avgRank.toFixed(1)} · {leastFavorite.rankCount} votes
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Full ranked list */}
      <div className="space-y-1.5">
        {rankedMovies.map((movie, index) => (
          <div
            key={movie.moviePickId}
            className={`flex items-center gap-2 sm:gap-3 rounded-xl p-2 sm:p-3 ${
              index === 0 ? 'bg-primary/5' : 'bg-muted/10'
            }`}
          >
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              index === 0 ? 'bg-primary text-primary-foreground' :
              index === 1 ? 'bg-primary/60 text-primary-foreground' :
              index === 2 ? 'bg-primary/30 text-foreground' :
              'bg-muted text-muted-foreground'
            }`}>
              {getMedal(index) || index + 1}
            </div>

            {movie.posterUrl ? (
              <img src={movie.posterUrl} alt={movie.title} className="w-8 sm:w-10 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-8 sm:w-10 h-11 sm:h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Film className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{movie.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {movie.year && `${movie.year} · `}Picked by {movie.pickerName}
              </p>
            </div>

            <div className="text-right shrink-0">
              <p className="text-xs font-medium text-muted-foreground">
                {movie.avgRank.toFixed(1)}
              </p>
              <p className="text-[10px] text-muted-foreground/60">avg</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClubRankings;
