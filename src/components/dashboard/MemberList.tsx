import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { Group, GroupMember, Profile } from '@/hooks/useGroup';
import { Users, Crown, Ghost, Film, BookOpen, Trophy, Star, Clock, Sparkles, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { computeMemberBadges, computeCasualViewerBadges, type BadgePickInput, type EarnedBadge } from '@/lib/memberBadges';
import { motion } from 'framer-motion';
import ClubStatNumber from '@/components/dashboard/ClubStatNumber';
import { useNavigate } from 'react-router-dom';

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
  guessing_enabled: boolean;
  next_call_date: string | null;
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
  tmdb_id: number | null;
}

interface TmdbDetails {
  runtime: number | null;
  vote_average: number | null;
  release_date: string | null;
  popularity: number | null;
}
const TMDB_CACHE_KEY = 'mc_tmdb_details_v6';

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
  season_id: string;
}

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] as const },
  }),
} as const;

/** Rotating banner accents so member tiles feel unique (admin gets gold). */
const MEMBER_BANNER_ACCENTS = [
  'from-violet-500/45 via-primary/25 to-background',
  'from-sky-500/40 via-cyan-500/10 to-background',
  'from-rose-500/40 via-primary/20 to-background',
  'from-emerald-500/40 via-teal-500/10 to-background',
  'from-fuchsia-500/35 via-primary/15 to-background',
] as const;

// suppress unused warning
void MEMBER_BANNER_ACCENTS;

