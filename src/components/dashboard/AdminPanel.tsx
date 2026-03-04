import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Season, MoviePick, GroupMember, Profile } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Play, SkipForward, Clock, Eye, Shuffle, Settings, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { addDays, nextMonday, setHours, setMinutes } from 'date-fns';
import ImportSeasonDialog from './ImportSeasonDialog';
import ImportGuessesDialog from './ImportGuessesDialog';

interface Props {
  group: Group;
  season: Season | null;
  moviePicks: MoviePick[];
  members: GroupMember[];
  profiles: Profile[];
  onUpdate: () => void;
}

const AdminPanel = ({ group, season, moviePicks, members, profiles, onUpdate }: Props) => {
  const [loading, setLoading] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [newSeasonTitle, setNewSeasonTitle] = useState('');

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

  return (
    <div className="mb-6">
      <Button
        variant="ghost-gold"
        size="sm"
        onClick={() => setShowPanel(!showPanel)}
        className="mb-3"
      >
        <Settings className="w-4 h-4 mr-2" /> Admin Controls
      </Button>

      {showPanel && (
        <div className="glass-card rounded-2xl p-6 space-y-4">
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
                <Button variant="outline" size="sm" onClick={() => delayCall(1)} disabled={loading}>
                  <Clock className="w-4 h-4 mr-1" /> +1 Day
                </Button>
                <Button variant="outline" size="sm" onClick={() => delayCall(7)} disabled={loading}>
                  <Clock className="w-4 h-4 mr-1" /> +1 Week
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
    </div>
  );
};

export default AdminPanel;
