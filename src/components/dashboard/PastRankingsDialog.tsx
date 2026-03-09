import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Profile } from '@/hooks/useGroup';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Film, GripVertical, Check, Star, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface SeasonOption {
  id: string;
  season_number: number;
  title: string | null;
}

interface MovieForRanking {
  id: string;
  title: string;
  poster_url: string | null;
  year: string | null;
  watch_order: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  profiles: Profile[];
  onUpdate: () => void;
}

const PastRankingsDialog = ({ open, onOpenChange, groupId, profiles, onUpdate }: Props) => {
  const { user } = useAuth();
  const [unrankedSeasons, setUnrankedSeasons] = useState<SeasonOption[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [movies, setMovies] = useState<MovieForRanking[]>([]);
  const [rankings, setRankings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dragItem, setDragItem] = useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);

  // Fetch unranked completed/reviewing seasons
  useEffect(() => {
    if (!open || !user) return;
    const fetchUnranked = async () => {
      setLoading(true);
      const { data: seasons } = await supabase
        .from('seasons')
        .select('id, season_number, title, status')
        .eq('group_id', groupId)
        .in('status', ['completed', 'reviewing'])
        .order('season_number', { ascending: false });

      if (!seasons || seasons.length === 0) {
        setUnrankedSeasons([]);
        setLoading(false);
        return;
      }

      const { data: existingRankings } = await supabase
        .from('movie_rankings')
        .select('season_id')
        .eq('user_id', user.id)
        .in('season_id', seasons.map(s => s.id));

      const rankedSeasonIds = new Set((existingRankings || []).map(r => r.season_id));
      const unranked = seasons.filter(s => !rankedSeasonIds.has(s.id));

      setUnrankedSeasons(unranked);
      setSelectedSeasonId(unranked.length > 0 ? unranked[0].id : null);
      setLoading(false);
    };
    fetchUnranked();
  }, [open, user, groupId]);

  useEffect(() => {
    if (!selectedSeasonId) {
      setMovies([]);
      setRankings([]);
      return;
    }
    const fetchMovies = async () => {
      const { data } = await supabase
        .from('movie_picks')
        .select('id, title, poster_url, year, watch_order')
        .eq('season_id', selectedSeasonId)
        .order('watch_order', { ascending: true });

      const unique = (data || []).filter((p, i, arr) =>
        arr.findIndex(x => x.watch_order === p.watch_order) === i
      );
      setMovies(unique);
      setRankings(unique.map(m => m.id));
    };
    fetchMovies();
  }, [selectedSeasonId]);

  const handleDragStart = (index: number) => setDragItem(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverItem(index);
  };
  const handleDrop = (index: number) => {
    if (dragItem === null) return;
    const newRankings = [...rankings];
    const [removed] = newRankings.splice(dragItem, 1);
    newRankings.splice(index, 0, removed);
    setRankings(newRankings);
    setDragItem(null);
    setDragOverItem(null);
  };
  const handleDragEnd = () => { setDragItem(null); setDragOverItem(null); };
  const moveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= rankings.length) return;
    const newRankings = [...rankings];
    const [removed] = newRankings.splice(fromIndex, 1);
    newRankings.splice(toIndex, 0, removed);
    setRankings(newRankings);
  };

  const handleSubmit = async () => {
    if (!user || !selectedSeasonId || rankings.length === 0) return;
    setSubmitting(true);
    try {
      const rows = rankings.map((moviePickId, index) => ({
        season_id: selectedSeasonId,
        user_id: user.id,
        movie_pick_id: moviePickId,
        rank: index + 1,
      }));
      const { error } = await supabase.from('movie_rankings').insert(rows);
      if (error) throw error;
      toast.success('Rankings submitted! 🎬');

      setUnrankedSeasons(prev => prev.filter(s => s.id !== selectedSeasonId));
      const remaining = unrankedSeasons.filter(s => s.id !== selectedSeasonId);
      setSelectedSeasonId(remaining.length > 0 ? remaining[0].id : null);

      if (remaining.length === 0) {
        onOpenChange(false);
      }
      onUpdate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit rankings');
    } finally {
      setSubmitting(false);
    }
  };

  const getMovieById = (id: string) => movies.find(m => m.id === id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[94vh] flex flex-col overflow-hidden p-0">
        {/* Compact header */}
        <div className="px-4 pt-3 pb-2 border-b border-border/40 shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trophy className="w-4 h-4 text-primary" />
              Add Past Rankings
            </DialogTitle>
          </DialogHeader>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-6 text-sm">Loading...</div>
        ) : unrankedSeasons.length === 0 ? (
          <div className="text-center py-6 px-4">
            <Trophy className="w-8 h-8 mx-auto mb-2 text-primary/30" />
            <p className="text-sm text-muted-foreground">You've ranked all completed seasons!</p>
          </div>
        ) : (
          <>
            {/* Compact controls */}
            <div className="px-4 pt-2 pb-1 shrink-0 space-y-1.5">
              <Select value={selectedSeasonId || ''} onValueChange={setSelectedSeasonId}>
                <SelectTrigger className="bg-muted/50 h-8 text-xs">
                  <SelectValue placeholder="Select a season" />
                </SelectTrigger>
                <SelectContent>
                  {unrankedSeasons.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      Season {s.season_number}{s.title ? ` — ${s.title}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Drag to rank from favorite (#1) to least favorite.
              </p>
            </div>

            {/* Compact scrollable ranking list */}
            <div className="flex-1 overflow-y-auto px-4 py-1 space-y-0.5 min-h-0">
              {rankings.map((movieId, index) => {
                const movie = getMovieById(movieId);
                if (!movie) return null;
                const isDragging = dragItem === index;
                const isDragOver = dragOverItem === index;

                return (
                  <motion.div
                    key={movieId}
                    layout
                    className={`flex items-center gap-1.5 rounded-lg py-1 px-1.5 transition-colors ${
                      isDragging ? 'opacity-50 bg-primary/10' :
                      isDragOver ? 'bg-primary/5 ring-1 ring-primary/30' :
                      'bg-muted/20 hover:bg-muted/30'
                    } cursor-grab active:cursor-grabbing`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="flex flex-col shrink-0">
                      <button onClick={() => moveItem(index, index - 1)} className="text-muted-foreground hover:text-foreground text-[9px] leading-none px-0.5" disabled={index === 0}>▲</button>
                      <button onClick={() => moveItem(index, index + 1)} className="text-muted-foreground hover:text-foreground text-[9px] leading-none px-0.5" disabled={index === rankings.length - 1}>▼</button>
                    </div>

                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      index === 0 ? 'bg-primary text-primary-foreground' :
                      index === 1 ? 'bg-primary/60 text-primary-foreground' :
                      index === 2 ? 'bg-primary/30 text-foreground' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {index + 1}
                    </div>

                    <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />

                    {movie.poster_url ? (
                      <img src={movie.poster_url} alt={movie.title} className="w-6 h-9 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-6 h-9 rounded bg-muted flex items-center justify-center shrink-0">
                        <Film className="w-2.5 h-2.5 text-muted-foreground" />
                      </div>
                    )}

                    <p className="font-medium text-xs truncate flex-1 min-w-0">{movie.title}</p>

                    {index === 0 && <Star className="w-3 h-3 text-primary fill-primary shrink-0" />}
                  </motion.div>
                );
              })}
            </div>

            {/* Compact submit footer */}
            <div className="px-4 py-2 border-t border-border/40 shrink-0">
              <Button
                variant="gold"
                size="sm"
                className="w-full h-8"
                onClick={handleSubmit}
                disabled={submitting || rankings.length === 0}
              >
                <Check className="w-3.5 h-3.5 mr-1.5" />
                {submitting ? 'Submitting...' : 'Submit Rankings'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PastRankingsDialog;
