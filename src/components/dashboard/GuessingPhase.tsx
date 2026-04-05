import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, HelpCircle, Film, ChevronDown, ChevronUp, CheckCircle2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface Props {
  season: Season;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onUpdate: () => void;
}

const STORAGE_KEY_PREFIX = 'guessing_draft_';
const TRUNCATE_LEN = 100;

const GuessingPhase = ({ season, moviePicks, members, profiles, onUpdate }: Props) => {
  const { user } = useAuth();
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [expandedOverviews, setExpandedOverviews] = useState<Record<string, boolean>>({});
  const [submittedMembers, setSubmittedMembers] = useState<Set<string>>(new Set());

  const storageKey = `${STORAGE_KEY_PREFIX}${season.id}_${user?.id}`;

  const memberPickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    members.forEach(m => {
      if (m.user_id === user?.id) return;
      const pickCount = moviePicks.filter(p => p.user_id === m.user_id).length;
      counts[m.user_id] = pickCount;
    });
    return counts;
  }, [moviePicks, members, user?.id]);

  // Load guesses from DB or localStorage, and fetch who has submitted
  useEffect(() => {
    const loadGuesses = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('guesses')
        .select('movie_pick_id, guessed_user_id')
        .eq('season_id', season.id)
        .eq('guesser_id', user.id);
      if (data && data.length > 0) {
        setSubmitted(true);
        const map: Record<string, string> = {};
        data.forEach(g => { map[g.movie_pick_id] = g.guessed_user_id; });
        setGuesses(map);
      } else {
        try {
          const draft = localStorage.getItem(storageKey);
          if (draft) setGuesses(JSON.parse(draft));
        } catch { /* ignore */ }
      }
    };

    const loadSubmissionStatus = async () => {
      // Get distinct guesser_ids who have submitted guesses for this season
      const { data } = await supabase
        .from('guesses')
        .select('guesser_id')
        .eq('season_id', season.id);
      if (data) {
        const ids = new Set(data.map(g => g.guesser_id));
        setSubmittedMembers(ids);
      }
    };

    loadGuesses();
    loadSubmissionStatus();
  }, [season.id, user, storageKey]);

  useEffect(() => {
    if (!submitted && user) {
      localStorage.setItem(storageKey, JSON.stringify(guesses));
    }
  }, [guesses, submitted, storageKey, user]);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

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

  const toggleOverview = (pickId: string) => {
    setExpandedOverviews(prev => ({ ...prev, [pickId]: !prev[pickId] }));
  };

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
      localStorage.removeItem(storageKey);
      setSubmittedMembers(prev => new Set(prev).add(user.id));
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit guesses');
    } finally {
      setSubmitting(false);
    }
  };

  const otherPicks = moviePicks.filter(p => p.user_id !== user?.id);
  const allGuessed = otherPicks.every(p => guesses[p.id]);

  // Members who need to guess (everyone except those whose picks are being guessed — i.e. all members)
  const guessingMembers = members.filter(m => !profiles.find(p => p.user_id === m.user_id)?.is_placeholder);

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center gap-2 mb-1">
        <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
        <h2 className="font-display text-lg sm:text-xl font-bold">Guess Who Picked What</h2>
      </div>
      <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
        {submitted ? "You've submitted your guesses!" : 'For each movie, guess which member picked it.'}
      </p>

      {/* Submission status */}
      <div className="flex flex-wrap gap-2 mb-4">
        {guessingMembers.map((member) => {
          const profile = getProfile(member.user_id);
          const hasSubmitted = submittedMembers.has(member.user_id);
          return (
            <div
              key={member.user_id}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                hasSubmitted
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-muted/30 border-border text-muted-foreground'
              }`}
            >
              <Avatar className="w-4 h-4">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback className="text-[8px]">
                  {(profile?.display_name || '?')[0]}
                </AvatarFallback>
              </Avatar>
              <span>{profile?.display_name || 'Unknown'}</span>
              {hasSubmitted ? (
                <CheckCircle2 className="w-3 h-3 text-primary" />
              ) : (
                <Clock className="w-3 h-3 text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-4">
        {otherPicks.map((pick) => {
          const isLong = (pick.overview?.length || 0) > TRUNCATE_LEN;
          const expanded = expandedOverviews[pick.id];
          return (
            <div key={pick.id} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 bg-muted/20 rounded-xl p-3">
              {pick.poster_url ? (
                <img src={pick.poster_url} alt={pick.title} className="w-12 h-18 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-18 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <Film className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{pick.title}</p>
                {pick.year && <p className="text-xs text-muted-foreground">{pick.year}</p>}
                {pick.overview && (
                  <div className="mt-1">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {expanded || !isLong ? pick.overview : pick.overview.slice(0, TRUNCATE_LEN).trimEnd() + '…'}
                    </p>
                    {isLong && (
                      <button
                        onClick={() => toggleOverview(pick.id)}
                        className="text-xs text-primary hover:underline mt-0.5 flex items-center gap-0.5"
                      >
                        {expanded ? 'Show less' : 'Read more'}
                        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <Select
                value={guesses[pick.id] || ''}
                onValueChange={(val) => setGuesses(prev => ({ ...prev, [pick.id]: val }))}
                disabled={submitted}
              >
                <SelectTrigger className="w-full sm:w-40 bg-muted/50 flex-shrink-0">
                  <SelectValue placeholder="Who picked?" />
                </SelectTrigger>
                <SelectContent>
                  {getAvailableMembers(pick.id).map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {getProfile(member.user_id)?.display_name || 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
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
