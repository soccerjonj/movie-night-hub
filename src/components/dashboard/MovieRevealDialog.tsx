import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { unitAtSlot } from '@/lib/pickUnits';
import { Film, Check, X } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  profiles: Profile[];
  getProfile: (userId: string) => Profile | undefined;
}

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
}

const STORAGE_KEY = 'movie-club-last-seen-index';

function getLastSeenIndex(seasonId: string): number {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return stored[seasonId] ?? -1;
  } catch { return -1; }
}

function setLastSeenIndex(seasonId: string, index: number) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    stored[seasonId] = index;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch { /* */ }
}

const MovieRevealDialog = ({ season, moviePicks, profiles, getProfile }: Props) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [revealedPick, setRevealedPick] = useState<MoviePick | null>(null);
  // every row in the revealed slot (several for a shared pick)
  const [slotRows, setSlotRows] = useState<MoviePick[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const shownForIndex = useRef<string | null>(null);

  useEffect(() => {
    if (!season || season.status !== 'watching' || !user) return;

    const lastSeen = getLastSeenIndex(season.id);
    const currentIdx = season.current_movie_index;

    // Build a unique key so we only trigger once per index change per session
    const revealKey = `${season.id}:${currentIdx}`;
    if (shownForIndex.current === revealKey) return;

    // Show reveal if: first visit and there's a movie to reveal, OR index advanced since last visit
    const shouldReveal = (lastSeen === -1 && currentIdx > 0) || (lastSeen >= 0 && currentIdx > lastSeen);
    if (shouldReveal) {
      shownForIndex.current = revealKey;
      setLastSeenIndex(season.id, currentIdx);

      const rows = unitAtSlot(moviePicks, currentIdx - 1);
      const justWatched = rows[0];
      if (justWatched) {
        setRevealedPick(justWatched);
        setSlotRows(rows);
        supabase
          .from('guesses')
          .select('guesser_id, guessed_user_id, movie_pick_id')
          .eq('season_id', season.id)
          .in('movie_pick_id', rows.map(r => r.id))
          .then(({ data }) => {
            if (data) setGuesses(data);
            setOpen(true);
          });
      }
    }
  }, [season, moviePicks, user]);

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setOpen(false);
    }
  };

  if (!revealedPick) return null;

  const pickerProfile = getProfile(revealedPick.user_id);
  const pickerNames = slotRows.map(r => getProfile(r.user_id)?.display_name || 'Unknown').join(' & ');
  const pickerOf = (pickId: string) => slotRows.find(r => r.id === pickId)?.user_id;
  // A guesser may have one guess per row of a shared pick — fold them into one line.
  const byGuesser = new Map<string, GuessRow[]>();
  guesses.forEach(g => { byGuesser.set(g.guesser_id, [...(byGuesser.get(g.guesser_id) || []), g]); });
  const summarize = (gs: GuessRow[]) => ({
    names: gs.map(g => getProfile(g.guessed_user_id)?.display_name || 'Unknown').join(' & '),
    correct: gs.length === slotRows.length && gs.every(g => g.guessed_user_id === pickerOf(g.movie_pick_id)),
  });
  const mine = user ? byGuesser.get(user.id) : undefined;
  const userGuess = mine ? summarize(mine) : null;
  const userIsCorrect = userGuess?.correct ?? false;
  const otherGuesses = [...byGuesser.entries()].filter(([id]) => id !== user?.id).map(([guesser_id, gs]) => ({ guesser_id, ...summarize(gs) }));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Movie Reveal
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Movie info */}
          <div className="flex items-center gap-3">
            {revealedPick.poster_url ? (
              <img src={revealedPick.poster_url} alt={revealedPick.title} className="w-14 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-14 h-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Film className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{revealedPick.title}</p>
              {revealedPick.year && <p className="text-xs text-muted-foreground">{revealedPick.year}</p>}
              <div className="flex items-center gap-1.5 mt-1.5">
                {pickerProfile?.avatar_url ? (
                  <img src={pickerProfile.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-primary">{pickerProfile?.display_name?.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <span className="text-xs text-primary font-medium">
                  Picked by {pickerNames || pickerProfile?.display_name || 'Unknown'}
                </span>
              </div>
            </div>
          </div>

          {/* Your guess */}
          {userGuess && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`rounded-xl p-3 ${userIsCorrect ? 'bg-green-500/10 ring-1 ring-green-500/20' : 'bg-destructive/5 ring-1 ring-destructive/10'}`}
            >
              <p className="text-xs text-muted-foreground mb-1">Your guess</p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{userGuess.names}</span>
                <div className={`flex items-center gap-1 text-xs font-medium ${userIsCorrect ? 'text-green-400' : 'text-destructive'}`}>
                  {userIsCorrect ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                  {userIsCorrect ? 'Correct!' : 'Wrong'}
                </div>
              </div>
            </motion.div>
          )}

          {/* Everyone else's guesses */}
          {otherGuesses.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Everyone's guesses</p>
              <div className="space-y-1">
                {otherGuesses.map((g, i) => {
                  const isCorrect = g.correct;
                  return (
                    <motion.div
                      key={g.guesser_id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.05 }}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
                        isCorrect ? 'bg-green-500/10' : 'bg-muted/20'
                      }`}
                    >
                      <span className="font-medium">{getProfile(g.guesser_id)?.display_name || 'Unknown'}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">guessed</span>
                        <span className={`font-medium ${isCorrect ? 'text-green-400' : 'text-foreground'}`}>
                          {g.names}
                        </span>
                        {isCorrect && <Check className="w-3 h-3 text-green-400" />}
                        {!isCorrect && <X className="w-3 h-3 text-destructive/50" />}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {guesses.length === 0 && (
            <p className="text-xs text-muted-foreground italic text-center py-2">No guesses were recorded for this movie</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MovieRevealDialog;
