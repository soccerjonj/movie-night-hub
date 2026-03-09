import { useState, useEffect, useRef, useCallback } from 'react';
import { Group, GroupMember, Profile } from '@/hooks/useGroup';
import { Users, Crown, Ghost, Film, Check, X, Trophy, Camera, Crop, ListOrdered } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import ReactCrop, { type Crop as CropType, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import PastRankingsDialog from './PastRankingsDialog';

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
}

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
  const [rankings, setRankings] = useState<any[]>([]);
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
    setCropImageSrc(url.split('?')[0] + '?t=' + Date.now());
    setCropDialogOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
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
      const filePath = `${user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const avatarUrl = `${publicUrl}?t=${Date.now()}`;
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('user_id', user.id);
      if (updateError) throw updateError;
      toast.success('Profile picture updated!');
      onUpdate();
      setCropDialogOpen(false);
      setCropImageSrc(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload');
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
        setRankings([]);
        setLoading(false);
        return;
      }

      const [picksRes, guessesRes, rankingsRes] = await Promise.all([
        supabase.from('movie_picks').select('id, title, user_id, poster_url, year, watch_order, season_id, revealed').in('season_id', seasonIds),
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

        {/* Ranking preferences */}
        {rankings.length > 0 && (() => {
          // Build co-pick groups for ranking attribution
          const coPickGroups = new Map<string, string[]>();
          picks.forEach(p => {
            if (p.watch_order != null) {
              const key = `${p.season_id}:${p.watch_order}`;
              if (!coPickGroups.has(key)) coPickGroups.set(key, []);
              coPickGroups.get(key)!.push(p.user_id);
            }
          });

          // Map each pick to all its co-pickers
          const pickToAllPickers = new Map<string, string[]>();
          picks.forEach(p => {
            if (p.watch_order != null) {
              const key = `${p.season_id}:${p.watch_order}`;
              const coPickers = coPickGroups.get(key) || [p.user_id];
              pickToAllPickers.set(p.id, coPickers);
            } else {
              pickToAllPickers.set(p.id, [p.user_id]);
            }
          });

          // Calculate favorite picker (who this user ranks highest on average)
          const pickerRankings = new Map<string, number[]>();
          rankings.filter(r => r.user_id === selectedUserId).forEach(ranking => {
            const allPickers = pickToAllPickers.get(ranking.movie_pick_id) || [];
            allPickers.forEach(pickerId => {
              if (!pickerRankings.has(pickerId)) {
                pickerRankings.set(pickerId, []);
              }
              pickerRankings.get(pickerId)!.push(ranking.rank);
            });
          });

          let favoritePicker: string | null = null;
          let bestAvgRank = Infinity;
          pickerRankings.forEach((ranks, pickerId) => {
            if (pickerId !== selectedUserId && ranks.length >= 2) { // Exclude self and need at least 2 rankings
              const avgRank = ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
              if (avgRank < bestAvgRank) {
                bestAvgRank = avgRank;
                favoritePicker = pickerId;
              }
            }
          });

          // Calculate biggest fan (who ranks this user's picks highest on average)
          const fanRankings = new Map<string, number[]>();
          rankings.forEach(ranking => {
            const allPickers = pickToAllPickers.get(ranking.movie_pick_id) || [];
            if (allPickers.includes(selectedUserId) && ranking.user_id !== selectedUserId) {
              // This ranking is for a movie that the selected user was involved in picking
              if (!fanRankings.has(ranking.user_id)) {
                fanRankings.set(ranking.user_id, []);
              }
              fanRankings.get(ranking.user_id)!.push(ranking.rank);
            }
          });

          let biggestFan: string | null = null;
          let bestFanAvgRank = Infinity;
          fanRankings.forEach((ranks, fanId) => {
            if (ranks.length >= 2) { // Need at least 2 rankings to be meaningful
              const avgRank = ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
              if (avgRank < bestFanAvgRank) {
                bestFanAvgRank = avgRank;
                biggestFan = fanId;
              }
            }
          });

          const favoriteProfile = favoritePicker ? getProfile(favoritePicker) : null;
          const biggestFanProfile = biggestFan ? getProfile(biggestFan) : null;

          if (favoriteProfile || biggestFanProfile) {
            return (
              <div className="space-y-3">
                <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-primary" />
                  Ranking Preferences
                </h4>
                <div className="space-y-2">
                  {favoriteProfile && (
                    <div className="bg-muted/20 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center shrink-0">
                          {favoriteProfile.avatar_url ? (
                            <img src={favoriteProfile.avatar_url} alt={favoriteProfile.display_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] font-bold text-primary">
                              {favoriteProfile.display_name?.charAt(0).toUpperCase() || '?'}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{favoriteProfile.display_name}</p>
                          <p className="text-[10px] text-muted-foreground">Favorite Picker</p>
                        </div>
                        <span className="text-xs font-bold text-primary">#{bestAvgRank.toFixed(1)}</span>
                      </div>
                    </div>
                  )}
                  {biggestFanProfile && (
                    <div className="bg-muted/20 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center shrink-0">
                          {biggestFanProfile.avatar_url ? (
                            <img src={biggestFanProfile.avatar_url} alt={biggestFanProfile.display_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] font-bold text-primary">
                              {biggestFanProfile.display_name?.charAt(0).toUpperCase() || '?'}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{biggestFanProfile.display_name}</p>
                          <p className="text-[10px] text-muted-foreground">Biggest Fan</p>
                        </div>
                        <span className="text-xs font-bold text-primary">#{bestFanAvgRank.toFixed(1)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          }
          return null;
        })()}
        )

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
