import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Trophy, TrendingUp, Check, X, Film, ChevronUp, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatePresence, motion } from 'framer-motion';

interface Props {
  group: { id: string };
  season: Season | null;
  profiles: Profile[];
  members: { user_id: string }[];
  collapsed?: boolean;
}

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
  season_id: string;
}

interface ScoreEntry {
  user_id: string;
  correct: number;
  total: number;
}

interface RankingEntry {
  user_id: string;
  avgRank: number;
  totalPicks: number;
  picks: { title: string; poster_url: string | null; avgRank: number; revealed: boolean }[];
}

const Scoreboard = ({ group, season, profiles, members, collapsed = false }: Props) => {
  const [view, setView] = useState<'season' | 'alltime'>('season');
  const [mode, setMode] = useState<'guesses' | 'rankings'>('guesses');
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [rankingScores, setRankingScores] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [picks, setPicks] = useState<{ id: string; user_id: string; season_id: string; watch_order: number | null; title: string; poster_url: string | null; revealed: boolean }[]>([]);
  const [seasonMap, setSeasonMap] = useState<Map<string, { id: string; status: string; current_movie_index: number; season_number: number }>>(new Map());
  const [isOpen, setIsOpen] = useState(!collapsed);

  useEffect(() => {
    fetchScores();
  }, [view, season?.id, group.id, mode]);

  const fetchScores = async () => {
    setLoading(true);
    try {
      let seasonData: { id: string; status: string; current_movie_index: number; season_number: number }[] = [];
      if (view === 'season' && season) {
        seasonData = [{ id: season.id, status: season.status, current_movie_index: season.current_movie_index, season_number: season.season_number }];
      } else {
        const { data: seasons } = await supabase
          .from('seasons')
          .select('id, status, current_movie_index, season_number')
          .eq('group_id', group.id);
        seasonData = (seasons || []) as typeof seasonData;
      }

      const seasonIds = seasonData.map(s => s.id);
      if (seasonIds.length === 0) {
        setScores([]);
        setRankingScores([]);
        setLoading(false);
        return;
      }

      const sMap = new Map(seasonData.map(s => [s.id, s]));
      setSeasonMap(sMap);

      const [guessesRes, picksRes] = await Promise.all([
        supabase.from('guesses').select('guesser_id, guessed_user_id, movie_pick_id, season_id').in('season_id', seasonIds),
        supabase.from('movie_picks').select('id, user_id, season_id, revealed, watch_order, title, poster_url').in('season_id', seasonIds),
      ]);

      const fetchedGuesses = (guessesRes.data || []) as GuessRow[];
      const fetchedPicks = picksRes.data || [];
      setGuesses(fetchedGuesses);
      setPicks(fetchedPicks as typeof picks);

      const isPickWatched = (pick: typeof fetchedPicks[0]) => {
        const s = sMap.get(pick.season_id);
        if (!s) return false;
        if (s.status === 'completed' || s.status === 'reviewing') return true;
        if (s.status === 'watching' && pick.watch_order != null) {
          return pick.watch_order < s.current_movie_index;
        }
        return false;
      };

      // Guessing scores
      const coPickGroups = new Map<string, string[]>();
      fetchedPicks.forEach(p => {
        if (isPickWatched(p) && p.watch_order != null) {
          const key = `${p.season_id}:${p.watch_order}`;
          if (!coPickGroups.has(key)) coPickGroups.set(key, []);
          coPickGroups.get(key)!.push(p.user_id);
        }
      });

      const pickValidUsers: Record<string, Set<string>> = {};
      fetchedPicks.forEach(p => {
        if (isPickWatched(p) && p.watch_order != null) {
          const key = `${p.season_id}:${p.watch_order}`;
          pickValidUsers[p.id] = new Set(coPickGroups.get(key) || [p.user_id]);
        }
      });

      const scoreMap: Record<string, { correct: number; total: number }> = {};
      members.forEach(m => {
        scoreMap[m.user_id] = { correct: 0, total: 0 };
      });

      fetchedGuesses.forEach(g => {
        if (!scoreMap[g.guesser_id]) {
          scoreMap[g.guesser_id] = { correct: 0, total: 0 };
        }
        if (pickValidUsers[g.movie_pick_id]) {
          scoreMap[g.guesser_id].total += 1;
          if (pickValidUsers[g.movie_pick_id].has(g.guessed_user_id)) {
            scoreMap[g.guesser_id].correct += 1;
          }
        }
      });

      const entries: ScoreEntry[] = Object.entries(scoreMap)
        .map(([user_id, { correct, total }]) => ({ user_id, correct, total }))
        .sort((a, b) => b.correct - a.correct || (b.total > 0 ? b.correct / b.total : 0) - (a.total > 0 ? a.correct / a.total : 0));

      setScores(entries);

      // Rankings scores - fetch rankings for relevant seasons
      if (mode === 'rankings') {
        const rankableSeasonIds = seasonData
          .filter(s => s.status === 'reviewing' || s.status === 'completed')
          .map(s => s.id);
        
        if (rankableSeasonIds.length > 0) {
          const { data: rankingsData } = await supabase
            .from('movie_rankings')
            .select('user_id, movie_pick_id, rank, season_id')
            .in('season_id', rankableSeasonIds);
          
          const rankings = rankingsData || [];
          
          const pickById = new Map(fetchedPicks.map(p => [p.id, p]));
          const getSlotKey = (pick: typeof fetchedPicks[0]) =>
            `${pick.season_id}:${pick.watch_order ?? pick.id}`;

          // Group rankings by slot (co-picks share the same watch_order)
          const slotAvgRanks = new Map<string, { total: number; count: number }>();
          rankings.forEach(r => {
            const pick = pickById.get(r.movie_pick_id);
            if (!pick) return;
            const key = getSlotKey(pick);
            if (!slotAvgRanks.has(key)) slotAvgRanks.set(key, { total: 0, count: 0 });
            const entry = slotAvgRanks.get(key)!;
            entry.total += r.rank;
            entry.count += 1;
          });

          // Group by picker
          const pickerMap = new Map<string, RankingEntry>();
          const pickerSlotSeen = new Map<string, Set<string>>();
          members.forEach(m => {
            pickerMap.set(m.user_id, { user_id: m.user_id, avgRank: 0, totalPicks: 0, picks: [] });
            pickerSlotSeen.set(m.user_id, new Set());
          });

          fetchedPicks.forEach(pick => {
            if (!rankableSeasonIds.includes(pick.season_id)) return;
            const slotKey = getSlotKey(pick);
            const avgData = slotAvgRanks.get(slotKey);
            if (!avgData || avgData.count === 0) return;
            
            const pickerEntry = pickerMap.get(pick.user_id);
            if (!pickerEntry) return;
            const seenSlots = pickerSlotSeen.get(pick.user_id);
            if (seenSlots?.has(slotKey)) return;
            seenSlots?.add(slotKey);
            
            const avg = avgData.total / avgData.count;
            pickerEntry.picks.push({
              title: pick.title,
              poster_url: pick.poster_url,
              avgRank: avg,
              revealed: pick.revealed || isPickWatched(pick),
            });
          });

          // Calculate overall avg for each picker
          const rankingEntries: RankingEntry[] = [];
          pickerMap.forEach(entry => {
            if (entry.picks.length === 0) return;
            const totalAvg = entry.picks.reduce((sum, p) => sum + p.avgRank, 0) / entry.picks.length;
            entry.avgRank = totalAvg;
            entry.totalPicks = entry.picks.length;
            entry.picks.sort((a, b) => a.avgRank - b.avgRank);
            rankingEntries.push(entry);
          });

          rankingEntries.sort((a, b) => a.avgRank - b.avgRank);
          setRankingScores(rankingEntries);
        } else {
          setRankingScores([]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch scores:', err);
    } finally {
      setLoading(false);
    }
  };

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const isPickWatchedCheck = (pick: typeof picks[0]) => {
    const s = seasonMap.get(pick.season_id);
    if (!s) return false;
    if (s.status === 'completed' || s.status === 'reviewing') return true;
    if (s.status === 'watching' && pick.watch_order != null) return pick.watch_order < s.current_movie_index;
    return false;
  };

  const getMedal = (index: number) => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `${index + 1}`;
  };

  const renderUserGuesses = (userId: string) => {
    const userGuesses = guesses.filter(g => g.guesser_id === userId);
    const watchedPicks = picks.filter(p => isPickWatchedCheck(p)).sort((a, b) => {
      const sA = seasonMap.get(a.season_id);
      const sB = seasonMap.get(b.season_id);
      const snA = sA?.season_number ?? 0;
      const snB = sB?.season_number ?? 0;
      if (snA !== snB) return snB - snA;
      return (b.watch_order ?? 0) - (a.watch_order ?? 0);
    });

    const seen = new Set<string>();
    const uniquePicks = watchedPicks.filter(p => {
      const key = `${p.season_id}:${p.watch_order}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniquePicks.length === 0) return <p className="text-xs text-muted-foreground italic py-2">No scored picks yet</p>;

    return (
      <div className="space-y-1 py-2">
        {uniquePicks.map(pick => {
          const guess = userGuesses.find(g => g.movie_pick_id === pick.id);
          const siblingPicks = picks.filter(p => p.season_id === pick.season_id && p.watch_order === pick.watch_order);
          const guessForSlot = guess || userGuesses.find(g => siblingPicks.some(sp => sp.id === g.movie_pick_id));
          const actualGuess = guess || (guessForSlot ? userGuesses.find(g => siblingPicks.some(sp => sp.id === g.movie_pick_id)) : undefined);
          
          const validUserIds = new Set(siblingPicks.map(sp => sp.user_id));
          const guessedName = actualGuess ? getProfile(actualGuess.guessed_user_id)?.display_name || '?' : null;
          const isCorrect = actualGuess ? validUserIds.has(actualGuess.guessed_user_id) : false;
          const isOwnPick = validUserIds.has(userId);

          return (
            <div
              key={pick.id}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] ${
                actualGuess ? (isCorrect ? 'bg-green-500/10' : 'bg-destructive/5') : 'bg-muted/20'
              }`}
            >
              {pick.poster_url ? (
                <img src={pick.poster_url} alt={pick.title} className="w-5 h-7 rounded object-cover shrink-0" />
              ) : (
                <div className="w-5 h-7 rounded bg-muted flex items-center justify-center shrink-0">
                  <Film className="w-2.5 h-2.5 text-muted-foreground" />
                </div>
              )}
              <span className="font-medium truncate flex-1">{pick.title}</span>
              {actualGuess ? (
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`font-medium ${isCorrect ? 'text-green-400' : 'text-destructive'}`}>
                    {guessedName}
                  </span>
                  {isCorrect ? <Check className="w-2.5 h-2.5 text-green-400" /> : <X className="w-2.5 h-2.5 text-destructive" />}
                </div>
              ) : isOwnPick ? (
                <span className="text-primary/70 italic shrink-0">their pick</span>
              ) : (
                <span className="text-muted-foreground italic shrink-0">no guess</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderUserPickRankings = (entry: RankingEntry) => {
    if (entry.picks.length === 0) return <p className="text-xs text-muted-foreground italic py-2">No ranked picks yet</p>;

    return (
      <div className="space-y-1 py-2">
        {entry.picks.map((pick, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] bg-muted/20"
          >
            {pick.revealed ? (
              <>
                {pick.poster_url ? (
                  <img src={pick.poster_url} alt={pick.title} className="w-5 h-7 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-5 h-7 rounded bg-muted flex items-center justify-center shrink-0">
                    <Film className="w-2.5 h-2.5 text-muted-foreground" />
                  </div>
                )}
                <span className="font-medium truncate flex-1">{pick.title}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Star className="w-2.5 h-2.5 text-primary fill-primary" />
                  <span className="font-semibold text-primary">{pick.avgRank.toFixed(1)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="w-5 h-7 rounded bg-muted/60 flex items-center justify-center shrink-0">
                  <span className="text-[9px] text-muted-foreground font-bold">?</span>
                </div>
                <span className="text-muted-foreground italic truncate flex-1">Not yet revealed</span>
              </>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <button
        onClick={() => collapsed && setIsOpen(!isOpen)}
        className={`flex items-center justify-between w-full mb-${isOpen ? '4' : '0'} ${collapsed ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <h2 className="font-display text-lg sm:text-xl font-bold">Scoreboard</h2>
          {collapsed && !isOpen && (
            <span className="text-xs text-muted-foreground ml-2">(from past seasons)</span>
          )}
        </div>
        {collapsed && (
          <ChevronUp className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? '' : 'rotate-180'}`} />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={collapsed ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex justify-between items-center mb-4 gap-2 flex-wrap">
              {/* Mode toggle */}
              <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
                <Button
                  variant={mode === 'guesses' ? 'gold' : 'ghost'}
                  size="sm"
                  className="text-xs h-7 px-3"
                  onClick={() => setMode('guesses')}
                >
                  Guesses
                </Button>
                <Button
                  variant={mode === 'rankings' ? 'gold' : 'ghost'}
                  size="sm"
                  className="text-xs h-7 px-3"
                  onClick={() => setMode('rankings')}
                >
                  Pick Rankings
                </Button>
              </div>
              {/* Season/All-time toggle */}
              <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
                <Button
                  variant={view === 'season' ? 'gold' : 'ghost'}
                  size="sm"
                  className="text-xs h-7 px-3"
                  onClick={() => setView('season')}
                >
                  Season
                </Button>
                <Button
                  variant={view === 'alltime' ? 'gold' : 'ghost'}
                  size="sm"
                  className="text-xs h-7 px-3"
                  onClick={() => setView('alltime')}
                >
                  All-Time
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="text-center text-muted-foreground py-8">Loading scores...</div>
            ) : mode === 'guesses' ? (
              // Guesses mode
              scores.every(s => s.total === 0) ? (
                <div className="text-center text-muted-foreground py-8">
                  <TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No guesses scored yet</p>
                  <p className="text-xs mt-1">Scores update as pickers are revealed</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {scores.map((entry, i) => {
                    const profile = getProfile(entry.user_id);
                    const pct = entry.total > 0 ? Math.round((entry.correct / entry.total) * 100) : 0;
                    const isExpanded = expandedUser === entry.user_id;
                    return (
                      <div key={entry.user_id}>
                        <button
                          onClick={() => setExpandedUser(isExpanded ? null : entry.user_id)}
                          className={`w-full flex items-center gap-3 rounded-xl p-3 transition-colors text-left ${
                            i === 0 && entry.correct > 0 ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/20 hover:bg-muted/30'
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
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="ml-10 pl-3 border-l-2 border-border/30 mt-1 mb-2">
                                {renderUserGuesses(entry.user_id)}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              // Rankings mode
              rankingScores.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <Star className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No rankings yet</p>
                  <p className="text-xs mt-1">Rankings appear after members submit their reviews</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rankingScores.map((entry, i) => {
                    const profile = getProfile(entry.user_id);
                    const isExpanded = expandedUser === entry.user_id;
                    return (
                      <div key={entry.user_id}>
                        <button
                          onClick={() => setExpandedUser(isExpanded ? null : entry.user_id)}
                          className={`w-full flex items-center gap-3 rounded-xl p-3 transition-colors text-left ${
                            i === 0 ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/20 hover:bg-muted/30'
                          }`}
                        >
                          <span className="text-lg w-8 text-center">{getMedal(i)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{profile?.display_name || 'Unknown'}</p>
                            <p className="text-xs text-muted-foreground">
                              {entry.totalPicks} pick{entry.totalPicks !== 1 ? 's' : ''} ranked
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-display text-lg font-bold text-primary">{entry.avgRank.toFixed(1)}</p>
                            <p className="text-xs text-muted-foreground">avg rank</p>
                          </div>
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="ml-10 pl-3 border-l-2 border-border/30 mt-1 mb-2">
                                {renderUserPickRankings(entry)}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Scoreboard;
