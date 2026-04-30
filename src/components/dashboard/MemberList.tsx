import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Group, GroupMember, Profile } from '@/hooks/useGroup';
import { Users, Crown, Ghost, Film, Check, X, Trophy, Camera, Crop, ListOrdered, Star, Award } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import ReactCrop, { type Crop as CropType, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import PastRankingsDialog from './PastRankingsDialog';
import RankingInsights from './RankingInsights';
import { validateImageFile, getSafeErrorMessage, safeFilename } from '@/lib/security';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import { computeMemberBadges, type BadgePickInput } from '@/lib/memberBadges';

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

// Same cache key + shape as Stats.tsx so the two share TMDB enrichment.
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

const MemberList = ({ members, profiles, group, isAdmin, onUpdate, externalSelectedUserId, onExternalSelectedClear }: Props) => {
  const { user } = useAuth();
  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [previewAvatarUrl, setPreviewAvatarUrl] = useState<string | null>(null);

  // Handle external selection
  useEffect(() => {
    if (externalSelectedUserId) {
      setSelectedUserId(externalSelectedUserId);
    }
  }, [externalSelectedUserId]);

  const handleClose = () => {
    setSelectedUserId(null);
    onExternalSelectedClear?.();
  };
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [rankings, setRankings] = useState<{ user_id: string; movie_pick_id: string; rank: number; season_id: string }[]>([]);
  const [tmdbDetails, setTmdbDetails] = useState<Record<string, TmdbDetails>>({});
  const [loading, setLoading] = useState(false);

  // Crop state
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropType>();
  const [uploading, setUploading] = useState(false);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pastRankingsOpen, setPastRankingsOpen] = useState(false);
  const [hasUnrankedSeasons, setHasUnrankedSeasons] = useState(false);

  // Check if user has unranked completed seasons
  useEffect(() => {
    if (!user) return;
    const checkUnranked = async () => {
      const { data: completedSeasons } = await supabase
        .from('seasons')
        .select('id')
        .eq('group_id', group.id)
        .in('status', ['completed', 'reviewing']);

      if (!completedSeasons || completedSeasons.length === 0) {
        setHasUnrankedSeasons(false);
        return;
      }

      const { data: existingRankings } = await supabase
        .from('movie_rankings')
        .select('season_id')
        .eq('user_id', user.id)
        .in('season_id', completedSeasons.map(s => s.id));

      const rankedIds = new Set((existingRankings || []).map(r => r.season_id));
      const hasUnranked = completedSeasons.some(s => !rankedIds.has(s.id));
      setHasUnrankedSeasons(hasUnranked);
    };
    checkUnranked();
  }, [user, group.id, pastRankingsOpen]);

  const onCropImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setCrop(centerAspectCrop(naturalWidth, naturalHeight));
  }, []);

  const openCropWithFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
      setCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const openCropWithUrl = (url: string) => {
    setCropImageSrc(url);
    setCropDialogOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) { toast.error(validation.error); return; }
    openCropWithFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getCroppedBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
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
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, size, size);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
    });
  };

  const handleSaveCrop = async () => {
    if (!user) return;
    setUploading(true);
    try {
      const blob = await getCroppedBlob();
      if (!blob) throw new Error('Failed to crop image');
      const filePath = safeFilename(user.id, 'jpg');
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: filePath }).eq('user_id', user.id);
      if (updateError) throw updateError;
      toast.success('Profile picture updated!');
      onUpdate();
      setCropDialogOpen(false);
      setCropImageSrc(null);
    } catch (err: unknown) {
      toast.error(getSafeErrorMessage(err, 'Failed to upload'));
    } finally {
      setUploading(false);
    }
  };

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

      const [picksRes, guessesRes, rankingsRes] = await Promise.all([
        supabase.from('movie_picks').select('id, title, user_id, poster_url, year, watch_order, season_id, revealed, tmdb_id').in('season_id', seasonIds),
        supabase.from('guesses').select('guesser_id, guessed_user_id, movie_pick_id, season_id').in('season_id', seasonIds),
        supabase.from('movie_rankings').select('user_id, movie_pick_id, rank, season_id').in('season_id', seasonIds),
      ]);
      setPicks((picksRes.data || []) as PickRow[]);
      setGuesses((guessesRes.data || []) as GuessRow[]);
      setRankings(rankingsRes.data || []);
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

  // Enrich watched picks with TMDB details (shares cache with Stats.tsx)
  useEffect(() => {
    if (group.club_type === 'book') return;
    if (picks.length === 0) return;
    let cancelled = false;

    const enrich = async () => {
      let cache: Record<string, TmdbDetails> = {};
      try {
        const raw = sessionStorage.getItem(TMDB_CACHE_KEY);
        if (raw) cache = JSON.parse(raw);
      } catch { /* ignore */ }

      const initial: Record<string, TmdbDetails> = {};
      const toFetch: PickRow[] = [];
      for (const p of picks) {
        // Only enrich watched picks — anonymity for unwatched is preserved.
        if (!isPickWatched(p)) continue;
        const cacheKey = p.tmdb_id ? `id:${p.tmdb_id}` : `t:${p.title}|${p.year || ''}`;
        if (cache[cacheKey]) {
          initial[p.id] = {
            runtime: cache[cacheKey].runtime ?? null,
            vote_average: cache[cacheKey].vote_average ?? null,
            release_date: cache[cacheKey].release_date ?? null,
            popularity: cache[cacheKey].popularity ?? null,
          };
        } else {
          toFetch.push(p);
        }
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
              const r = await fetch(
                `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(p.title)}&include_adult=false&language=en-US&page=1${yp}`,
                { headers }
              );
              const d = await r.json();
              tmdbId = d.results?.[0]?.id || null;
            }
            if (!tmdbId) continue;
            const r2 = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US`, { headers });
            if (!r2.ok) continue;
            const d2 = await r2.json();
            const details: TmdbDetails = {
              runtime: typeof d2.runtime === 'number' ? d2.runtime : null,
              vote_average: typeof d2.vote_average === 'number' ? d2.vote_average : null,
              release_date: d2.release_date ?? null,
              popularity: typeof d2.popularity === 'number' ? d2.popularity : null,
            };
            // Don't clobber richer Stats cache entries — only fill if missing.
            if (!cache[cacheKey]) {
              cache[cacheKey] = details as TmdbDetails;
            } else {
              cache[cacheKey] = { ...cache[cacheKey], ...details };
            }
            if (!cancelled) {
              setTmdbDetails(prev => ({ ...prev, [p.id]: details }));
            }
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

  // Compute badges for ALL members (group context). Only watched picks count.
  const memberBadgesMap = useMemo(() => {
    if (group.club_type === 'book') {
      // Books don't have runtime/popularity from TMDB — skip badges for now.
      return new Map();
    }
    if (picks.length === 0) return new Map();

    // Group co-pickers by season+watch_order so a co-picked movie is one entry
    // counted toward each picker.
    const slotMap = new Map<string, PickRow[]>();
    for (const p of picks) {
      if (!isPickWatched(p)) continue;
      const key = p.watch_order != null ? `${p.season_id}:${p.watch_order}` : `${p.season_id}:single:${p.id}`;
      if (!slotMap.has(key)) slotMap.set(key, []);
      slotMap.get(key)!.push(p);
    }

    // Build per-season ranking max (N) per user for love-score normalization
    const seasonUserMax = new Map<string, number>(); // `${season}:${user}` -> N
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
        seasonUserMax.set(`${seasonId}:${uid}`, Math.max(...ranks));
      }
    }

    // For each slot, compute group love (avg across users for any pick in slot)
    const slotLove = new Map<string, number | null>();
    for (const [key, slotPicks] of slotMap) {
      const slotPickIds = new Set(slotPicks.map(p => p.id));
      const seasonId = slotPicks[0].season_id;
      const loves: number[] = [];
      for (const r of rankings) {
        if (r.season_id !== seasonId) continue;
        if (!slotPickIds.has(r.movie_pick_id)) continue;
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
      inputs.push({
        pickId: canonical.id,
        pickerIds: Array.from(new Set(slotPicks.map(p => p.user_id))),
        runtime: det?.runtime ?? null,
        voteAverage: det?.vote_average ?? null,
        popularity: det?.popularity ?? null,
        releaseYear: Number.isFinite(releaseYear as number) ? (releaseYear as number) : null,
        groupLove: slotLove.get(key) ?? null,
      });
    }

    return computeMemberBadges(inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, rankings, tmdbDetails, group.club_type, seasons]);

  const renderMemberProfile = () => {
    if (!selectedUserId) return null;
    const profile = getProfile(selectedUserId);
    const isOwnProfile = user?.id === selectedUserId;

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
          <div className="relative group">
            <div
              className={`w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-lg font-bold text-primary ${!isOwnProfile && profile?.avatar_url ? 'cursor-pointer' : ''}`}
              onClick={() => { if (!isOwnProfile && profile?.avatar_url) setPreviewAvatarUrl(profile.avatar_url); }}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
              ) : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
            </div>
            {isOwnProfile && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                >
                  <Camera className="w-4 h-4 text-white" />
                </button>
                {profile?.avatar_url && (
                  <button
                    onClick={() => openCropWithUrl(profile.avatar_url!)}
                    className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Crop photo"
                  >
                    <Crop className="w-3 h-3 text-primary-foreground" />
                  </button>
                )}
              </>
            )}
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

        {/* Badges */}
        {(() => {
          const earned = memberBadgesMap.get(selectedUserId) || [];
          if (earned.length === 0) return null;
          return (
            <div className="bg-primary/5 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Award className="w-4 h-4 text-primary" />
                <h4 className="font-display text-sm font-bold">Badges</h4>
                <span className="text-xs text-muted-foreground">· {earned.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {earned.map(({ badge, metricLabel }) => (
                  <Popover key={badge.id}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background border border-primary/20 text-xs font-medium hover:border-primary/50 active:border-primary transition-colors"
                      >
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
            </div>
          );
        })()}

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

        {/* Average Pick Score */}
        {(() => {
          // Compute avg rank for all picks this member made
          const memberPicks = picks.filter(p => p.user_id === selectedUserId);
          const pickById = new Map(picks.map(p => [p.id, p]));
          const getSlotKey = (pick: PickRow) => `${pick.season_id}:${pick.watch_order ?? pick.id}`;
          const memberSlotKeys = new Set(memberPicks.map(p => getSlotKey(p)));
          const slotRankings = new Map<string, { total: number; count: number }>();

          rankings.forEach(r => {
            const pick = pickById.get(r.movie_pick_id);
            if (!pick) return;
            const slotKey = getSlotKey(pick);
            if (!memberSlotKeys.has(slotKey)) return;
            if (!slotRankings.has(slotKey)) slotRankings.set(slotKey, { total: 0, count: 0 });
            const entry = slotRankings.get(slotKey)!;
            entry.total += r.rank;
            entry.count += 1;
          });

          const perPickAvgs = Array.from(slotRankings.values()).map(v => v.total / v.count);
          if (perPickAvgs.length === 0) return null;
          
          const overallAvg = perPickAvgs.reduce((s, v) => s + v, 0) / perPickAvgs.length;
          
          return (
            <div className="bg-primary/5 rounded-xl p-3 flex items-center gap-3">
              <Star className="w-5 h-5 text-primary fill-primary shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold">Avg Pick Ranking</p>
                <p className="text-xs text-muted-foreground">{perPickAvgs.length} pick{perPickAvgs.length !== 1 ? 's' : ''} ranked by the group</p>
              </div>
              <p className="font-display text-2xl font-bold text-primary">{overallAvg.toFixed(1)}</p>
            </div>
          );
        })()}

        {/* Add Past Rankings button - own profile only, if there are unranked seasons */}
        {isOwnProfile && hasUnrankedSeasons && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setPastRankingsOpen(true)}
          >
            <ListOrdered className="w-4 h-4 mr-2" />
            Add Past Rankings
          </Button>
        )}

        {/* Ranking Insights */}
        <RankingInsights userId={selectedUserId} groupId={group.id} profiles={profiles} />

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
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0 ${isPlaceholder ? 'bg-muted/30 text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                  {isPlaceholder ? <Ghost className="w-3 h-3 sm:w-4 sm:h-4" /> : profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
                  ) : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
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

      <Dialog open={!!selectedUserId} onOpenChange={(open) => !open && handleClose()}>
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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Crop dialog */}
      <Dialog open={cropDialogOpen} onOpenChange={(open) => { if (!uploading) { setCropDialogOpen(open); if (!open) setCropImageSrc(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crop Profile Photo</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center max-h-[60vh] overflow-auto">
            {cropImageSrc && (
              <ReactCrop crop={crop} onChange={(c) => setCrop(c)} aspect={1} circularCrop>
                <img
                  ref={cropImgRef}
                  src={cropImageSrc}
                  alt="Crop preview"
                  onLoad={onCropImageLoad}
                  crossOrigin="anonymous"
                  className="max-h-[55vh] object-contain"
                />
              </ReactCrop>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCropDialogOpen(false); setCropImageSrc(null); }} disabled={uploading}>Cancel</Button>
            <Button onClick={handleSaveCrop} disabled={uploading}>{uploading ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo preview lightbox */}
      <Dialog open={!!previewAvatarUrl} onOpenChange={(open) => !open && setPreviewAvatarUrl(null)}>
        <DialogContent className="sm:max-w-sm p-2 bg-transparent border-none shadow-none">
          <DialogHeader>
            <DialogTitle className="sr-only">Profile Photo</DialogTitle>
          </DialogHeader>
          {previewAvatarUrl && (
            <img
              src={previewAvatarUrl}
              alt="Profile photo"
              className="w-full rounded-2xl object-cover"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Past Rankings Dialog */}
      <PastRankingsDialog
        open={pastRankingsOpen}
        onOpenChange={setPastRankingsOpen}
        groupId={group.id}
        profiles={profiles}
        onUpdate={onUpdate}
      />
    </>
  );
};

export default MemberList;
