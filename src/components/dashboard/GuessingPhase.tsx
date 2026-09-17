import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Check, HelpCircle, Film, ChevronDown, ChevronUp, CheckCircle2, Clock, Pencil, X, Eye, Link2, ArrowRight } from 'lucide-react';
import GuessingIntro from './GuessingIntro';
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
  const storageKey = `${STORAGE_KEY_PREFIX}${season.id}_${user?.id}`;
  const readDraft = (key: string): Record<string, string> => {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  };
  // Start from the saved draft so a reload (iOS evicts backgrounded PWAs freely)
  // never shows an empty form while the DB check is still in flight.
  const [guesses, setGuesses] = useState<Record<string, string>>(() => (user ? readDraft(storageKey) : {}));
  // Which storage key the load effect has finished for. Persisting before that
  // would overwrite the stored draft with the initial state — the bug that lost
  // guesses on every reload.
  const loadedKeyRef = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [expandedOverviews, setExpandedOverviews] = useState<Record<string, boolean>>({});
  const [submittedMembers, setSubmittedMembers] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [hasUsedEdit, setHasUsedEdit] = useState(false);
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
  // Per-member pick counts from the server: pickers are secret in the feed during
  // guessing, but the roster of who picked (and how many) is the answer bank.
  const [pickCounts, setPickCounts] = useState<Record<string, number>>({});
  const [myGroup, setMyGroup] = useState<number | null>(null);
  // Intro animation: shown once per member per season, flag written on completion
  const introKey = `guessing_intro_seen_${season.id}_${user?.id}`;
  const [introSeen, setIntroSeen] = useState<boolean>(() => {
    try { return !!localStorage.getItem(introKey); } catch { return true; }
  });
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [flashUnitId, setFlashUnitId] = useState<string | null>(null);

  const myPartnerIds = useMemo(() => {
    if (myGroup == null || !user) return new Set<string>();
    return new Set(moviePicks.filter(p => p.pick_group === myGroup && p.user_id && p.user_id !== user.id).map(p => p.user_id as string));
  }, [moviePicks, myGroup, user]);

  const memberPickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    members.forEach(m => {
      if (m.user_id === user?.id || myPartnerIds.has(m.user_id)) return;
      counts[m.user_id] = pickCounts[m.user_id] || 0;
    });
    return counts;
  }, [pickCounts, members, user?.id, myPartnerIds]);

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
        const draft = readDraft(storageKey);
        if (Object.keys(draft).length > 0) setGuesses(draft);
      }
      loadedKeyRef.current = storageKey;
    };

    const loadSubmissionStatus = async () => {
      const { data } = await supabase.rpc('get_season_guess_submitters', { _season_id: season.id });
      if (data) {
        const ids = new Set((data as { guesser_id: string }[]).map(r => r.guesser_id));
        setSubmittedMembers(ids);
      }
    };

    const loadPickCounts = async () => {
      const [{ data: counts }, { data: grp }] = await Promise.all([
        supabase.rpc('get_season_pick_counts', { _season_id: season.id }),
        supabase.rpc('my_pick_group', { _season_id: season.id }),
      ]);
      if (counts) {
        const map: Record<string, number> = {};
        (counts as { user_id: string; pick_count: number }[]).forEach(r => { map[r.user_id] = r.pick_count; });
        setPickCounts(map);
      }
      setMyGroup((grp as number | null) ?? null);
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
    loadPickCounts();
    loadEditStatus();
  }, [season.id, user, storageKey]);

  useEffect(() => {
    if (loadedKeyRef.current !== storageKey) return;
    if (!submitted && !editing && user) {
      try { localStorage.setItem(storageKey, JSON.stringify(guesses)); } catch { /* ignore */ }
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
      const rows = Object.entries(guesses).map(([movie_pick_id, guessed_user_id]) => ({ movie_pick_id, guessed_user_id }));
      // save_guesses replaces existing guesses and, for shared picks, aligns each
      // correctly named member to their own row so per-row scoring stays exact.
      const { error } = await supabase.rpc('save_guesses', { _season_id: season.id, _guesses: rows });
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

  const isMine = (p: MoviePick) => p.user_id === user?.id || (myGroup != null && p.pick_group === myGroup);
  const otherPicks = moviePicks.filter(p => !isMine(p));
  const myPicks = moviePicks.filter(p => isMine(p));
  // A shared pick is several rows of one film; guess it once with one slot per row.
  const otherUnits = useMemo(() => {
    const units: MoviePick[][] = [];
    const byGroup = new Map<number, MoviePick[]>();
    otherPicks.forEach(p => {
      if (p.pick_group == null) { units.push([p]); return; }
      if (!byGroup.has(p.pick_group)) { const u: MoviePick[] = []; byGroup.set(p.pick_group, u); units.push(u); }
      byGroup.get(p.pick_group)!.push(p);
    });
    return units;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moviePicks, myGroup, user?.id]);
  const guessedNames = (unit: MoviePick[]) =>
    unit.map(r => (guesses[r.id] ? getProfile(guesses[r.id])?.display_name : null)).filter(Boolean).join(' & ') || '—';

  /** Members who can be guessed at all this season (excludes self and co-pick partners). */
  const guessableMembers = members.filter(m => (memberPickCounts[m.user_id] || 0) > 0);
  /** The unit(s) a member has already been named for. */
  const usedFor = (memberId: string) =>
    otherUnits.filter(u => u.some(r => guesses[r.id] === memberId));
  const jumpToUnit = (unit: MoviePick[]) => {
    const el = document.getElementById(`guess-unit-${unit[0].id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashUnitId(unit[0].id);
    setOpenSlotId(null);
    window.setTimeout(() => setFlashUnitId(null), 1400);
  };
  const finishIntro = () => {
    try { localStorage.setItem(introKey, '1'); } catch { /* ignore */ }
    setIntroSeen(true);
  };
  const allGuessed = otherPicks.length > 0 && otherPicks.every(p => guesses[p.id]);
  const guessingMembers = members.filter(m => !profiles.find(p => p.user_id === m.user_id)?.is_placeholder);

  const showForm = !submitted || editing;

  const submittedCount = guessingMembers.filter(m => submittedMembers.has(m.user_id)).length;

  const inSeason = !!user && members.some(m => m.user_id === user.id);
  if (!inSeason) {
    return (
      <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
        <div className="rounded-2xl bg-muted/15 border border-border/30 px-4 py-5 text-center">
          <p className="text-sm font-semibold">You're sitting this season out</p>
          <p className="text-xs text-muted-foreground mt-1">Guessing is for this season's participants. You'll see the reveals as they happen.</p>
        </div>
      </div>
    );
  }

  if (showForm && !submitted && !introSeen && otherUnits.length > 0) {
    return <GuessingIntro units={otherUnits} seasonNumber={season.season_number} onDone={finishIntro} />;
  }

  const statusCard = (
      <div className="rounded-xl border border-border/40 bg-muted/15 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-foreground">
            Locked in <span className="text-primary tabular-nums">{submittedCount}</span><span className="text-muted-foreground">/{guessingMembers.length}</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {guessingMembers.map((member) => {
            const profile = getProfile(member.user_id);
            const hasSubmitted = submittedMembers.has(member.user_id);
            return (
              <div
                key={member.user_id}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors ${
                  hasSubmitted
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-muted/30 border-border text-muted-foreground opacity-60'
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
        <div className="flex gap-1">
          {guessingMembers.map((member) => (
            <div
              key={member.user_id}
              className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                submittedMembers.has(member.user_id) ? 'bg-gradient-to-r from-primary to-amber-300' : 'bg-muted/40'
              }`}
            />
          ))}
        </div>
      </div>
  );

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      {/* Cinematic hero */}
      <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/5 bg-gradient-to-br from-card via-card to-muted/20 p-4 sm:p-5 mb-4">
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_80%_10%,hsl(38_90%_55%/0.14),transparent_55%)]" />
        <div className="relative z-10">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-sm border border-primary/30 px-2.5 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Guessing Round</span>
          </span>
          <h2 className="font-display text-2xl sm:text-3xl font-bold leading-[1.05] mt-2.5 text-gradient-gold">
            {submitted && !editing ? 'Your guesses are in.' : 'Guess who picked what'}
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1.5">
            {submitted && !editing
              ? (guessingMembers.length - submittedCount > 0
                  ? `${guessingMembers.length - submittedCount} still guessing · pickers stay secret until watch day.`
                  : "Everyone's in — pickers are revealed film by film on watch day.")
              : 'Match each movie to the member who chose it — use each name once.'}
          </p>
        </div>
      </div>

      {!(submitted && !editing) && <div className="mb-4">{statusCard}</div>}

      {/* Submitted: the guess sheet */}
      {submitted && !editing && (
        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden ring-1 ring-white/5 bg-card">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/5">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-300">Your guess sheet</p>
              <p className="text-[11px] text-muted-foreground">{otherUnits.length} {otherUnits.length === 1 ? 'film' : 'films'} · tap for details</p>
            </div>
            <div className="divide-y divide-white/5">
              {otherUnits.map((unit) => {
                const pick = unit[0];
                const isExpanded = expandedDetailId === pick.id;
                const guessed = unit.map(r => (guesses[r.id] ? getProfile(guesses[r.id]) : null));
                return (
                  <button
                    key={pick.id}
                    type="button"
                    onClick={() => setExpandedDetailId(isExpanded ? null : pick.id)}
                    className="w-full text-left px-3 py-2.5 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {pick.poster_url ? (
                        <img src={pick.poster_url} alt={pick.title} className="w-10 h-[60px] rounded-md object-cover ring-1 ring-white/10 shrink-0" />
                      ) : (
                        <div className="w-10 h-[60px] rounded-md bg-muted/40 flex items-center justify-center shrink-0">
                          <Film className="w-4 h-4 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-tight truncate">{pick.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {pick.year}
                          {unit.length > 1 && <span className="inline-flex items-center gap-1 ml-1.5 text-primary/80"><Link2 className="w-3 h-3" /> Shared pick</span>}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {guessed.map((gp, i) => (
                          <span key={unit[i].id} className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 border border-violet-500/25 pl-0.5 pr-2 py-0.5 text-[11px] font-medium text-violet-200 max-w-[140px]">
                            <Avatar className="w-4 h-4 shrink-0">
                              <AvatarImage src={gp?.avatar_url || undefined} />
                              <AvatarFallback className="text-[8px]">{(gp?.display_name || '?')[0]}</AvatarFallback>
                            </Avatar>
                            <span className="truncate">{gp?.display_name || '—'}</span>
                          </span>
                        ))}
                      </div>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground/60 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                    {isExpanded && (
                      <p className="mt-2 pl-[52px] text-[11px] text-muted-foreground leading-relaxed">
                        {pick.overview || 'No description available.'}
                      </p>
                    )}
                  </button>
                );
              })}
              {myPicks.map((pick) => (
                <div key={pick.id} className="flex items-center gap-3 px-3 py-2.5 bg-primary/[0.04]">
                  {pick.poster_url ? (
                    <img src={pick.poster_url} alt={pick.title} className="w-10 h-[60px] rounded-md object-cover ring-1 ring-primary/30 shrink-0" />
                  ) : (
                    <div className="w-10 h-[60px] rounded-md bg-muted/40 flex items-center justify-center shrink-0">
                      <Film className="w-4 h-4 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight truncate">{pick.title}</p>
                    {pick.year && <p className="text-[11px] text-muted-foreground mt-0.5">{pick.year}</p>}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary shrink-0">
                    <Check className="w-2.5 h-2.5" strokeWidth={3} /> Your pick
                  </span>
                </div>
              ))}
            </div>
            {hasUsedEdit ? (
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-t border-white/5 text-xs text-muted-foreground/70">
                <Pencil className="w-3.5 h-3.5" /> Your one edit has been used — these are final.
              </div>
            ) : (
              <button
                type="button"
                onClick={handleEditClick}
                className="w-full flex items-center gap-1.5 px-4 py-2.5 border-t border-white/5 text-xs text-muted-foreground hover:text-primary hover:bg-white/[0.03] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Change your guesses
                <span className="ml-auto text-[10px] text-muted-foreground/60">one edit allowed</span>
              </button>
            )}
          </div>

          {statusCard}
        </div>
      )}

      {/* Movie list - shown when not submitted or editing */}
      {showForm && (
        <>
          {otherUnits.length === 0 && (
            <div className="rounded-2xl bg-muted/15 border border-border/30 px-4 py-5 text-center">
              <p className="text-sm font-semibold">The lineup didn't load</p>
              <p className="text-xs text-muted-foreground mt-1">Close the app fully and reopen it — you may be on an older version.</p>
            </div>
          )}
          <div className="space-y-3">
            {otherUnits.map((unit) => {
              const pick = unit[0];
              const isLong = (pick.overview?.length || 0) > TRUNCATE_LEN;
              const expanded = expandedOverviews[pick.id];
              return (
                <div
                  key={pick.id}
                  id={`guess-unit-${pick.id}`}
                  className={`bg-muted/20 rounded-xl p-3 space-y-2 transition-shadow duration-300 ${flashUnitId === pick.id ? 'ring-2 ring-primary shadow-[0_0_24px_-6px_hsl(38_90%_55%/0.6)]' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    {pick.poster_url ? (
                      <img src={pick.poster_url} alt={pick.title} className="w-12 h-[72px] sm:w-14 sm:h-[84px] rounded-lg object-cover flex-shrink-0 shadow-md" />
                    ) : (
                      <div className="w-12 h-[72px] sm:w-14 sm:h-[84px] rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <Film className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm leading-tight">{pick.title}</p>
                      {pick.year && <p className="text-[11px] text-muted-foreground">{pick.year}</p>}
                      {unit.length > 1 && (
                        <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-primary/10 border border-primary/25 px-2 py-0.5 text-[10px] font-medium text-primary">
                          <Link2 className="w-3 h-3" /> Shared pick · {unit.length} people
                        </span>
                      )}
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
                  {unit.map((pick, slotIdx) => (
                  <Fragment key={pick.id}>
                  <div className="flex items-center gap-1.5">
                    {unit.length > 1 && (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-12">Pick {slotIdx + 1}</span>
                    )}
                    {(() => {
                      const guessedProfile = guesses[pick.id] ? getProfile(guesses[pick.id]) : null;
                      const hasGuess = !!guesses[pick.id];
                      const isOpen = openSlotId === pick.id;
                      return (
                        <button
                          type="button"
                          onClick={() => setOpenSlotId(isOpen ? null : pick.id)}
                          aria-expanded={isOpen}
                          className={`flex-1 min-w-0 h-9 px-3 text-sm rounded-full border transition-colors flex items-center justify-between gap-2 ${
                            hasGuess
                              ? 'bg-violet-500/12 border-violet-500/25 text-violet-200'
                              : 'bg-transparent border-dashed border-primary/40 text-primary'
                          }`}
                        >
                          {hasGuess ? (
                            <span className="flex items-center gap-1.5 min-w-0">
                              <Avatar className="w-4 h-4 shrink-0">
                                <AvatarImage src={guessedProfile?.avatar_url || undefined} />
                                <AvatarFallback className="text-[8px]">{(guessedProfile?.display_name || '?')[0]}</AvatarFallback>
                              </Avatar>
                              <span className="truncate font-medium">{guessedProfile?.display_name || 'Unknown'}</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 font-medium">
                              <HelpCircle className="w-3.5 h-3.5" /> Tap to guess
                            </span>
                          )}
                          {isOpen ? <ChevronUp className="w-3.5 h-3.5 shrink-0 opacity-70" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />}
                        </button>
                      );
                    })()}
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
                  {openSlotId === pick.id && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {guessableMembers.map((m) => {
                        const name = getProfile(m.user_id)?.display_name || 'Unknown';
                        const isCurrent = guesses[pick.id] === m.user_id;
                        const usedUp = !isCurrent && (guessCountPerMember[m.user_id] || 0) >= (memberPickCounts[m.user_id] || 0);
                        const elsewhere = usedUp ? usedFor(m.user_id) : [];
                        if (usedUp) {
                          return (
                            <button
                              key={m.user_id}
                              type="button"
                              onClick={() => elsewhere[0] && jumpToUnit(elsewhere[0])}
                              title={elsewhere[0] ? `Already picked for ${elsewhere[0][0].title} — tap to jump` : undefined}
                              className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground/70 hover:text-primary hover:border-primary/30 transition-colors"
                            >
                              <span className="line-through decoration-muted-foreground/60">{name}</span>
                              {elsewhere[0] && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-primary/80 max-w-[110px] truncate">
                                  <ArrowRight className="w-2.5 h-2.5 shrink-0" /> {elsewhere[0][0].title}
                                </span>
                              )}
                            </button>
                          );
                        }
                        return (
                          <button
                            key={m.user_id}
                            type="button"
                            onClick={() => {
                              setGuesses(prev => {
                                const next = { ...prev };
                                if (isCurrent) delete next[pick.id]; else next[pick.id] = m.user_id;
                                return next;
                              });
                              setOpenSlotId(null);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                              isCurrent
                                ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                                : 'bg-card border-border/60 text-foreground hover:border-primary/50 hover:text-primary'
                            }`}
                          >
                            <Avatar className="w-4 h-4 shrink-0">
                              <AvatarImage src={getProfile(m.user_id)?.avatar_url || undefined} />
                              <AvatarFallback className="text-[8px]">{name[0]}</AvatarFallback>
                            </Avatar>
                            {name}
                            {isCurrent && <Check className="w-3 h-3" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  </Fragment>
                  ))}
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground text-center">
            Every name gets used once — a shared pick takes one name per slot.
          </p>

          <div className={`mt-4 rounded-xl transition-all duration-500 ${allGuessed && !submitting ? 'shadow-[0_0_24px_-6px_hsl(38_90%_55%_/_0.5)]' : ''}`}>
          <Button
            variant="gold"
            className={`w-full ${!allGuessed || submitting ? 'opacity-50' : ''}`}
            onClick={submitGuesses}
            disabled={!allGuessed || submitting}
          >
            <Check className="w-4 h-4 mr-2" />
            {submitting ? 'Submitting...' : editing ? 'Re-Submit Guesses' : 'Submit Guesses'}
          </Button>
          </div>
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
