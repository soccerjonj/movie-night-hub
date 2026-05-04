import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Trophy, TrendingUp, Check, X, Film, ChevronUp, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  picks: { title: string; poster_url: string | null; avgRank: number; revealed: boolean; slotKey: string }[];
}

const RANK_BORDER = ['bg-amber-400', 'bg-slate-400', 'bg-amber-600'];
const RANK_BG    = ['bg-amber-500/8 hover:bg-amber-500/12', 'bg-slate-400/5 hover:bg-slate-400/8', 'bg-amber-700/5 hover:bg-amber-700/8'];
const RANK_BADGE = [
  'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  'bg-slate-400/15 text-slate-300 border border-slate-400/25',
  'bg-amber-700/15 text-amber-600 border border-amber-700/25',
];

const Scoreboard = ({ group, season, profiles, members, collapsed = false }: Props) => {
  const [view, setView] = useState<'season' | 'alltime'>('season');
  const [mode, setMode] = useState<'guesses' | 'rankings'>('guesses');
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [rankingScores, setRankingScores] = useState<RankingEntry[]>([]);
  const [rankingDetails, setRankingDetails] = useState<Record<string, { avgRank: number; rankings: { user_id: string; rank: number }[] }>>({});
  const [expandedRankingPick, setExpandedRankingPick] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [picks, setPicks] = useState<{ id: string; user_id: string; season_id: string; watch_order: number | null; title: string; poster_url: string | null; revealed: boolean }[]>([]);
  const [seasonMap, setSeasonMap] = useState<Map<string, { id: string; status: string; current_movie_index: number; season_number: number }>>(new Map());
  const [isOpen, setIsOpen] = useState(!collapsed);
  const [availableSeasons, setAvailableSeasons] = useState<{ id: string; status: string; current_movie_index: number; season_number: number }[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const userViewOverride = useRef(false);

  useEffect(() => {
    fetchScores();
  }, [view, season?.id, group.id, mode, selectedSeasonId]);

  const setViewWithOverride = (next: 'season' | 'alltime') => {
    userViewOverride.current = true;
    setView(next);
  };

  const fetchScores = async () => {
    setLoading(true);
    try {
      const { data: seasons } = await supabase
        .from('seasons')
        .select('id, status, current_movie_index, season_number')
        .eq('group_id', group.id);

      const allSeasons = (seasons || []) as { id: string; status: string; current_movie_index: number; season_number: number }[];
      const eligibleSeasons = allSeasons
        .filter(s => s.status === 'watching' || s.status === 'reviewing' || s.status === 'completed')
        .sort((a, b) => b.season_number - a.season_number);

      setAvailableSeasons(eligibleSeasons);

      const watchingSeason = eligibleSeasons.find(s => s.status === 'watching') ?? null;

      if (!userViewOverride.current) {
        setView(watchingSeason ? 'season' : 'alltime');
      }

      let seasonData: typeof eligibleSeasons = [];
      if (view === 'season') {
        const desiredId = selectedSeasonId || watchingSeason?.id || eligibleSeasons[0]?.id || '';
        if (desiredId && desiredId !== selectedSeasonId) {
          setSelectedSeasonId(desiredId);
        }
        const selected = eligibleSeasons.find(s => s.id === (desiredId || selectedSeasonId));
        seasonData = selected ? [selected] : [];
      } else {
        seasonData = eligibleSeasons;
      }

      const seasonIds = seasonData.map(s => s.id);
      if (seasonIds.length === 0) {
        setScores([]);
        setRankingScores([]);
        setRankingDetails({});
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
      members.forEach(m => { scoreMap[m.user_id] = { correct: 0, total: 0 }; });

      fetchedGuesses.forEach(g => {
        if (!scoreMap[g.guesser_id]) scoreMap[g.guesser_id] = { correct: 0, total: 0 };
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

          const slotAvgRanks = new Map<string, { total: number; count: number; rankings: { user_id: string; rank: number }[] }>();
          rankings.forEach(r => {
            const pick = pickById.get(r.movie_pick_id);
            if (!pick) return;
            const key = getSlotKey(pick);
            if (!slotAvgRanks.has(key)) slotAvgRanks.set(key, { total: 0, count: 0, rankings: [] });
            const entry = slotAvgRanks.get(key)!;
            entry.total += r.rank;
            entry.count += 1;
            entry.rankings.push({ user_id: r.user_id, rank: r.rank });
          });

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
              slotKey,
            });
          });

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
          const details: Record<string, { avgRank: number; rankings: { user_id: string; rank: number }[] }> = {};
          slotAvgRanks.forEach((val, key) => {
            details[key] = { avgRank: val.total / val.count, rankings: val.rankings };
          });
          setRankingDetails(details);
          setRankingScores(rankingEntries);
        } else {
          setRankingScores([]);
          setRankingDetails({});
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

  const renderAvatar = (userId: string, size = 'w-8 h-8') => {
    const profile = getProfile(userId);
    return (
      <div className={`${size} rounded-full overflow-hidden bg-primary/10 flex items-center justify-center shrink-0`}>
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt={profile.display_name || ''} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs font-bold text-primary">
            {profile?.display_name?.charAt(0).toUpperCase() || '?'}
          </span>
        )}
      </div>
    );
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
                  <span className={`font-medium ${isCorrect ? 'text-green-400' : 'text-destructive'}`}>{guessedName}</span>
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

    const autoExpandSinglePick = view === 'season' && entry.picks.length <= 1;

    return (
      <div className="space-y-1 py-2">
        {entry.picks.map((pick, i) => {
          const detailKey = `${entry.user_id}:${pick.slotKey}`;
          const isExpanded = autoExpandSinglePick || expandedRankingPick === detailKey;
          const detail = rankingDetails[pick.slotKey];
          const rankingsByUser = new Map(detail?.rankings.map(r => [r.user_id, r.rank]));
          const hidePickRow = autoExpandSinglePick;
          return (
            <div key={i}>
              {!hidePickRow && (
                <button
                  onClick={() => {
                    if (autoExpandSinglePick) return;
                    if (pick.revealed) setExpandedRankingPick(isExpanded ? null : detailKey);
                  }}
                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-left ${
                    pick.revealed ? (autoExpandSinglePick ? 'bg-muted/20' : 'bg-muted/20 hover:bg-muted/30') : 'bg-muted/10 cursor-default'
                  }`}
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
                </button>
              )}

              <AnimatePresence>
                {pick.revealed && isExpanded && detail && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-6 pl-3 border-l-2 border-border/30 mt-1 mb-2">
                      <p className="text-xs text-muted-foreground mb-2">Everyone&apos;s rankings</p>
                      <div className="text-xs mb-2">
                        <span className="text-primary font-semibold">{detail.avgRank.toFixed(1)} avg rank</span>
                        <span className="text-muted-foreground"> ({detail.rankings.length}/{members.length} ranked)</span>
                      </div>
                      <div className="space-y-1">
                        {[...members]
                          .map(m => {
                            const rank = rankingsByUser.get(m.user_id);
                            return { user_id: m.user_id, rank: typeof rank === 'number' ? rank : null };
                          })
                          .sort((a, b) => {
                            if (a.rank === null && b.rank === null) return 0;
                            if (a.rank === null) return 1;
                            if (b.rank === null) return -1;
                            return a.rank - b.rank;
                          })
                          .map((item, idx) => {
                            const name = getProfile(item.user_id)?.display_name || 'Unknown';
                            const hasRank = item.rank !== null;
                            const rowClass = hasRank && item.rank === 1 ? 'bg-green-500/10' : hasRank ? 'bg-muted/20' : 'bg-muted/10';
                            return (
                              <motion.div
                                key={item.user_id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.05 + idx * 0.03 }}
                                className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${rowClass}`}
                              >
                                <span className="font-medium">{name}</span>
                                <div className="flex items-center gap-1">
                                  <span className="text-muted-foreground">ranked</span>
                                  <span className={`font-medium ${hasRank ? (item.rank === 1 ? 'text-green-400' : 'text-foreground') : 'text-muted-foreground italic'}`}>
                                    {hasRank ? `${item.rank}` : '—'}
                                  </span>
                                  {hasRank && item.rank === 1 && <Check className="w-3 h-3 text-green-400" />}
                                  {!hasRank && <X className="w-3 h-3 text-destructive/50" />}
                                </div>
                              </motion.div>
                            );
                          })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    );
  };

  const renderScoreRow = (userId: string, i: number, scoreNode: React.ReactNode, detailNode: React.ReactNode, hasScore: boolean) => {
    const profile = getProfile(userId);
    const isExpanded = expandedUser === userId;
    const borderColor = i < 3 && hasScore ? RANK_BORDER[i] : 'bg-border/20';
    const rowBg = i < 3 && hasScore ? RANK_BG[i] : 'bg-muted/10 hover:bg-muted/20';
    const badgeStyle = i < 3 && hasScore ? RANK_BADGE[i] : 'bg-muted/30 text-muted-foreground border border-border/40';
    const nameStyle = i === 0 && hasScore ? 'text-amber-200' : '';

    return (
      <motion.div
        key={userId}
        variants={{
          hidden: { opacity: 0, y: 8 },
          visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }
        }}
      >
        <div className="relative overflow-hidden rounded-xl">
          {/* Left border accent */}
          <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl ${borderColor}`} />

          <button
            onClick={() => setExpandedUser(isExpanded ? null : userId)}
            className={`w-full flex items-center gap-3 pl-4 pr-3 py-3 text-left transition-all ${rowBg}`}
          >
            {/* Rank badge */}
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${badgeStyle}`}>
              {i + 1}
            </div>

            {/* Avatar */}
            {renderAvatar(userId)}

            {/* Name + bar */}
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm truncate ${nameStyle}`}>{profile?.display_name || 'Unknown'}</p>
              {scoreNode}
            </div>

            {/* Right score */}
            {detailNode}
          </button>
        </div>

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
                {mode === 'guesses'
                  ? renderUserGuesses(userId)
                  : renderUserPickRankings(rankingScores.find(e => e.user_id === userId)!)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <button
        onClick={() => collapsed && setIsOpen(!isOpen)}
        className={`flex items-center justify-between w-full mb-${isOpen ? '4' : '0'} ${collapsed ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
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
            {/* Controls — single row */}
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
                <Button variant={mode === 'guesses' ? 'gold' : 'ghost'} size="sm" className="text-xs h-7 px-3" onClick={() => setMode('guesses')}>
                  Guesses
                </Button>
                <Button variant={mode === 'rankings' ? 'gold' : 'ghost'} size="sm" className="text-xs h-7 px-3" onClick={() => setMode('rankings')}>
                  Rankings
                </Button>
              </div>
              <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
                <Button variant={view === 'season' ? 'gold' : 'ghost'} size="sm" className="text-xs h-7 px-3" onClick={() => setViewWithOverride('season')}>
                  Season
                </Button>
                <Button variant={view === 'alltime' ? 'gold' : 'ghost'} size="sm" className="text-xs h-7 px-3" onClick={() => setViewWithOverride('alltime')}>
                  All-Time
                </Button>
              </div>
            </div>

            {view === 'season' && availableSeasons.length > 0 && (
              <div className="mb-4">
                <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
                  <SelectTrigger className="h-8 text-xs bg-muted/20 border-muted/40">
                    <SelectValue placeholder="Select season" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSeasons.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        Season {s.season_number}
                        {s.status === 'watching' ? ' • Watching' : s.status === 'reviewing' ? ' • Reviewing' : s.status === 'completed' ? ' • Completed' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {loading ? (
              <div className="text-center text-muted-foreground py-8">Loading scores...</div>
            ) : mode === 'guesses' ? (
              scores.every(s => s.total === 0) ? (
                <div className="text-center text-muted-foreground py-10 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mx-auto">
                    <TrendingUp className="w-6 h-6 opacity-40" />
                  </div>
                  <p className="font-medium text-sm">No scores yet</p>
                  <p className="text-xs text-muted-foreground/70">Scores appear as movies are revealed</p>
                </div>
              ) : (
                <motion.div
                  className="space-y-2"
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
                >
                  {scores.map((entry, i) => {
                    const pct = entry.total > 0 ? Math.round((entry.correct / entry.total) * 100) : 0;
                    const hasScore = entry.correct > 0;
                    const barColor = pct >= 60 ? 'bg-green-500' : pct >= 35 ? 'bg-amber-500' : 'bg-red-500/70';

                    return renderScoreRow(
                      entry.user_id,
                      i,
                      /* name sub-row: accuracy bar */
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1 rounded-full bg-muted/30 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{entry.correct}/{entry.total}</span>
                      </div>,
                      /* right score */
                      <div className="text-right shrink-0">
                        <p className={`font-display font-bold ${i === 0 && hasScore ? 'text-xl text-gradient-gold' : 'text-lg text-primary'}`}>
                          {entry.correct}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{pct}%</p>
                      </div>,
                      hasScore
                    );
                  })}
                </motion.div>
              )
            ) : (
              rankingScores.length === 0 ? (
                <div className="text-center text-muted-foreground py-10 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mx-auto">
                    <Star className="w-6 h-6 opacity-40" />
                  </div>
                  <p className="font-medium text-sm">No rankings yet</p>
                  <p className="text-xs text-muted-foreground/70">Rankings appear after members submit reviews</p>
                </div>
              ) : (
                <motion.div
                  className="space-y-2"
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
                >
                  {rankingScores.map((entry, i) => {
                    const showInlinePick = view === 'season' && entry.picks.length <= 1;
                    const inlinePick = showInlinePick ? entry.picks[0] : undefined;

                    return renderScoreRow(
                      entry.user_id,
                      i,
                      /* name sub-row: pick or count */
                      showInlinePick ? (
                        inlinePick ? (
                          inlinePick.revealed ? (
                            <div className="flex items-center gap-1.5 mt-1">
                              {inlinePick.poster_url ? (
                                <img src={inlinePick.poster_url} alt={inlinePick.title} className="w-4 h-6 rounded object-cover shrink-0" />
                              ) : (
                                <div className="w-4 h-6 rounded bg-muted flex items-center justify-center shrink-0">
                                  <Film className="w-2 h-2 text-muted-foreground" />
                                </div>
                              )}
                              <span className="text-xs text-muted-foreground truncate">{inlinePick.title}</span>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic mt-0.5">Not yet revealed</p>
                          )
                        ) : (
                          <p className="text-xs text-muted-foreground italic mt-0.5">No pick yet</p>
                        )
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {entry.totalPicks} pick{entry.totalPicks !== 1 ? 's' : ''} ranked
                        </p>
                      ),
                      /* right score */
                      <div className="text-right shrink-0">
                        <p className={`font-display font-bold ${i === 0 ? 'text-xl text-gradient-gold' : 'text-lg text-primary'}`}>
                          {entry.avgRank.toFixed(1)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">avg rank</p>
                      </div>,
                      true
                    );
                  })}
                </motion.div>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Scoreboard;
