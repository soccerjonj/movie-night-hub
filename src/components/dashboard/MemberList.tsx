import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { Group, GroupMember, Profile } from '@/hooks/useGroup';
import { Users, Crown, Ghost, Film, Check, X, Trophy, Camera, Crop, ListOrdered, Star, Award, Clock, Sparkles, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import ReactCrop, { type Crop as CropType, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import PastRankingsDialog from './PastRankingsDialog';
import RankingInsights from './RankingInsights';
import { validateImageFile, getSafeErrorMessage, safeFilename } from '@/lib/security';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { computeMemberBadges, computeCasualViewerBadges, type BadgePickInput, type EarnedBadge } from '@/lib/memberBadges';
import { motion } from 'framer-motion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import ClubStatNumber from '@/components/dashboard/ClubStatNumber';

interface Props {
  members: GroupMember[];
  profiles: Profile[];
  group: Group;
  isAdmin: boolean;
  onUpdate: () => void;
  externalSelectedUserId?: string | null;
  onExternalSelectedClear?: () => void;
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

function centerAspectCrop(mediaWidth: number, mediaHeight: number) {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, 1, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight
  );
}

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] as number[] },
  }),
};

/** Rotating banner accents so member tiles feel unique (admin gets gold). */
const MEMBER_BANNER_ACCENTS = [
  'from-violet-500/45 via-primary/25 to-background',
  'from-sky-500/40 via-cyan-500/10 to-background',
  'from-rose-500/40 via-primary/20 to-background',
  'from-emerald-500/40 via-teal-500/10 to-background',
  'from-fuchsia-500/35 via-primary/15 to-background',
] as const;

