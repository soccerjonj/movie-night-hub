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
  season_title: string | null;
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

const STATUS_HINT: Record<string, string> = {
  watching:  'Currently watching',
  reviewing: 'Ranking picks',
  completed: 'Season complete',
  picking:   'Choosing picks',
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
          supabase.from('seasons').select('status, season_number, title').eq('group_id', g.id).order('season_number', { ascending: false }).limit(1),
        ]);
        groupInfos.push({
          id: g.id, name: g.name, member_count: count ?? 0,
          season_status: latestSeason?.[0]?.status ?? null,
          season_number: latestSeason?.[0]?.season_number ?? null,
          season_title: latestSeason?.[0]?.title ?? null,
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

  const firstName = displayName?.split(' ')[0] ?? null;
  const solo = groups.length === 1;

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-hidden">
      {/* Subtle background glow */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,hsl(38_90%_55%/0.08),transparent_70%)]" />

      {/* Sign-out */}
      <div className="absolute top-4 right-4 z-10">
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground/50 hover:text-muted-foreground" onClick={() => { signOut(); navigate('/'); }}>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>

      {/* Main — optically centered slightly above midpoint */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 pb-16 gap-6">

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center text-center gap-2.5"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl scale-150 opacity-60" />
            <img src={logo} alt="Club Hub" className="relative h-14 object-contain" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-gradient-gold">
              {firstName ? `Welcome back, ${firstName}` : 'Your Clubs'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {solo ? 'Jump back into your club' : `You're in ${groups.length} clubs`}
            </p>
          </div>
        </motion.div>

        {/* Club cards */}
        <div className="w-full max-w-sm flex flex-col gap-2.5">
          {!solo && (
            <p className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-widest px-1 mb-0.5">
              Your Clubs
            </p>
          )}
          {groups.map((g, i) => (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.07, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 shadow-sm hover:border-primary/30 hover:shadow-lg hover:bg-card/90 transition-all duration-200">
                <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl ${g.season_status ? (STATUS_STRIP[g.season_status] ?? 'bg-border') : 'bg-border/30'}`} />
                <div className="flex items-center">
                  <button
                    onClick={() => navigate(`/dashboard/${g.id}`)}
                    className="flex-1 flex items-center gap-4 pl-5 pr-3 py-4 text-left"
                  >
                    {/* Icon */}
                    <div className="flex items-center justify-center h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
                      {g.club_type === 'book'
                        ? <BookOpen className="w-5 h-5 text-primary" />
                        : <Film className="w-5 h-5 text-primary" />}
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-base truncate leading-snug">{g.name}</p>

                      {/* Season title or status hint */}
                      {g.season_status && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {STATUS_HINT[g.season_status] ?? g.season_status}
                          {g.season_title ? ` · ${g.season_title}` : g.season_number ? ` · Season ${g.season_number}` : ''}
                        </p>
                      )}

                      {/* Meta row */}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
                          <Users className="w-3 h-3" /> {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
                        </span>
                        {g.season_status && (
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLES[g.season_status] ?? 'bg-muted/30 text-muted-foreground border-border/40'}`}>
                            {g.season_status}
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 mr-2 text-muted-foreground/25 hover:text-muted-foreground hover:bg-muted/30 shrink-0">
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
        </div>

        {/* Join / Create — secondary style for solo users, primary for none */}
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => navigate('/setup')}
          className={`w-full max-w-sm flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all active:scale-[0.98] ${
            solo
              ? 'border border-border/60 bg-card/50 text-muted-foreground hover:border-border hover:text-foreground hover:bg-card/80'
              : 'bg-primary text-primary-foreground shadow-[0_8px_32px_-8px_hsl(38_90%_55%/0.4)] hover:bg-primary/90'
          }`}
        >
          <Plus className="w-4 h-4" /> Join or Create a Club
        </motion.button>
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
    </div>
  );
};

export default ClubSelect;