const MemberList = ({ members, profiles, group, isAdmin: _isAdmin, onUpdate: _onUpdate }: Props) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [rankings, setRankings] = useState<{ user_id: string; movie_pick_id: string; rank: number; season_id: string }[]>([]);
  const [seasonParticipants, setSeasonParticipants] = useState<{ user_id: string; season_id: string }[]>([]);
  const [tmdbDetails, setTmdbDetails] = useState<Record<string, TmdbDetails>>({});
  const [loading, setLoading] = useState(false);

  // Fetch all group data on mount
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const { data: seasonData } = await supabase
        .from('seasons').select('id, season_number, title, status, current_movie_index, guessing_enabled, next_call_date')
        .eq('group_id', group.id).order('season_number', { ascending: false });
      const s = (seasonData || []) as SeasonInfo[];
      setSeasons(s);
      const seasonIds = s.map(ss => ss.id);
      if (seasonIds.length === 0) { setPicks([]); setGuesses([]); setSeasonParticipants([]); setLoading(false); return; }
      const [picksRes, guessesRes, rankingsRes, participantsRes] = await Promise.all([
        supabase.from('movie_picks').select('id, title, user_id, poster_url, year, watch_order, season_id, revealed, tmdb_id').in('season_id', seasonIds),
        supabase.from('guesses').select('guesser_id, guessed_user_id, movie_pick_id, season_id').in('season_id', seasonIds),
        supabase.from('movie_rankings').select('user_id, movie_pick_id, rank, season_id').in('season_id', seasonIds),
        supabase.from('season_participants').select('user_id, season_id').in('season_id', seasonIds),
      ]);
      setPicks((picksRes.data || []) as PickRow[]);
      setGuesses((guessesRes.data || []) as GuessRow[]);
      setRankings(rankingsRes.data || []);
      setSeasonParticipants(participantsRes.data || []);
      setLoading(false);
    };
    fetchData();
  }, [group.id]);

  const isPickWatched = (pick: PickRow) => {
    const s = seasons.find(ss => ss.id === pick.season_id);
    if (!s) return false;
    if (s.status === 'completed') return true;
    if (s.status === 'watching' && pick.watch_order != null) return pick.watch_order < s.current_movie_index;
    return false;
  };

  // TMDB enrichment
  useEffect(() => {
    if (group.club_type === 'book' || picks.length === 0) return;
    let cancelled = false;
    const enrich = async () => {
      let cache: Record<string, TmdbDetails> = {};
      try { const raw = sessionStorage.getItem(TMDB_CACHE_KEY); if (raw) cache = JSON.parse(raw); } catch { /* ignore */ }
      const initial: Record<string, TmdbDetails> = {};
      const toFetch: PickRow[] = [];
      for (const p of picks) {
        if (!isPickWatched(p)) continue;
        const cacheKey = p.tmdb_id ? `id:${p.tmdb_id}` : `t:${p.title}|${p.year || ''}`;
        if (cache[cacheKey]) initial[p.id] = { runtime: cache[cacheKey].runtime ?? null, vote_average: cache[cacheKey].vote_average ?? null, release_date: cache[cacheKey].release_date ?? null, popularity: cache[cacheKey].popularity ?? null };
        else toFetch.push(p);
      }
      if (Object.keys(initial).length) setTmdbDetails(prev => ({ ...prev, ...initial }));
      if (toFetch.length === 0 || !TMDB_API_TOKEN) return;
      const headers = { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' };
      const queue = [...toFetch];
      const workers = Array.from({ length: 4 }, async () => {
        while (queue.length && !cancelled) {
          const p = queue.shift()!;
          const cacheKey = p.tmdb_id ? `id:${p.tmdb_id}` : `t:${p.title}|${p.year || ''}`;
          try {
            let tmdbId = p.tmdb_id;
            if (!tmdbId) {
              const yp = p.year ? `&year=${p.year}` : '';
              const r = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(p.title)}&include_adult=false&language=en-US&page=1${yp}`, { headers });
              const d = await r.json();
              tmdbId = d.results?.[0]?.id || null;
            }
            if (!tmdbId) continue;
            const r2 = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US`, { headers });
            if (!r2.ok) continue;
            const d2 = await r2.json();
            const details: TmdbDetails = { runtime: typeof d2.runtime === 'number' ? d2.runtime : null, vote_average: typeof d2.vote_average === 'number' ? d2.vote_average : null, release_date: d2.release_date ?? null, popularity: typeof d2.popularity === 'number' ? d2.popularity : null };
            if (!cache[cacheKey]) cache[cacheKey] = details as TmdbDetails;
            else cache[cacheKey] = { ...cache[cacheKey], ...details };
            if (!cancelled) setTmdbDetails(prev => ({ ...prev, [p.id]: details }));
          } catch { /* skip */ }
        }
      });
      await Promise.all(workers);
      try { sessionStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
    };
    enrich();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, group.club_type]);

  // Badge computation
  const memberBadgesMap = useMemo(() => {
    if (group.club_type === 'book' || picks.length === 0) return new Map();
    const slotMap = new Map<string, PickRow[]>();
    for (const p of picks) {
      if (!isPickWatched(p)) continue;
      const key = p.watch_order != null ? `${p.season_id}:${p.watch_order}` : `${p.season_id}:single:${p.id}`;
      if (!slotMap.has(key)) slotMap.set(key, []);
      slotMap.get(key)!.push(p);
    }
    const seasonUserMax = new Map<string, number>();
    const ranksBySeason = new Map<string, Map<string, number[]>>();
    for (const r of rankings) {
      let bySeason = ranksBySeason.get(r.season_id);
      if (!bySeason) { bySeason = new Map(); ranksBySeason.set(r.season_id, bySeason); }
      const arr = bySeason.get(r.user_id) || [];
      arr.push(r.rank);
      bySeason.set(r.user_id, arr);
    }
    for (const [seasonId, byUser] of ranksBySeason) {
      for (const [uid, ranks] of byUser) {
        if (ranks.length === 0) continue;
        seasonUserMax.set(`${seasonId}:${uid}`, Math.max(...ranks));
      }
    }
    const slotLove = new Map<string, number | null>();
    for (const [key, slotPicks] of slotMap) {
      const slotPickIds = new Set(slotPicks.map(p => p.id));
      const seasonId = slotPicks[0].season_id;
      const loves: number[] = [];
      for (const r of rankings) {
        if (r.season_id !== seasonId || !slotPickIds.has(r.movie_pick_id)) continue;
        const N = seasonUserMax.get(`${seasonId}:${r.user_id}`);
        if (!N || N < 2) continue;
        loves.push((N - r.rank + 1) / N);
      }
      slotLove.set(key, loves.length ? loves.reduce((s, v) => s + v, 0) / loves.length : null);
    }
    const inputs: BadgePickInput[] = [];
    for (const [key, slotPicks] of slotMap) {
      const canonical = slotPicks[0];
      const det = tmdbDetails[canonical.id];
      const releaseYearStr = det?.release_date?.slice(0, 4) || canonical.year || null;
      const releaseYear = releaseYearStr ? parseInt(releaseYearStr.slice(0, 4), 10) : null;
      inputs.push({ pickId: canonical.id, pickerIds: Array.from(new Set(slotPicks.map(p => p.user_id))), runtime: det?.runtime ?? null, voteAverage: det?.vote_average ?? null, popularity: det?.popularity ?? null, releaseYear: Number.isFinite(releaseYear as number) ? (releaseYear as number) : null, groupLove: slotLove.get(key) ?? null });
    }
    return computeMemberBadges(inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, rankings, tmdbDetails, group.club_type, seasons]);

  const casualViewerMap = useMemo(() => {
    if (picks.length === 0 || seasons.length === 0) return new Map<string, EarnedBadge>();
    const participantsBySeason = new Map<string, Set<string>>();
    for (const sp of seasonParticipants) {
      let set = participantsBySeason.get(sp.season_id);
      if (!set) { set = new Set(); participantsBySeason.set(sp.season_id, set); }
      set.add(sp.user_id);
    }
    const allMemberIds = members.map(m => m.user_id);
    const participantsFor = (seasonId: string): string[] => {
      const set = participantsBySeason.get(seasonId);
      return set && set.size > 0 ? Array.from(set) : allMemberIds;
    };
    const guessesExpected: Record<string, number> = {}, guessesMade: Record<string, number> = {};
    const rankingsExpected: Record<string, number> = {}, rankingsMade: Record<string, number> = {};
    for (const s of seasons) {
      const participants = participantsFor(s.id);
      const seasonPicks = picks.filter(p => p.season_id === s.id);
      if (s.guessing_enabled && (s.status === 'watching' || s.status === 'reviewing' || s.status === 'completed')) {
        const watchedPicks = seasonPicks.filter(p => isPickWatched(p));
        for (const uid of participants) {
          const expected = watchedPicks.filter(p => p.user_id !== uid).length;
          if (expected > 0) guessesExpected[uid] = (guessesExpected[uid] || 0) + expected;
        }
      }
      if (s.status === 'reviewing' || s.status === 'completed') {
        for (const uid of participants) {
          const expected = seasonPicks.filter(p => p.user_id !== uid).length;
          if (expected > 0) rankingsExpected[uid] = (rankingsExpected[uid] || 0) + expected;
        }
      }
    }
    for (const g of guesses) {
      const s = seasons.find(ss => ss.id === g.season_id);
      if (!s || !s.guessing_enabled) continue;
      const pick = picks.find(p => p.id === g.movie_pick_id);
      if (!pick || !isPickWatched(pick)) continue;
      guessesMade[g.guesser_id] = (guessesMade[g.guesser_id] || 0) + 1;
    }
    for (const r of rankings) {
      const s = seasons.find(ss => ss.id === r.season_id);
      if (!s || (s.status !== 'reviewing' && s.status !== 'completed')) continue;
      rankingsMade[r.user_id] = (rankingsMade[r.user_id] || 0) + 1;
    }
    return computeCasualViewerBadges({ memberIds: allMemberIds, guessesExpected, guessesMade, rankingsExpected, rankingsMade });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, guesses, rankings, seasons, seasonParticipants, members]);

  const allMemberBadgesMap = useMemo(() => {
    const merged = new Map<string, EarnedBadge[]>();
    for (const [uid, list] of memberBadgesMap) merged.set(uid, [...list]);
    for (const [uid, badge] of casualViewerMap) {
      const list = merged.get(uid) || [];
      list.push(badge);
      merged.set(uid, list);
    }
    return merged;
  }, [memberBadgesMap, casualViewerMap]);

  const clubStats = useMemo(() => {
    const completedSeasons = seasons.filter(s => s.status === 'completed').length;
    const watchedPicks = picks.filter(p => isPickWatched(p));
    const watchedSlots = new Set<string>();
    for (const p of watchedPicks) watchedSlots.add(p.watch_order != null ? `${p.season_id}:${p.watch_order}` : `single:${p.id}`);
    let totalRuntimeMin = 0;
    const countedSlots = new Set<string>();
    for (const p of watchedPicks) {
      const key = p.watch_order != null ? `${p.season_id}:${p.watch_order}` : `single:${p.id}`;
      if (countedSlots.has(key)) continue;
      const det = tmdbDetails[p.id];
      if (det?.runtime) { totalRuntimeMin += det.runtime; countedSlots.add(key); }
    }
    return { completedSeasons, totalWatched: watchedSlots.size, totalRuntimeMin, memberCount: members.length, foundedAt: group.created_at };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasons, picks, tmdbDetails, members, group.created_at]);

  const milestoneHint = useMemo(() => {
    const n = clubStats.completedSeasons;
    if (n <= 0) return null;
    if (n < 10) return `${10 - n} more season${10 - n === 1 ? '' : 's'} to 10 completed`;
    if (n < 25) return `${25 - n} more season${25 - n === 1 ? '' : 's'} to 25 completed`;
    return null;
  }, [clubStats.completedSeasons]);

  const activityBlurb = useMemo(() => {
    const active = seasons.find(s => s.status === 'watching' || s.status === 'reviewing');
    if (active?.next_call_date) {
      const d = new Date(active.next_call_date);
      if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
        return {
          kind: 'next' as const,
          line: 'Next get-together',
          sub: d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
        };
      }
    }
    const watched = picks.filter(p => {
      const s = seasons.find(ss => ss.id === p.season_id);
      if (!s) return false;
      if (s.status === 'completed') return true;
      if (s.status === 'watching' && p.watch_order != null) return p.watch_order < s.current_movie_index;
      return false;
    });
    const seen = new Set<string>();
    const unique: PickRow[] = [];
    for (const p of watched.sort((a, b) => {
      const sA = seasons.find(s => s.id === a.season_id)?.season_number ?? 0;
      const sB = seasons.find(s => s.id === b.season_id)?.season_number ?? 0;
      if (sA !== sB) return sB - sA;
      return (b.watch_order ?? 0) - (a.watch_order ?? 0);
    })) {
      const key = `${p.season_id}:${p.watch_order ?? p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }
    const last = unique[0];
    if (last?.title) {
      return { kind: 'last' as const, line: 'Last watched together', sub: last.title };
    }
    return null;
  }, [seasons, picks]);

  const isBookClub = group.club_type === 'book';
  const watchedNoun = isBookClub ? 'books read' : 'movies watched';
  const runtimeNoun = isBookClub ? null : 'watched together';
  const formatRuntimeShort = (mins: number) => {
    if (mins <= 0) return null;
    const totalH = mins / 60;
    if (totalH >= 100) return `${Math.round(totalH)} hours`;
    if (totalH >= 10) return `${totalH.toFixed(1)} hours`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins - h * 60);
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  };
  const runtimeStr = formatRuntimeShort(clubStats.totalRuntimeMin);
  const foundedDate = clubStats.foundedAt
    ? new Date(clubStats.foundedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  const statItems: { value: number | string; label: string; icon: ReactNode; numeric: boolean; tileClass: string; valueClass: string; subLabel?: string }[] = [
    { value: clubStats.memberCount,      label: 'members',      icon: <Users  className="w-3.5 h-3.5 text-sky-400"     />, numeric: true,  tileClass: 'bg-sky-500/10 border-sky-500/20',          valueClass: 'text-sky-400' },
    { value: clubStats.completedSeasons, label: 'seasons done', icon: <Trophy className="w-3.5 h-3.5 text-amber-400"   />, numeric: true,  tileClass: 'bg-amber-500/10 border-amber-500/20',      valueClass: 'text-amber-400', subLabel: milestoneHint ?? undefined },
    { value: clubStats.totalWatched,     label: watchedNoun,    icon: <Film   className="w-3.5 h-3.5 text-violet-400"  />, numeric: true,  tileClass: 'bg-violet-500/10 border-violet-500/20',    valueClass: 'text-violet-400' },
    runtimeStr && runtimeNoun
      ? { value: runtimeStr,     label: runtimeNoun,     icon: <Clock className="w-3.5 h-3.5 text-emerald-400" />, numeric: false, tileClass: 'bg-emerald-500/10 border-emerald-500/20', valueClass: 'text-emerald-400' }
      : { value: seasons.length, label: 'total seasons', icon: <Star  className="w-3.5 h-3.5 text-emerald-400" />, numeric: true,  tileClass: 'bg-emerald-500/10 border-emerald-500/20', valueClass: 'text-emerald-400' },
  ];

  // suppress unused loading warning for now (used for future loading state)
  void loading;

  return (
    <>
      {/* Club header card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6 relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-amber-500/10 pointer-events-none" aria-hidden />
        <div className="relative">
          {/* Activity blurb — top of card */}
          {activityBlurb && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 mb-3 ${activityBlurb.kind === 'next' ? 'border-amber-500/25 bg-amber-500/8' : 'border-primary/15 bg-primary/5'}`}
            >
              <Sparkles className={`w-4 h-4 shrink-0 mt-0.5 ${activityBlurb.kind === 'next' ? 'text-amber-400' : 'text-primary'}`} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{activityBlurb.line}</p>
                <p className="text-sm font-medium text-foreground truncate">{activityBlurb.sub}</p>
              </div>
            </motion.div>
          )}
          {/* Identity row */}
          <div className="flex items-center gap-2 mb-3 sm:mb-4">
            {isBookClub ? <BookOpen className="w-3.5 h-3.5 text-primary/50" /> : <Film className="w-3.5 h-3.5 text-primary/50" />}
            <span className="text-xs font-medium text-muted-foreground">{isBookClub ? 'Book Club' : 'Movie Club'}</span>
            {foundedDate && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-xs text-muted-foreground">Est. {foundedDate}</span>
              </>
            )}
          </div>
          {/* Color-coded stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {statItems.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className={`rounded-xl border p-3 ${stat.tileClass}`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">{stat.icon}<span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</span></div>
                {stat.numeric && typeof stat.value === 'number' ? (
                  <ClubStatNumber value={stat.value} className={`font-display text-lg sm:text-xl font-bold ${stat.valueClass}`} />
                ) : (
                  <p className={`font-display text-lg sm:text-xl font-bold ${stat.valueClass}`}>{stat.value}</p>
                )}
                {stat.subLabel && <p className="text-[10px] text-muted-foreground/60 mt-1 leading-tight">{stat.subLabel}</p>}
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Member list */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card mt-4 sm:mt-6 rounded-2xl border border-border/50 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h2 className="font-display text-base font-bold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Members
          </h2>
          <span className="text-[11px] text-muted-foreground tabular-nums">{members.length}</span>
        </div>
        <div className="divide-y divide-border/30">
          {members.map((member, i) => {
            const profile = getProfile(member.user_id);
            const isGroupAdmin = member.user_id === group.admin_user_id;
            const isPlaceholder = profile?.is_placeholder === true;
            const earned = allMemberBadgesMap.get(member.user_id) || [];
            return (
              <motion.button
                key={member.id}
                type="button"
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                onClick={() => navigate(`/dashboard/${group.id}/member/${member.user_id}`)}
                className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className={`h-10 w-10 overflow-hidden rounded-full ${isPlaceholder ? 'bg-muted ring-1 ring-border/50' : 'bg-card ring-2 ring-border/40'} ${isGroupAdmin ? 'ring-primary/40' : ''}`}>
                    {isPlaceholder ? (
                      <div className="flex h-full w-full items-center justify-center">
                        <Ghost className="h-5 w-5 text-muted-foreground/60" />
                      </div>
                    ) : profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 to-muted text-sm font-bold text-primary">
                        {profile?.display_name?.charAt(0).toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                </div>
                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{profile?.display_name || 'Unknown'}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {isGroupAdmin && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary">
                        <Crown className="w-2.5 h-2.5" /> Admin
                      </span>
                    )}
                    {isPlaceholder && (
                      <span className="text-[10px] text-muted-foreground">Invite pending</span>
                    )}
                    {!isPlaceholder && earned.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        {earned.slice(0, 5).map(e => (
                          <span key={e.badge.id} className="text-[12px] leading-none" title={e.badge.label}>{e.badge.emoji}</span>
                        ))}
                        {earned.length > 5 && <span className="text-[10px] text-muted-foreground ml-0.5">+{earned.length - 5}</span>}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/70" />
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* Own profile link for quick access */}
      {user && (
        <div className="mt-3 px-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => navigate(`/dashboard/${group.id}/member/${user.id}`)}
          >
            View your profile
          </Button>
        </div>
      )}
    </>
  );
};

export default MemberList;
