import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Plus, Users, ArrowRight, X, Film, BookOpen } from 'lucide-react';
import logo from '@/assets/logo.png';
import { motion } from 'framer-motion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

interface GroupInfo {
  id: string;
  name: string;
  member_count: number;
  season_status: string | null;
  club_type: 'movie' | 'book';
}

const ClubSelect = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const handleLeave = async (groupId: string, groupName: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Left club', description: `You left ${groupName}.` });
    const remaining = groups.filter(g => g.id !== groupId);
    if (remaining.length === 0) {
      navigate('/setup', { replace: true });
    } else {
      setGroups(remaining);
    }
  };

  useEffect(() => {
    const fetchGroups = async () => {
      if (!user) return;
      setLoading(true);

      // Get all groups the user is a member of
      const { data: memberships } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);

      if (!memberships || memberships.length === 0) {
        // No groups — send to setup
        navigate('/setup', { replace: true });
        return;
      }

      const groupIds = memberships.map(m => m.group_id);

      // Fetch group details
      const { data: groupsData } = await supabase
        .from('groups')
        .select('id, name, club_type')
        .in('id', groupIds);

      if (!groupsData) {
        setLoading(false);
        return;
      }

      // Get member counts and current season status
      const groupInfos: GroupInfo[] = [];
      for (const g of groupsData) {
        const [{ count }, { data: latestSeason }] = await Promise.all([
          supabase
            .from('group_members')
            .select('*', { count: 'exact', head: true })
            .eq('group_id', g.id),
          supabase
            .from('seasons')
            .select('status')
            .eq('group_id', g.id)
            .order('season_number', { ascending: false })
            .limit(1),
        ]);
        const status = latestSeason && latestSeason.length > 0 ? latestSeason[0].status : null;
        groupInfos.push({ id: g.id, name: g.name, member_count: count ?? 0, season_status: status, club_type: (g as any).club_type || 'movie' });
      }

      setGroups(groupInfos);
      setLoading(false);
    };

    fetchGroups();
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <img src={logo} alt="Loading" className="h-12 object-contain rounded-xl animate-pulse mix-blend-screen" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-primary/5 blur-[140px]" />
      <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px] rounded-full bg-primary/3 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="glass-card rounded-2xl p-8 w-full max-w-md mx-4 relative z-10"
        style={{ boxShadow: '0 0 60px -20px hsl(38 90% 55% / 0.15), 0 25px 50px -12px rgba(0,0,0,0.5)' }}
      >
        <div className="space-y-6">
          <div className="text-center">
            <div className="relative inline-block mb-4">
              <div className="absolute inset-0 rounded-2xl blur-xl bg-primary/20 scale-110" />
              <img src={logo} alt="Movie Club" className="h-16 object-contain rounded-2xl relative mix-blend-screen" />
            </div>
            <h1 className="text-2xl font-display font-bold text-gradient-gold">Your Clubs</h1>
            <p className="text-muted-foreground mt-2 text-sm">Choose a club to enter</p>
          </div>

          <div className="space-y-2.5">
            {groups.map((g, index) => (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                className="flex items-center gap-2"
              >
                <button
                  onClick={() => navigate(`/dashboard/${g.id}`)}
                  className="flex-1 flex items-center gap-4 rounded-xl p-4 border border-border/50 bg-gradient-to-r from-muted/20 to-muted/5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-[0_0_20px_-8px_hsl(38_90%_55%_/_0.3)] transition-all text-left group"
                >
                  <div className="flex items-center justify-center h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 group-hover:bg-primary/20 group-hover:border-primary/35 transition-colors shrink-0">
                    {g.club_type === 'book' ? (
                      <BookOpen className="w-5 h-5 text-primary" />
                    ) : (
                      <Film className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate group-hover:text-primary/90 transition-colors">{g.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" /> {g.member_count} members
                      </p>
                      {g.season_status && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 border border-primary/15 text-primary capitalize">
                          {g.season_status === 'completed' ? 'Completed' : g.season_status}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <X className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Leave {g.name}?</AlertDialogTitle>
                      <AlertDialogDescription>You'll lose access to this club. You can rejoin later with the invite code.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleLeave(g.id, g.name)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Leave</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </motion.div>
            ))}
          </div>

          <Button
            variant="outline"
            className="w-full border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all"
            onClick={() => navigate('/setup')}
          >
            <Plus className="w-4 h-4 mr-2" /> Join or Create Another Club
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default ClubSelect;
