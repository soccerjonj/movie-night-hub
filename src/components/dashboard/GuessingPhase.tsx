import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, HelpCircle, Film } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onUpdate: () => void;
}

interface Guess {
  movie_pick_id: string;
  guessed_user_id: string;
}

const GuessingPhase = ({ season, moviePicks, members, profiles, onUpdate }: Props) => {
  const { user } = useAuth();
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [existingGuesses, setExistingGuesses] = useState<Guess[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const fetchGuesses = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('guesses')
        .select('movie_pick_id, guessed_user_id')
        .eq('season_id', season.id)
        .eq('guesser_id', user.id);
      if (data && data.length > 0) {
        setExistingGuesses(data);
        setSubmitted(true);
        const map: Record<string, string> = {};
        data.forEach(g => { map[g.movie_pick_id] = g.guessed_user_id; });
        setGuesses(map);
      }
    };
    fetchGuesses();
  }, [season.id, user]);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const submitGuesses = async () => {
    if (!user) return;
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
      toast.success('Guesses submitted!');
      setSubmitted(true);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit guesses');
    } finally {
      setSubmitting(false);
    }
  };

  const allGuessed = moviePicks.filter(p => p.user_id !== user?.id).every(p => guesses[p.id]);

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center gap-2 mb-1">
        <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
        <h2 className="font-display text-lg sm:text-xl font-bold">Guess Who Picked What</h2>
      </div>
      <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
        {submitted ? "You've submitted your guesses!" : 'For each movie, guess which member picked it.'}
      </p>

      <div className="space-y-4">
        {moviePicks
          .filter(pick => pick.user_id !== user?.id)
          .map((pick) => (
            <div key={pick.id} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 bg-muted/20 rounded-xl p-3">
              {pick.poster_url ? (
                <img src={pick.poster_url} alt={pick.title} className="w-12 h-18 rounded-lg object-cover" />
              ) : (
                <div className="w-12 h-18 rounded-lg bg-muted flex items-center justify-center">
                  <Film className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{pick.title}</p>
                {pick.year && <p className="text-xs text-muted-foreground">{pick.year}</p>}
              </div>
              <Select
                value={guesses[pick.id] || ''}
                onValueChange={(val) => setGuesses(prev => ({ ...prev, [pick.id]: val }))}
                disabled={submitted}
              >
                <SelectTrigger className="w-full sm:w-40 bg-muted/50">
                  <SelectValue placeholder="Who picked?" />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter(m => m.user_id !== user?.id)
                    .map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {getProfile(member.user_id)?.display_name || 'Unknown'}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ))}
      </div>

      {!submitted && (
        <Button
          variant="gold"
          className="mt-6 w-full"
          onClick={submitGuesses}
          disabled={!allGuessed || submitting}
        >
          <Check className="w-4 h-4 mr-2" />
          {submitting ? 'Submitting...' : 'Submit Guesses'}
        </Button>
      )}
    </div>
  );
};

export default GuessingPhase;
