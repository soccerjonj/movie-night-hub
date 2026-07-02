import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, Profile, GroupMember } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Film, BookOpen, GripVertical, Check, Trophy, Star, ChevronRight, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useTouchDragReorder } from '@/hooks/useTouchDragReorder';
import { ClubType, getClubLabels } from '@/lib/clubTypes';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  profiles: Profile[];
  members: GroupMember[];
  onUpdate: () => void;
  clubType: ClubType;
}

interface RankingEntry {
  movie_pick_id: string;
  rank: number;
}

const ReviewPhase = ({ season, moviePicks, profiles, members, onUpdate, clubType }: Props) => {
  const labels = getClubLabels(clubType);
  const ItemIcon = clubType === 'book' ? BookOpen : Film;
  const { user } = useAuth();
  const [rankings, setRankings] = useState<string[]>([]); // ordered movie pick IDs (index 0 = rank 1 = favorite)
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [allRankings, setAllRankings] = useState<Record<string, RankingEntry[]>>({});
  const [submittedCount, setSubmittedCount] = useState(0);
  const [dragItem, setDragItem] = useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useTouchDragReorder(rankings, setRankings, listRef);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  // Deduplicate movies by watch_order (co-picks share same watch_order)
  const uniqueMovies = moviePicks.filter((p, i, arr) =>
    arr.findIndex(x => x.watch_order === p.watch_order) === i
  ).sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));

  // Initialize rankings order
  useEffect(() => {
    if (rankings.length === 0 && uniqueMovies.length > 0) {
      setRankings(uniqueMovies.map(m => m.id));
    }
  }, [uniqueMovies.length]);

  // Fetch existing rankings
  useEffect(() => {
    const fetchRankings = async () => {
      if (!user) return;

      // Fetch own rankings
      const { data: ownRankings } = await supabase
        .from('movie_rankings')
        .select('movie_pick_id, rank')
        .eq('season_id', season.id)
        .eq('user_id', user.id)
        .order('rank', { ascending: true });

      if (ownRankings && ownRankings.length > 0) {
        setSubmitted(true);
        setRankings(ownRankings.map(r => r.movie_pick_id));
      }

      // Fetch all rankings to see who has submitted
      const { data: allData } = await supabase
        .from('movie_rankings')
        .select('user_id, movie_pick_id, rank')
        .eq('season_id', season.id);

      if (allData) {
        const byUser: Record<string, RankingEntry[]> = {};
        allData.forEach(r => {
          if (!byUser[r.user_id]) byUser[r.user_id] = [];
          byUser[r.user_id].push({ movie_pick_id: r.movie_pick_id, rank: r.rank });
        });
        setAllRankings(byUser);
        setSubmittedCount(Object.keys(byUser).length);
      }
    };
    fetchRankings();
  }, [season.id, user]);

  const handleDragStart = (index: number) => {
    setDragItem(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverItem(index);
  };

  const handleDrop = (index: number) => {
    if (dragItem === null) return;
    const newRankings = [...rankings];
    const [removed] = newRankings.splice(dragItem, 1);
    newRankings.splice(index, 0, removed);
    setRankings(newRankings);
    setDragItem(null);
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setDragOverItem(null);
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= rankings.length) return;
    const newRankings = [...rankings];
    const [removed] = newRankings.splice(fromIndex, 1);
    newRankings.splice(toIndex, 0, removed);
    setRankings(newRankings);
  };

  const submitRankings = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      const rows = rankings.map((moviePickId, index) => ({
        season_id: season.id,
        user_id: user.id,
        movie_pick_id: moviePickId,
        rank: index + 1,
      }));

      const { error } = await supabase.from('movie_rankings').insert(rows);
      if (error) throw error;
      toast.success('Rankings submitted!');
      setSubmitted(true);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit rankings');
    } finally {
      setSubmitting(false);
    }
  };

  const getMovieById = (id: string) => uniqueMovies.find(m => m.id === id);

  // Check if everyone has submitted - show results
  const everyoneSubmitted = submittedCount >= members.length;

  // Calculate aggregate scores (lower is better since rank 1 = favorite)
  const getAggregateScores = () => {
    const scores: Record<string, { total: number; count: number; title: string }> = {};
    Object.values(allRankings).forEach(userRankings => {
      userRankings.forEach(r => {
        if (!scores[r.movie_pick_id]) {
          const movie = getMovieById(r.movie_pick_id);
          scores[r.movie_pick_id] = { total: 0, count: 0, title: movie?.title || '?' };
        }
        scores[r.movie_pick_id].total += r.rank;
        scores[r.movie_pick_id].count += 1;
      });
    });
    return Object.entries(scores)
      .map(([id, s]) => ({ id, ...s, avg: s.total / s.count }))
      .sort((a, b) => a.avg - b.avg);
  };

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      {/* Cinematic hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-card via-card to-muted/20 ring-1 ring-white/5 p-4 sm:p-5 mb-4">
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_80%_10%,hsl(38_90%_55%/0.14),transparent_55%)]" />
        <div className="relative z-10">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/30 px-2.5 py-1 mb-2.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              {clubType === 'book' ? 'Book Review' : 'Season Review'}
            </span>
          </span>
          <h2 className="font-display text-2xl sm:text-3xl font-bold leading-[1.05] text-gradient-gold">
            Rank the season
          </h2>
          {season.title && (
            <span className="inline-flex items-center gap-1.5 mt-2 rounded-full bg-muted/30 border border-border/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <Film className="w-3 h-3 text-primary" /> {season.title}
            </span>
          )}
          <p className="text-xs sm:text-sm text-foreground/70 leading-relaxed mt-2.5">
            {submitted
              ? `You've submitted your rankings! ${everyoneSubmitted ? 'Results are in!' : `Waiting for others (${submittedCount}/${members.length}).`}`
              : `Drag your ${labels.items} from favorite to least — your ranking sets the scoreboard.`}
          </p>
        </div>
      </div>

      {/* Submission status card */}
      {!everyoneSubmitted && (
        <div className="rounded-2xl bg-muted/15 border border-border/30 p-3 sm:p-4 mb-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-foreground">
              {submittedCount} <span className="text-muted-foreground font-medium">of {members.length} submitted</span>
            </span>
            <span className="text-[11px] font-medium text-primary/70 tabular-nums">
              {members.length > 0 ? Math.round((submittedCount / members.length) * 100) : 0}%
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden mb-3">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-amber-300 transition-all duration-500"
              style={{ width: `${members.length > 0 ? (submittedCount / members.length) * 100 : 0}%` }}
            />
          </div>
          {/* Avatar chips */}
          <div className="flex flex-wrap gap-1.5">
            {members.map(member => {
              const profile = getProfile(member.user_id);
              const hasSubmitted = !!allRankings[member.user_id];
              return (
                <div
                  key={member.user_id}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${
                    hasSubmitted
                      ? 'bg-amber-500/10 border-amber-400/30 text-amber-300'
                      : 'bg-muted/20 border-dashed border-border/50 text-muted-foreground/60'
                  }`}
                >
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className={`w-4 h-4 rounded-full object-cover ${hasSubmitted ? '' : 'opacity-50'}`} />
                  ) : (
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold ${
                      hasSubmitted ? 'bg-amber-500/20 text-amber-300' : 'bg-muted text-muted-foreground/60'
                    }`}>
                      {profile?.display_name?.charAt(0).toUpperCase() || '?'}
                    </div>
                  )}
                  <span className="truncate max-w-[80px]">{profile?.display_name || '?'}</span>
                  {hasSubmitted && <Check className="w-3 h-3 shrink-0 text-amber-300" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ranking UI */}
      {!everyoneSubmitted && (
        <div ref={listRef} className="space-y-1.5">
          {rankings.map((movieId, index) => {
            const movie = getMovieById(movieId);
            if (!movie) return null;
            const isDragging = dragItem === index;
            const isDragOver = dragOverItem === index;
            const isTop = index === 0;

            const medalChip =
              index === 0 ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40' :
              index === 1 ? 'bg-slate-300/15 text-slate-200 ring-1 ring-slate-300/30' :
              index === 2 ? 'bg-amber-700/25 text-amber-500 ring-1 ring-amber-700/40' :
              'bg-muted/40 text-muted-foreground';

            return (
              <motion.div
                key={movieId}
                layout
                className={`flex items-center gap-2 sm:gap-3 rounded-xl p-2 sm:p-3 transition-colors ${
                  isDragging ? 'opacity-50 bg-primary/10' :
                  isDragOver ? 'bg-primary/5 ring-1 ring-primary/30' :
                  isTop ? 'bg-amber-500/[0.06] ring-1 ring-amber-400/25' :
                  'bg-muted/20 hover:bg-muted/30'
                } ${submitted ? 'pointer-events-none opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
                draggable={!submitted}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                onTouchStart={(e) => !submitted && handleTouchStart(index, e)}
                onTouchMove={(e) => !submitted && handleTouchMove(e)}
                onTouchEnd={() => !submitted && handleTouchEnd()}
              >
                {!submitted && (
                  <GripVertical className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                )}

                <div className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 ${medalChip}`}>
                  {index + 1}
                </div>

                {movie.poster_url ? (
                  <img src={movie.poster_url} alt={movie.title} className="w-8 sm:w-10 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-8 sm:w-10 h-11 sm:h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <ItemIcon className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{movie.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {movie.year && `${movie.year} · `}Picked by {
                      moviePicks
                        .filter(p => p.watch_order === movie.watch_order)
                        .map(p => getProfile(p.user_id)?.display_name || '?')
                        .join(' & ')
                    }
                  </p>
                </div>

                {isTop ? (
                  <Star className="w-4 h-4 text-amber-300 fill-amber-300 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Helper line */}
      {!submitted && !everyoneSubmitted && (
        <p className="text-[11px] text-muted-foreground/70 mt-3 text-center">
          Only you see your order until everyone submits.
        </p>
      )}

      {/* Submit button */}
      {!submitted && (
        <Button
          variant="gold"
          className="mt-3 w-full bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 font-semibold hover:from-amber-300 hover:to-yellow-400 shadow-[0_4px_16px_-4px_rgba(245,158,11,0.5)]"
          onClick={submitRankings}
          disabled={submitting || rankings.length === 0}
        >
          <Check className="w-4 h-4 mr-2" />
          {submitting ? 'Submitting...' : 'Submit Rankings'}
        </Button>
      )}

      {/* Locked-results teaser while waiting on others */}
      {submitted && !everyoneSubmitted && (
        <div className="mt-4 rounded-2xl bg-muted/15 border border-dashed border-border/40 p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-muted/30 flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Results reveal when all {members.length} are in</p>
            <p className="text-[11px] text-muted-foreground">Waiting for others ({submittedCount}/{members.length}).</p>
          </div>
        </div>
      )}

      {/* Results when everyone has submitted */}
      {everyoneSubmitted && (
        <div className="space-y-3 mt-4">
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            Group Rankings
          </h3>
          {getAggregateScores().map((score, index) => {
            const movie = getMovieById(score.id);
            return (
              <div key={score.id} className={`flex items-center gap-3 rounded-xl p-3 ${
                index === 0 ? 'bg-primary/10 ring-1 ring-primary/30' : 'bg-muted/20'
              }`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  index === 0 ? 'bg-gradient-to-br from-amber-300 to-yellow-500 text-amber-950 shadow-[0_0_10px_-2px_rgba(251,191,36,0.5)]' :
                  index === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-800' :
                  index === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-700 text-amber-100' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {index + 1}
                </div>

                {movie?.poster_url ? (
                  <img src={movie.poster_url} alt={movie?.title} className="w-10 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <ItemIcon className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{score.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    Avg rank: {score.avg.toFixed(1)} · Picked by {
                      moviePicks
                        .filter(p => p.id === score.id || (movie && p.watch_order === movie.watch_order))
                        .filter((p, i, arr) => arr.findIndex(x => x.user_id === p.user_id) === i)
                        .map(p => getProfile(p.user_id)?.display_name || '?')
                        .join(' & ')
                    }
                  </p>
                </div>

                {index === 0 && <Trophy className="w-5 h-5 text-primary shrink-0" />}
              </div>
            );
          })}

          {/* Individual rankings breakdown */}
          <div className="pt-3 border-t border-border/40">
            <p className="text-sm text-muted-foreground mb-2">Individual Rankings</p>
            <div className="space-y-2">
              {members.map(member => {
                const memberRankings = allRankings[member.user_id];
                if (!memberRankings) return null;
                const sorted = [...memberRankings].sort((a, b) => a.rank - b.rank);
                return (
                  <div key={member.user_id} className="bg-muted/10 rounded-lg p-2.5">
                    <p className="text-xs font-medium mb-1">{getProfile(member.user_id)?.display_name || '?'}</p>
                    <div className="flex flex-wrap gap-1">
                      {sorted.map(r => {
                        const movie = getMovieById(r.movie_pick_id);
                        return (
                          <span key={r.movie_pick_id} className="text-[10px] bg-muted/30 rounded px-1.5 py-0.5">
                            {r.rank}. {movie?.title || '?'}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewPhase;
