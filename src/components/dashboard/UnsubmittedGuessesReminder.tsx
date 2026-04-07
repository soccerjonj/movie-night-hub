import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { HelpCircle, Clock, Check, Film, ChevronDown, ChevronUp, X } from 'lucide-react';
import { differenceInDays, differenceInHours, differenceInMinutes, isPast } from 'date-fns';
import { toast } from 'sonner';

interface Props {
  season: Season | null;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onDismissed: () => void;
  onUpdate: () => void;
}

const TRUNCATE_LEN = 100;

const UnsubmittedGuessesReminder = ({ season, moviePicks, members, profiles, onDismissed, onUpdate }: Props) => {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<'reminder' | 'guessing'>('reminder');
  const [timeLeft, setTimeLeft] = useState('');
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [expandedOverviews, setExpandedOverviews] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user || !season) { onDismissed(); return; }
    if (season.status !== 'watching' || !season.guessing_enabled) { onDismissed(); return; }
    if (!season.next_call_date) { onDismissed(); return; }

    const deadline = new Date(season.next_call_date);
    if (isPast(deadline)) { onDismissed(); return; }

    const checkGuesses = async () => {
      const { data } = await supabase
        .rpc('get_season_guess_submitters', { _season_id: season.id });

      const submitters = new Set((data || []).map((r: { guesser_id: string }) => r.guesser_id));
      if (!submitters.has(user.id)) {
        setShow(true);
      } else {
        onDismissed();
      }
    };

    checkGuesses();
  }, [user, season]);

  // Update countdown every minute
  useEffect(() => {
    if (!show || !season?.next_call_date) return;

    const update = () => {
      const deadline = new Date(season.next_call_date!);
      const now = new Date();
      if (isPast(deadline)) {
        setTimeLeft('');
        setShow(false);
        onDismissed();
        return;
      }
      const days = differenceInDays(deadline, now);
      const hours = differenceInHours(deadline, now) % 24;
      const mins = differenceInMinutes(deadline, now) % 60;

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h remaining`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${mins}m remaining`);
      } else {
        setTimeLeft(`${mins}m remaining`);
      }
    };

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [show, season?.next_call_date]);

  const otherPicks = useMemo(() => moviePicks.filter(p => p.user_id !== user?.id), [moviePicks, user?.id]);

  const memberPickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    members.forEach(m => {
      if (m.user_id === user?.id) return;
      const pickCount = moviePicks.filter(p => p.user_id === m.user_id).length;
      counts[m.user_id] = pickCount;
    });
    return counts;
  }, [moviePicks, members, user?.id]);

  const guessCountPerMember = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(guesses).forEach(userId => {
      counts[userId] = (counts[userId] || 0) + 1;
    });
    return counts;
  }, [guesses]);

  const getAvailableMembers = (pickId: string) => {
    return members
      .filter(m => m.user_id !== user?.id)
      .filter(m => {
        const maxSlots = memberPickCounts[m.user_id] || 0;
        const usedSlots = guessCountPerMember[m.user_id] || 0;
        if (guesses[pickId] === m.user_id) return true;
        return usedSlots < maxSlots;
      });
  };

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const allGuessed = otherPicks.every(p => guesses[p.id]);

  const toggleOverview = (pickId: string) => {
    setExpandedOverviews(prev => ({ ...prev, [pickId]: !prev[pickId] }));
  };

  const handleClose = () => {
    setShow(false);
    setStep('reminder');
    onDismissed();
  };

  const submitGuesses = async () => {
    if (!user || !season) return;
    setSubmitting(true);
    try {
      const rows = Object.entries(guesses).map(([movie_pick_id, guessed_user_id]) => ({
        season_id: season.id,
        guesser_id: user.id,
        movie_pick_id,
        guessed_user_id,
      }));
      const { error } = await supabase.from('guesses').insert(rows);
      if (error) throw error;

      // Record a guess_edit so they can't edit later
      await supabase.from('guess_edits').insert({
        season_id: season.id,
        user_id: user.id,
      });

      toast.success('Guesses submitted!');
      setShow(false);
      setStep('reminder');
      onUpdate();
      onDismissed();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit guesses');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={show} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className={`${step === 'guessing' ? 'sm:max-w-md max-h-[85vh]' : 'max-w-sm'} flex flex-col overflow-hidden`}>
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="w-5 h-5 text-primary" />
            {step === 'reminder' ? 'Submit Your Guesses' : 'Guess Who Picked What'}
          </DialogTitle>
        </DialogHeader>

        {step === 'reminder' && (
          <>
            <p className="text-sm text-muted-foreground">
              The watching phase has started but you haven't submitted your guesses yet! Guess who picked each movie before picks are revealed.
            </p>
            {timeLeft && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm">
                <Clock className="w-4 h-4 text-destructive shrink-0" />
                <span className="text-destructive font-medium">{timeLeft}</span>
                <span className="text-destructive/70 text-xs">before picks are revealed</span>
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <Button variant="outline" className="flex-1" onClick={handleClose}>
                Later
              </Button>
              <Button variant="gold" className="flex-1" onClick={() => setStep('guessing')}>
                Guess Now
              </Button>
            </div>
          </>
        )}

        {step === 'guessing' && (
          <>
            {timeLeft && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs shrink-0">
                <Clock className="w-3.5 h-3.5 text-destructive shrink-0" />
                <span className="text-destructive font-medium">{timeLeft}</span>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-3 pr-1">
              {otherPicks.map((pick) => {
                const isLong = (pick.overview?.length || 0) > TRUNCATE_LEN;
                const expanded = expandedOverviews[pick.id];
                return (
                  <div key={pick.id} className="bg-muted/20 rounded-xl p-3 space-y-2">
                    <div className="flex items-start gap-3">
                      {pick.poster_url ? (
                        <img src={pick.poster_url} alt={pick.title} className="w-10 h-[60px] rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-[60px] rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <Film className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-tight">{pick.title}</p>
                        {pick.year && <p className="text-[11px] text-muted-foreground">{pick.year}</p>}
                        {pick.overview && (
                          <div
                            className={`mt-1 ${isLong ? 'cursor-pointer' : ''}`}
                            onClick={() => isLong && toggleOverview(pick.id)}
                          >
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              {expanded || !isLong ? pick.overview : pick.overview.slice(0, TRUNCATE_LEN).trimEnd() + '…'}
                            </p>
                            {isLong && (
                              <span className="text-[11px] text-primary hover:underline mt-0.5 inline-flex items-center gap-0.5">
                                {expanded ? 'Show less' : 'Read more'}
                                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={guesses[pick.id] || ''}
                        onValueChange={(val) => setGuesses(prev => ({ ...prev, [pick.id]: val }))}
                      >
                        <SelectTrigger className="w-full bg-muted/50 h-9 text-sm">
                          <SelectValue placeholder="Who picked this?" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableMembers(pick.id).map((member) => (
                            <SelectItem key={member.user_id} value={member.user_id}>
                              {getProfile(member.user_id)?.display_name || 'Unknown'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {guesses[pick.id] && (
                        <button
                          onClick={() => setGuesses(prev => {
                            const next = { ...prev };
                            delete next[pick.id];
                            return next;
                          })}
                          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-muted/50 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Clear guess"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="shrink-0 pt-3 border-t border-border">
              <Button
                variant="gold"
                className="w-full"
                onClick={submitGuesses}
                disabled={!allGuessed || submitting}
              >
                <Check className="w-4 h-4 mr-2" />
                {submitting ? 'Submitting...' : 'Submit Guesses'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default UnsubmittedGuessesReminder;
