import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Film, Check, X, Sparkles } from 'lucide-react';
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
  const [guesses, setGuesses] = useState<GuessRow[]>([]);

  useEffect(() => {
    if (!season || season.status !== 'watching' || !user) return;

    const lastSeen = getLastSeenIndex(season.id);
    const currentIdx = season.current_movie_index;

    // If we've never seen this season, just record the current index
    if (lastSeen === -1) {
      setLastSeenIndex(season.id, currentIdx);
      return;
    }

    // If the index advanced, show the reveal for the last watched movie
    if (currentIdx > lastSeen && lastSeen >= 0) {
      const sortedPicks = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));
      // The movie that was just watched is at the previous index (currentIdx - 1)
      const justWatched = sortedPicks[currentIdx - 1];
      if (justWatched) {
        setRevealedPick(justWatched);
        // Fetch guesses for this movie
        supabase
          .from('guesses')
          .select('guesser_id, guessed_user_id, movie_pick_id')
          .eq('season_id', season.id)
          .eq('movie_pick_id', justWatched.id)
          .then(({ data }) => {
            if (data) setGuesses(data);
            setOpen(true);
          });
      }
      setLastSeenIndex(season.id, currentIdx);
    }
  }, [season, moviePicks, user]);

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setOpen(false);
    }
  };

  if (!revealedPick) return null;

  const pickerProfile = getProfile(revealedPick.user_id);
  const userGuess = guesses.find(g => g.guesser_id === user?.id);
  const otherGuesses = guesses.filter(g => g.guesser_id !== user?.id);
  const userIsCorrect = userGuess?.guessed_user_id === revealedPick.user_id;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-primary" />
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
                  Picked by {pickerProfile?.display_name || 'Unknown'}
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
                <span className="text-sm font-medium">{getProfile(userGuess.guessed_user_id)?.display_name || 'Unknown'}</span>
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
                  const isCorrect = g.guessed_user_id === revealedPick.user_id;
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
                          {getProfile(g.guessed_user_id)?.display_name || 'Unknown'}
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
