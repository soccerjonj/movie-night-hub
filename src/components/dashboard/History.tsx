import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Film, ChevronDown, ChevronUp, Trophy, TrendingUp, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmNTY4MWM0OWEzYmQ0MTgwY2Y4NjliNWJiODU3NDFiZSIsIm5iZiI6MTc3MjY1ODEzNS4xNjIsInN1YiI6IjY5YTg5ZGQ3ZDcxNDhmYzc5OTk0NzE3ZSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.OiO9ThN-gfA-HMEzrO52JlEQgg1njrMcVosXVcYlKKo';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

interface Props {
  group: { id: string };
  profiles: Profile[];
  members: { user_id: string }[];
}

interface SeasonInfo {
  id: string;
  season_number: number;
  title: string | null;
  status: string;
  current_movie_index: number;
}

interface PickRow {
  id: string;
  title: string;
  user_id: string;
  poster_url: string | null;
  year: string | null;
  tmdb_id: number | null;
  watch_order: number | null;
  season_id: string;
}

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
  season_id: string;
}

interface MovieDisplay {
  watchOrder: number | null;
  title: string;
  year: string | null;
  posterUrl: string | null;
  pickerNames: string;
  tmdbId: number | null;
  pickId: string;
}

const History = ({ group, profiles, members }: Props) => {
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('all');
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [directors, setDirectors] = useState<Record<string, string>>({});
  const [expandedMovie, setExpandedMovie] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Scoreboard state
  const [scores, setScores] = useState<{ user_id: string; correct: number; total: number }[]>([]);
  const [scoreLoading, setScoreLoading] = useState(false);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  // Fetch seasons
  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('seasons')
        .select('id, season_number, title, status, current_movie_index')
        .eq('group_id', group.id)
        .order('season_number', { ascending: true });
      setSeasons((data || []) as SeasonInfo[]);
      setLoading(false);
    };
    fetch();
  }, [group.id]);

  // Fetch picks when season changes
  useEffect(() => {
    const fetchPicks = async () => {
      setLoading(true);
      let query = supabase.from('movie_picks')
        .select('id, title, user_id, poster_url, year, tmdb_id, watch_order, season_id')
        .order('watch_order', { ascending: true });

      if (selectedSeasonId !== 'all') {
        query = query.eq('season_id', selectedSeasonId);
      } else {
        const ids = seasons.map(s => s.id);
        if (ids.length > 0) query = query.in('season_id', ids);
      }

      const { data } = await query;
      setPicks((data || []) as PickRow[]);
      setLoading(false);
    };
    if (seasons.length > 0) fetchPicks();
  }, [selectedSeasonId, seasons]);

  // Fetch directors
  useEffect(() => {
    const fetchDirectors = async () => {
      for (const pick of picks) {
        if (directors[pick.id]) continue;
        let tmdbId = pick.tmdb_id;
        try {
          if (!tmdbId) {
            const yearParam = pick.year ? `&year=${pick.year}` : '';
            const res = await fetch(
              `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(pick.title)}&include_adult=false&language=en-US&page=1${yearParam}`,
              { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
            );
            const data = await res.json();
            tmdbId = data.results?.[0]?.id || null;

            // Also fetch poster if missing
            if (data.results?.[0]?.poster_path && !pick.poster_url) {
              const url = `${TMDB_IMAGE_BASE}${data.results[0].poster_path}`;
              await supabase.from('movie_picks').update({
                poster_url: url,
                tmdb_id: data.results[0].id,
              }).eq('id', pick.id);
            }
          }
          if (tmdbId) {
            const creditsRes = await fetch(
              `https://api.themoviedb.org/3/movie/${tmdbId}/credits?language=en-US`,
              { headers: { 'Authorization': `Bearer ${TMDB_API_TOKEN}`, 'Accept': 'application/json' } }
            );
            const creditsData = await creditsRes.json();
            const director = creditsData.crew?.find((c: { job: string; name: string }) => c.job === 'Director');
            if (director) {
              setDirectors(prev => ({ ...prev, [pick.id]: director.name }));
            }
          }
        } catch {
          // skip
        }
      }
    };
    if (picks.length > 0) fetchDirectors();
  }, [picks]);

  // Fetch scores
  useEffect(() => {
    const fetchScores = async () => {
      setScoreLoading(true);
      try {
        let seasonData: SeasonInfo[] = [];
        if (selectedSeasonId === 'all') {
          seasonData = seasons;
        } else {
          const s = seasons.find(s => s.id === selectedSeasonId);
          if (s) seasonData = [s];
        }

        const seasonIds = seasonData.map(s => s.id);
        if (seasonIds.length === 0) { setScores([]); setScoreLoading(false); return; }

        const seasonMap = new Map(seasonData.map(s => [s.id, s]));

        const [guessesRes, picksRes] = await Promise.all([
          supabase.from('guesses').select('guesser_id, guessed_user_id, movie_pick_id, season_id').in('season_id', seasonIds),
          supabase.from('movie_picks').select('id, user_id, season_id, revealed, watch_order').in('season_id', seasonIds),
        ]);

        const guesses = (guessesRes.data || []) as GuessRow[];
        const allPicks = picksRes.data || [];

        const isPickWatched = (pick: typeof allPicks[0]) => {
          const s = seasonMap.get(pick.season_id);
          if (!s) return false;
          if (s.status === 'completed') return true;
          if (s.status === 'watching' && pick.watch_order != null) return pick.watch_order < s.current_movie_index;
          return false;
        };

        const coPickGroups = new Map<string, string[]>();
        allPicks.forEach(p => {
          if (isPickWatched(p) && p.watch_order != null) {
            const key = `${p.season_id}:${p.watch_order}`;
            if (!coPickGroups.has(key)) coPickGroups.set(key, []);
            coPickGroups.get(key)!.push(p.user_id);
          }
        });

        const pickValidUsers: Record<string, Set<string>> = {};
        allPicks.forEach(p => {
          if (isPickWatched(p) && p.watch_order != null) {
            const key = `${p.season_id}:${p.watch_order}`;
            pickValidUsers[p.id] = new Set(coPickGroups.get(key) || [p.user_id]);
          }
        });

        const scoreMap: Record<string, { correct: number; total: number }> = {};
        members.forEach(m => { scoreMap[m.user_id] = { correct: 0, total: 0 }; });

        guesses.forEach(g => {
          if (!scoreMap[g.guesser_id]) scoreMap[g.guesser_id] = { correct: 0, total: 0 };
          if (pickValidUsers[g.movie_pick_id]) {
            scoreMap[g.guesser_id].total += 1;
            if (pickValidUsers[g.movie_pick_id].has(g.guessed_user_id)) {
              scoreMap[g.guesser_id].correct += 1;
            }
          }
        });

        setScores(
          Object.entries(scoreMap)
            .map(([user_id, { correct, total }]) => ({ user_id, correct, total }))
            .sort((a, b) => b.correct - a.correct || (b.total > 0 ? b.correct / b.total : 0) - (a.total > 0 ? a.correct / a.total : 0))
        );
      } catch {
        setScores([]);
      } finally {
        setScoreLoading(false);
      }
    };
    fetchScores();
  }, [selectedSeasonId, seasons, members]);

  // Group picks by season + watch_order for display (co-picks become one entry)
  const groupedMovies = (() => {
    const seasonGroups = new Map<string, Map<number | string, PickRow[]>>();
    picks.forEach(p => {
      if (!seasonGroups.has(p.season_id)) seasonGroups.set(p.season_id, new Map());
      const key = p.watch_order ?? p.id;
      const group = seasonGroups.get(p.season_id)!;
      if (!group.has(key)) group.set(key, []);
      group.get(key)!.push(p);
    });

    const result: { seasonId: string; seasonInfo: SeasonInfo | undefined; movies: MovieDisplay[] }[] = [];
    const orderedSeasons = selectedSeasonId === 'all' ? seasons : seasons.filter(s => s.id === selectedSeasonId);

    orderedSeasons.forEach(seasonInfo => {
      const pickGroups = seasonGroups.get(seasonInfo.id);
      if (!pickGroups) return;
      const movies: MovieDisplay[] = Array.from(pickGroups.entries())
        .sort(([a], [b]) => (typeof a === 'number' ? a : 999) - (typeof b === 'number' ? b : 999))
        .map(([, groupPicks]) => ({
          watchOrder: groupPicks[0].watch_order,
          title: groupPicks[0].title,
          year: groupPicks[0].year,
          posterUrl: groupPicks[0].poster_url,
          pickerNames: groupPicks.map(p => getProfile(p.user_id)?.display_name || '?').join(' & '),
          tmdbId: groupPicks[0].tmdb_id,
          pickId: groupPicks[0].id,
        }));
      result.push({ seasonId: seasonInfo.id, seasonInfo, movies });
    });
    return result;
  })();

  const getMedal = (i: number) => {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return `${i + 1}`;
  };

  return (
    <div className="space-y-6">
      {/* Season selector */}
      <div className="flex items-center gap-3">
        <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
          <SelectTrigger className="w-56 bg-muted/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Seasons</SelectItem>
            {seasons.map(s => (
              <SelectItem key={s.id} value={s.id}>
                Season {s.season_number}{s.title ? ` — ${s.title}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : groupedMovies.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <Film className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No movies watched yet</p>
        </div>
      ) : (
        <>
          {/* Movies */}
          <div className="glass-card rounded-2xl p-5">
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-2">
              {groupedMovies.map(({ seasonId, seasonInfo, movies }, groupIdx) => (
                <>
                  {selectedSeasonId === 'all' && seasonInfo && groupIdx > 0 && (
                    <div key={`sep-${seasonId}`} className="col-span-full flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-border/30" />
                      <span className="text-[11px] text-muted-foreground/60 font-medium whitespace-nowrap">
                        Season {seasonInfo.season_number}{seasonInfo.title ? ` — ${seasonInfo.title}` : ''}
                      </span>
                      <div className="flex-1 h-px bg-border/30" />
                    </div>
                  )}
                  {selectedSeasonId === 'all' && seasonInfo && groupIdx === 0 && (
                    <div key={`label-${seasonId}`} className="col-span-full">
                      <span className="text-[11px] text-muted-foreground/60 font-medium">
                        Season {seasonInfo.season_number}{seasonInfo.title ? ` — ${seasonInfo.title}` : ''}
                      </span>
                    </div>
                  )}
                  {movies.map((movie) => {
                    const isExpanded = expandedMovie === movie.pickId;
                    return (
                      <div key={movie.pickId} className="relative group">
                        <button
                          onClick={() => setExpandedMovie(isExpanded ? null : movie.pickId)}
                          className="w-full aspect-[2/3] rounded-lg overflow-hidden bg-muted transition-transform hover:scale-105 hover:ring-2 hover:ring-primary/40 focus:ring-2 focus:ring-primary/40"
                        >
                          {movie.posterUrl ? (
                            <img src={movie.posterUrl} alt={movie.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1">
                              <Film className="w-5 h-5 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground text-center leading-tight line-clamp-3">{movie.title}</span>
                            </div>
                          )}
                        </button>
                        {isExpanded && (
                          <div className="absolute z-20 left-0 right-0 top-full mt-1 p-3 rounded-xl bg-card border border-border shadow-xl space-y-1.5 min-w-[200px] w-max max-w-[260px]">
                            <p className="font-medium text-sm leading-tight">{movie.title}</p>
                            <div className="flex items-center gap-x-2 text-xs text-muted-foreground">
                              {movie.year && <span>{movie.year}</span>}
                              {directors[movie.pickId] && (
                                <>
                                  {movie.year && <span>·</span>}
                                  <span>{directors[movie.pickId]}</span>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs">
                              <User className="w-3 h-3 text-primary" />
                              <span className="text-muted-foreground">Picked by</span>
                              <span className="font-medium">{movie.pickerNames}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>

          {/* Scoreboard */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-primary" />
              <h2 className="font-display text-xl font-bold">
                {selectedSeasonId === 'all' ? 'All-Time Scoreboard' : `Season ${seasons.find(s => s.id === selectedSeasonId)?.season_number} Scoreboard`}
              </h2>
            </div>

            {scoreLoading ? (
              <div className="text-center text-muted-foreground py-6">Loading scores...</div>
            ) : scores.every(s => s.total === 0) ? (
              <div className="text-center text-muted-foreground py-6">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No guesses scored yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {scores.map((entry, i) => {
                  const profile = getProfile(entry.user_id);
                  const pct = entry.total > 0 ? Math.round((entry.correct / entry.total) * 100) : 0;
                  return (
                    <div
                      key={entry.user_id}
                      className={`flex items-center gap-3 rounded-xl p-3 transition-colors ${
                        i === 0 && entry.correct > 0 ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/20'
                      }`}
                    >
                      <span className="text-lg w-8 text-center">{getMedal(i)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{profile?.display_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.correct}/{entry.total} correct ({pct}%)
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-lg font-bold text-primary">{entry.correct}</p>
                        <p className="text-xs text-muted-foreground">pts</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default History;
