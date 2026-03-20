import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, CalendarClock, BookOpen, ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

type ReadingAssignment = {
  id: string;
  season_id: string;
  title: string | null;
  chapter_range: string | null;
  start_page: number | null;
  end_page: number | null;
  due_date: string | null;
  notes: string | null;
  order_index: number;
};

interface Props {
  seasonId: string;
  isAdmin: boolean;
}

const formatDueDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return format(date, 'MMM d, yyyy');
};

const ReadingAssignments = ({ seasonId, isAdmin }: Props) => {
  const [assignments, setAssignments] = useState<ReadingAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [chapterStart, setChapterStart] = useState('');
  const [chapterEnd, setChapterEnd] = useState('');
  const [startPage, setStartPage] = useState('');
  const [endPage, setEndPage] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const nextOrderIndex = useMemo(() => {
    return assignments.length > 0 ? Math.max(...assignments.map(a => a.order_index)) + 1 : 0;
  }, [assignments]);

  const resetForm = () => {
    setTitle('');
    setChapterStart('');
    setChapterEnd('');
    setStartPage('');
    setEndPage('');
    setDueDate('');
    setNotes('');
  };

  const fetchAssignments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reading_assignments')
        .select('*')
        .eq('season_id', seasonId)
        .order('order_index', { ascending: true })
        .order('due_date', { ascending: true });
      if (error) throw error;
      setAssignments((data || []) as ReadingAssignment[]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load reading assignments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
  }, [seasonId]);

  const handleSave = async () => {
    if (!chapterStart.trim() && !chapterEnd.trim() && !title.trim() && !startPage.trim() && !endPage.trim()) {
      toast.error('Add a chapter range, page range, or title');
      return;
    }
    setLoading(true);
    try {
      const startPageNum = startPage.trim() ? Number(startPage) : null;
      const endPageNum = endPage.trim() ? Number(endPage) : null;
      const chapterStartNum = chapterStart.trim() ? Number(chapterStart) : null;
      const chapterEndNum = chapterEnd.trim() ? Number(chapterEnd) : null;
      const chapterRange = chapterStartNum || chapterEndNum
        ? `${chapterStartNum ?? '?'}–${chapterEndNum ?? '?'}`
        : null;
      const { error } = await supabase.from('reading_assignments').insert({
        season_id: seasonId,
        title: title.trim() || null,
        chapter_range: chapterRange,
        start_page: Number.isFinite(startPageNum) ? startPageNum : null,
        end_page: Number.isFinite(endPageNum) ? endPageNum : null,
        due_date: dueDate || null,
        notes: notes.trim() || null,
        order_index: nextOrderIndex,
      });
      if (error) throw error;
      toast.success('Reading assigned');
      await fetchAssignments();
      if (keepOpen) {
        resetForm();
      } else {
        resetForm();
        setDialogOpen(false);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save reading');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      const { error } = await supabase.from('reading_assignments').delete().eq('id', id);
      if (error) throw error;
      setAssignments(prev => prev.filter(a => a.id !== id));
      toast.success('Reading removed');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove reading');
    } finally {
      setLoading(false);
    }
  };

  const openAssignFirst = () => {
    setKeepOpen(false);
    setDialogOpen(true);
  };

  const openAssignAll = () => {
    setKeepOpen(true);
    setDialogOpen(true);
  };

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <h3 className="font-display text-lg font-bold">Reading Assignments</h3>
        </div>
        {isAdmin && assignments.length > 0 && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={openAssignFirst}>
                <ListPlus className="w-4 h-4 mr-1" /> Add Reading
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Add reading assignment</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="bg-muted/50" />
                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={chapterStart}
                    onChange={(e) => setChapterStart(e.target.value)}
                    placeholder="Chapter start"
                    className="bg-muted/50"
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={chapterEnd}
                    onChange={(e) => setChapterEnd(e.target.value)}
                    placeholder="Chapter end"
                    className="bg-muted/50"
                  />
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={startPage}
                    onChange={(e) => setStartPage(e.target.value)}
                    placeholder="Start page"
                    className="bg-muted/50"
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={endPage}
                    onChange={(e) => setEndPage(e.target.value)}
                    placeholder="End page"
                    className="bg-muted/50"
                  />
                </div>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-muted/50" />
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="bg-muted/50" />
                <div className="flex items-center gap-2">
                  <Checkbox id="keep-open" checked={keepOpen} onCheckedChange={(v) => setKeepOpen(Boolean(v))} />
                  <label htmlFor="keep-open" className="text-xs text-muted-foreground">Keep open to add another</label>
                </div>
                <Button variant="gold" onClick={handleSave} disabled={loading}>
                  Save reading
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {assignments.length === 0 ? (
        <div className="mt-4 text-sm text-muted-foreground">
          <p>No reading assignments yet.</p>
          {isAdmin && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="gold" size="sm" onClick={openAssignFirst}>
                    Assign First Reading
                  </Button>
                </DialogTrigger>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={openAssignAll}>
                    Assign All Readings
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[520px]">
                  <DialogHeader>
                    <DialogTitle>{keepOpen ? 'Assign readings' : 'Assign first reading'}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="bg-muted/50" />
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={chapterStart}
                        onChange={(e) => setChapterStart(e.target.value)}
                        placeholder="Chapter start"
                        className="bg-muted/50"
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={chapterEnd}
                        onChange={(e) => setChapterEnd(e.target.value)}
                        placeholder="Chapter end"
                        className="bg-muted/50"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={startPage}
                        onChange={(e) => setStartPage(e.target.value)}
                        placeholder="Start page"
                        className="bg-muted/50"
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={endPage}
                        onChange={(e) => setEndPage(e.target.value)}
                        placeholder="End page"
                        className="bg-muted/50"
                      />
                    </div>
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-muted/50" />
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="bg-muted/50" />
                    <div className="flex items-center gap-2">
                      <Checkbox id="keep-open-first" checked={keepOpen} onCheckedChange={(v) => setKeepOpen(Boolean(v))} />
                      <label htmlFor="keep-open-first" className="text-xs text-muted-foreground">Keep open to add another</label>
                    </div>
                    <Button variant="gold" onClick={handleSave} disabled={loading}>
                      Save reading
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {assignments.map((assignment, index) => {
            const titleText = assignment.title || `Reading ${index + 1}`;
            const chapterText = assignment.chapter_range ? `Chapters ${assignment.chapter_range}` : null;
            const pageText = assignment.start_page || assignment.end_page
              ? `Pages ${assignment.start_page ?? '?'}–${assignment.end_page ?? '?'}`
              : null;
            return (
              <div key={assignment.id} className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3">
                <CalendarClock className="w-4 h-4 text-primary mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{titleText}</p>
                    {assignment.due_date && (
                      <span className="text-xs text-muted-foreground">Due {formatDueDate(assignment.due_date)}</span>
                    )}
                  </div>
                  {(chapterText || pageText) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {chapterText || pageText}
                      {chapterText && pageText ? ` · ${pageText}` : ''}
                    </p>
                  )}
                  {assignment.notes && (
                    <p className="text-xs text-muted-foreground mt-1">{assignment.notes}</p>
                  )}
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(assignment.id)}
                    disabled={loading}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReadingAssignments;
