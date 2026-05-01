import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Plus, Users, ArrowRight, Film, BookOpen, LogOut, MoreHorizontal } from 'lucide-react';
import logo from '@/assets/logo.png';
import { motion } from 'framer-motion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

interface GroupInfo {
  id: string;
  name: string;
  member_count: number;
  season_status: string | null;
  club_type: 'movie' | 'book';
}

const statusStyle = (s: string) => {
  switch (s) {
    case 'watching':  return 'bg-amber-500/15 border-amber-500/25 text-amber-400';
    case 'reviewing': return 'bg-sky-500/15 border-sky-500/25 text-sky-400';
    case 'completed': return 'bg-green-500/15 border-green-500/25 text-green-400';
    case 'picking':   return 'bg-violet-500/15 border-violet-500/25 text-violet-400';
    default:          return 'bg-muted/30 border-border/40 text-muted-foreground';
  }
};

const ClubSelect = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState<GroupInfo | null>(null);

  const handleLeave = async () => {
    if (!user || !confirmLeave) return;
    const { error } = await supabase
      .from('group_members').delete()
      .eq('group_id', confirmLeave.id).eq('user_id', user.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Left club', description: `You left ${confirmLeave.name}.` });
    const remaining = groups.filter(g => g.id !== confirmLeave.id);
    setConfirmLeave(null);
    if (remaining.length === 0) navigate('/setup', { replace: true });
    else setGroups(remaining);
  };

  useEffect(() => {
    const fetchGroups = async () => {
      if (!user) return;
      setLoading(true);
      const { data: memberships } = await supabase
        .from('group_members').select('group_id').eq('user_id', user.id);
      if (!memberships || memberships.length === 0) { navigate('/setup', { replace: true }); return; }
      const groupIds = memberships.map(m => m.group_id);
      const { data: groupsData } = await supabase
        .from('groups').select('id, name, club_type').in('id', groupIds);
      if (!groupsData) { setLoading(false); return; }
      const groupInfos: GroupInfo[] = [];
      for (const g of groupsData) {
        const [{ count }, { data: latestSeason }] = await Promise.all([
          supabase.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', g.id),
          supabase.from('seasons').select('status').eq('group_id', g.id).order('season_number', { ascending: false }).limit(1),
        ]);
        groupInfos.push({ id: g.id, name: g.name, member_count: count ?? 0, season_status: latestSeason?.[0]?.status ?? null, club_type: (g as any).club_type || 'movie' });
      }
      setGroups(groupInfos);
      setLoading(false);
    };
    fetchGroups();
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <img src={logo} alt="Loading" className="h-12 object-contain animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card/80 backdrop-blur-xl border-b border-border/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src={logo} alt="Movie Club Hub" className="h-8 object-contain" />
          <h1 className="font-display text-lg font-bold text-gradient-gold">Your Clubs</h1>
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={() => { signOut(); navigate('/'); }}>
          <LogOut className="w-4 h-4" />
        </Button>
      </header>

      {/* Club list */}
      <main className="flex-1 px-4 pt-4 pb-28 space-y-2.5">
        {groups.map((g, i) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center gap-2"
          >
            <button
              onClick={() => navigate(`/dashboard/${g.id}`)}
              className="flex-1 flex items-center gap-4 rounded-xl p-4 border border-border/50 bg-card/60 hover:border-primary/40 hover:bg-primary/5 hover:shadow-[0_0_20px_-8px_hsl(38_90%_55%/0.3)] transition-all text-left group"
            >
              <div className="flex items-center justify-center h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 group-hover:bg-primary/20 transition-colors shrink-0">
                {g.club_type === 'book' ? <BookOpen className="w-5 h-5 text-primary" /> : <Film className="w-5 h-5 text-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{g.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="w-3 h-3" /> {g.member_count}
                  </p>
                  {g.season_status && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize ${statusStyle(g.season_status)}`}>
                      {g.season_status}
                    </span>
                  )}
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground/50 hover:text-muted-foreground">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setConfirmLeave(g)} className="text-destructive focus:text-destructive">
                  Leave club
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </motion.div>
        ))}
      </main>

      {/* Leave confirm dialog */}
      <AlertDialog open={!!confirmLeave} onOpenChange={open => !open && setConfirmLeave(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {confirmLeave?.name}?</AlertDialogTitle>
            <AlertDialogDescription>You'll lose access. Rejoin anytime with the invite code.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeave} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* FAB */}
      <button
        onClick={() => navigate('/setup')}
        className="fixed bottom-6 right-5 z-20 flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_32px_-8px_hsl(38_90%_55%/0.5)] hover:bg-primary/90 active:scale-95 transition-all"
      >
        <Plus className="w-4 h-4" /> Join or Create
      </button>
    </div>
  );
};

export default ClubSelect;
