import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MoviePick } from '@/hooks/useGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Film, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { ClubType, getClubLabels } from '@/lib/clubTypes';

interface Props {
  moviePicks: MoviePick[];
  onUpdated: () => void;
  clubType: ClubType;
}

const EditMovieInfoDialog = ({ moviePicks, onUpdated, clubType }: Props) => {
  const labels = getClubLabels(clubType);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editPosterUrl, setEditPosterUrl] = useState('');
  const [editOverview, setEditOverview] = useState('');
  const [saving, setSaving] = useState(false);

  const sorted = [...moviePicks]
    .filter((p, i, arr) => arr.findIndex(x => x.watch_order === p.watch_order) === i)
    .sort((a, b) => (a.watch_order ?? 0) - (b.watch_order ?? 0));

  const startEdit = (pick: MoviePick) => {
    setEditingId(pick.id);
    setEditTitle(pick.title);
    setEditYear(pick.year || '');
    setEditPosterUrl(pick.poster_url || '');
    setEditOverview(pick.overview || '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      // Find all co-picks (same watch_order) and update them all
      const pick = moviePicks.find(p => p.id === editingId);
      const idsToUpdate = pick
        ? moviePicks.filter(p => p.watch_order === pick.watch_order).map(p => p.id)
        : [editingId];

      for (const id of idsToUpdate) {
        const { error } = await supabase.from('movie_picks').update({
          title: editTitle.trim(),
          year: editYear.trim() || null,
          poster_url: editPosterUrl.trim() || null,
          overview: editOverview.trim() || null,
        }).eq('id', id);
        if (error) throw error;
      }

      toast.success(`${labels.Item} info updated!`);
      setEditingId(null);
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="w-3 h-3 mr-1" /> Edit {labels.Item} Info
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-base">Edit {labels.Item} Info</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {sorted.map(pick => {
            const isEditing = editingId === pick.id;

            if (isEditing) {
              return (
                <div key={pick.id} className="rounded-xl bg-primary/5 ring-1 ring-primary/20 p-3 space-y-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-0.5 block">Title</label>
                    <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-0.5 block">Year</label>
                      <Input value={editYear} onChange={e => setEditYear(e.target.value)} placeholder="e.g. 2024" className="h-8 text-sm" />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-0.5 block">Poster URL</label>
                      <Input value={editPosterUrl} onChange={e => setEditPosterUrl(e.target.value)} placeholder="https://..." className="h-8 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-0.5 block">Overview</label>
                    <Input value={editOverview} onChange={e => setEditOverview(e.target.value)} placeholder="Short description..." className="h-8 text-sm" />
                  </div>
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelEdit} disabled={saving}>
                      <X className="w-3 h-3 mr-1" /> Cancel
                    </Button>
                    <Button variant="gold" size="sm" className="h-7 text-xs" onClick={saveEdit} disabled={saving || !editTitle.trim()}>
                      <Check className="w-3 h-3 mr-1" /> {saving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={pick.id}
                onClick={() => startEdit(pick)}
                className="w-full flex items-center gap-2.5 rounded-xl p-2.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
              >
                {pick.poster_url ? (
                  <img src={pick.poster_url} alt={pick.title} className="w-8 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Film className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{pick.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {pick.year || <span className="text-destructive/70 italic">No year</span>}
                    {!pick.poster_url && <span className="text-destructive/70 italic ml-1">· No poster</span>}
                  </p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>
            );
          })}
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No {labels.items} yet</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditMovieInfoDialog;
