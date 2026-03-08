import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Film, Plus, Users, ArrowRight, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

interface GroupInfo {
  id: string;
  name: string;
  member_count: number;
  season_status: string | null;
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
        .select('id, name')
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
        groupInfos.push({ id: g.id, name: g.name, member_count: count ?? 0, season_status: status });
      }

      // If only one group, go directly to dashboard
      if (groupInfos.length === 1) {
        navigate(`/dashboard/${groupInfos[0].id}`, { replace: true });
        return;
      }

      setGroups(groupInfos);
      setLoading(false);
    };

    fetchGroups();
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary">
          <Film className="w-12 h-12" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="glass-card rounded-2xl p-8 w-full max-w-md mx-4 relative z-10"
      >
        <div className="space-y-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Film className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold">Your Clubs</h1>
            <p className="text-muted-foreground mt-2">Choose a club to enter</p>
          </div>

          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.id} className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/dashboard/${g.id}`)}
                  className="flex-1 flex items-center gap-4 rounded-xl p-4 border border-border bg-muted/10 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Film className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{g.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="w-3 h-3" /> {g.member_count} members
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive">
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
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            className="w-full"
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
