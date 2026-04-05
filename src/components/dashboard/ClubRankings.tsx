import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Trophy, Film, Star, Crown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  seasonIds: string[];
  profiles: Profile[];
  label?: string;
  hideFavorites?: boolean;
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

export { type RankedMovie };

const ClubRankings = ({ seasonIds, profiles, label, hideFavorites }: Props) => {
  const [rankedMovies, setRankedMovies] = useState<RankedMovie[]>([]);
  const [allRankings, setAllRankings] = useState<{ movie_pick_id: string; user_id: string; rank: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMovie, setSelectedMovie] = useState<RankedMovie | null>(null);

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
          .select('movie_pick_id, rank, user_id')
          .in('season_id', seasonIds),
        supabase
          .from('movie_picks')
          .select('id, title, poster_url, year, user_id, watch_order, season_id')
          .in('season_id', seasonIds),
      ]);

      const rankings = rankingsRes.data || [];
      const picks = picksRes.data || [];
      setAllRankings(rankings);

      if (rankings.length === 0) {
        setRankedMovies([]);
        setLoading(false);
        return;
      }

      // Group co-picks by (season_id, watch_order) so they merge into one entry
      const coPickGroups = new Map<string, typeof picks>();
      picks.forEach(p => {
        const key = `${p.season_id}::${p.watch_order ?? p.id}`;
        if (!coPickGroups.has(key)) coPickGroups.set(key, []);
        coPickGroups.get(key)!.push(p);
      });

      // Build a map from movie_pick_id to its co-pick group key
      const pickIdToGroupKey = new Map<string, string>();
      coPickGroups.forEach((group, key) => {
        group.forEach(p => pickIdToGroupKey.set(p.id, key));
      });

      // Aggregate rankings per co-pick group (not per individual pick id)
      const scoreMap: Record<string, { total: number; count: number; pickIds: Set<string> }> = {};
      rankings.forEach(r => {
        const groupKey = pickIdToGroupKey.get(r.movie_pick_id) || r.movie_pick_id;
        if (!scoreMap[groupKey]) scoreMap[groupKey] = { total: 0, count: 0, pickIds: new Set() };
        scoreMap[groupKey].total += r.rank;
        scoreMap[groupKey].count += 1;
        scoreMap[groupKey].pickIds.add(r.movie_pick_id);
      });

      // Build ranked list
      const ranked: RankedMovie[] = Object.entries(scoreMap)
        .map(([groupKey, { total, count, pickIds }]) => {
          const group = coPickGroups.get(groupKey);
          const primaryPick = group?.[0];
          const pickerName = group
            ? group.map(p => getProfile(p.user_id)?.display_name || '?').join(' & ')
            : '?';
          // Use first pick id as the canonical id; store all pick ids for ranking lookup
          const canonicalId = primaryPick?.id || [...pickIds][0];
          return {
            moviePickId: canonicalId,
            _allPickIds: [...pickIds],
            title: primaryPick?.title || '?',
            posterUrl: primaryPick?.poster_url || null,
            year: primaryPick?.year || null,
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

      {!hideFavorites && (<>
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
      </>)}

      {/* Full ranked list */}
      <div className="space-y-1.5">
        {rankedMovies.map((movie, index) => (
          <button
            key={movie.moviePickId}
            onClick={() => setSelectedMovie(movie)}
            className={`w-full flex items-center gap-2 sm:gap-3 rounded-xl p-2 sm:p-3 text-left transition-colors hover:ring-1 hover:ring-primary/30 ${
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
          </button>
        ))}
      </div>

      {/* Individual rankings dialog */}
      <Dialog open={!!selectedMovie} onOpenChange={(open) => { if (!open) setSelectedMovie(null); }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-display text-base truncate">
              {selectedMovie?.title}
            </DialogTitle>
          </DialogHeader>
          {selectedMovie && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground mb-2">
                Avg rank: {selectedMovie.avgRank.toFixed(1)} · {selectedMovie.rankCount} votes
              </p>
              {allRankings
                .filter(r => r.movie_pick_id === selectedMovie.moviePickId)
                .sort((a, b) => a.rank - b.rank)
                .map(r => {
                  const profile = getProfile(r.user_id);
                  return (
                    <div key={r.user_id} className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {profile?.avatar_url ? (
                          <img src={profile.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-bold text-primary">{profile?.display_name?.charAt(0).toUpperCase() || '?'}</span>
                          </div>
                        )}
                        <span className="text-sm truncate">{profile?.display_name || 'Unknown'}</span>
                      </div>
                      <span className="font-mono text-sm font-medium text-muted-foreground shrink-0 ml-2">#{r.rank}</span>
                    </div>
                  );
                })}
              {allRankings.filter(r => r.movie_pick_id === selectedMovie.moviePickId).length === 0 && (
                <p className="text-sm text-muted-foreground italic text-center py-4">No rankings yet</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClubRankings;
