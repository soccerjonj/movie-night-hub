import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { getClubLabels } from '@/lib/clubTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Play, SkipForward, SkipBack, Eye, EyeOff, Shuffle, Trash2, Pencil, Check, X, CalendarClock, Star, Upload, PencilLine, Users, ChevronDown, ListOrdered, MapPin, Tag, Camera, Film } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { addDays, nextMonday, setHours, setMinutes } from 'date-fns';
import ImportSeasonDialog from './ImportSeasonDialog';
import CreateSeasonDialog from './CreateSeasonDialog';
import ImportGuessesDialog from './ImportGuessesDialog';
import EditGuessesDialog from './EditGuessesDialog';
import EditPicksDialog from './EditPicksDialog';
import AddPlaceholderDialog from './AddPlaceholderDialog';
import EditMovieInfoDialog from './EditMovieInfoDialog';
import ChangePickedMovieDialog from './ChangePickedMovieDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TMDB_API_TOKEN } from '@/lib/apiKeys';
import PlacesAutocomplete from './PlacesAutocomplete';
import MapPreview from './MapPreview';
import StartWatchingDialog from './StartWatchingDialog';


// Collapsible dropdown panel for grouping admin actions
function DropdownPanel({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {icon} {label} <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="min-w-[280px] p-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface Props {
  group: Group;
  season: Season | null;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onUpdate: () => void;
}

const AdminPanel = ({ group, season, moviePicks, members, profiles, onUpdate, showPanel, setShowPanel }: Props & { showPanel: boolean; setShowPanel: (v: boolean) => void }) => {
  const labels = getClubLabels(group.club_type);
  const isBookClub = labels.type === 'book';
  const showCallDate = group.meeting_type === 'remote' && !isBookClub;
  const [loading, setLoading] = useState(false);
  const [showStartWatching, setShowStartWatching] = useState(false);

  // Poster management
  const [posterPickTarget, setPosterPickTarget] = useState<MoviePick | null>(null);
  const [altPosters, setAltPosters] = useState<string[]>([]);
  const [loadingAltPosters, setLoadingAltPosters] = useState(false);
  const [posterOverrides, setPosterOverrides] = useState<Record<string, string>>({});

  const openPosterPicker = async (pick: MoviePick) => {
    setPosterPickTarget(pick);
    setAltPosters([]);
    if (!pick.tmdb_id) return;
    setLoadingAltPosters(true);
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/movie/${pick.tmdb_id}/images`,
        { headers: { Authorization: `Bearer ${TMDB_API_TOKEN}`, Accept: 'application/json' } }
      );
      const data = await res.json();
      const paths: string[] = (data.posters || [])
        .sort((a: { vote_average: number }, b: { vote_average: number }) => b.vote_average - a.vote_average)
        .slice(0, 20)
        .map((p: { file_path: string }) => p.file_path);
      setAltPosters(paths);
    } catch { /* skip */ }
    setLoadingAltPosters(false);
  };

  const selectPoster = async (path: string) => {
    if (!posterPickTarget) return;
    const url = `https://image.tmdb.org/t/p/w342${path}`;
    const { error } = await supabase.from('movie_picks').update({ poster_url: url }).eq('id', posterPickTarget.id);
    if (error) { toast.error('Failed to update poster'); return; }
    setPosterOverrides(prev => ({ ...prev, [posterPickTarget.id]: url }));
    setPosterPickTarget(null);
    toast.success('Poster updated');
    onUpdate();
  };
  
  const [editingSeason, setEditingSeason] = useState(false);
  const [editSeasonNumber, setEditSeasonNumber] = useState('');
  const [editSeasonTitle, setEditSeasonTitle] = useState('');
  const [editingCallDate, setEditingCallDate] = useState(false);
  const [callDate, setCallDate] = useState('');
  const [callTime, setCallTime] = useState('');
  const [callTimezone, setCallTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [editingCallLink, setEditingCallLink] = useState(false);
  const [callLinkValue, setCallLinkValue] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationValue, setLocationValue] = useState(group.meeting_location || '');
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [currentReadingIndex, setCurrentReadingIndex] = useState<number | null>(null);
  const getProfileName = (userId: string) => profiles.find((p) => p.user_id === userId)?.display_name || 'Unknown';

  useEffect(() => {
    const fetchCoords = async () => {
      if (!group.meeting_location || group.meeting_type !== 'in_person') {
        setLocationCoords(null);
        return;
      }
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(group.meeting_location)}&key=${encodeURIComponent(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '')}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const first = data?.results?.[0];
        const loc = first?.geometry?.location;
        if (loc?.lat && loc?.lng) {
          setLocationCoords({ lat: Number(loc.lat), lon: Number(loc.lng) });
        }
      } catch {
        setLocationCoords(null);
      }
    };
    fetchCoords();
  }, [group.meeting_location, group.meeting_type]);

  useEffect(() => {
    const fetchReadingIndex = async () => {
      if (!isBookClub || !season) {
        setCurrentReadingIndex(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('reading_assignments')
          .select('order_index, due_date')
          .eq('season_id', season.id)
          .order('order_index', { ascending: true })
          .order('due_date', { ascending: true });
        if (error) throw error;
        if (!data || data.length === 0) {
          setCurrentReadingIndex(null);
          return;
        }
        const today = new Date();
        const idx = data.findIndex((row) => {
          if (!row.due_date) return false;
          const due = new Date(`${row.due_date}T23:59:59`);
          return due >= today;
        });
        const index = idx >= 0 ? idx : data.length - 1;
        setCurrentReadingIndex(index + 1);
      } catch {
        setCurrentReadingIndex(null);
      }
    };
    fetchReadingIndex();
  }, [isBookClub, season?.id]);

  const copyJoinCode = () => {
    navigator.clipboard.writeText(group.join_code);
    toast.success('Join code copied!');
  };

  const getNextMondayCallDate = () => {
    const next = nextMonday(new Date());
    return setMinutes(setHours(next, 19), 30);
  };


  const startGuessingRound = async () => {
    if (!season) return;
    setLoading(true);
    try {
      const shuffled = [...moviePicks].sort(() => Math.random() - 0.5);
      for (let i = 0; i < shuffled.length; i++) {
        const { error: pickError } = await supabase.from('movie_picks').update({ watch_order: i }).eq('id', shuffled[i].id);
        if (pickError) throw pickError;
      }
      const { error: seasonError } = await supabase.from('seasons').update({ status: 'guessing' }).eq('id', season.id);
      if (seasonError) throw seasonError;
      toast.success('Guessing round started!');
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to start guessing round');
    } finally {
      setLoading(false);
    }
  };




  const jumpToMovie = async (index: number) => {
    if (!season) return;
    setLoading(true);
    try {
      // Auto-advance the next_call_date by the watch interval when moving forward
      const updateData: Record<string, unknown> = { current_movie_index: index };
      if (season.next_call_date && index > season.current_movie_index) {
        const newCallDate = addDays(new Date(season.next_call_date), season.watch_interval_days * (index - season.current_movie_index));
        updateData.next_call_date = newCallDate.toISOString();
      }
      const { error } = await supabase.from('seasons').update(updateData).eq('id', season.id);
      if (error) throw error;
      toast.success(`Jumped to ${labels.item} ${index + 1}!`);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to jump to movie');
    } finally {
      setLoading(false);
    }
  };

  const revealCurrentPicker = async () => {
    if (!season) return;
    const sortedPicks = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));
    const currentPick = sortedPicks[season.current_movie_index];
    if (!currentPick) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('movie_picks').update({ revealed: true }).eq('id', currentPick.id);
      if (error) throw error;
      toast.success('Picker revealed!');
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reveal picker');
    } finally {
      setLoading(false);
    }
  };

  const unrevealCurrentPicker = async () => {
    if (!season) return;
    const sortedPicks = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));
    const currentPick = sortedPicks[season.current_movie_index];
    if (!currentPick) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('movie_picks').update({ revealed: false }).eq('id', currentPick.id);
      if (error) throw error;
      toast.success('Picker hidden again!');
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to hide picker');
    } finally {
      setLoading(false);
    }
  };

  const delayCall = async (days: number) => {
    if (!season?.next_call_date) return;
    setLoading(true);
    try {
      const newDate = addDays(new Date(season.next_call_date), days);
      const { error } = await supabase.from('seasons').update({ next_call_date: newDate.toISOString() }).eq('id', season.id);
      if (error) throw error;
      toast.success(`Call delayed by ${days} day${days > 1 ? 's' : ''}!`);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delay call');
    } finally {
      setLoading(false);
    }
  };

  const deleteSeason = async () => {
    if (!season) return;
    setLoading(true);
    try {
      await supabase.from('guesses').delete().eq('season_id', season.id);
      await supabase.from('movie_picks').delete().eq('season_id', season.id);
      const { error } = await supabase.from('seasons').delete().eq('id', season.id);
      if (error) throw error;
      toast.success(`${labels.seasonNoun} ${season.season_number} deleted!`);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete season');
    } finally {
      setLoading(false);
    }
  };

  const startEditingSeason = () => {
    if (!season) return;
    setEditSeasonNumber(String(season.season_number));
    setEditSeasonTitle(season.title || '');
    setEditingSeason(true);
  };

  const saveSeasonEdit = async () => {
    if (!season) return;
    setLoading(true);
    try {
      const num = parseInt(editSeasonNumber);
      if (isNaN(num) || num < 1) {
        toast.error(`${labels.seasonNoun} number must be a positive number`);
        return;
      }
      const { error } = await supabase.from('seasons').update({
        season_number: num,
        title: editSeasonTitle.trim() || null,
      }).eq('id', season.id);
      if (error) throw error;
      toast.success(`${labels.seasonNoun} updated!`);
      setEditingSeason(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update season');
    } finally {
      setLoading(false);
    }
  };

  const startEditingCallDate = () => {
    const d = season?.next_call_date ? new Date(season.next_call_date) : new Date();
    setCallDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    setCallTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    setEditingCallDate(true);
  };

  const saveCallDate = async () => {
    if (!season) return;
    const localString = `${callDate}T${callTime}:00`;
    const tempDate = new Date(localString);
    if (isNaN(tempDate.getTime())) {
      toast.error('Invalid date/time');
      return;
    }
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: callTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(tempDate);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
    const tzNow = new Date(`${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}`);
    const offsetMs = tempDate.getTime() - tzNow.getTime();
    const dateTime = new Date(tempDate.getTime() + offsetMs);
    setLoading(true);
    try {
      const { error } = await supabase.from('seasons').update({ next_call_date: dateTime.toISOString() }).eq('id', season.id);
      if (error) throw error;
      toast.success('Call date updated!');
      setEditingCallDate(false);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update call date');
    } finally {
      setLoading(false);
    }
  };

  const removeCallDate = async () => {
    if (!season) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('seasons').update({ next_call_date: null }).eq('id', season.id);
      if (error) throw error;
      toast.success('Call date removed');
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove call date');
    } finally {
      setLoading(false);
    }
  };

  const removeMember = async (memberUserId: string) => {
    if (memberUserId === group.admin_user_id) {
      toast.error('You cannot remove the group admin');
      return;
    }
    const memberName = getProfileName(memberUserId);
    const confirmed = window.confirm(`Remove ${memberName} from this group?`);
    if (!confirmed) return;

    let hasHistory = false;
    try {
      const { data: seasonsData, error: seasonsError } = await supabase
        .from('seasons')
        .select('id')
        .eq('group_id', group.id);
      if (seasonsError) throw seasonsError;
      const seasonIds = (seasonsData || []).map((s) => s.id);
      if (seasonIds.length > 0) {
        const [{ count: pickCount, error: picksError }, { count: guessCount, error: guessesError }] = await Promise.all([
          supabase.from('movie_picks').select('id', { count: 'exact', head: true }).in('season_id', seasonIds).eq('user_id', memberUserId),
          supabase.from('guesses').select('id', { count: 'exact', head: true }).in('season_id', seasonIds).or(`guesser_id.eq.${memberUserId},guessed_user_id.eq.${memberUserId}`),
        ]);
        if (picksError) throw picksError;
        if (guessesError) throw guessesError;
        hasHistory = (pickCount || 0) > 0 || (guessCount || 0) > 0;
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to verify member history');
      return;
    }

    if (hasHistory) {
      const secondConfirm = window.confirm(
        `${memberName} already has ${labels.item} picks/guesses. Deleting this member may remove historical links. Are you absolutely sure?`,
      );
      if (!secondConfirm) return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('group_members').delete().eq('group_id', group.id).eq('user_id', memberUserId);
      if (error) throw error;
      toast.success(`${memberName} removed`);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setLoading(false);
    }
  };

  const startReview = async () => {
    if (!season) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('seasons').update({
        status: 'reviewing',
        next_call_date: null,
      }).eq('id', season.id);
      if (error) throw error;
      toast.success(`${labels.seasonNoun} review started! Members can now rank ${labels.items}.`);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to start review');
    } finally {
      setLoading(false);
    }
  };

  const completeSeason = async () => {
    if (!season) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('seasons').update({ status: 'completed' }).eq('id', season.id);
      if (error) throw error;
      toast.success(`${labels.seasonNoun} completed! 🎉`);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete season');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showPanel && (
        <div className="glass-card rounded-2xl p-4 sm:p-6 space-y-3 sm:space-y-4">
          {/* Join Code */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Join Code:</span>
            <code className="font-mono text-primary bg-primary/10 px-3 py-1 rounded-lg tracking-widest">
              {group.join_code}
            </code>
            <Button variant="ghost" size="icon" onClick={copyJoinCode}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>

          {/* Meeting Location (in-person groups) */}
          {group.meeting_type === 'in_person' && (
            <div className="space-y-2">
              {!editingLocation ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {group.meeting_location || 'No meeting location set'}
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setLocationValue(group.meeting_location || ''); setEditingLocation(true); }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                  </div>
                  {locationCoords && group.meeting_location && (
                    <MapPreview lat={locationCoords.lat} lon={locationCoords.lon} label={group.meeting_location} />
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground block">Meeting Location</label>
                  <PlacesAutocomplete
                    value={locationValue}
                    onChange={setLocationValue}
                    placeholder="Search for a place..."
                    autoFocus
                    onPlaceSelected={(place) => {
                      if (place.lat && place.lon) {
                        setLocationCoords({ lat: Number(place.lat), lon: Number(place.lon) });
                      }
                    }}
                  />
                  {locationCoords && (
                    <MapPreview lat={locationCoords.lat} lon={locationCoords.lon} label={locationValue} />
                  )}
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="text-green-500" onClick={async () => {
                      setLoading(true);
                      try {
                        const { error } = await supabase.from('groups').update({ meeting_location: locationValue.trim() || null } as any).eq('id', group.id);
                        if (error) throw error;
                        toast.success('Meeting location updated!');
                        setEditingLocation(false);
                        onUpdate();
                      } catch (err: unknown) {
                        toast.error(err instanceof Error ? err.message : 'Failed to update location');
                      } finally {
                        setLoading(false);
                      }
                    }} disabled={loading}>
                      <Check className="w-4 h-4 mr-1" /> Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingLocation(false)}>
                      <X className="w-4 h-4 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          

          {season && !editingSeason && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {labels.seasonNoun} {season.season_number}{season.title ? ` — ${season.title}` : ''}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startEditingSeason}>
                <Pencil className="w-3 h-3" />
              </Button>
            </div>
          )}
          {season && editingSeason && (
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{labels.seasonNoun} #</label>
                <Input type="number" min={1} value={editSeasonNumber} onChange={(e) => setEditSeasonNumber(e.target.value)} className="bg-muted/50 w-20" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{labels.seasonNoun} Theme (optional)</label>
                <Input value={editSeasonTitle} onChange={(e) => setEditSeasonTitle(e.target.value)} placeholder="e.g. Horror Month" className="bg-muted/50 w-48" />
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-green-500" onClick={saveSeasonEdit} disabled={loading}>
                <Check className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setEditingSeason(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Season Actions */}
          <div className="flex flex-wrap gap-2 items-end">
            {(!season || season.status === 'completed') && (
              <CreateSeasonDialog
                group={group}
                members={members}
                profiles={profiles}
                currentSeasonNumber={season?.season_number ?? 0}
                onCreated={onUpdate}
              />
            )}

            {season?.status === 'picking' && (
              <>
                {/* Toggle guessing on/off during picking */}
                {!isBookClub && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setLoading(true);
                      try {
                        const { error } = await supabase.from('seasons').update({ guessing_enabled: !season.guessing_enabled }).eq('id', season.id);
                        if (error) throw error;
                        toast.success(season.guessing_enabled ? 'Guessing round disabled' : 'Guessing round enabled');
                        onUpdate();
                      } catch (err: unknown) {
                        toast.error(err instanceof Error ? err.message : 'Failed to update');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={loading}
                  >
                    {season.guessing_enabled ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                    {season.guessing_enabled ? 'Disable Guessing' : 'Enable Guessing'}
                  </Button>
                )}

                {/* Toggle constraint visibility */}
                {(() => {
                  // Check if season has any constraints
                  const hasConstraints = moviePicks.length > 0 || true; // always show if season exists
                  return hasConstraints ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        setLoading(true);
                        try {
                          const newVal = !(season as any).constraints_visible;
                          const { error } = await supabase.from('seasons').update({ constraints_visible: newVal } as any).eq('id', season.id);
                          if (error) throw error;
                          toast.success(newVal ? 'Constraints now visible to all' : 'Constraints hidden from others');
                          onUpdate();
                        } catch (err: unknown) {
                          toast.error(err instanceof Error ? err.message : 'Failed to update');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={loading}
                    >
                      <Tag className="w-4 h-4 mr-1" />
                      {(season as any).constraints_visible !== false ? 'Hide Constraints' : 'Show Constraints'}
                    </Button>
                  ) : null;
                })()}

                {!isBookClub && season.guessing_enabled ? (
                  <Button variant="gold" size="sm" onClick={startGuessingRound} disabled={loading || moviePicks.length < members.length}>
                    <Shuffle className="w-4 h-4 mr-1" /> Start Guessing Round
                    {moviePicks.length < members.length && (
                      <span className="ml-1 text-xs">({moviePicks.length}/{members.length} picks)</span>
                    )}
                  </Button>
                ) : (
                  <Button variant="gold" size="sm" onClick={() => setShowStartWatching(true)} disabled={loading || moviePicks.length < members.length}>
                    <Play className="w-4 h-4 mr-1" /> Start {labels.Watching}
                    {moviePicks.length < members.length && (
                      <span className="ml-1 text-xs">({moviePicks.length}/{members.length} picks)</span>
                    )}
                  </Button>
                )}
              </>
            )}

            {season?.status === 'guessing' && (
              <Button variant="gold" size="sm" onClick={() => setShowStartWatching(true)} disabled={loading}>
                <Play className="w-4 h-4 mr-1" /> Start {labels.Watching}
              </Button>
            )}

          {season?.status === 'watching' && (
              <>
                {/* Jump to movie selector */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <ListOrdered className="w-4 h-4 mr-1" /> {isBookClub ? `Assigned Reading${currentReadingIndex ? ` #${currentReadingIndex}` : ''}` : `${labels.Item} ${season.current_movie_index + 1}/${moviePicks.length}`}
                      <ChevronDown className="w-3 h-3 ml-1" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-2 max-h-[300px] overflow-y-auto">
                    <p className="text-xs text-muted-foreground px-2 py-1 mb-1">Jump to {labels.item}:</p>
                    {[...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0)).map((pick, i) => (
                      <button
                        key={pick.id}
                        onClick={() => jumpToMovie(i)}
                        disabled={loading}
                        className={`w-full text-left text-sm px-2 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                          i === season.current_movie_index
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'hover:bg-muted/30 text-foreground'
                        }`}
                      >
                        <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
                        <span className="truncate">{pick.title}</span>
                        {i === season.current_movie_index && <span className="text-[10px] text-primary ml-auto shrink-0">current</span>}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>

                {season.current_movie_index >= moviePicks.length - 1 && (
                  <Button variant="gold" size="sm" onClick={startReview} disabled={loading}>
                    <Star className="w-4 h-4 mr-1" /> Start {labels.seasonNoun} Review
                  </Button>
                )}

                {/* End season early with confirmation */}
                {season.current_movie_index < moviePicks.length - 1 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={loading}>
                        <X className="w-4 h-4 mr-1" /> End {labels.seasonNoun} Early
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>End {labels.seasonNoun.toLowerCase()} early?</AlertDialogTitle>
                        <AlertDialogDescription>
                          There {moviePicks.length - 1 - season.current_movie_index === 1 ? 'is' : 'are'} still{' '}
                          <strong>{moviePicks.length - 1 - season.current_movie_index}</strong>{' '}
                          un{labels.watched} {labels.item}{moviePicks.length - 1 - season.current_movie_index === 1 ? '' : 's'} remaining.
                          This will skip them and move directly to the {labels.seasonNoun.toLowerCase()} review phase.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={startReview} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          End {labels.seasonNoun} &amp; Start Review
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {!isBookClub && (() => {
                  const sortedPicks = [...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));
                  const currentPick = sortedPicks[season.current_movie_index];
                  const isRevealed = currentPick?.revealed;
                  return isRevealed ? (
                    <Button variant="outline" size="sm" onClick={unrevealCurrentPicker} disabled={loading}>
                      <EyeOff className="w-4 h-4 mr-1" /> Unreveal Picker
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={revealCurrentPicker} disabled={loading}>
                      <Eye className="w-4 h-4 mr-1" /> Reveal Picker
                    </Button>
                  );
                })()}
                {showCallDate && (
                  <Button variant="outline" size="sm" onClick={startEditingCallDate} disabled={loading}>
                    <CalendarClock className="w-4 h-4 mr-1" /> {season.next_call_date ? 'Change Call Date' : 'Set Call Date'}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => { setCallLinkValue(season.call_link || ''); setEditingCallLink(true); }} disabled={loading}>
                  <Play className="w-4 h-4 mr-1" /> {group.meeting_type === 'in_person' ? (season.call_link ? 'Edit Location' : 'Set Location') : (season.call_link ? 'Edit Call Link' : 'Add Call Link')}
                </Button>
                {season.call_link && (
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={async () => {
                    setLoading(true);
                    try {
                      const { error } = await supabase.from('seasons').update({ call_link: null } as any).eq('id', season.id);
                      if (error) throw error;
                      toast.success('Call link removed');
                      onUpdate();
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : 'Failed to remove call link');
                    } finally {
                      setLoading(false);
                    }
                  }} disabled={loading}>
                    <Trash2 className="w-4 h-4 mr-1" /> Remove Call Link
                  </Button>
                )}
                {showCallDate && season.next_call_date && (
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={removeCallDate} disabled={loading}>
                    <Trash2 className="w-4 h-4 mr-1" /> Remove Call Date
                  </Button>
                )}
              </>
            )}

            {season?.status === 'reviewing' && (
              <Button variant="gold" size="sm" onClick={completeSeason} disabled={loading}>
                <Check className="w-4 h-4 mr-1" /> Complete {labels.seasonNoun}
              </Button>
            )}
          </div>

          {/* Call Date Editor */}
          {showCallDate && editingCallDate && season && (
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-2 flex-wrap">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                <Input type="date" value={callDate} onChange={e => setCallDate(e.target.value)} className="bg-muted/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Time</label>
                <Input type="time" value={callTime} onChange={e => setCallTime(e.target.value)} className="bg-muted/50 w-32" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Timezone</label>
                <select
                  value={callTimezone}
                  onChange={e => setCallTimezone(e.target.value)}
                  className="h-9 rounded-md border border-input bg-muted/50 px-2 text-sm text-foreground max-w-[200px]"
                >
                  {[
                    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                    'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
                    'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
                    'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
                    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
                    'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Moscow',
                    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore',
                    'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
                    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
                    'Pacific/Auckland', 'Pacific/Fiji',
                  ].map(tz => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, ' ').replace('America/', '').replace('Europe/', '').replace('Asia/', '').replace('Australia/', '').replace('Pacific/', '')} ({tz.split('/')[0]})</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-9 w-9 text-green-500" onClick={saveCallDate} disabled={loading}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setEditingCallDate(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Call Link Editor */}
          {editingCallLink && season && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">{group.meeting_type === 'in_person' ? 'Meeting Location' : 'Call Link (Zoom, Google Meet, etc.)'}</label>
                <Input
                  type={group.meeting_type === 'in_person' ? 'text' : 'url'}
                  placeholder={group.meeting_type === 'in_person' ? "e.g. Joe's house, The Coffee Bean" : "https://zoom.us/j/... or https://meet.google.com/..."}
                  value={callLinkValue}
                  onChange={e => setCallLinkValue(e.target.value)}
                  className="bg-muted/50"
                />
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-green-500" onClick={async () => {
                setLoading(true);
                try {
                  const { error } = await supabase.from('seasons').update({ call_link: callLinkValue.trim() || null } as any).eq('id', season.id);
                  if (error) throw error;
                  toast.success('Call link saved!');
                  setEditingCallLink(false);
                  onUpdate();
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : 'Failed to save call link');
                } finally {
                  setLoading(false);
                }
              }} disabled={loading}>
                <Check className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setEditingCallLink(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            {/* Manage Members */}
            <DropdownPanel label="Manage Members" icon={<Users className="w-4 h-4 mr-1" />}>
              <div className="space-y-2">
                <AddPlaceholderDialog group={group} onAdded={onUpdate} />
                {members.map((member) => {
                  const isGroupAdmin = member.user_id === group.admin_user_id;
                  const name = getProfileName(member.user_id);
                  return (
                    <div key={member.id} className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
                      <span className="text-sm">{name}{isGroupAdmin ? ' (Admin)' : ''}</span>
                      {!isGroupAdmin && (
                        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeMember(member.user_id)} disabled={loading}>
                          <Trash2 className="w-3 h-3 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </DropdownPanel>

            {/* Import Past Info */}
            <DropdownPanel label="Import Past Info" icon={<Upload className="w-4 h-4 mr-1" />}>
              <div className="flex flex-wrap gap-2">
                <ImportSeasonDialog group={group} profiles={profiles} existingSeasonCount={season?.season_number ?? 0} onImported={onUpdate} />
                {!isBookClub && <ImportGuessesDialog group={group} profiles={profiles} onImported={onUpdate} />}
              </div>
            </DropdownPanel>

            {/* Edit Picks & Movies (current or past seasons) */}
            {season && (
              <DropdownPanel label={`Edit ${labels.Items} & Pickers`} icon={<PencilLine className="w-4 h-4 mr-1" />}>
                <div className="flex flex-wrap gap-2">
                  {!isBookClub && <EditGuessesDialog group={group} profiles={profiles} onUpdated={onUpdate} />}
                  {!isBookClub && <EditPicksDialog group={group} profiles={profiles} onUpdated={onUpdate} />}
                  {!isBookClub && <ChangePickedMovieDialog group={group} profiles={profiles} onUpdated={onUpdate} />}
                  <EditMovieInfoDialog moviePicks={moviePicks} onUpdated={onUpdate} clubType={labels.type} />
                </div>

                {/* Poster management */}
                {!isBookClub && moviePicks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5" /> Swap Posters
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {[...moviePicks].sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0)).map(pick => (
                        <button
                          key={pick.id}
                          onClick={() => openPosterPicker(pick)}
                          className="group relative aspect-[2/3] rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all"
                          title={pick.title}
                        >
                          {(posterOverrides[pick.id] || pick.poster_url) ? (
                            <img src={posterOverrides[pick.id] || pick.poster_url!} alt={pick.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Film className="w-4 h-4 text-muted-foreground/50" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Camera className="w-4 h-4 text-white" />
                          </div>
                          <p className="absolute bottom-0 inset-x-0 text-[8px] text-white bg-black/60 px-1 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">{pick.title}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </DropdownPanel>
            )}

            {/* Edit Season Setup — reset/revert controls */}
            {season && (season.status === 'picking' || season.status === 'guessing') && (
              <DropdownPanel label={`Edit ${labels.seasonNoun} Setup`} icon={<SkipBack className="w-4 h-4 mr-1" />}>
                <div className="flex flex-wrap gap-2">
                  {/* Reset All Picks */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={loading}>
                        <Trash2 className="w-3 h-3 mr-1" /> Reset All Picks
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Reset all picks?</AlertDialogTitle>
                        <AlertDialogDescription>This will delete every {labels.item} pick for this season. All guesses will also be removed. This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={async () => {
                            setLoading(true);
                            try {
                              await supabase.from('guesses').delete().eq('season_id', season.id);
                              await supabase.from('movie_picks').delete().eq('season_id', season.id);
                              toast.success('All picks and guesses reset!');
                              onUpdate();
                            } catch (err: unknown) {
                              toast.error(err instanceof Error ? err.message : 'Failed to reset picks');
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >Reset Picks</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  {/* Reset All Guesses */}
                  {season.status === 'guessing' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={loading}>
                          <Trash2 className="w-3 h-3 mr-1" /> Reset All Guesses
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Reset all guesses?</AlertDialogTitle>
                          <AlertDialogDescription>This will delete every guess for this season. Movie picks will be kept. This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={async () => {
                              setLoading(true);
                              try {
                                await supabase.from('guesses').delete().eq('season_id', season.id);
                                toast.success('All guesses reset!');
                                onUpdate();
                              } catch (err: unknown) {
                                toast.error(err instanceof Error ? err.message : 'Failed to reset guesses');
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >Reset Guesses</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}

                  {/* Go Back to Picking (only from guessing phase) */}
                  {season.status === 'guessing' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={loading}>
                          <SkipBack className="w-3 h-3 mr-1" /> Back to Picking
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Go back to picking phase?</AlertDialogTitle>
                          <AlertDialogDescription>This will move the season back to the picking phase. All guesses will be deleted. {labels.Item} picks will be kept.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              setLoading(true);
                              try {
                                await supabase.from('guesses').delete().eq('season_id', season.id);
                                const { error } = await supabase.from('seasons').update({ status: 'picking' }).eq('id', season.id);
                                if (error) throw error;
                                toast.success('Back to picking phase!');
                                onUpdate();
                              } catch (err: unknown) {
                                toast.error(err instanceof Error ? err.message : 'Failed to go back to picking');
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >Go Back</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </DropdownPanel>
            )}

            {/* Delete Season */}
            {season && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={loading}>
                    <Trash2 className="w-4 h-4 mr-1" /> Delete {labels.seasonNoun} {season.season_number}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {labels.seasonNoun} {season.season_number}?</AlertDialogTitle>
                    <AlertDialogDescription>This will permanently delete this season, all {labels.item} picks, and all guesses. This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteSeason} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      )}
      <Dialog open={!!posterPickTarget} onOpenChange={open => !open && setPosterPickTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose a poster — {posterPickTarget?.title}</DialogTitle>
          </DialogHeader>
          {loadingAltPosters ? (
            <div className="text-center text-muted-foreground py-10 text-sm">Loading posters…</div>
          ) : altPosters.length === 0 && !loadingAltPosters ? (
            <div className="text-center text-muted-foreground py-10 text-sm">
              {posterPickTarget?.tmdb_id ? 'No alternate posters found.' : 'No TMDB ID — search for this movie first to enable poster swapping.'}
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[60vh] overflow-y-auto py-1">
              {altPosters.map(path => (
                <button
                  key={path}
                  onClick={() => selectPoster(path)}
                  className="rounded-lg overflow-hidden hover:ring-2 hover:ring-primary transition-all focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <img src={`https://image.tmdb.org/t/p/w342${path}`} alt="Alternate poster" className="w-full aspect-[2/3] object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {season && (
        <StartWatchingDialog
          open={showStartWatching}
          onOpenChange={setShowStartWatching}
          season={season}
          moviePicks={moviePicks}
          profiles={profiles}
          onUpdate={onUpdate}
          labels={labels}
          showCallDate={showCallDate}
        />
      )}
    </>
  );
};

export { AdminPanel };
export default AdminPanel;
