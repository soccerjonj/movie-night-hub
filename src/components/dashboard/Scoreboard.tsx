import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Season, MoviePick, Profile } from '@/hooks/useGroup';
import { Trophy, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  group: { id: string };
  season: Season | null;
  profiles: Profile[];
  members: { user_id: string }[];
}

interface GuessRow {
  guesser_id: string;
  guessed_user_id: string;
  movie_pick_id: string;
  season_id: string;
}

interface ScoreEntry {
  user_id: string;
  correct: number;
  total: number;
}

const Scoreboard = ({ group, season, profiles, members }: Props) => {
  const [view, setView] = useState<'season' | 'alltime'>('season');
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchScores();
  }, [view, season?.id, group.id]);

  const fetchScores = async () => {
    setLoading(true);
    try {
      // Get all seasons for the group (or just current)
      let seasonData: { id: string; status: string; current_movie_index: number }[] = [];
      if (view === 'season' && season) {
        seasonData = [{ id: season.id, status: season.status, current_movie_index: season.current_movie_index }];
      } else {
        const { data: seasons } = await supabase
          .from('seasons')
          .select('id, status, current_movie_index')
          .eq('group_id', group.id);
        seasonData = (seasons || []) as { id: string; status: string; current_movie_index: number }[];
      }

      const seasonIds = seasonData.map(s => s.id);
      if (seasonIds.length === 0) {
        setScores([]);
        setLoading(false);
        return;
      }

      const seasonMap = new Map(seasonData.map(s => [s.id, s]));

      // Fetch guesses and movie picks for those seasons
      const [guessesRes, picksRes] = await Promise.all([
        supabase.from('guesses').select('guesser_id, guessed_user_id, movie_pick_id, season_id').in('season_id', seasonIds),
        supabase.from('movie_picks').select('id, user_id, season_id, revealed, watch_order').in('season_id', seasonIds),
      ]);

      const guesses = (guessesRes.data || []) as GuessRow[];
      const picks = picksRes.data || [];

      // Determine which picks are "watched" based on season status and current_movie_index
      const isPickWatched = (pick: typeof picks[0]) => {
        const s = seasonMap.get(pick.season_id);
        if (!s) return false;
        if (s.status === 'completed') return true;
        if (s.status === 'watching' && pick.watch_order != null) {
          return pick.watch_order < s.current_movie_index;
        }
        return false;
      };

      // Build a map of movie_pick_id -> set of valid user_ids (for co-picks, any co-picker is correct)
      // Only include watched picks
      const coPickGroups = new Map<string, string[]>();
      picks.forEach(p => {
        if (isPickWatched(p) && p.watch_order != null) {
          const key = `${p.season_id}:${p.watch_order}`;
          if (!coPickGroups.has(key)) coPickGroups.set(key, []);
          coPickGroups.get(key)!.push(p.user_id);
        }
      });

      // Map each pick id to the set of valid user_ids (all co-pickers)
      const pickValidUsers: Record<string, Set<string>> = {};
      picks.forEach(p => {
        if (isPickWatched(p) && p.watch_order != null) {
          const key = `${p.season_id}:${p.watch_order}`;
          pickValidUsers[p.id] = new Set(coPickGroups.get(key) || [p.user_id]);
        }
      });

      // Calculate scores per guesser
      const scoreMap: Record<string, { correct: number; total: number }> = {};
      members.forEach(m => {
        scoreMap[m.user_id] = { correct: 0, total: 0 };
      });

      guesses.forEach(g => {
        if (!scoreMap[g.guesser_id]) {
          scoreMap[g.guesser_id] = { correct: 0, total: 0 };
        }
        // Only count guesses for watched movies
        if (pickValidUsers[g.movie_pick_id]) {
          scoreMap[g.guesser_id].total += 1;
          if (pickValidUsers[g.movie_pick_id].has(g.guessed_user_id)) {
            scoreMap[g.guesser_id].correct += 1;
          }
        }
      });

      const entries: ScoreEntry[] = Object.entries(scoreMap)
        .map(([user_id, { correct, total }]) => ({ user_id, correct, total }))
        .sort((a, b) => b.correct - a.correct || (b.total > 0 ? b.correct / b.total : 0) - (a.total > 0 ? a.correct / a.total : 0));

      setScores(entries);
    } catch (err) {
      console.error('Failed to fetch scores:', err);
    } finally {
      setLoading(false);
    }
  };

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const getMedal = (index: number) => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `${index + 1}`;
  };

  return (
    <div className="glass-card rounded-2xl p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <h2 className="font-display text-xl font-bold">Scoreboard</h2>
        </div>
        <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
          <Button
            variant={view === 'season' ? 'gold' : 'ghost'}
            size="sm"
            className="text-xs h-7 px-3"
            onClick={() => setView('season')}
          >
            Season
          </Button>
          <Button
            variant={view === 'alltime' ? 'gold' : 'ghost'}
            size="sm"
            className="text-xs h-7 px-3"
            onClick={() => setView('alltime')}
          >
            All-Time
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-8">Loading scores...</div>
      ) : scores.every(s => s.total === 0) ? (
        <div className="text-center text-muted-foreground py-8">
          <TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>No guesses scored yet</p>
          <p className="text-xs mt-1">Scores update as movie pickers are revealed</p>
        </div>
      ) : (
        <div className="space-y-2">
          {scores.map((entry, i) => {
            const profile = getProfile(entry.user_id);
            const pct = entry.total > 0 ? Math.round((entry.correct / entry.total) * 100) : 0;
            return (
              <div
                key={entry.user_id}
                className={`flex items-center gap-3 rounded-xl p-3 transition-colors ${
                  i === 0 && entry.correct > 0 ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/20'
                }`}
              >
                <span className="text-lg w-8 text-center">{getMedal(i)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{profile?.display_name || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.correct}/{entry.total} correct ({pct}%)
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-lg font-bold text-primary">{entry.correct}</p>
                  <p className="text-xs text-muted-foreground">pts</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Scoreboard;
