import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, Profile, GroupMember } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Film, BookOpen, GripVertical, Check, Trophy, Star } from 'lucide-react';
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
      toast.success('Rankings submitted! 🎬');
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
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
        <h2 className="font-display text-lg sm:text-xl font-bold">Season Review</h2>
      </div>
      <p className="text-xs sm:text-sm text-muted-foreground mb-4">
        {submitted
          ? `You've submitted your rankings! ${everyoneSubmitted ? 'Results are in!' : `Waiting for others (${submittedCount}/${members.length}).`}`
          : `Drag to rank ${labels.items} from your favorite (#1) to least favorite.`}
      </p>

      {/* Ranking UI */}
      {!everyoneSubmitted && (
        <div ref={listRef} className="space-y-1.5">
          {rankings.map((movieId, index) => {
            const movie = getMovieById(movieId);
            if (!movie) return null;
            const isDragging = dragItem === index;
            const isDragOver = dragOverItem === index;

            return (
              <motion.div
                key={movieId}
                layout
                className={`flex items-center gap-2 sm:gap-3 rounded-xl p-2 sm:p-3 transition-colors ${
                  isDragging ? 'opacity-50 bg-primary/10' :
                  isDragOver ? 'bg-primary/5 ring-1 ring-primary/30' :
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
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      onClick={() => moveItem(index, index - 1)}
                      className="text-muted-foreground hover:text-foreground text-xs p-0.5"
                      disabled={index === 0}
                    >▲</button>
                    <button
                      onClick={() => moveItem(index, index + 1)}
                      className="text-muted-foreground hover:text-foreground text-xs p-0.5"
                      disabled={index === rankings.length - 1}
                    >▼</button>
                  </div>
                )}

                <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 ${
                  index === 0 ? 'bg-primary text-primary-foreground' :
                  index === 1 ? 'bg-primary/60 text-primary-foreground' :
                  index === 2 ? 'bg-primary/30 text-foreground' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {index + 1}
                </div>

                {!submitted && (
                  <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                )}

                {movie.poster_url ? (
                  <img src={movie.poster_url} alt={movie.title} className="w-8 sm:w-10 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-8 sm:w-10 h-11 sm:h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <ItemIcon className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{movie.title}</p>
                  {movie.year && <span className="text-xs text-muted-foreground">{movie.year}</span>}
                </div>

                {index === 0 && <Star className="w-4 h-4 text-primary fill-primary shrink-0" />}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Submit button */}
      {!submitted && (
        <Button
          variant="gold"
          className="mt-4 w-full"
          onClick={submitRankings}
          disabled={submitting || rankings.length === 0}
        >
          <Check className="w-4 h-4 mr-2" />
          {submitting ? 'Submitting...' : 'Submit Rankings'}
        </Button>
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
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  index === 0 ? 'bg-primary text-primary-foreground' :
                  index === 1 ? 'bg-primary/60 text-primary-foreground' :
                  index === 2 ? 'bg-primary/30 text-foreground' :
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
                  <p className="text-xs text-muted-foreground">
                    Avg rank: {score.avg.toFixed(1)}
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
