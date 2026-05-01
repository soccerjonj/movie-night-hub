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
  const [profileTab, setProfileTab] = useState<'overview' | 'picks' | 'guessing' | 'taste'>('overview');
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

  const pickCountByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of picks) {
      m.set(p.user_id, (m.get(p.user_id) || 0) + 1);
    }
    return m;
  }, [picks]);

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

    const tabBtn = (id: 'overview' | 'picks' | 'guessing' | 'taste', label: string) => (
      <button
        key={id}
        type="button"
        onClick={() => setProfileTab(id)}
        className={`px-2.5 py-2 text-xs font-medium border-b-2 -mb-px transition-colors shrink-0 ${
          profileTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        {label}
      </button>
    );

    const stickyHeader = (
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-1 pb-2 bg-background/95 backdrop-blur-md border-b border-border/50 space-y-2">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <button
              type="button"
              className={`w-10 h-10 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-sm font-bold text-primary ring-2 ring-primary/25 ${!isOwnProfile && profile?.avatar_url ? 'cursor-zoom-in' : ''} ${isOwnProfile ? 'cursor-default' : ''}`}
              onClick={() => {
                if (!isOwnProfile && profile?.avatar_url) setPreviewAvatarUrl(profile.avatar_url);
              }}
            >
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
            </button>
            {isOwnProfile && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-0 rounded-full bg-black/50 opacity-0 hover:opacity-100 active:opacity-100 transition-opacity flex items-center justify-center"
                  aria-label="Change profile photo"
                >
                  <Camera className="w-4 h-4 text-white" />
                </button>
                {profile?.avatar_url && (
                  <button
                    type="button"
                    onClick={() => openCropWithUrl(profile.avatar_url!)}
                    className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow"
                    title="Crop photo"
                  >
                    <Crop className="w-2.5 h-2.5 text-primary-foreground" />
                  </button>
                )}
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-bold truncate">{profileDisplayName}</p>
            {selectedUserId === group.admin_user_id ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-primary"><Crown className="w-3 h-3" /> Admin</span>
            ) : profile?.is_placeholder ? (
              <span className="text-[10px] text-muted-foreground">Unregistered</span>
            ) : null}
          </div>
        </div>
        <div className="flex gap-0 border-b border-border/40 -mb-px overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {tabBtn('overview', 'Overview')}
          {tabBtn('picks', 'Picks')}
          {tabBtn('guessing', 'Guessing')}
          {tabBtn('taste', 'Taste')}
        </div>
      </div>
    );

    const overviewTab = (
      <div className="space-y-4 pt-2">
        {sectionLabel('Badges')}
        {earned.length > 0 ? (
          <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <Award className="w-4 h-4 text-primary" />
              <h4 className="font-display text-sm font-bold">Badges</h4>
              <span className="text-xs text-muted-foreground">· {earned.length}</span>
            </div>
            {badgeIntroPlayed ? (
              <div className="flex flex-wrap gap-1.5">
                {earned.map(({ badge, metricLabel }) => (
                  <Popover key={badge.id}>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background border border-primary/20 text-xs font-medium hover:border-primary/50 active:border-primary transition-colors">
                        <span className="text-sm leading-none">{badge.emoji}</span>
                        <span>{badge.label}</span>
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
              <motion.div
                className="flex flex-wrap gap-1.5"
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
              >
                {earned.map(({ badge, metricLabel }) => (
                  <motion.div
                    key={badge.id}
                    variants={{ hidden: { opacity: 0, scale: 0.75 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } } }}
                  >
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background border border-primary/20 text-xs font-medium hover:border-primary/50 active:border-primary transition-colors">
                          <span className="text-sm leading-none">{badge.emoji}</span>
                          <span>{badge.label}</span>
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
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">No badges yet — keep ranking picks and joining guessing rounds to earn your first ones.</p>
          </div>
        )}

        {sectionLabel('Guessing scores')}
        <p className="text-[10px] text-muted-foreground -mt-2 mb-1">All time · this club</p>
        <div className="flex gap-2.5">
          <div className="flex-1 bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
            <p className="font-display text-2xl font-bold text-green-400">{correct}</p>
            <p className="text-xs text-muted-foreground">Correct</p>
          </div>
          <div className="flex-1 bg-muted/20 rounded-xl p-3 text-center">
            <p className="font-display text-2xl font-bold text-foreground">{total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className={`flex-1 rounded-xl p-3 text-center ${pct >= 50 ? 'bg-primary/10 border border-primary/20' : 'bg-muted/20'}`}>
            <p className={`font-display text-2xl font-bold ${pct >= 50 ? 'text-gradient-gold' : 'text-foreground'}`}>{pct}%</p>
            <p className="text-xs text-muted-foreground">Accuracy</p>
          </div>
        </div>

        {overallAvg !== null && (
          <>
            {sectionLabel('Pick reception')}
            <div className="bg-primary/5 border border-primary/10 rounded-xl p-3 flex items-center gap-3">
              <Star className="w-5 h-5 text-primary fill-primary shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold">Avg pick ranking</p>
                <p className="text-xs text-muted-foreground">{perPickAvgs.length} pick{perPickAvgs.length !== 1 ? 's' : ''} ranked by the group</p>
              </div>
              <p className="font-display text-2xl font-bold text-primary">{overallAvg.toFixed(1)}</p>
            </div>
          </>
        )}

        {isOwnProfile && hasUnrankedSeasons && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setPastRankingsOpen(true)}>
            <ListOrdered className="w-4 h-4 mr-2" />
            Add past rankings
          </Button>
        )}

        {sectionLabel('Taste preview')}
        <RankingInsights userId={selectedUserId} groupId={group.id} profiles={profiles} variant="teaser" />
        <Button variant="ghost" size="sm" className="w-full h-8 text-xs text-muted-foreground" onClick={() => setProfileTab('taste')}>
          Open full taste insights
          <ChevronRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </div>
    );

    const picksTab = (
      <div className="space-y-3 pt-2">
        {sectionLabel('Their picks')}
        {memberPicks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center space-y-2">
            <Film className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No picks assigned yet.</p>
            <p className="text-xs text-muted-foreground/80">When seasons start, their choices will show up here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {memberPicks.map(pick => {
              const revealed = isPickRevealed(pick);
              return (
                <div key={pick.id} className="aspect-[2/3] rounded-lg overflow-hidden bg-muted ring-1 ring-border/20">
                  {revealed
                    ? pick.poster_url
                      ? <img src={pick.poster_url} alt={pick.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center p-1"><span className="text-[9px] text-muted-foreground text-center leading-tight line-clamp-3">{pick.title}</span></div>
                    : <div className="w-full h-full flex items-center justify-center bg-muted/60"><span className="text-lg text-muted-foreground font-bold">?</span></div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );

    const guessingTab = (
      <div className="space-y-3 pt-2">
        {sectionLabel('Guess history')}
        {uniqueWatched.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center space-y-2">
            <Trophy className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
            <p className="text-xs text-muted-foreground/80">Guess history appears after the club has watched picks with guessing enabled.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'correct', 'miss', 'none'] as const).map(f => (
                <Button
                  key={f}
                  type="button"
                  variant={guessFilter === f ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-[10px] px-2 capitalize"
                  onClick={() => setGuessFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'correct' ? 'Correct' : f === 'miss' ? 'Misses' : 'No guess'}
                </Button>
              ))}
            </div>
            <div className="space-y-4">
              {guessGroupsVisible.map(group => (
                <div key={group.sn} className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-primary/90 tracking-wide">{group.label}</p>
                  <div className="space-y-1">
                    {group.rows.map(m => (
                      <div
                        key={m.pick.id}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] ${m.guess ? (m.isCorrect ? 'bg-green-500/10' : 'bg-destructive/5') : 'bg-muted/20'}`}
                      >
                        {m.pick.poster_url
                          ? <img src={m.pick.poster_url} alt={m.pick.title} className="w-5 h-7 rounded object-cover shrink-0" />
                          : <div className="w-5 h-7 rounded bg-muted flex items-center justify-center shrink-0"><Film className="w-2.5 h-2.5 text-muted-foreground" /></div>}
                        <span className="font-medium truncate flex-1">{m.pick.title}</span>
                        {m.guess
                          ? <div className="flex items-center gap-1 shrink-0">
                              <span className={`font-medium ${m.isCorrect ? 'text-green-400' : 'text-destructive'}`}>{m.guessedName}</span>
                              {m.isCorrect ? <Check className="w-2.5 h-2.5 text-green-400" /> : <X className="w-2.5 h-2.5 text-destructive" />}
                            </div>
                          : m.isOwnPick
                            ? <span className="text-primary/70 italic shrink-0">Their pick</span>
                            : <span className="text-muted-foreground italic shrink-0">No guess</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {guessGroups.length > 2 && (
              <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => setGuessOlderExpanded(e => !e)}>
                {guessOlderExpanded ? 'Show fewer seasons' : `Show ${guessGroups.length - 2} older season${guessGroups.length - 2 === 1 ? '' : 's'}`}
              </Button>
            )}
          </>
        )}
      </div>
    );

    const tasteTab = (
      <div className="space-y-3 pt-2">
        {sectionLabel('Ranking insights')}
        <RankingInsights userId={selectedUserId} groupId={group.id} profiles={profiles} variant="default" />
      </div>
    );

    return (
      <div className="space-y-0 -mx-4 px-4">
        {stickyHeader}
        <div className="pt-3 pb-2">
          {profileTab === 'overview' && overviewTab}
          {profileTab === 'picks' && picksTab}
          {profileTab === 'guessing' && guessingTab}
          {profileTab === 'taste' && tasteTab}
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

      {/* Member cards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6"
      >
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Users className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
          <h2 className="font-display text-base sm:text-lg font-bold">Members</h2>
          <span className="text-[10px] sm:text-xs text-muted-foreground ml-auto">{members.length} members</span>
        </div>

        <div className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:gap-3">
          {members.map((member, i) => {
            const profile = getProfile(member.user_id);
            const isGroupAdmin = member.user_id === group.admin_user_id;
            const isPlaceholder = profile?.is_placeholder === true;
            const isOwnCard = member.user_id === user?.id;
            const earned = allMemberBadgesMap.get(member.user_id) || [];
            const topBadges = earned.slice(0, 2);
            const pickN = pickCountByUser.get(member.user_id) ?? 0;
            return (
              <motion.button
                key={member.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                onClick={() => setSelectedUserId(member.user_id)}
                className={`flex flex-row sm:flex-col items-center gap-3 sm:gap-2 rounded-xl p-3 sm:p-4 text-left sm:text-center transition-all duration-200 ${
                  isGroupAdmin
                    ? 'bg-primary/5 ring-1 ring-primary/30 hover:ring-primary/50 hover:shadow-[0_0_16px_-4px_hsl(38_90%_55%_/_0.35)]'
                    : isPlaceholder
                      ? 'bg-muted/10 border border-dashed border-border/50 hover:border-border'
                      : 'bg-muted/20 hover:bg-primary/5 hover:ring-1 hover:ring-primary/25 hover:shadow-[0_0_16px_-6px_hsl(38_90%_55%_/_0.25)]'
                }`}
              >
                <div className="relative shrink-0">
                  <div className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full overflow-hidden flex items-center justify-center text-lg sm:text-2xl font-bold ring-2 ${
                    isGroupAdmin ? 'bg-primary/15 text-primary ring-primary/40' : isPlaceholder ? 'bg-muted/30 text-muted-foreground ring-border/30' : 'bg-primary/10 text-primary ring-primary/20'
                  }`}>
                    {isPlaceholder
                      ? <Ghost className="w-6 h-6 sm:w-8 sm:h-8" />
                      : profile?.avatar_url
                        ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
                  </div>
                  {isOwnCard && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-primary border-2 border-background flex items-center justify-center shadow-sm hover:bg-primary/90 transition-colors"
                      title="Change photo"
                    >
                      <Camera className="w-3 h-3 text-primary-foreground" />
                    </button>
                  )}
                </div>

                <div className="flex-1 min-w-0 sm:w-full">
                  <p className="text-sm font-medium truncate">{profile?.display_name || 'Unknown'}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {pickN} {pickN === 1 ? (isBookClub ? 'book' : 'movie') : isBookClub ? 'books' : 'movies'} picked
                  </p>
                  {isGroupAdmin ? (
                    <span className="inline-flex items-center gap-1 text-xs text-primary mt-0.5"><Crown className="w-3 h-3" /> Admin</span>
                  ) : isPlaceholder ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-0.5">Unregistered</span>
                  ) : null}
                </div>

                {topBadges.length > 0 && (
                  <div className="flex flex-wrap items-center justify-end sm:justify-center gap-1 sm:mt-0.5 shrink-0 max-w-[42%] sm:max-w-none">
                    {topBadges.map(({ badge }) => (
                      <span key={badge.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-background border border-primary/20 text-[10px]" title={badge.label}>
                        <span>{badge.emoji}</span>
                        <span className="truncate max-w-[56px] sm:max-w-[80px]">{badge.label}</span>
                      </span>
                    ))}
                    {earned.length > topBadges.length && (
                      <span className="text-[10px] text-muted-foreground">+{earned.length - topBadges.length}</span>
                    )}
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* Profile — dialog on large screens, bottom sheet on small */}
      {isDesktopProfile ? (
        <Dialog open={!!selectedUserId} onOpenChange={(open) => !open && handleClose()}>
          <DialogContent className="max-w-lg w-[calc(100%-1.5rem)] max-h-[min(88vh,720px)] p-0 gap-0 flex flex-col overflow-hidden rounded-2xl">
            <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/40 shrink-0 text-left space-y-1">
              <DialogTitle className="font-display text-lg pr-8">{profileSheetTitle}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Member profile, stats, picks, and guessing history for this club.
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto flex-1 min-h-0 px-4 pb-6 pt-1">
              {loading
                ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
                : renderMemberProfile()}
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={!!selectedUserId} onOpenChange={(open) => !open && handleClose()} shouldScaleBackground={false}>
          <DrawerContent className="max-h-[88vh] outline-none flex flex-col">
            <DrawerTitle className="sr-only">{profileSheetTitle}</DrawerTitle>
            <DrawerDescription className="sr-only">
              Member profile for this club. Swipe down to close.
            </DrawerDescription>
            <div className="overflow-y-auto flex-1 min-h-0 px-4 pb-8 pt-1">
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
