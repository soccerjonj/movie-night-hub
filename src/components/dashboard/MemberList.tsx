import { useState, useEffect } from 'react';
import { Group, GroupMember, Profile } from '@/hooks/useGroup';
import { Users, Crown, Ghost, Film, Check, X, Trophy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  members: GroupMember[];
  profiles: Profile[];
  group: Group;
  isAdmin: boolean;
  onUpdate: () => void;
}

interface SeasonInfo {
  id: string;
  season_number: number;
  title: string | null;
  status: string;
  current_movie_index: number;
}

interface PickRow {
  id: string;
  title: string;
  user_id: string;
  poster_url: string | null;
  year: string | null;
  watch_order: number | null;
  season_id: string;
  revealed: boolean;
}

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
  season_id: string;
}

const MemberList = ({ members, profiles, group, isAdmin, onUpdate }: Props) => {
  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch data when a member is selected
  useEffect(() => {
    if (!selectedUserId) return;
    const fetchData = async () => {
      setLoading(true);
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id, season_number, title, status, current_movie_index')
        .eq('group_id', group.id)
        .order('season_number', { ascending: false });
      const s = (seasonData || []) as SeasonInfo[];
      setSeasons(s);

      const seasonIds = s.map(ss => ss.id);
      if (seasonIds.length === 0) {
        setPicks([]);
        setGuesses([]);
        setLoading(false);
        return;
      }

      const [picksRes, guessesRes] = await Promise.all([
        supabase.from('movie_picks').select('id, title, user_id, poster_url, year, watch_order, season_id, revealed').in('season_id', seasonIds),
        supabase.from('guesses').select('guesser_id, guessed_user_id, movie_pick_id, season_id').in('season_id', seasonIds),
      ]);
      setPicks((picksRes.data || []) as PickRow[]);
      setGuesses((guessesRes.data || []) as GuessRow[]);
      setLoading(false);
    };
    fetchData();
  }, [selectedUserId, group.id]);

  const isPickWatched = (pick: PickRow) => {
    const s = seasons.find(ss => ss.id === pick.season_id);
    if (!s) return false;
    if (s.status === 'completed') return true;
    if (s.status === 'watching' && pick.watch_order != null) return pick.watch_order < s.current_movie_index;
    return false;
  };

  const isPickRevealed = (pick: PickRow) => {
    // Only reveal picks that have actually been watched — ignore the DB 'revealed' flag
    // to prevent leaking who picked an unwatched movie in member profiles
    return isPickWatched(pick);
  };

  const renderMemberProfile = () => {
    if (!selectedUserId) return null;
    const profile = getProfile(selectedUserId);

    // Movies this member picked
    const memberPicks = picks
      .filter(p => p.user_id === selectedUserId)
      .sort((a, b) => {
        const sA = seasons.find(s => s.id === a.season_id)?.season_number ?? 0;
        const sB = seasons.find(s => s.id === b.season_id)?.season_number ?? 0;
        if (sA !== sB) return sB - sA;
        return (b.watch_order ?? 0) - (a.watch_order ?? 0);
      });

    // Guessing stats
    const userGuesses = guesses.filter(g => g.guesser_id === selectedUserId);
    let correct = 0;
    let total = 0;

    // Build co-pick valid users map
    const coPickGroups = new Map<string, string[]>();
    picks.forEach(p => {
      if (isPickWatched(p) && p.watch_order != null) {
        const key = `${p.season_id}:${p.watch_order}`;
        if (!coPickGroups.has(key)) coPickGroups.set(key, []);
        coPickGroups.get(key)!.push(p.user_id);
      }
    });
    const pickValidUsers: Record<string, Set<string>> = {};
    picks.forEach(p => {
      if (isPickWatched(p) && p.watch_order != null) {
        const key = `${p.season_id}:${p.watch_order}`;
        pickValidUsers[p.id] = new Set(coPickGroups.get(key) || [p.user_id]);
      }
    });

    userGuesses.forEach(g => {
      if (pickValidUsers[g.movie_pick_id]) {
        total += 1;
        if (pickValidUsers[g.movie_pick_id].has(g.guessed_user_id)) {
          correct += 1;
        }
      }
    });

    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Guess breakdown: most recent first
    const watchedPicks = picks.filter(p => isPickWatched(p)).sort((a, b) => {
      const sA = seasons.find(s => s.id === a.season_id)?.season_number ?? 0;
      const sB = seasons.find(s => s.id === b.season_id)?.season_number ?? 0;
      if (sA !== sB) return sB - sA;
      return (b.watch_order ?? 0) - (a.watch_order ?? 0);
    });

    const seen = new Set<string>();
    const uniqueWatched = watchedPicks.filter(p => {
      const key = `${p.season_id}:${p.watch_order}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
            {profile?.display_name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div>
            <h3 className="font-display text-lg font-bold">{profile?.display_name || 'Unknown'}</h3>
            {selectedUserId === group.admin_user_id && (
              <span className="flex items-center gap-1 text-xs text-primary">
                <Crown className="w-3 h-3" /> Admin
              </span>
            )}
          </div>
        </div>

        {/* Score summary */}
        <div className="flex gap-3">
          <div className="flex-1 bg-muted/20 rounded-xl p-3 text-center">
            <p className="font-display text-2xl font-bold text-primary">{correct}</p>
            <p className="text-xs text-muted-foreground">Correct</p>
          </div>
          <div className="flex-1 bg-muted/20 rounded-xl p-3 text-center">
            <p className="font-display text-2xl font-bold text-foreground">{total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="flex-1 bg-muted/20 rounded-xl p-3 text-center">
            <p className="font-display text-2xl font-bold text-foreground">{pct}%</p>
            <p className="text-xs text-muted-foreground">Accuracy</p>
          </div>
        </div>

        {/* Their picks */}
        <div>
          <h4 className="font-display text-sm font-bold mb-2 flex items-center gap-1.5">
            <Film className="w-4 h-4 text-primary" />
            Their Picks
          </h4>
          {memberPicks.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No picks yet</p>
          ) : (
            <div className="grid grid-cols-5 gap-1.5">
              {memberPicks.map(pick => {
                const revealed = isPickRevealed(pick);
                return (
                  <div key={pick.id} className="aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                    {revealed ? (
                      pick.poster_url ? (
                        <img src={pick.poster_url} alt={pick.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center p-1">
                          <span className="text-[9px] text-muted-foreground text-center leading-tight line-clamp-3">{pick.title}</span>
                        </div>
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted/60">
                        <span className="text-lg text-muted-foreground font-bold">?</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Guess breakdown */}
        <div>
          <h4 className="font-display text-sm font-bold mb-2 flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-primary" />
            Guess History
          </h4>
          {uniqueWatched.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No watched movies yet</p>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {uniqueWatched.map(pick => {
                const siblingPicks = picks.filter(p => p.season_id === pick.season_id && p.watch_order === pick.watch_order);
                const validUserIds = new Set(siblingPicks.map(sp => sp.user_id));
                const isOwnPick = validUserIds.has(selectedUserId);
                const guess = userGuesses.find(g => g.movie_pick_id === pick.id) ||
                  userGuesses.find(g => siblingPicks.some(sp => sp.id === g.movie_pick_id));
                const guessedName = guess ? getProfile(guess.guessed_user_id)?.display_name || '?' : null;
                const isCorrect = guess ? validUserIds.has(guess.guessed_user_id) : false;

                return (
                  <div
                    key={pick.id}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] ${
                      guess ? (isCorrect ? 'bg-green-500/10' : 'bg-destructive/5') : 'bg-muted/20'
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
                    {guess ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`font-medium ${isCorrect ? 'text-green-400' : 'text-destructive'}`}>
                          {guessedName}
                        </span>
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
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Users className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
          <h2 className="font-display text-base sm:text-lg font-bold">Members</h2>
          <span className="text-[10px] sm:text-xs text-muted-foreground ml-auto">{members.length} members</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
          {members.map((member) => {
            const profile = getProfile(member.user_id);
            const isGroupAdmin = member.user_id === group.admin_user_id;
            const isPlaceholder = profile?.is_placeholder === true;
            return (
              <button
                key={member.id}
                onClick={() => setSelectedUserId(member.user_id)}
                className={`flex items-center gap-2 rounded-xl p-2 sm:p-3 text-left transition-colors hover:ring-1 hover:ring-primary/30 ${isPlaceholder ? 'bg-muted/10 border border-dashed border-border' : 'bg-muted/20 hover:bg-muted/30'}`}
              >
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0 ${isPlaceholder ? 'bg-muted/30 text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                  {isPlaceholder ? <Ghost className="w-3 h-3 sm:w-4 sm:h-4" /> : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{profile?.display_name || 'Unknown'}</p>
                  {isGroupAdmin ? (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <Crown className="w-3 h-3" /> Admin
                    </span>
                  ) : isPlaceholder ? (
                    <span className="text-xs text-muted-foreground">Unregistered member</span>
                  ) : (
                    <span className="text-xs text-green-400">Member</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={!!selectedUserId} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="sr-only">Member Profile</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Loading...</div>
          ) : (
            renderMemberProfile()
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MemberList;
