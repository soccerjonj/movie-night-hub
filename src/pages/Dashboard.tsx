import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useGroup } from '@/hooks/useGroup';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Film, LogOut, Settings, ArrowLeft, DoorOpen } from 'lucide-react';
import AvatarUpload from '@/components/dashboard/AvatarUpload';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import SeasonStatus from '@/components/dashboard/SeasonStatus';
import AdminPanel from '@/components/dashboard/AdminPanel';
import MoviePickPhase from '@/components/dashboard/MoviePickPhase';
import GuessingPhase from '@/components/dashboard/GuessingPhase';
import WatchingPhase from '@/components/dashboard/WatchingPhase';
import ReviewPhase from '@/components/dashboard/ReviewPhase';
import MemberList from '@/components/dashboard/MemberList';
import Scoreboard from '@/components/dashboard/Scoreboard';
import History from '@/components/dashboard/History';

const Dashboard = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const { user, signOut } = useAuth();
  const { group, season, moviePicks, members, profiles, loading, isAdmin, refetch, getProfile } = useGroup(groupId);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const handleLeaveGroup = async () => {
    if (!user || !groupId) return;
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Left club', description: 'You have left this club.' });
      navigate('/clubs', { replace: true });
    }
  };

  useEffect(() => {
    if (!loading && !group) {
      navigate('/clubs');
    }
  }, [loading, group, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary">
          <Film className="w-12 h-12" />
        </div>
      </div>
    );
  }

  if (!group) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container max-w-5xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/clubs')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Film className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-base sm:text-lg font-bold truncate">{group.name}</h1>
              {season && tab === 'current' && (
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                  Season {season.season_number}{season.title ? ` — ${season.title}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAdminPanel(!showAdminPanel)}
                className="h-8 w-8 text-primary/70 hover:text-primary"
              >
                <Settings className="w-3.5 h-3.5" />
              </Button>
            )}
            {user && (
              <AvatarUpload
                currentAvatarUrl={getProfile(user.id)?.avatar_url || null}
                displayName={getProfile(user.id)?.display_name || ''}
                onUploaded={refetch}
              />
            )}
            <span className="text-sm text-muted-foreground hidden sm:block">
              {getProfile(user!.id)?.display_name}
            </span>
            {!isAdmin && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive">
                    <DoorOpen className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave {group.name}?</AlertDialogTitle>
                    <AlertDialogDescription>You'll lose access to this club. You can rejoin later with the invite code.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleLeaveGroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Leave</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" onClick={() => { signOut(); navigate('/'); }}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="container max-w-5xl mx-auto px-3 sm:px-4">
          <div className="flex gap-1 -mb-px">
            <button
              onClick={() => setTab('current')}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                tab === 'current'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Current Season
            </button>
            <button
              onClick={() => setTab('history')}
              className={`px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                tab === 'history'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              History
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-4 sm:space-y-8">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {tab === 'current' ? (
            <>
              {/* Admin Panel */}
              {isAdmin && showAdminPanel && (
                <AdminPanel
                  group={group}
                  season={season}
                  moviePicks={moviePicks}
                  members={members}
                  profiles={profiles}
                  onUpdate={refetch}
                  showPanel={showAdminPanel}
                  setShowPanel={setShowAdminPanel}
                />
              )}

              {/* Season Status */}
              {season && <SeasonStatus season={season} moviePicks={moviePicks} getProfile={getProfile} />}

              {/* Phase-specific content */}
              {season?.status === 'picking' && (
                <MoviePickPhase season={season} moviePicks={moviePicks} members={members} profiles={profiles} onUpdate={refetch} />
              )}
              {season?.status === 'guessing' && (
                <GuessingPhase season={season} moviePicks={moviePicks} members={members} profiles={profiles} onUpdate={refetch} />
              )}
              {season?.status === 'watching' && (
                <WatchingPhase season={season} moviePicks={moviePicks} profiles={profiles} members={members} getProfile={getProfile} isAdmin={isAdmin} onUpdate={refetch} />
              )}
              {season?.status === 'reviewing' && (
                <ReviewPhase season={season} moviePicks={moviePicks} profiles={profiles} members={members} onUpdate={refetch} />
              )}

              {/* Scoreboard */}
              {group && (
                <Scoreboard group={group} season={season} profiles={profiles} members={members} />
              )}

              {/* Members */}
              <MemberList members={members} profiles={profiles} group={group} isAdmin={isAdmin} onUpdate={refetch} />

              {/* No season yet */}
              {!season && !isAdmin && (
                <div className="glass-card rounded-2xl p-12 text-center">
                  <Film className="w-16 h-16 text-primary/30 mx-auto mb-4" />
                  <h2 className="text-xl font-display font-bold mb-2">No Season Yet</h2>
                  <p className="text-muted-foreground">Waiting for your admin to start a new season.</p>
                </div>
              )}
            </>
          ) : (
            <History group={group} profiles={profiles} members={members} />
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default Dashboard;
