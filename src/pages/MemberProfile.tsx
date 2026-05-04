import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useGroup } from '@/hooks/useGroup';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Film, Crown, Camera, Crop, Award, Star, ListOrdered, Check, X, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ReactCrop, { type Crop as CropType, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import PastRankingsDialog from '@/components/dashboard/PastRankingsDialog';
import RankingInsights from '@/components/dashboard/RankingInsights';
import { validateImageFile, getSafeErrorMessage, safeFilename } from '@/lib/security';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { computeMemberBadges, computeCasualViewerBadges, type BadgePickInput, type EarnedBadge } from '@/lib/memberBadges';
import { toast } from 'sonner';
import logo from '@/assets/logo.png';
import { getClubLabels } from '@/lib/clubTypes';

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

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
  season_id: string;
}

const TMDB_CACHE_KEY = 'mc_tmdb_details_v6';

const PROFILE_COVER_ACCENTS = [
  'from-violet-600/35 via-violet-500/10',
  'from-sky-600/35 via-sky-500/10',
  'from-rose-600/35 via-rose-500/10',
  'from-emerald-600/35 via-emerald-500/10',
  'from-fuchsia-600/30 via-fuchsia-500/10',
] as const;

function centerAspectCrop(mediaWidth: number, mediaHeight: number) {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, 1, mediaWidth, mediaHeight),
    mediaWidth, mediaHeight
  );
}

