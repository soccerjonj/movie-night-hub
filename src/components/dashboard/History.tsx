import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/hooks/useGroup';
import { Film, ChevronDown, ChevronUp, Trophy, TrendingUp, User, Users, Check, X } from 'lucide-react';
import ClubRankings from './ClubRankings';
import FavoritesBar from './FavoritesBar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getClubLabels } from '@/lib/clubTypes';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';

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
  pickUserId: string;
  seasonId: string;
}
const History = ({ group, profiles, members }: Props) => {
  const labels = getClubLabels(group.club_type);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('all');
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [directors, setDirectors] = useState<Record<string, string>>({});
  const [expandedMovie, setExpandedMovie] = useState<string | null>(null);
  const [allGuesses, setAllGuesses] = useState<GuessRow[]>([]);
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
        .order('season_number', { ascending: false });
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

  // Fetch all guesses for selected seasons
  useEffect(() => {
    const fetchGuesses = async () => {
      const seasonIds = selectedSeasonId === 'all' ? seasons.map(s => s.id) : [selectedSeasonId];
      if (seasonIds.length === 0) return;
      const { data } = await supabase
        .from('guesses')
        .select('guesser_id, guessed_user_id, movie_pick_id, season_id')
        .in('season_id', seasonIds);
      setAllGuesses((data || []) as GuessRow[]);
    };
    if (seasons.length > 0) fetchGuesses();
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
  // Check if a pick has been watched
  const isPickWatched = (pick: PickRow) => {
    const s = seasons.find(s => s.id === pick.season_id);
    if (!s) return false;
    if (s.status === 'completed') return true;
    if (s.status === 'watching' && pick.watch_order != null) return pick.watch_order < s.current_movie_index;
    return false;
  };

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
        .map(([, groupPicks]) => {
          const watched = isPickWatched(groupPicks[0]);
          return {
            watchOrder: groupPicks[0].watch_order,
            title: groupPicks[0].title,
            year: groupPicks[0].year,
            posterUrl: groupPicks[0].poster_url,
            pickerNames: watched
              ? groupPicks.map(p => getProfile(p.user_id)?.display_name || '?').join(' & ')
              : '???',
            tmdbId: groupPicks[0].tmdb_id,
            pickId: groupPicks[0].id,
            pickUserId: groupPicks[0].user_id,
            seasonId: groupPicks[0].season_id,
          };
        });
      if (movies.length > 0) result.push({ seasonId: seasonInfo.id, seasonInfo, movies });
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
            <SelectItem value="all">All {labels.seasonNounPlural}</SelectItem>
            {seasons.map(s => (
              <SelectItem key={s.id} value={s.id}>
                {labels.seasonNoun} {s.season_number}{s.title ? ` — ${s.title}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Compact favorites bar at top */}
      <FavoritesBar
        seasonIds={selectedSeasonId === 'all' ? seasons.filter(s => s.status === 'completed' || s.status === 'reviewing').map(s => s.id) : [selectedSeasonId]}
        profiles={profiles}
      />

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : groupedMovies.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <Film className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No {labels.items} {labels.watched} yet</p>
        </div>
      ) : (
        <>
          {/* Movies */}
          <div className="glass-card rounded-2xl p-3 sm:p-5 overflow-visible">
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-1.5 sm:gap-2">
              {groupedMovies.map(({ seasonId, seasonInfo, movies }, groupIdx) => (
                <>
                  {selectedSeasonId === 'all' && seasonInfo && groupIdx > 0 && (
                    <div key={`sep-${seasonId}`} className="col-span-full flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-border/30" />
                      <span className="text-[11px] text-muted-foreground/60 font-medium whitespace-nowrap">
                        {labels.seasonNoun} {seasonInfo.season_number}{seasonInfo.title ? ` — ${seasonInfo.title}` : ''}
                      </span>
                      <div className="flex-1 h-px bg-border/30" />
                    </div>
                  )}
                  {selectedSeasonId === 'all' && seasonInfo && groupIdx === 0 && (
                    <div key={`label-${seasonId}`} className="col-span-full">
                      <span className="text-[11px] text-muted-foreground/60 font-medium">
                        {labels.seasonNoun} {seasonInfo.season_number}{seasonInfo.title ? ` — ${seasonInfo.title}` : ''}
                      </span>
                    </div>
                  )}
                  {movies.map((movie) => {
                    const isExpanded = expandedMovie === movie.pickId;
                    return (
                      <Popover key={movie.pickId} open={expandedMovie === movie.pickId} onOpenChange={(open) => setExpandedMovie(open ? movie.pickId : null)}>
                        <PopoverTrigger asChild>
                          <button
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
                        </PopoverTrigger>
                        <PopoverContent side="top" align="center" sideOffset={4} collisionPadding={8} className="p-3 space-y-1.5 min-w-[220px] w-max max-w-[280px]">
                          {(() => {
                            // Find all sibling picks for co-picks (same season + watch_order)
                            const pick = picks.find(p => p.id === movie.pickId);
                            const watched = pick ? isPickWatched(pick) : false;
                            const siblingPicks = pick
                              ? picks.filter(p => p.season_id === pick.season_id && p.watch_order === pick.watch_order)
                              : [pick].filter(Boolean);
                            const siblingPickIds = new Set(siblingPicks.map(p => p!.id));
                            const validPickerIds = new Set(siblingPicks.map(p => p!.user_id));
                            // Collect guesses across all sibling pick IDs, dedupe by guesser
                            const guessMap = new Map<string, GuessRow>();
                            allGuesses.forEach(g => {
                              if (siblingPickIds.has(g.movie_pick_id) && !guessMap.has(g.guesser_id)) {
                                guessMap.set(g.guesser_id, g);
                              }
                            });
                            const guesses = Array.from(guessMap.values());
                            const correctCount = watched ? guesses.filter(g => validPickerIds.has(g.guessed_user_id)).length : 0;
                            const pct = watched && guesses.length > 0 ? Math.round((correctCount / guesses.length) * 100) : 0;

                            return (
                              <>
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

                                {guesses.length > 0 && (
                                  <div className="border-t border-border/30 pt-1.5 mt-1.5">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                      <Users className="w-3 h-3" />
                                      <span>Guesses</span>
                                      {watched && guesses.length > 0 && (
                                        <span className="ml-auto text-primary font-medium">{correctCount}/{guesses.length} ({pct}%)</span>
                                      )}
                                    </div>
                                    <div className="space-y-1">
                                      {guesses.map(g => {
                                        const guesserName = getProfile(g.guesser_id)?.display_name || '?';
                                        // For co-picks, show the group name if they guessed any valid picker
                                        const guessedName = validPickerIds.size > 1 && validPickerIds.has(g.guessed_user_id)
                                          ? Array.from(validPickerIds).map(id => getProfile(id)?.display_name || '?').join(' & ')
                                          : getProfile(g.guessed_user_id)?.display_name || '?';
                                        const isCorrect = watched && validPickerIds.has(g.guessed_user_id);
                                        const isWrong = watched && !validPickerIds.has(g.guessed_user_id);

                                        return (
                                          <div
                                            key={g.guesser_id}
                                            className={`flex items-center justify-between rounded-md px-2 py-1 text-[11px] ${
                                              isCorrect ? 'bg-green-500/10' : isWrong ? 'bg-destructive/5' : 'bg-muted/20'
                                            }`}
                                          >
                                            <span className="font-medium">{guesserName}</span>
                                            <div className="flex items-center gap-1">
                                              <span className="text-muted-foreground">→</span>
                                              <span className={`font-medium ${isCorrect ? 'text-green-400' : isWrong ? 'text-destructive' : ''}`}>
                                                {guessedName}
                                              </span>
                                              {isCorrect && <Check className="w-2.5 h-2.5 text-green-400" />}
                                              {isWrong && <X className="w-2.5 h-2.5 text-destructive" />}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </PopoverContent>
                      </Popover>
                    );
                  })}
                </>
              ))}
            </div>
          </div>

          {/* Club Rankings */}
          <ClubRankings
            seasonIds={selectedSeasonId === 'all' ? seasons.filter(s => s.status === 'completed' || s.status === 'reviewing').map(s => s.id) : [selectedSeasonId]}
            profiles={profiles}
            label={selectedSeasonId === 'all' ? 'All-Time Club Rankings' : `${labels.seasonNoun} ${seasons.find(s => s.id === selectedSeasonId)?.season_number} Rankings`}
            hideFavorites
          />

          {/* Scoreboard */}
          <div className="glass-card rounded-2xl p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-primary" />
              <h2 className="font-display text-xl font-bold">
                {selectedSeasonId === 'all' ? 'All-Time Scoreboard' : `${labels.seasonNoun} ${seasons.find(s => s.id === selectedSeasonId)?.season_number} Scoreboard`}
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