const MemberList = ({ members, profiles, group, isAdmin, onUpdate, externalSelectedUserId, onExternalSelectedClear }: Props) => {
  const { user } = useAuth();
  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [previewAvatarUrl, setPreviewAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (externalSelectedUserId) setSelectedUserId(externalSelectedUserId);
  }, [externalSelectedUserId]);

  const handleClose = () => {
    setSelectedUserId(null);
    onExternalSelectedClear?.();
  };

  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [rankings, setRankings] = useState<{ user_id: string; movie_pick_id: string; rank: number; season_id: string }[]>([]);
  const [seasonParticipants, setSeasonParticipants] = useState<{ user_id: string; season_id: string }[]>([]);
  const [tmdbDetails, setTmdbDetails] = useState<Record<string, TmdbDetails>>({});
  const [loading, setLoading] = useState(false);

  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropType>();
  const [uploading, setUploading] = useState(false);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pastRankingsOpen, setPastRankingsOpen] = useState(false);
  const [hasUnrankedSeasons, setHasUnrankedSeasons] = useState(false);
  const isDesktopProfile = useMediaQuery('(min-width: 1024px)');
  const [profileTab, setProfileTab] = useState<'overview' | 'picks' | 'guessing'>('overview');
  const [badgeIntroPlayed, setBadgeIntroPlayed] = useState(
    () => typeof window !== 'undefined' && sessionStorage.getItem('mnh_badge_intro') === '1'
  );

  const [guessFilter, setGuessFilter] = useState<'all' | 'correct' | 'miss' | 'none'>('all');
  const [guessOlderExpanded, setGuessOlderExpanded] = useState(false);

  useEffect(() => {
    setProfileTab('overview');
    setGuessFilter('all');
    setGuessOlderExpanded(false);
  }, [selectedUserId]);

  useEffect(() => {
    if (!user) return;
    const checkUnranked = async () => {
      const { data: completedSeasons } = await supabase
        .from('seasons').select('id').eq('group_id', group.id).in('status', ['completed', 'reviewing']);
      if (!completedSeasons || completedSeasons.length === 0) { setHasUnrankedSeasons(false); return; }
      const { data: existingRankings } = await supabase
        .from('movie_rankings').select('season_id').eq('user_id', user.id)
        .in('season_id', completedSeasons.map(s => s.id));
      const rankedIds = new Set((existingRankings || []).map(r => r.season_id));
      setHasUnrankedSeasons(completedSeasons.some(s => !rankedIds.has(s.id)));
    };
    checkUnranked();
  }, [user, group.id, pastRankingsOpen]);

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
      onUpdate(); setCropDialogOpen(false); setCropImageSrc(null);
    } catch (err: unknown) {
      toast.error(getSafeErrorMessage(err, 'Failed to upload'));
    } finally { setUploading(false); }
  };

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

  const isPickRevealed = (pick: PickRow) => isPickWatched(pick);

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

  const selectedBadgeCount = selectedUserId ? (allMemberBadgesMap.get(selectedUserId)?.length ?? 0) : 0;
  useEffect(() => {
    if (!selectedUserId || selectedBadgeCount === 0 || badgeIntroPlayed) return;
    const t = window.setTimeout(() => {
      sessionStorage.setItem('mnh_badge_intro', '1');
      setBadgeIntroPlayed(true);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [selectedUserId, selectedBadgeCount, badgeIntroPlayed]);

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

  const renderMemberProfile = () => {
    if (!selectedUserId) return null;
    const profile = getProfile(selectedUserId);
    const isOwnProfile = user?.id === selectedUserId;

    const memberPicks = picks
      .filter(p => p.user_id === selectedUserId)
      .sort((a, b) => {
        const sA = seasons.find(s => s.id === a.season_id)?.season_number ?? 0;
        const sB = seasons.find(s => s.id === b.season_id)?.season_number ?? 0;
        if (sA !== sB) return sB - sA;
        return (b.watch_order ?? 0) - (a.watch_order ?? 0);
      });

    const userGuesses = guesses.filter(g => g.guesser_id === selectedUserId);
    let correct = 0, total = 0;
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
    userGuesses.forEach(g => {
      if (pickValidUsers[g.movie_pick_id]) {
        total += 1;
        if (pickValidUsers[g.movie_pick_id].has(g.guessed_user_id)) correct += 1;
      }
    });
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

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

    const earned = allMemberBadgesMap.get(selectedUserId) || [];

    // Avg pick ranking
    const mPicks = picks.filter(p => p.user_id === selectedUserId);
    const pickById = new Map(picks.map(p => [p.id, p]));
    const getSlotKey = (pick: PickRow) => `${pick.season_id}:${pick.watch_order ?? pick.id}`;
    const memberSlotKeys = new Set(mPicks.map(p => getSlotKey(p)));
    const slotRankings = new Map<string, { total: number; count: number }>();
    rankings.forEach(r => {
      const pick = pickById.get(r.movie_pick_id);
      if (!pick) return;
      const slotKey = getSlotKey(pick);
      if (!memberSlotKeys.has(slotKey)) return;
      if (!slotRankings.has(slotKey)) slotRankings.set(slotKey, { total: 0, count: 0 });
      const entry = slotRankings.get(slotKey)!;
      entry.total += r.rank; entry.count += 1;
    });
    const perPickAvgs = Array.from(slotRankings.values()).map(v => v.total / v.count);
    const overallAvg = perPickAvgs.length > 0 ? perPickAvgs.reduce((s, v) => s + v, 0) / perPickAvgs.length : null;

    const profileDisplayName = profile?.display_name || 'Unknown';
    const seasonNumForPick = (pick: PickRow) => seasons.find(s => s.id === pick.season_id)?.season_number ?? 0;
    const seasonHeading = (sn: number) => {
      const s = seasons.find(ss => ss.season_number === sn);
      return s?.title ? `Season ${sn} — ${s.title}` : `Season ${sn}`;
    };

    type GuessMeta = { pick: PickRow; guess?: GuessRow; guessedName: string | null; isCorrect: boolean; isOwnPick: boolean };
    const guessMetasRaw: GuessMeta[] = uniqueWatched.map(pick => {
      const siblingPicks = picks.filter(p => p.season_id === pick.season_id && p.watch_order === pick.watch_order);
      const validUserIds = new Set(siblingPicks.map(sp => sp.user_id));
      const isOwnPick = validUserIds.has(selectedUserId);
      const guess = userGuesses.find(g => g.movie_pick_id === pick.id) || userGuesses.find(g => siblingPicks.some(sp => sp.id === g.movie_pick_id));
      const guessedName = guess ? getProfile(guess.guessed_user_id)?.display_name || '?' : null;
      const isCorrect = guess ? validUserIds.has(guess.guessed_user_id) : false;
      return { pick, guess, guessedName, isCorrect, isOwnPick };
    });
    const guessMetas = guessMetasRaw.filter(m => {
      if (guessFilter === 'all') return true;
      if (guessFilter === 'correct') return !!m.guess && m.isCorrect;
      if (guessFilter === 'miss') return !!m.guess && !m.isCorrect;
      if (guessFilter === 'none') return !m.guess && !m.isOwnPick;
      return true;
    });
    const seasonNums = [...new Set(guessMetas.map(m => seasonNumForPick(m.pick)))].sort((a, b) => b - a);
    const guessGroups = seasonNums.map(sn => ({
      sn,
      label: seasonHeading(sn),
      rows: guessMetas.filter(m => seasonNumForPick(m.pick) === sn),
    }));
    const guessGroupsVisible = guessOlderExpanded ? guessGroups : guessGroups.slice(0, 2);

    const sectionLabel = (title: string) => (
      <div className="flex items-center gap-3 py-1.5">
        <Separator className="flex-1" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{title}</span>
        <Separator className="flex-1" />
      </div>
    );

    const tabBtn = (id: 'overview' | 'picks' | 'guessing', label: string) => (
      <button
        key={id}
        type="button"
        onClick={() => setProfileTab(id)}
        className={`relative min-w-0 flex-1 sm:flex-none px-2 sm:px-3 py-2.5 text-xs font-semibold tracking-wide transition-colors ${
          profileTab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/90'
        }`}
      >
        {label}
        {profileTab === id && (
          <span className="absolute bottom-0 left-2 right-2 sm:left-3 sm:right-3 h-0.5 rounded-full bg-gradient-to-r from-primary to-amber-400" />
        )}
      </button>
    );

    const profileHero = (
      <div className="relative w-full min-w-0">
        <div className="relative h-32 sm:h-36 overflow-hidden bg-muted/30">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/40 via-primary/10 to-background" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_80%_at_50%_-30%,hsl(38_90%_55%/0.35),transparent_55%)]" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background via-background/80 to-transparent" />
        </div>
        <div className="relative z-10 px-3 sm:px-4 -mt-16 sm:-mt-[4.5rem] pb-1">
          {/* Mobile: side-by-side so stats use full width; sm+: original row with avatar */}
          <div className="flex w-full min-w-0 flex-row items-start gap-3 sm:items-end sm:gap-5">
            <div className="relative shrink-0">
              <div
                className={`relative w-[5.5rem] h-[5.5rem] sm:w-28 sm:h-28 rounded-[1.35rem] overflow-hidden bg-card ring-[3px] ring-background shadow-[0_12px_40px_-12px_rgba(0,0,0,0.65)] ${!isOwnProfile && profile?.avatar_url ? 'cursor-zoom-in' : ''}`}
              >
                {isOwnProfile ? (
                  <div className="relative w-full h-full group/avatar">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl sm:text-4xl font-bold bg-gradient-to-br from-primary/25 to-muted text-primary">
                        {profile?.display_name?.charAt(0).toUpperCase() || '?'}
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 group-hover/avatar:opacity-100 active:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 rounded-full bg-background/90 text-foreground shadow-md"
                        aria-label="Change profile photo"
                      >
                        <Camera className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="relative block w-full h-full text-left"
                    onClick={() => { if (profile?.avatar_url) setPreviewAvatarUrl(profile.avatar_url); }}
                  >
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl sm:text-4xl font-bold bg-gradient-to-br from-primary/25 to-muted text-primary">
                        {profile?.display_name?.charAt(0).toUpperCase() || '?'}
                      </div>
                    )}
                  </button>
                )}
                {isOwnProfile && profile?.avatar_url && (
                  <button
                    type="button"
                    onClick={() => openCropWithUrl(profile.avatar_url!)}
                    className="absolute -bottom-1 -right-1 z-10 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg border-2 border-background hover:bg-primary/90 transition-colors"
                    title="Crop photo"
                  >
                    <Crop className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-left sm:pb-1">
              <div>
                <h2 className="font-display text-xl leading-tight sm:text-3xl font-bold tracking-tight text-foreground break-words">{profileDisplayName}</h2>
                <div className="mt-1.5 flex flex-wrap items-center justify-start gap-2">
                  {selectedUserId === group.admin_user_id && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium text-primary border border-primary/25">
                      <Crown className="w-3 h-3" /> Admin
                    </span>
                  )}
                  {profile?.is_placeholder && (
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground border border-border/60">Unregistered</span>
                  )}
                </div>
              </div>
              <div className="grid w-full min-w-0 grid-cols-3 rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden divide-x divide-border/40 shadow-sm sm:max-w-sm">
                <div className="py-2.5 px-1 sm:px-1.5 text-center min-w-0">
                  <p className="font-display text-base sm:text-xl font-bold text-foreground tabular-nums">{memberPicks.length}</p>
                  <p className="text-[9px] sm:text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-tight">{isBookClub ? 'Books' : 'Picks'}</p>
                </div>
                <div className="py-2.5 px-1 sm:px-1.5 text-center min-w-0">
                  <p className="font-display text-base sm:text-xl font-bold text-foreground tabular-nums">{earned.length}</p>
                  <p className="text-[9px] sm:text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Badges</p>
                </div>
                <div className="py-2.5 px-1 sm:px-1.5 text-center min-w-0">
                  <p className={`font-display text-base sm:text-xl font-bold tabular-nums ${total > 0 ? (pct >= 50 ? 'text-gradient-gold' : 'text-foreground') : 'text-muted-foreground'}`}>
                    {total > 0 ? `${pct}%` : '—'}
                  </p>
                  <p className="text-[9px] sm:text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-tight">Guess hit</p>
                </div>
              </div>
              {total > 0 && (
                <p className="text-[11px] text-muted-foreground text-left">
                  <span className="text-green-400 font-medium">{correct}</span> correct · <span className="text-foreground/80 font-medium">{total}</span> guessed · this club
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );

    const stickyTabs = (
      <div className="sticky top-0 z-20 w-full min-w-0 bg-background/90 backdrop-blur-xl border-b border-border/40 px-0 sm:px-2">
        <div className="flex w-full min-w-0 justify-stretch sm:justify-start gap-0 sm:gap-1">
          {tabBtn('overview', 'Overview')}
          {tabBtn('picks', 'Picks')}
          {tabBtn('guessing', 'Guessing')}
        </div>
      </div>
    );

    const badgeChip = (badgeIntro: boolean) => (
      badgeIntro ? (
        <div className="flex flex-wrap items-center gap-1">
          {earned.map(({ badge, metricLabel }) => (
            <Popover key={badge.id}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground/90 hover:border-primary/40 hover:bg-primary/5 transition-colors max-w-[140px] sm:max-w-[180px]"
                >
                  <span className="text-[11px] leading-none shrink-0">{badge.emoji}</span>
                  <span className="truncate">{badge.label}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" className="max-w-[240px] p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base leading-none">{badge.emoji}</span>
                  <p className="font-display text-sm font-bold">{badge.label}</p>
                </div>
                <p className="text-xs">{badge.description}</p>
                <p className="text-xs text-muted-foreground mt-1">{metricLabel}</p>
              </PopoverContent>
            </Popover>
          ))}
        </div>
      ) : (
        <motion.div className="flex flex-wrap items-center gap-1" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.04 } } }}>
          {earned.map(({ badge, metricLabel }) => (
            <motion.div key={badge.id} variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] } } }}>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground/90 hover:border-primary/40 hover:bg-primary/5 transition-colors max-w-[140px] sm:max-w-[180px]"
                  >
                    <span className="text-[11px] leading-none shrink-0">{badge.emoji}</span>
                    <span className="truncate">{badge.label}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" className="max-w-[240px] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base leading-none">{badge.emoji}</span>
                    <p className="font-display text-sm font-bold">{badge.label}</p>
                  </div>
                  <p className="text-xs">{badge.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">{metricLabel}</p>
                </PopoverContent>
              </Popover>
            </motion.div>
          ))}
        </motion.div>
      )
    );

    const overviewTab = (
      <div className="min-w-0 space-y-5 pt-1">
        <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-3.5 sm:p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-primary shrink-0" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Badges</span>
          </div>
          {earned.length > 0 ? (
            badgeChip(badgeIntroPlayed)
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">No badges yet — rank picks and join guessing rounds to unlock achievements.</p>
          )}
        </div>

        {overallAvg !== null && (
          <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-primary/8 to-transparent p-4 flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/20">
              <Star className="w-5 h-5 text-primary fill-primary/80" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">How the group ranks their picks</p>
              <p className="text-xs text-muted-foreground mt-0.5">{perPickAvgs.length} pick{perPickAvgs.length !== 1 ? 's' : ''} with rankings · lower avg is better</p>
            </div>
            <p className="font-display text-2xl font-bold text-gradient-gold tabular-nums shrink-0">{overallAvg.toFixed(1)}</p>
          </div>
        )}

        {isOwnProfile && hasUnrankedSeasons && (
          <Button variant="outline" size="sm" className="w-full rounded-xl border-dashed" onClick={() => setPastRankingsOpen(true)}>
            <ListOrdered className="w-4 h-4 mr-2" />
            Add past rankings
          </Button>
        )}

        <div className="rounded-2xl border border-border/40 bg-muted/15 p-3 sm:p-4 space-y-3">
          {sectionLabel('Club taste')}
          <RankingInsights userId={selectedUserId} groupId={group.id} profiles={profiles} variant="default" dense hideTitle />
        </div>
      </div>
    );

    const picksTab = (
      <div className="min-w-0 space-y-4 pt-2">
        <p className="text-xs text-muted-foreground text-left">Posters from every season they chose a title.</p>
        {memberPicks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 px-4 py-10 text-center space-y-2">
            <Film className="w-10 h-10 mx-auto text-muted-foreground/35" />
            <p className="text-sm font-medium text-foreground/90">No picks yet</p>
            <p className="text-xs text-muted-foreground w-full text-left">When a season starts, their choices appear here like a gallery.</p>
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-4 gap-2 sm:grid-cols-4 sm:gap-2.5">
            {memberPicks.map(pick => {
              const revealed = isPickRevealed(pick);
              return (
                <div
                  key={pick.id}
                  className="group aspect-[2/3] rounded-xl overflow-hidden bg-muted ring-1 ring-border/30 shadow-sm transition-all duration-300 hover:ring-primary/35 hover:shadow-[0_8px_28px_-8px_hsl(38_90%_55%/0.25)]"
                >
                  {revealed
                    ? pick.poster_url
                      ? <img src={pick.poster_url} alt={pick.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                      : <div className="w-full h-full flex items-center justify-center p-1.5 bg-muted/80"><span className="text-[10px] text-muted-foreground text-center leading-tight line-clamp-4 font-medium">{pick.title}</span></div>
                    : <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-muted to-muted/60"><span className="text-xl text-muted-foreground/70 font-bold">?</span></div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );

    const guessingTab = (
      <div className="min-w-0 space-y-4 pt-2">
        <p className="text-xs text-muted-foreground text-left">Who they thought picked each watched title.</p>
        {uniqueWatched.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 px-4 py-10 text-center space-y-2">
            <Trophy className="w-10 h-10 mx-auto text-muted-foreground/35" />
            <p className="text-sm font-medium text-foreground/90">No guess history yet</p>
            <p className="text-xs text-muted-foreground w-full text-left">Shows up once your club has finished watches with guessing turned on.</p>
          </div>
        ) : (
          <>
            <div className="flex w-full min-w-0 flex-wrap justify-stretch gap-1 p-1 rounded-xl bg-muted/30 border border-border/40 sm:justify-start">
              {(['all', 'correct', 'miss', 'none'] as const).map(f => (
                <Button
                  key={f}
                  type="button"
                  variant={guessFilter === f ? 'secondary' : 'ghost'}
                  size="sm"
                  className={`h-8 min-w-0 flex-1 text-[10px] sm:text-[11px] px-2 sm:px-3 rounded-lg capitalize sm:flex-none ${guessFilter === f ? 'shadow-sm' : ''}`}
                  onClick={() => setGuessFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'correct' ? 'Correct' : f === 'miss' ? 'Misses' : 'No guess'}
                </Button>
              ))}
            </div>
            <div className="space-y-5">
              {guessGroupsVisible.map(group => (
                <div key={group.sn} className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80 pl-0.5">{group.label}</p>
                  <div className="space-y-2">
                    {group.rows.map(m => (
                      <div
                        key={m.pick.id}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                          m.guess
                            ? m.isCorrect
                              ? 'border-green-500/25 bg-green-500/[0.07]'
                              : 'border-destructive/20 bg-destructive/[0.06]'
                            : 'border-border/40 bg-card/30'
                        }`}
                      >
                        <div className="w-10 aspect-[2/3] rounded-lg overflow-hidden bg-muted shrink-0 ring-1 ring-border/30 shadow-sm">
                          {m.pick.poster_url
                            ? <img src={m.pick.poster_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center"><Film className="w-3.5 h-3.5 text-muted-foreground" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate leading-snug">{m.pick.title}</p>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                            {m.guess ? (
                              <>
                                <span className="text-muted-foreground">Guessed</span>
                                <span className={`font-semibold ${m.isCorrect ? 'text-green-400' : 'text-destructive'}`}>{m.guessedName}</span>
                                {m.isCorrect ? <Check className="w-3.5 h-3.5 text-green-400 shrink-0" /> : <X className="w-3.5 h-3.5 text-destructive shrink-0" />}
                              </>
                            ) : m.isOwnPick ? (
                              <span className="text-primary/75 italic">Their pick</span>
                            ) : (
                              <span className="text-muted-foreground italic">No guess</span>
                            )}
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

    return (
      <div className="min-w-0 max-w-full space-y-0 overflow-x-hidden -mx-4">
        {profileHero}
        {stickyTabs}
        <div className="min-w-0 w-full px-3 pt-4 pb-3 sm:px-4">
          {profileTab === 'overview' && overviewTab}
          {profileTab === 'picks' && picksTab}
          {profileTab === 'guessing' && guessingTab}
        </div>
      </div>
    );
  };

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

  const statItems: { value: number | string; label: string; icon: ReactNode; numeric: boolean }[] = [
    { value: clubStats.memberCount, label: 'members', icon: <Users className="w-3.5 h-3.5 text-primary" />, numeric: true },
    { value: clubStats.completedSeasons, label: 'seasons done', icon: <Trophy className="w-3.5 h-3.5 text-primary" />, numeric: true },
    { value: clubStats.totalWatched, label: watchedNoun, icon: <Film className="w-3.5 h-3.5 text-primary" />, numeric: true },
    runtimeStr && runtimeNoun
      ? { value: runtimeStr, label: runtimeNoun, icon: <Clock className="w-3.5 h-3.5 text-primary" />, numeric: false }
      : { value: seasons.length, label: 'total seasons', icon: <Star className="w-3.5 h-3.5 text-primary" />, numeric: true },
  ];

  const profileSheetTitle = selectedUserId ? (getProfile(selectedUserId)?.display_name || 'Member profile') : 'Member profile';

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
          <div className="mb-3 sm:mb-4">
            <h2 className="font-display text-xl sm:text-2xl font-bold truncate">{group.name}</h2>
            {foundedDate && <p className="text-xs text-muted-foreground mt-0.5">Founded {foundedDate}</p>}
          </div>
          {activityBlurb && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-start gap-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5 mb-3"
            >
              <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{activityBlurb.line}</p>
                <p className="text-sm font-medium text-foreground truncate">{activityBlurb.sub}</p>
              </div>
            </motion.div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {statItems.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-xl bg-muted/20 border border-border/30 p-3"
              >
                <div className="flex items-center gap-1.5 mb-1.5">{stat.icon}<span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</span></div>
                {stat.numeric && typeof stat.value === 'number' ? (
                  <ClubStatNumber value={stat.value} className="font-display text-lg sm:text-xl font-bold text-primary" />
                ) : (
                  <p className="font-display text-lg sm:text-xl font-bold text-primary">{stat.value}</p>
                )}
              </motion.div>
            ))}
          </div>
          {milestoneHint && (
            <p className="text-[11px] text-muted-foreground mt-3 text-center sm:text-left">{milestoneHint}</p>
          )}
        </div>
      </motion.div>

      {/* Member preview wall — social-style tiles */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card relative mt-4 sm:mt-6 overflow-hidden rounded-3xl border border-border/50 p-4 sm:p-6"
      >
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -left-12 bottom-0 h-40 w-40 rounded-full bg-amber-500/8 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="mb-5 sm:mb-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary shrink-0" />
                  <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">The crew</h2>
                </div>
                <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                  Tap anyone for picks, badges, taste insights, and guess history — same energy as their full profile.
                </p>
              </div>
              <span className="rounded-full bg-muted/50 border border-border/50 px-3 py-1 text-[11px] font-medium text-muted-foreground tabular-nums shrink-0">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </span>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member, i) => {
              const profile = getProfile(member.user_id);
              const isGroupAdmin = member.user_id === group.admin_user_id;
              const isPlaceholder = profile?.is_placeholder === true;
              const isOwnCard = member.user_id === user?.id;
              const earned = allMemberBadgesMap.get(member.user_id) || [];
              const bannerAccent = isGroupAdmin
                ? 'from-amber-500/50 via-primary/35 to-background'
                : MEMBER_BANNER_ACCENTS[i % MEMBER_BANNER_ACCENTS.length];
              const emojiStrip = earned.slice(0, 6);
              const moreBadges = earned.length - emojiStrip.length;
              return (
                <motion.button
                  key={member.id}
                  type="button"
                  custom={i}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  onClick={() => setSelectedUserId(member.user_id)}
                  className={`group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    isPlaceholder
                      ? 'border-dashed border-border/60 bg-muted/15 hover:border-border hover:bg-muted/25'
                      : 'border-border/45 bg-card/55 hover:border-primary/35 hover:bg-card/80 hover:shadow-[0_16px_48px_-16px_hsl(38_90%_55%/0.22)]'
                  }`}
                >
                  <div className={`relative h-16 shrink-0 bg-gradient-to-br sm:h-[4.25rem] ${bannerAccent}`}>
                    <div className="absolute inset-0 bg-gradient-to-t from-card/90 to-transparent" />
                    {isGroupAdmin && (
                      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold text-primary shadow-sm ring-1 ring-primary/25 backdrop-blur-sm">
                        <Crown className="w-3 h-3" /> Host
                      </div>
                    )}
                  </div>
                  <div className="relative -mt-9 flex flex-col items-center px-3 pb-3 pt-0">
                    <div className="relative">
                      <div
                        className={`relative h-[4.25rem] w-[4.25rem] shrink-0 overflow-hidden rounded-2xl shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] ring-[3px] ${
                          isPlaceholder ? 'bg-muted ring-border/50' : 'bg-card ring-background'
                        } ${isGroupAdmin ? 'ring-primary/35' : ''}`}
                      >
                        {isPlaceholder ? (
                          <div className="flex h-full w-full items-center justify-center">
                            <Ghost className="h-8 w-8 text-muted-foreground/60" />
                          </div>
                        ) : profile?.avatar_url ? (
                          <img src={profile.avatar_url} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 to-muted text-xl font-bold text-primary">
                            {profile?.display_name?.charAt(0).toUpperCase() || '?'}
                          </div>
                        )}
                      </div>
                      {isOwnCard && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                          className="absolute -bottom-1 -right-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105 active:scale-95"
                          title="Change photo"
                        >
                          <Camera className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="mt-2.5 w-full truncate text-center font-display text-base font-bold tracking-tight text-foreground sm:text-lg">
                      {profile?.display_name || 'Unknown'}
                    </p>
                    {isPlaceholder ? (
                      <span className="mt-1 text-[11px] text-muted-foreground">Invite pending</span>
                    ) : (
                      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/80 opacity-80 group-hover:text-primary group-hover:opacity-100 transition-colors">
                        View profile
                      </span>
                    )}
                    {!isPlaceholder && emojiStrip.length > 0 && (
                      <div className="mt-2.5 flex max-w-full flex-wrap items-center justify-center gap-1.5 px-1" aria-hidden>
                        {emojiStrip.map(({ badge }) => (
                          <span
                            key={badge.id}
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-background/90 text-lg shadow-sm ring-1 ring-border/40 transition-transform group-hover:scale-105"
                            title={badge.label}
                          >
                            {badge.emoji}
                          </span>
                        ))}
                        {moreBadges > 0 && (
                          <span className="flex h-8 min-w-8 items-center justify-center rounded-xl bg-primary/15 px-1.5 text-[11px] font-bold text-primary ring-1 ring-primary/25">
                            +{moreBadges}
                          </span>
                        )}
                      </div>
                    )}
                    {!isPlaceholder && (
                      <div className="mt-3 flex w-full items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-primary">
                        <span>Explore</span>
                        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* Profile — dialog on large screens, bottom sheet on small */}
      {isDesktopProfile ? (
        <Dialog open={!!selectedUserId} onOpenChange={(open) => !open && handleClose()}>
          <DialogContent className="max-w-lg w-[calc(100%-1.5rem)] max-h-[min(88vh,720px)] p-0 gap-0 flex flex-col overflow-hidden rounded-2xl">
            <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/40 shrink-0 text-left space-y-1 min-w-0">
              <DialogTitle className="font-display text-lg pr-8">{profileSheetTitle}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Member profile, stats, picks, and guessing history for this club.
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0 overflow-x-hidden overflow-y-auto flex-1 px-3 pb-6 pt-1 sm:px-4">
              {loading
                ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
                : renderMemberProfile()}
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={!!selectedUserId} onOpenChange={(open) => !open && handleClose()} shouldScaleBackground={false}>
          <DrawerContent className="max-h-[88vh] outline-none flex flex-col overflow-x-hidden">
            <DrawerTitle className="sr-only">{profileSheetTitle}</DrawerTitle>
            <DrawerDescription className="sr-only">
              Member profile for this club. Swipe down to close.
            </DrawerDescription>
            <div className="min-w-0 overflow-x-hidden overflow-y-auto flex-1 px-3 pb-8 pt-1 sm:px-4">
              {loading
                ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
                : renderMemberProfile()}
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />

      {/* Crop dialog */}
      <Dialog open={cropDialogOpen} onOpenChange={(open) => { if (!uploading) { setCropDialogOpen(open); if (!open) setCropImageSrc(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Crop Profile Photo</DialogTitle></DialogHeader>
          <div className="flex items-center justify-center max-h-[60vh] overflow-auto">
            {cropImageSrc && (
              <ReactCrop crop={crop} onChange={(c) => setCrop(c)} aspect={1} circularCrop>
                <img ref={cropImgRef} src={cropImageSrc} alt="Crop preview" onLoad={onCropImageLoad} crossOrigin="anonymous" className="max-h-[55vh] object-contain" />
              </ReactCrop>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCropDialogOpen(false); setCropImageSrc(null); }} disabled={uploading}>Cancel</Button>
            <Button onClick={handleSaveCrop} disabled={uploading}>{uploading ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo preview lightbox */}
      <Dialog open={!!previewAvatarUrl} onOpenChange={(open) => !open && setPreviewAvatarUrl(null)}>
        <DialogContent className="sm:max-w-sm p-2 bg-transparent border-none shadow-none">
          <DialogHeader><DialogTitle className="sr-only">Profile Photo</DialogTitle></DialogHeader>
          {previewAvatarUrl && <img src={previewAvatarUrl} alt="Profile photo" className="w-full rounded-2xl object-cover" />}
        </DialogContent>
      </Dialog>

      {/* Past Rankings Dialog */}
      <PastRankingsDialog open={pastRankingsOpen} onOpenChange={setPastRankingsOpen} groupId={group.id} profiles={profiles} onUpdate={onUpdate} />
    </>
  );
};

export default MemberList;