const MemberProfile = () => {
  const { groupId, userId } = useParams<{ groupId: string; userId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { group, members, profiles, loading: groupLoading } = useGroup(groupId);

  const isOwnProfile = user?.id === userId;
  const getProfile = (uid: string) => profiles.find(p => p.user_id === uid);
  const profile = userId ? getProfile(userId) : undefined;
  const isGroupAdmin = userId === group?.admin_user_id;
  const isBookClub = group?.club_type === 'book';
  const labels = getClubLabels(group?.club_type ?? 'movie');

  // Data state
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [rankings, setRankings] = useState<{ user_id: string; movie_pick_id: string; rank: number; season_id: string }[]>([]);
  const [seasonParticipants, setSeasonParticipants] = useState<{ user_id: string; season_id: string }[]>([]);
  const [tmdbDetails, setTmdbDetails] = useState<Record<string, TmdbDetails>>({});
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile UI state
  const [profileTab, setProfileTab] = useState<'overview' | 'picks' | 'guessing'>('overview');
  const [guessFilter, setGuessFilter] = useState<'all' | 'correct' | 'miss' | 'none'>('all');
  const [guessOlderExpanded, setGuessOlderExpanded] = useState(false);

  // Avatar upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropType>();
  const [uploading, setUploading] = useState(false);
  const [previewAvatarUrl, setPreviewAvatarUrl] = useState<string | null>(null);

  // Cover picker state
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverBackdrops, setCoverBackdrops] = useState<{ pickTitle: string; path: string }[]>([]);
  const [loadingBackdrops, setLoadingBackdrops] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(profile?.cover_url ?? null);

  // Rankings
  const [pastRankingsOpen, setPastRankingsOpen] = useState(false);
  const [hasUnrankedSeasons, setHasUnrankedSeasons] = useState(false);

  // Redirect if no group
  useEffect(() => {
    if (!groupLoading && !group) navigate('/clubs');
  }, [groupLoading, group, navigate]);

  // Fetch all data
  useEffect(() => {
    if (!groupId || !userId) return;
    const fetchData = async () => {
      setLoading(true);
      const { data: seasonData } = await supabase
        .from('seasons').select('id, season_number, title, status, current_movie_index, guessing_enabled, next_call_date')
        .eq('group_id', groupId).order('season_number', { ascending: false });
      const s = (seasonData || []) as SeasonInfo[];
      setSeasons(s);
      const seasonIds = s.map(ss => ss.id);

      // Member join date
      const { data: memberData } = await supabase
        .from('group_members').select('created_at')
        .eq('group_id', groupId).eq('user_id', userId).single();
      if (memberData?.created_at) {
        setMemberSince(new Date(memberData.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }));
      }

      if (seasonIds.length === 0) { setLoading(false); return; }
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
  }, [groupId, userId]);

  // Unranked seasons check
  useEffect(() => {
    if (!user || !isOwnProfile || !groupId) return;
    const check = async () => {
      const { data: completed } = await supabase.from('seasons').select('id').eq('group_id', groupId).in('status', ['completed', 'reviewing']);
      if (!completed?.length) { setHasUnrankedSeasons(false); return; }
      const { data: existing } = await supabase.from('movie_rankings').select('season_id').eq('user_id', user.id).in('season_id', completed.map(s => s.id));
      const rankedIds = new Set((existing || []).map(r => r.season_id));
      setHasUnrankedSeasons(completed.some(s => !rankedIds.has(s.id)));
    };
    check();
  }, [user, isOwnProfile, groupId, pastRankingsOpen]);

  // TMDB enrichment
  const isPickWatched = useCallback((pick: PickRow) => {
    const s = seasons.find(ss => ss.id === pick.season_id);
    if (!s) return false;
    if (s.status === 'completed') return true;
    if (s.status === 'watching' && pick.watch_order != null) return pick.watch_order < s.current_movie_index;
    return false;
  }, [seasons]);

  useEffect(() => {
    if (isBookClub || picks.length === 0) return;
    let cancelled = false;
    const enrich = async () => {
      let cache: Record<string, TmdbDetails & { cast?: unknown }> = {};
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
            if (!cache[cacheKey]) cache[cacheKey] = details;
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
  }, [picks, isBookClub, isPickWatched]);

  // Badge computation
  const memberBadgesMap = useMemo(() => {
    if (isBookClub || picks.length === 0) return new Map<string, EarnedBadge[]>();
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
  }, [picks, rankings, tmdbDetails, isBookClub, isPickWatched, seasons]);

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
  }, [picks, guesses, rankings, seasons, seasonParticipants, members, isPickWatched]);

  const earned = useMemo<EarnedBadge[]>(() => {
    if (!userId) return [];
    const list = memberBadgesMap.get(userId) ? [...(memberBadgesMap.get(userId) || [])] : [];
    const casual = casualViewerMap.get(userId);
    if (casual) list.push(casual);
    return list;
  }, [memberBadgesMap, casualViewerMap, userId]);

  // Profile-specific computations
  const memberPicks = useMemo(() => {
    if (!userId) return [];
    return picks.filter(p => p.user_id === userId).sort((a, b) => {
      const sA = seasons.find(s => s.id === a.season_id)?.season_number ?? 0;
      const sB = seasons.find(s => s.id === b.season_id)?.season_number ?? 0;
      if (sA !== sB) return sB - sA;
      return (b.watch_order ?? 0) - (a.watch_order ?? 0);
    });
  }, [picks, userId, seasons]);

  const userGuesses = useMemo(() => guesses.filter(g => g.guesser_id === userId), [guesses, userId]);

  const isPickRevealed = useCallback((pick: PickRow) => isPickWatched(pick), [isPickWatched]);

  // Guess accuracy
  const { correct, total, pct } = useMemo(() => {
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
      if (isPickWatched(p) && p.watch_order != null)
        pickValidUsers[p.id] = new Set(coPickGroups.get(`${p.season_id}:${p.watch_order}`) || [p.user_id]);
    });
    let correct = 0, total = 0;
    userGuesses.forEach(g => {
      if (pickValidUsers[g.movie_pick_id]) {
        total += 1;
        if (pickValidUsers[g.movie_pick_id].has(g.guessed_user_id)) correct += 1;
      }
    });
    return { correct, total, pct: total > 0 ? Math.round((correct / total) * 100) : 0 };
  }, [picks, userGuesses, isPickWatched]);

  const accuracyTier = total === 0 ? 'none' : pct >= 70 ? 'gold' : pct >= 50 ? 'good' : 'low';
  const accuracyTextClass = accuracyTier === 'gold' ? 'text-gradient-gold' : accuracyTier === 'good' ? 'text-green-400' : accuracyTier === 'low' ? 'text-foreground/60' : 'text-muted-foreground';
  const accuracyTileClass = accuracyTier === 'gold' ? 'bg-primary/10 border-primary/25' : accuracyTier === 'good' ? 'bg-green-500/10 border-green-500/20' : 'bg-muted/20 border-border/40';

  // Avg pick ranking
  const pickById = useMemo(() => new Map(picks.map(p => [p.id, p])), [picks]);
  const getSlotKey = (pick: PickRow) => `${pick.season_id}:${pick.watch_order ?? pick.id}`;
  const memberSlotKeys = useMemo(() => new Set(memberPicks.map(p => getSlotKey(p))), [memberPicks]);
  const slotRankings = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    rankings.forEach(r => {
      const pick = pickById.get(r.movie_pick_id);
      if (!pick) return;
      const slotKey = getSlotKey(pick);
      if (!memberSlotKeys.has(slotKey)) return;
      if (!map.has(slotKey)) map.set(slotKey, { total: 0, count: 0 });
      const entry = map.get(slotKey)!;
      entry.total += r.rank; entry.count += 1;
    });
    return map;
  }, [rankings, pickById, memberSlotKeys]);
  const perPickAvgs = useMemo(() => Array.from(slotRankings.values()).map(v => v.total / v.count), [slotRankings]);
  const overallAvg = perPickAvgs.length > 0 ? perPickAvgs.reduce((s, v) => s + v, 0) / perPickAvgs.length : null;

  // Featured pick
  const { featuredPick, featuredAvgRank, featuredRankCount } = useMemo(() => {
    let bestAvg = Infinity, featuredPick: PickRow | null = null, featuredAvgRank: number | null = null, featuredRankCount = 0;
    for (const [slotKey, stats] of slotRankings) {
      if (stats.count < 2) continue;
      const avg = stats.total / stats.count;
      if (avg < bestAvg) {
        bestAvg = avg;
        const matchPick = memberPicks.find(p => getSlotKey(p) === slotKey);
        if (matchPick && isPickRevealed(matchPick)) {
          featuredPick = matchPick; featuredAvgRank = avg; featuredRankCount = stats.count;
        }
      }
    }
    return { featuredPick, featuredAvgRank, featuredRankCount };
  }, [slotRankings, memberPicks, isPickRevealed]);

  // Sync cover from profile
  useEffect(() => { setCoverUrl(profile?.cover_url ?? null); }, [profile?.cover_url]);

  // Cover
  const memberIndex = members.findIndex(m => m.user_id === userId);
  const coverAccentClass = isGroupAdmin
    ? 'from-amber-500/45 via-primary/25'
    : PROFILE_COVER_ACCENTS[(memberIndex >= 0 ? memberIndex : 0) % PROFILE_COVER_ACCENTS.length];
  const coverPosters = memberPicks.filter(p => isPickRevealed(p) && p.poster_url).slice(0, 4);

  // Season groupings
  const seasonNumForPick = (pick: PickRow) => seasons.find(s => s.id === pick.season_id)?.season_number ?? 0;
  const seasonHeading = (sn: number) => {
    const s = seasons.find(ss => ss.season_number === sn);
    return s?.title ? `Season ${sn} — ${s.title}` : `Season ${sn}`;
  };
  const pickSeasonNums = [...new Set(memberPicks.map(p => seasonNumForPick(p)))].sort((a, b) => b - a);
  const picksSeasonGroups = pickSeasonNums.map(sn => ({
    sn, label: seasonHeading(sn),
    picks: memberPicks.filter(p => seasonNumForPick(p) === sn),
  }));

  // Seasons participated count
  const seasonsParticipated = useMemo(() => {
    const seasonIds = new Set([
      ...memberPicks.map(p => p.season_id),
      ...seasonParticipants.filter(sp => sp.user_id === userId).map(sp => sp.season_id),
    ]);
    return seasonIds.size;
  }, [memberPicks, seasonParticipants, userId]);

  // Guessing tab data
  const watchedPicks = useMemo(() => {
    const seen = new Set<string>();
    return picks.filter(p => isPickWatched(p)).sort((a, b) => {
      const sA = seasons.find(s => s.id === a.season_id)?.season_number ?? 0;
      const sB = seasons.find(s => s.id === b.season_id)?.season_number ?? 0;
      if (sA !== sB) return sB - sA;
      return (b.watch_order ?? 0) - (a.watch_order ?? 0);
    }).filter(p => {
      const key = `${p.season_id}:${p.watch_order}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [picks, seasons, isPickWatched]);

  type GuessMeta = { pick: PickRow; guess?: GuessRow; guessedName: string | null; isCorrect: boolean; isOwnPick: boolean };
  const guessMetasRaw = useMemo<GuessMeta[]>(() => watchedPicks.map(pick => {
    const siblingPicks = picks.filter(p => p.season_id === pick.season_id && p.watch_order === pick.watch_order);
    const validUserIds = new Set(siblingPicks.map(sp => sp.user_id));
    const isOwnPick = validUserIds.has(userId!);
    const guess = userGuesses.find(g => g.movie_pick_id === pick.id) || userGuesses.find(g => siblingPicks.some(sp => sp.id === g.movie_pick_id));
    const guessedName = guess ? getProfile(guess.guessed_user_id)?.display_name || '?' : null;
    const isCorrect = guess ? validUserIds.has(guess.guessed_user_id) : false;
    return { pick, guess, guessedName, isCorrect, isOwnPick };
  }), [watchedPicks, picks, userGuesses, userId]);

  const guessMetas = useMemo(() => guessMetasRaw.filter(m => {
    if (guessFilter === 'all') return true;
    if (guessFilter === 'correct') return !!m.guess && m.isCorrect;
    if (guessFilter === 'miss') return !!m.guess && !m.isCorrect;
    if (guessFilter === 'none') return !m.guess && !m.isOwnPick;
    return true;
  }), [guessMetasRaw, guessFilter]);

  const guessGroups = useMemo(() => {
    const seasonNums = [...new Set(guessMetas.map(m => seasonNumForPick(m.pick)))].sort((a, b) => b - a);
    return seasonNums.map(sn => ({ sn, label: seasonHeading(sn), rows: guessMetas.filter(m => seasonNumForPick(m.pick) === sn) }));
  }, [guessMetas]);
  const guessGroupsVisible = guessOlderExpanded ? guessGroups : guessGroups.slice(0, 2);

  // Avatar upload handlers
  const onCropImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setCrop(centerAspectCrop(naturalWidth, naturalHeight));
  }, []);
  const openCropWithFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => { setCropImageSrc(reader.result as string); setCropDialogOpen(true); };
    reader.readAsDataURL(file);
  };
  const openCropWithUrl = (url: string) => { setCropImageSrc(url); setCropDialogOpen(true); };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) { toast.error(validation.error); return; }
    openCropWithFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const getCroppedBlob = (): Promise<Blob | null> => new Promise((resolve) => {
    const image = cropImgRef.current;
    if (!image || !crop) { resolve(null); return; }
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const pixelCrop = {
      x: (crop.unit === '%' ? (crop.x / 100) * image.width : crop.x) * scaleX,
      y: (crop.unit === '%' ? (crop.y / 100) * image.height : crop.y) * scaleY,
      width: (crop.unit === '%' ? (crop.width / 100) * image.width : crop.width) * scaleX,
      height: (crop.unit === '%' ? (crop.height / 100) * image.height : crop.height) * scaleY,
    };
    const size = Math.min(pixelCrop.width, pixelCrop.height, 512);
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) { resolve(null); return; }
    ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, size, size);
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
  });
  const handleSaveCrop = async () => {
    if (!user) return;
    setUploading(true);
    try {
      const blob = await getCroppedBlob();
      if (!blob) throw new Error('Failed to crop image');
      const filePath = safeFilename(user.id, 'jpg');
      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: filePath }).eq('user_id', user.id);
      if (updateError) throw updateError;
      toast.success('Profile picture updated!');
      setCropDialogOpen(false); setCropImageSrc(null);
    } catch (err: unknown) {
      toast.error(getSafeErrorMessage(err, 'Failed to upload'));
    } finally { setUploading(false); }
  };

  const openCoverPicker = async () => {
    setCoverPickerOpen(true);
    setCoverBackdrops([]);
    setLoadingBackdrops(true);
    const revealedPicks = memberPicks.filter(p => isPickRevealed(p) && p.tmdb_id);
    const results: { pickTitle: string; path: string }[] = [];
    const seen = new Set<string>();
    for (const pick of revealedPicks.slice(0, 12)) {
      try {
        const res = await fetch(
          `https://api.themoviedb.org/3/movie/${pick.tmdb_id}/images`,
          { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' } }
        );
        const data = await res.json();
        const top = (data.backdrops || [])
          .sort((a: { vote_average: number }, b: { vote_average: number }) => b.vote_average - a.vote_average)
          .slice(0, 3);
        for (const b of top) {
          if (!seen.has(b.file_path)) {
            seen.add(b.file_path);
            results.push({ pickTitle: pick.title, path: b.file_path });
          }
        }
      } catch { /* skip */ }
    }
    setCoverBackdrops(results);
    setLoadingBackdrops(false);
  };

  const selectCover = async (path: string | null) => {
    if (!user) return;
    const url = path ? `https://image.tmdb.org/t/p/w1280${path}` : null;
    const { error } = await supabase.from('profiles').update({ cover_url: url }).eq('user_id', user.id);
    if (error) { toast.error('Failed to update cover'); return; }
    setCoverUrl(url);
    setCoverPickerOpen(false);
    toast.success(url ? 'Cover updated' : 'Cover removed');
  };

  const sectionLabel = (title: string) => (
    <div className="flex items-center gap-3 py-1.5">
      <Separator className="flex-1" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{title}</span>
      <Separator className="flex-1" />
    </div>
  );

  const tabBtn = (id: 'overview' | 'picks' | 'guessing', label: string, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setProfileTab(id)}
      className={`relative flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold tracking-wide transition-colors ${profileTab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80'}`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={`rounded-full px-1.5 leading-4 text-[9px] font-bold ${profileTab === id ? 'bg-primary/20 text-primary' : 'bg-muted/60 text-muted-foreground'}`}>{count}</span>
      )}
      {profileTab === id && <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-gradient-to-r from-primary to-amber-400" />}
    </button>
  );

  if (groupLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <img src={logo} alt="Loading" className="h-12 object-contain animate-pulse" />
      </div>
    );
  }

  if (!group || !userId) return null;

  // ── TABS ──────────────────────────────────────────────────────────────────

  const overviewTab = (
    <div className="space-y-4 pt-1">
      {featuredPick && featuredAvgRank !== null && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-3 flex items-center gap-3"
        >
          <div className="w-12 aspect-[2/3] rounded-xl overflow-hidden bg-muted shrink-0 ring-1 ring-primary/30 shadow-md">
            {featuredPick.poster_url
              ? <img src={featuredPick.poster_url} alt={featuredPick.title} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center"><Film className="w-4 h-4 text-muted-foreground" /></div>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-0.5 flex items-center gap-1">
              <Star className="w-3 h-3 fill-primary/80" /> Most loved pick
            </p>
            <p className="text-sm font-bold truncate">{featuredPick.title}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">avg rank {featuredAvgRank.toFixed(1)} · {featuredRankCount} ranking{featuredRankCount !== 1 ? 's' : ''}</p>
          </div>
        </motion.div>
      )}

      {/* Badges — 2-col grid */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Badges</span>
        </div>
        {earned.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {earned.map(({ badge, metricLabel }) => (
              <Popover key={badge.id}>
                <PopoverTrigger asChild>
                  <button type="button" className="rounded-xl border border-border/40 bg-muted/20 p-3 flex items-center gap-2.5 text-left hover:border-primary/30 hover:bg-primary/5 transition-colors w-full">
                    <span className="text-2xl leading-none shrink-0">{badge.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{badge.label}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{metricLabel}</p>
                    </div>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" className="max-w-[240px] p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xl leading-none">{badge.emoji}</span>
                    <p className="font-display text-sm font-bold">{badge.label}</p>
                  </div>
                  <p className="text-xs text-foreground/90">{badge.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">{metricLabel}</p>
                </PopoverContent>
              </Popover>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No badges yet — rank picks and join guessing rounds to unlock achievements.</p>
        )}
      </div>

      {overallAvg !== null && (
        <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-primary/8 to-transparent p-4 flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/20">
            <Star className="w-4 h-4 text-primary fill-primary/80" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Group ranking avg</p>
            <p className="text-xs text-muted-foreground mt-0.5">{perPickAvgs.length} pick{perPickAvgs.length !== 1 ? 's' : ''} · lower is better</p>
          </div>
          <p className="font-display text-2xl font-bold text-gradient-gold tabular-nums shrink-0">{overallAvg.toFixed(1)}</p>
        </div>
      )}

      {isOwnProfile && hasUnrankedSeasons && (
        <Button variant="outline" size="sm" className="w-full rounded-xl border-dashed" onClick={() => setPastRankingsOpen(true)}>
          <ListOrdered className="w-4 h-4 mr-2" /> Add past rankings
        </Button>
      )}

      <div className="rounded-2xl border border-border/40 bg-muted/15 p-3 sm:p-4 space-y-3">
        {sectionLabel('Club taste')}
        <RankingInsights userId={userId} groupId={group.id} profiles={profiles} variant="default" dense hideTitle />
      </div>
    </div>
  );

  const picksTab = (
    <div className="space-y-5 pt-2">
      {memberPicks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 px-4 py-10 text-center space-y-2">
          <Film className="w-10 h-10 mx-auto text-muted-foreground/35" />
          <p className="text-sm font-medium">No picks yet</p>
          <p className="text-xs text-muted-foreground">When a season starts, their choices appear here.</p>
        </div>
      ) : (
        picksSeasonGroups.map(sg => (
          <div key={sg.sn} className="space-y-2.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80 pl-0.5">{sg.label}</p>
            <div className="grid grid-cols-3 gap-x-2 gap-y-4">
              {sg.picks.map(pick => {
                const revealed = isPickRevealed(pick);
                return (
                  <div key={pick.id}>
                    <div className="aspect-[2/3] rounded-xl overflow-hidden bg-muted ring-1 ring-border/30 shadow-sm mb-1.5 hover:ring-primary/35 hover:shadow-[0_6px_24px_-6px_hsl(38_90%_55%/0.25)] transition-all duration-300">
                      {revealed
                        ? pick.poster_url
                          ? <img src={pick.poster_url} alt={pick.title} className="h-full w-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center p-1.5 bg-muted/80"><span className="text-[10px] text-muted-foreground text-center leading-tight line-clamp-4 font-medium">{pick.title}</span></div>
                        : <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-muted to-muted/60"><span className="text-xl text-muted-foreground/70 font-bold">?</span></div>}
                    </div>
                    {revealed && (
                      <div>
                        <p className="text-[11px] font-medium truncate leading-tight">{pick.title}</p>
                        {pick.year && <p className="text-[10px] text-muted-foreground">{pick.year}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );

  const guessingTab = (
    <div className="space-y-4 pt-2">
      <p className="text-xs text-muted-foreground">Who they thought picked each watched title.</p>
      {watchedPicks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 px-4 py-10 text-center space-y-2">
          <Trophy className="w-10 h-10 mx-auto text-muted-foreground/35" />
          <p className="text-sm font-medium">No guess history yet</p>
        </div>
      ) : (
        <>
          <div className="flex w-full gap-1 p-1 rounded-xl bg-muted/30 border border-border/40">
            {(['all', 'correct', 'miss', 'none'] as const).map(f => (
              <Button key={f} type="button" variant={guessFilter === f ? 'secondary' : 'ghost'} size="sm"
                className={`h-8 flex-1 text-[10px] px-2 rounded-lg capitalize ${guessFilter === f ? 'shadow-sm' : ''}`}
                onClick={() => setGuessFilter(f)}>
                {f === 'all' ? 'All' : f === 'correct' ? '✓ Correct' : f === 'miss' ? '✗ Misses' : 'No guess'}
              </Button>
            ))}
          </div>
          <div className="space-y-5">
            {guessGroupsVisible.map(grp => (
              <div key={grp.sn} className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80 pl-0.5">{grp.label}</p>
                <div className="space-y-2">
                  {grp.rows.map(m => (
                    <div key={m.pick.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${m.guess ? m.isCorrect ? 'border-green-500/25 bg-green-500/[0.07]' : 'border-destructive/20 bg-destructive/[0.06]' : 'border-border/40 bg-card/30'}`}>
                      <div className="w-10 aspect-[2/3] rounded-lg overflow-hidden bg-muted shrink-0 ring-1 ring-border/30 shadow-sm">
                        {m.pick.poster_url ? <img src={m.pick.poster_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Film className="w-3.5 h-3.5 text-muted-foreground" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate leading-snug">{m.pick.title}</p>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                          {m.guess ? (<><span className="text-muted-foreground">Guessed</span><span className={`font-semibold ${m.isCorrect ? 'text-green-400' : 'text-destructive'}`}>{m.guessedName}</span>{m.isCorrect ? <Check className="w-3.5 h-3.5 text-green-400 shrink-0" /> : <X className="w-3.5 h-3.5 text-destructive shrink-0" />}</>)
                            : m.isOwnPick ? <span className="text-primary/75 italic">Their pick</span>
                            : <span className="text-muted-foreground italic">No guess</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {guessGroups.length > 2 && (
            <Button variant="outline" size="sm" className="w-full h-9 text-xs rounded-xl" onClick={() => setGuessOlderExpanded(e => !e)}>
              {guessOlderExpanded ? 'Show fewer seasons' : `Show ${guessGroups.length - 2} older season${guessGroups.length - 2 === 1 ? '' : 's'}`}
            </Button>
          )}
        </>
      )}
    </div>
  );

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-xl border-b border-border/40">
        <div className="flex items-center gap-2 px-3 py-3 max-w-2xl mx-auto">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-display font-bold text-base truncate flex-1">{profile?.display_name || 'Profile'}</h1>
          {isOwnProfile && (
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" onClick={() => fileInputRef.current?.click()} title="Change photo">
              <Camera className="w-4 h-4" />
            </Button>
          )}
        </div>
      </header>

      {/* Hero */}
      <div className="relative h-52 overflow-hidden bg-muted/30">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        ) : coverPosters.length > 0 ? (
          <div className="absolute inset-0 flex opacity-45">
            {coverPosters.map(p => (
              <div key={p.id} className="flex-1 h-full overflow-hidden">
                <img src={p.poster_url!} alt="" className="h-full w-full object-cover blur-sm scale-110" />
              </div>
            ))}
          </div>
        ) : null}
        <div className={`absolute inset-0 bg-gradient-to-br ${coverUrl ? 'from-black/40 via-black/10' : coverAccentClass} to-background`} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_80%_at_50%_-30%,hsl(38_90%_55%/0.25),transparent_60%)]" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />
        {isOwnProfile && (
          <button
            type="button"
            onClick={openCoverPicker}
            className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-sm px-3 py-1.5 text-[11px] font-medium text-white hover:bg-black/70 transition-colors"
          >
            <Camera className="w-3 h-3" />
            {coverUrl ? 'Change cover' : 'Add cover'}
          </button>
        )}
      </div>

      {/* Profile info — overlaps hero */}
      <div className="relative z-10 -mt-20 px-4 max-w-2xl mx-auto w-full">
        <div className="flex items-end gap-4 mb-4">
          {/* Avatar */}
          <div className="relative shrink-0">
            <div
              className={`w-24 h-24 rounded-2xl overflow-hidden bg-card ring-[3px] ring-background shadow-[0_12px_40px_-12px_rgba(0,0,0,0.65)] ${!isOwnProfile && profile?.avatar_url ? 'cursor-zoom-in' : ''}`}
              onClick={() => !isOwnProfile && profile?.avatar_url && setPreviewAvatarUrl(profile.avatar_url)}
            >
              {profile?.is_placeholder ? (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <span className="text-3xl">👤</span>
                </div>
              ) : profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/25 to-muted text-3xl font-bold text-primary">
                  {profile?.display_name?.charAt(0).toUpperCase() || '?'}
                </div>
              )}
            </div>
            {isOwnProfile && profile?.avatar_url && (
              <button
                type="button"
                onClick={() => openCropWithUrl(profile.avatar_url!)}
                className="absolute -bottom-1 -right-1 z-10 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg border-2 border-background hover:bg-primary/90 transition-colors"
                title="Crop photo"
              >
                <Crop className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Name + meta */}
          <div className="pb-1 min-w-0 flex-1">
            <h2 className="font-display text-2xl font-bold leading-tight truncate">{profile?.display_name || 'Unknown'}</h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
              {isGroupAdmin && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary border border-primary/25">
                  <Crown className="w-2.5 h-2.5" /> Admin
                </span>
              )}
              {memberSince && <span className="text-xs text-muted-foreground">Since {memberSince}</span>}
              {seasonsParticipated > 0 && (
                <span className="text-xs text-muted-foreground">· {seasonsParticipated} season{seasonsParticipated !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
        </div>

        {/* Color-coded stat tiles */}
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-3 text-center">
            <p className="font-display text-xl font-bold text-violet-400 tabular-nums">{memberPicks.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{isBookClub ? 'Books' : 'Picks'}</p>
          </div>
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
            <p className="font-display text-xl font-bold text-amber-400 tabular-nums">{earned.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Badges</p>
          </div>
          <div className={`rounded-xl border p-3 text-center ${accuracyTileClass}`}>
            <p className={`font-display text-xl font-bold tabular-nums ${accuracyTextClass}`}>{total > 0 ? `${pct}%` : '—'}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Accuracy</p>
          </div>
        </div>
      </div>

      {/* Sticky tabs */}
      <div className="sticky top-[52px] z-40 bg-background/90 backdrop-blur-xl border-b border-border/40 mt-3">
        <div className="flex max-w-2xl mx-auto px-2">
          {tabBtn('overview', 'Overview')}
          {tabBtn('picks', isBookClub ? 'Books' : 'Picks', memberPicks.length)}
          {tabBtn('guessing', 'Guessing', watchedPicks.length)}
        </div>
      </div>

      {/* Tab content */}
      <main className="flex-1 px-4 pt-4 pb-24 max-w-2xl mx-auto w-full">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={profileTab}
            initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {profileTab === 'overview' && overviewTab}
            {profileTab === 'picks' && picksTab}
            {profileTab === 'guessing' && guessingTab}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Hidden file input */}
      {isOwnProfile && <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />}

      {/* Crop dialog */}
      <Dialog open={cropDialogOpen} onOpenChange={open => { if (!open) { setCropDialogOpen(false); setCropImageSrc(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Crop Profile Photo</DialogTitle></DialogHeader>
          {cropImageSrc && (
            <div className="flex flex-col gap-4">
              <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCrop(c)} aspect={1} circularCrop>
                <img ref={cropImgRef} src={cropImageSrc} onLoad={onCropImageLoad} alt="Crop" className="max-h-64 w-full object-contain" />
              </ReactCrop>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setCropDialogOpen(false); setCropImageSrc(null); }}>Cancel</Button>
                <Button className="flex-1" onClick={handleSaveCrop} disabled={uploading}>{uploading ? 'Saving…' : 'Save'}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Avatar preview */}
      <Dialog open={!!previewAvatarUrl} onOpenChange={open => !open && setPreviewAvatarUrl(null)}>
        <DialogContent className="max-w-xs p-2">
          <DialogHeader><DialogTitle className="sr-only">Avatar</DialogTitle></DialogHeader>
          {previewAvatarUrl && <img src={previewAvatarUrl} alt="" className="w-full rounded-xl object-cover" />}
        </DialogContent>
      </Dialog>

      {/* Past rankings */}
      {isOwnProfile && <PastRankingsDialog open={pastRankingsOpen} onOpenChange={setPastRankingsOpen} groupId={group.id} profiles={profiles} onUpdate={() => {}} />}

      {/* Cover picker */}
      <Dialog open={coverPickerOpen} onOpenChange={open => !open && setCoverPickerOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose a cover photo</DialogTitle>
          </DialogHeader>
          {loadingBackdrops ? (
            <div className="text-center text-muted-foreground py-10 text-sm">Loading backdrops…</div>
          ) : coverBackdrops.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">No backdrops found. Watch more movies to unlock cover options!</div>
          ) : (
            <div className="space-y-3 max-h-[65vh] overflow-y-auto py-1">
              {coverUrl && (
                <button
                  onClick={() => selectCover(null)}
                  className="w-full text-xs text-destructive hover:text-destructive/80 py-1 transition-colors"
                >
                  Remove current cover
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                {coverBackdrops.map((b, idx) => (
                  <button
                    key={idx}
                    onClick={() => selectCover(b.path)}
                    className="group relative rounded-xl overflow-hidden aspect-video hover:ring-2 hover:ring-primary transition-all focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <img
                      src={`https://image.tmdb.org/t/p/w780${b.path}`}
                      alt={b.pickTitle}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                      <p className="text-[10px] text-white font-medium truncate">{b.pickTitle}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MemberProfile;
