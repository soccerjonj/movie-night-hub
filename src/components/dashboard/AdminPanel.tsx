import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Group, Season, MoviePick, GroupMember } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Play, SkipForward, Clock, Eye, Shuffle, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, nextMonday, setHours, setMinutes } from 'date-fns';

interface Props {
  group: Group;
  season: Season | null;
  moviePicks: MoviePick[];
  members: GroupMember[];
  onUpdate: () => void;
}

const AdminPanel = ({ group, season, moviePicks, members, onUpdate }: Props) => {
  const [loading, setLoading] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const copyJoinCode = () => {
    navigator.clipboard.writeText(group.join_code);
    toast.success('Join code copied!');
  };

  const getNextMondayCallDate = () => {
    const next = nextMonday(new Date());
    return setMinutes(setHours(next, 19), 30); // 7:30 PM — user should adjust for timezone
  };

  const startNewSeason = async () => {
    setLoading(true);
    try {
      const seasonNumber = season ? season.season_number + 1 : 1;
      await supabase.from('seasons').insert({
        group_id: group.id,
        season_number: seasonNumber,
        status: 'picking' as any,
      });
      toast.success(`Season ${seasonNumber} started!`);
      onUpdate();
    } catch (err: any) {
      toast.error(err.message);
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
        await supabase.from('movie_picks').update({ watch_order: i }).eq('id', shuffled[i].id);
      }
      await supabase.from('seasons').update({ status: 'guessing' as any }).eq('id', season.id);
      toast.success('Guessing round started!');
      onUpdate();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startWatching = async () => {
    if (!season) return;
    setLoading(true);
    try {
      const callDate = getNextMondayCallDate();
      await supabase.from('seasons').update({
        status: 'watching' as any,
        current_movie_index: 0,
        next_call_date: callDate.toISOString(),
      }).eq('id', season.id);
      toast.success('Watching season started!');
      onUpdate();
    } catch (err: any) {
      toast.error(err.message);
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
        await supabase.from('seasons').update({ status: 'completed' as any }).eq('id', season.id);
        toast.success('Season completed! 🎉');
      } else {
        await supabase.from('seasons').update({
          current_movie_index: nextIndex,
          next_call_date: callDate.toISOString(),
        }).eq('id', season.id);
        toast.success('Advanced to next movie!');
      }
      onUpdate();
    } catch (err: any) {
      toast.error(err.message);
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
      await supabase.from('movie_picks').update({ revealed: true }).eq('id', currentPick.id);
      toast.success('Picker revealed!');
      onUpdate();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const delayCall = async (days: number) => {
    if (!season?.next_call_date) return;
    setLoading(true);
    try {
      const newDate = addDays(new Date(season.next_call_date), days);
      await supabase.from('seasons').update({ next_call_date: newDate.toISOString() }).eq('id', season.id);
      toast.success(`Call delayed by ${days} day${days > 1 ? 's' : ''}!`);
      onUpdate();
    } catch (err: any) {
      toast.error(err.message);
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
          <div className="flex flex-wrap gap-2">
            {(!season || season.status === 'completed') && (
              <Button variant="gold" size="sm" onClick={startNewSeason} disabled={loading}>
                <Play className="w-4 h-4 mr-1" /> Start New Season
              </Button>
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
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
