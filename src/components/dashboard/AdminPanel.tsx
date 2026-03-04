import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Play, SkipForward, Clock, Eye, Shuffle, Settings, Trash2, Pencil, Check, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { addDays, nextMonday, setHours, setMinutes } from 'date-fns';
import ImportSeasonDialog from './ImportSeasonDialog';
import ImportGuessesDialog from './ImportGuessesDialog';
import EditGuessesDialog from './EditGuessesDialog';
import EditPicksDialog from './EditPicksDialog';

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
        const { error } = await supabase.from('seasons').update({ status: 'completed' }).eq('id', season.id);
        if (error) throw error;
        toast.success('Season completed! 🎉');
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
                <Button variant="gold" size="sm" onClick={advanceMovie} disabled={loading}>
                  <SkipForward className="w-4 h-4 mr-1" /> Next Movie
                </Button>
                <Button variant="outline" size="sm" onClick={revealCurrentPicker} disabled={loading}>
                  <Eye className="w-4 h-4 mr-1" /> Reveal Picker
                </Button>
              </>
            )}
          </div>

          {/* Import Past Season */}
          <div className="flex flex-wrap gap-2 items-center">
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
        </div>
      )}
    </>
  );
};

export { AdminPanel };
export default AdminPanel;
