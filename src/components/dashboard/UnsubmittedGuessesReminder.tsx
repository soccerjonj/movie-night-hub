import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Season } from '@/hooks/useGroup';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { HelpCircle, Clock } from 'lucide-react';
import { differenceInDays, differenceInHours, differenceInMinutes, isPast } from 'date-fns';

interface Props {
  season: Season | null;
  onDismissed: () => void;
}

const UnsubmittedGuessesReminder = ({ season, onDismissed }: Props) => {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!user || !season) return;
    if (season.status !== 'watching' || !season.guessing_enabled) return;
    if (!season.next_call_date) return;

    const deadline = new Date(season.next_call_date);
    if (isPast(deadline)) return;

    const checkGuesses = async () => {
      const { data } = await supabase
        .rpc('get_season_guess_submitters', { _season_id: season.id });

      const submitters = new Set((data || []).map((r: { guesser_id: string }) => r.guesser_id));
      if (!submitters.has(user.id)) {
        setShow(true);
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

  const handleClose = () => {
    setShow(false);
    onDismissed();
  };

  return (
    <Dialog open={show} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="w-5 h-5 text-primary" />
            Submit Your Guesses
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The watching phase has started but you haven't submitted your guesses yet! Head to the scoreboard to see who you think picked each movie.
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
          <Button variant="gold" className="flex-1" onClick={handleClose}>
            Got It
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UnsubmittedGuessesReminder;
