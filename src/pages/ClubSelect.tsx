import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Plus, Users, Film, BookOpen, LogOut, MoreHorizontal, ChevronRight } from 'lucide-react';
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
  season_number: number | null;
  club_type: 'movie' | 'book';
}

const STATUS_STYLES: Record<string, string> = {
  watching:  'bg-amber-500/15 text-amber-400 border-amber-500/20',
  reviewing: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
  completed: 'bg-green-500/15 text-green-400 border-green-500/20',
  picking:   'bg-violet-500/15 text-violet-400 border-violet-500/20',
};

const STATUS_STRIP: Record<string, string> = {
  watching:  'bg-amber-400',
  reviewing: 'bg-sky-400',
  completed: 'bg-green-400',
  picking:   'bg-violet-400',
};

const ClubSelect = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState<GroupInfo | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

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

      const [{ data: memberships }, { data: profile }] = await Promise.all([
        supabase.from('group_members').select('group_id').eq('user_id', user.id),
        supabase.from('profiles').select('display_name').eq('id', user.id).single(),
      ]);

      if (profile?.display_name) setDisplayName(profile.display_name);

      if (!memberships || memberships.length === 0) { navigate('/setup', { replace: true }); return; }
      const groupIds = memberships.map(m => m.group_id);
      const { data: groupsData } = await supabase
        .from('groups').select('id, name, club_type').in('id', groupIds);
      if (!groupsData) { setLoading(false); return; }
      const groupInfos: GroupInfo[] = [];
      for (const g of groupsData) {
        const [{ count }, { data: latestSeason }] = await Promise.all([
          supabase.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', g.id),
          supabase.from('seasons').select('status, season_number').eq('group_id', g.id).order('season_number', { ascending: false }).limit(1),
        ]);
        groupInfos.push({
          id: g.id,
          name: g.name,
          member_count: count ?? 0,
          season_status: latestSeason?.[0]?.status ?? null,
          season_number: latestSeason?.[0]?.season_number ?? null,
          club_type: (g as any).club_type || 'movie',
        });
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

  const greeting = displayName ? `Hey, ${displayName.split(' ')[0]} 👋` : 'Your Clubs';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-10 bg-card/80 backdrop-blur-xl border-b border-border/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src={logo} alt="Movie Club Hub" className="h-8 object-contain" />
          <div>
            <h1 className="font-display text-base font-bold text-gradient-gold leading-tight">{greeting}</h1>
            {groups.length > 0 && (
              <p className="text-[11px] text-muted-foreground leading-tight">
                {groups.length} {groups.length === 1 ? 'club' : 'clubs'}
              </p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={() => { signOut(); navigate('/'); }}>
          <LogOut className="w-4 h-4" />
        </Button>
      </header>

      <main className="flex-1 px-4 pt-5 pb-28 space-y-3">
        {groups.map((g, i) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card/70 shadow-sm hover:border-primary/30 hover:shadow-md hover:bg-card/90 transition-all duration-200">
              {/* Left status accent strip */}
              <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${g.season_status ? (STATUS_STRIP[g.season_status] ?? 'bg-border') : 'bg-border/30'}`} />

              <div className="flex items-center">
                <button
                  onClick={() => navigate(`/dashboard/${g.id}`)}
                  className="flex-1 flex items-center gap-3.5 pl-4 pr-3 py-3.5 text-left"
                >
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
                    {g.club_type === 'book'
                      ? <BookOpen className="w-4.5 h-4.5 text-primary" />
                      : <Film className="w-4.5 h-4.5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{g.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" /> {g.member_count}
                      </span>
                      {g.season_number && (
                        <span className="text-xs text-muted-foreground">Season {g.season_number}</span>
                      )}
                      {g.season_status && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLES[g.season_status] ?? 'bg-muted/30 text-muted-foreground border-border/40'}`}>
                          {g.season_status}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 mr-1.5 text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/30 shrink-0">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setConfirmLeave(g)} className="text-destructive focus:text-destructive">
                      Leave club
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </motion.div>
        ))}
      </main>

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
