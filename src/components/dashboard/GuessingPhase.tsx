import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, HelpCircle, Film, ChevronDown, ChevronUp, CheckCircle2, Clock, Pencil, PartyPopper, X } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

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
  const [editing, setEditing] = useState(false);
  const [hasUsedEdit, setHasUsedEdit] = useState(false);
  const [showEditConfirm, setShowEditConfirm] = useState(false);

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

  // Load guesses from DB or localStorage, submission status, and edit status
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
      const { data } = await supabase
        .from('guesses')
        .select('guesser_id')
        .eq('season_id', season.id);
      if (data) {
        const ids = new Set(data.map(g => g.guesser_id));
        setSubmittedMembers(ids);
      }
    };

    const loadEditStatus = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('guess_edits')
        .select('id')
        .eq('season_id', season.id)
        .eq('user_id', user.id);
      if (data && data.length > 0) {
        setHasUsedEdit(true);
      }
    };

    loadGuesses();
    loadSubmissionStatus();
    loadEditStatus();
  }, [season.id, user, storageKey]);

  useEffect(() => {
    if (!submitted && !editing && user) {
      localStorage.setItem(storageKey, JSON.stringify(guesses));
    }
  }, [guesses, submitted, editing, storageKey, user]);

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

  const handleEditClick = () => {
    setShowEditConfirm(true);
  };

  const confirmEdit = async () => {
    if (!user) return;
    setShowEditConfirm(false);
    // Record the edit usage
    await supabase.from('guess_edits').insert({
      season_id: season.id,
      user_id: user.id,
    });
    setHasUsedEdit(true);
    // Delete existing guesses so user can re-submit
    await supabase
      .from('guesses')
      .delete()
      .eq('season_id', season.id)
      .eq('guesser_id', user.id);
    setSubmitted(false);
    setEditing(true);
    setSubmittedMembers(prev => {
      const next = new Set(prev);
      next.delete(user.id);
      return next;
    });
    toast.info('You can now edit your guesses. This is your only edit!');
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
      setEditing(false);
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
  const guessingMembers = members.filter(m => !profiles.find(p => p.user_id === m.user_id)?.is_placeholder);

  const showForm = !submitted || editing;

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center gap-2 mb-1">
        <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
        <h2 className="font-display text-lg sm:text-xl font-bold">Guess Who Picked What</h2>
      </div>
      <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
        {submitted && !editing ? "You've submitted your guesses!" : 'For each movie, guess which member picked it.'}
      </p>

      {/* Submission status */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {guessingMembers.map((member) => {
          const profile = getProfile(member.user_id);
          const hasSubmitted = submittedMembers.has(member.user_id);
          return (
            <div
              key={member.user_id}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                hasSubmitted
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-muted/30 border-border text-muted-foreground'
              }`}
            >
              <Avatar className="w-3.5 h-3.5">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback className="text-[7px]">
                  {(profile?.display_name || '?')[0]}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-[60px] truncate sm:max-w-none">{profile?.display_name || 'Unknown'}</span>
              {hasSubmitted ? (
                <CheckCircle2 className="w-3 h-3 text-primary flex-shrink-0" />
              ) : (
                <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Submitted state - collapsed */}
      {submitted && !editing && (
        <div className="text-center py-6 space-y-4">
          <div className="flex items-center justify-center gap-2 text-primary">
            <PartyPopper className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">All guesses submitted!</p>
            <p className="text-xs text-muted-foreground mt-1">
              You guessed for {otherPicks.length} {otherPicks.length === 1 ? 'movie' : 'movies'}. Results will be revealed later.
            </p>
          </div>
          {hasUsedEdit ? (
            <Button variant="outline" size="sm" disabled className="opacity-50">
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Edit Used
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleEditClick}>
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Edit Guesses
            </Button>
          )}
        </div>
      )}

      {/* Movie list - shown when not submitted or editing */}
      {showForm && (
        <>
          <div className="space-y-3">
            {otherPicks.map((pick) => {
              const isLong = (pick.overview?.length || 0) > TRUNCATE_LEN;
              const expanded = expandedOverviews[pick.id];
              return (
                <div key={pick.id} className="bg-muted/20 rounded-xl p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    {pick.poster_url ? (
                      <img src={pick.poster_url} alt={pick.title} className="w-10 h-[60px] sm:w-12 sm:h-18 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-[60px] sm:w-12 sm:h-18 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <Film className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
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
                  <Select
                    value={guesses[pick.id] || ''}
                    onValueChange={(val) => setGuesses(prev => ({ ...prev, [pick.id]: val }))}
                  >
                    <SelectTrigger className="w-full sm:w-40 bg-muted/50 h-9 text-sm">
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
                </div>
              );
            })}
          </div>

          <Button
            variant="gold"
            className="mt-6 w-full"
            onClick={submitGuesses}
            disabled={!allGuessed || submitting}
          >
            <Check className="w-4 h-4 mr-2" />
            {submitting ? 'Submitting...' : editing ? 'Re-Submit Guesses' : 'Submit Guesses'}
          </Button>
        </>
      )}

      {/* Edit confirmation dialog */}
      <AlertDialog open={showEditConfirm} onOpenChange={setShowEditConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Your Guesses?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">This is your <strong className="text-foreground">only chance</strong> to edit your guesses. Once you use this edit, you won't be able to change them again.</span>
              <span className="block text-destructive font-medium">Are you sure you want to proceed?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmEdit} className="bg-primary text-primary-foreground hover:bg-primary/90">
              Yes, Edit Guesses
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GuessingPhase;
