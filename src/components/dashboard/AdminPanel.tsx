import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Play, SkipForward, Clock, Eye, Shuffle, Settings, Trash2, Pencil, Check, X, CalendarClock, Star } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { addDays, nextMonday, setHours, setMinutes } from 'date-fns';
import ImportSeasonDialog from './ImportSeasonDialog';
import ImportGuessesDialog from './ImportGuessesDialog';
import EditGuessesDialog from './EditGuessesDialog';
import EditPicksDialog from './EditPicksDialog';
import AddPlaceholderDialog from './AddPlaceholderDialog';

interface Props {
  group: Group;
  season: Season | null;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onUpdate: () => void;
}

const AdminPanel = ({ group, season, moviePicks, members, profiles, onUpdate, showPanel, setShowPanel }: Props & { showPanel: boolean; setShowPanel: (v: boolean) => void }) => {
  const [loading, setLoading] = useState(false);
  const [newSeasonTitle, setNewSeasonTitle] = useState('');
  const [editingSeason, setEditingSeason] = useState(false);
  const [editSeasonNumber, setEditSeasonNumber] = useState('');
  const [editSeasonTitle, setEditSeasonTitle] = useState('');
  const [editingCallDate, setEditingCallDate] = useState(false);
  const [callDate, setCallDate] = useState('');
  const [callTime, setCallTime] = useState('');
  const [callTimezone, setCallTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const getProfileName = (userId: string) => profiles.find((p) => p.user_id === userId)?.display_name || 'Unknown';

  const copyJoinCode = () => {
    navigator.clipboard.writeText(group.join_code);
    toast.success('Join code copied!');
  };

  const getNextMondayCallDate = () => {
    const next = nextMonday(new Date());
    return setMinutes(setHours(next, 19), 30); // 7:30 PM — user should adjust for timezone
  };

  const startNewSeason = async (title?: string) => {
    setLoading(true);
    try {
      const seasonNumber = season ? season.season_number + 1 : 1;
      const { error } = await supabase.from('seasons').insert({
        group_id: group.id,
        season_number: seasonNumber,
        title: title?.trim() || null,
        status: 'picking',
      });
      if (error) throw error;
      toast.success(`Season ${seasonNumber} started!`);
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to start new season');
    } finally {
      setLoading(false);
    }
  };

  const startGuessingRound = async () => {
    if (!season) return;
    setLoading(true);
    try {
      // Randomize watch order
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

  const startWatching = async () => {
    if (!season) return;
    setLoading(true);
    try {
      const callDate = getNextMondayCallDate();
      const { error } = await supabase.from('seasons').update({
        status: 'watching',
        current_movie_index: 0,
        next_call_date: callDate.toISOString(),
      }).eq('id', season.id);
      if (error) throw error;
      toast.success('Watching season started!');
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to start watching season');
    } finally {
      setLoading(false);
    }
  };

  const advanceMovie = async () => {
    if (!season) return;
    setLoading(true);
    try {
      const nextIndex = season.current_movie_index + 1;
      const callDate = getNextMondayCallDate();

      if (nextIndex >= moviePicks.length) {
        // All movies watched - stay on watching, admin will manually start review
        toast.info('All movies watched! Start the season review when ready.');
        setLoading(false);
        return;
      } else {
        const { error } = await supabase.from('seasons').update({
          current_movie_index: nextIndex,
          next_call_date: callDate.toISOString(),
        }).eq('id', season.id);
        if (error) throw error;
        toast.success('Advanced to next movie!');
      }
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to advance movie');
    } finally {
      setLoading(false);
    }
  };

  const revealCurrentPicker = async () => {
    if (!season) return;
    const currentPick = moviePicks.find((_, i) => i === season.current_movie_index);
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
      // Delete guesses, then picks, then season
      await supabase.from('guesses').delete().eq('season_id', season.id);
      await supabase.from('movie_picks').delete().eq('season_id', season.id);
      const { error } = await supabase.from('seasons').delete().eq('id', season.id);
      if (error) throw error;
      toast.success(`Season ${season.season_number} deleted!`);
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
        toast.error('Season number must be a positive number');
        return;
      }
      const { error } = await supabase.from('seasons').update({
        season_number: num,
        title: editSeasonTitle.trim() || null,
      }).eq('id', season.id);
      if (error) throw error;
      toast.success('Season updated!');
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
    // Build date in the selected timezone
    const localString = `${callDate}T${callTime}:00`;
    // Use a formatter to get the offset for the selected timezone
    const tempDate = new Date(localString);
    if (isNaN(tempDate.getTime())) {
      toast.error('Invalid date/time');
      return;
    }
    // Get the offset by formatting in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: callTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    // Calculate offset: parse the date as if it's in the target timezone
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
          supabase
            .from('movie_picks')
            .select('id', { count: 'exact', head: true })
            .in('season_id', seasonIds)
            .eq('user_id', memberUserId),
          supabase
            .from('guesses')
            .select('id', { count: 'exact', head: true })
            .in('season_id', seasonIds)
            .or(`guesser_id.eq.${memberUserId},guessed_user_id.eq.${memberUserId}`),
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
        `${memberName} already has movie picks/guesses. Deleting this member may remove historical links. Are you absolutely sure?`,
      );
      if (!secondConfirm) return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', group.id)
        .eq('user_id', memberUserId);
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
      toast.success('Season review started! Members can now rank movies.');
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
      toast.success('Season completed! 🎉');
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

          {/* Edit Season */}
          {season && !editingSeason && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Season {season.season_number}{season.title ? ` — ${season.title}` : ''}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startEditingSeason}>
                <Pencil className="w-3 h-3" />
              </Button>
            </div>
          )}
          {season && editingSeason && (
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Season #</label>
                <Input
                  type="number"
                  min={1}
                  value={editSeasonNumber}
                  onChange={(e) => setEditSeasonNumber(e.target.value)}
                  className="bg-muted/50 w-20"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Theme (optional)</label>
                <Input
                  value={editSeasonTitle}
                  onChange={(e) => setEditSeasonTitle(e.target.value)}
                  placeholder="e.g. Horror Month"
                  className="bg-muted/50 w-48"
                />
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
              <div className="flex items-end gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Season Title (optional)</label>
                  <Input
                    value={newSeasonTitle}
                    onChange={(e) => setNewSeasonTitle(e.target.value)}
                    placeholder="e.g. Horror Month"
                    className="bg-muted/50 w-48"
                  />
                </div>
                <Button variant="gold" size="sm" onClick={() => { startNewSeason(newSeasonTitle); setNewSeasonTitle(''); }} disabled={loading}>
                  <Play className="w-4 h-4 mr-1" /> Start New Season
                </Button>
              </div>
            )}

            {season?.status === 'picking' && (
              <Button
                variant="gold"
                size="sm"
                onClick={startGuessingRound}
                disabled={loading || moviePicks.length < members.length}
              >
                <Shuffle className="w-4 h-4 mr-1" /> Start Guessing Round
                {moviePicks.length < members.length && (
                  <span className="ml-1 text-xs">({moviePicks.length}/{members.length} picks)</span>
                )}
              </Button>
            )}

            {season?.status === 'guessing' && (
              <Button variant="gold" size="sm" onClick={startWatching} disabled={loading}>
                <Play className="w-4 h-4 mr-1" /> Start Watching
              </Button>
            )}

            {season?.status === 'watching' && (
              <>
                {season.current_movie_index < moviePicks.length - 1 && (
                  <Button variant="gold" size="sm" onClick={advanceMovie} disabled={loading}>
                    <SkipForward className="w-4 h-4 mr-1" /> Next Movie
                  </Button>
                )}
                {season.current_movie_index >= moviePicks.length - 1 && (
                  <Button variant="gold" size="sm" onClick={startReview} disabled={loading}>
                    <Star className="w-4 h-4 mr-1" /> Start Season Review
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={revealCurrentPicker} disabled={loading}>
                  <Eye className="w-4 h-4 mr-1" /> Reveal Picker
                </Button>
                <Button variant="outline" size="sm" onClick={startEditingCallDate} disabled={loading}>
                  <CalendarClock className="w-4 h-4 mr-1" /> {season.next_call_date ? 'Change Call Date' : 'Set Call Date'}
                </Button>
                {season.next_call_date && (
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={removeCallDate} disabled={loading}>
                    <Trash2 className="w-4 h-4 mr-1" /> Remove Call Date
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Call Date Editor */}
          {editingCallDate && season && (
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


          {/* Import Past Season */}
          <div className="flex flex-wrap gap-2 items-center">
            <AddPlaceholderDialog group={group} onAdded={onUpdate} />
            <ImportSeasonDialog
              group={group}
              profiles={profiles}
              existingSeasonCount={season?.season_number ?? 0}
              onImported={onUpdate}
            />
            <ImportGuessesDialog
              group={group}
              profiles={profiles}
              onImported={onUpdate}
            />
            <EditGuessesDialog
              group={group}
              profiles={profiles}
              onUpdated={onUpdate}
            />
            <EditPicksDialog
              group={group}
              profiles={profiles}
              onUpdated={onUpdate}
            />

            {season && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={loading}>
                    <Trash2 className="w-4 h-4 mr-1" /> Delete Season {season.season_number}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Season {season.season_number}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this season, all movie picks, and all guesses. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteSeason} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {/* Member Management */}
          <div className="pt-2 border-t border-border/40">
            <p className="text-sm text-muted-foreground mb-2">Member Management</p>
            <div className="space-y-2">
              {members.map((member) => {
                const isGroupAdmin = member.user_id === group.admin_user_id;
                const name = getProfileName(member.user_id);
                return (
                  <div key={member.id} className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
                    <span className="text-sm">
                      {name}
                      {isGroupAdmin ? ' (Admin)' : ''}
                    </span>
                    {!isGroupAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeMember(member.user_id)}
                        disabled={loading}
                      >
                        <Trash2 className="w-4 h-4 mr-1" /> Delete Member
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export { AdminPanel };
export default AdminPanel;
