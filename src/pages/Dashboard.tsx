import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useGroup } from '@/hooks/useGroup';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogOut, Settings, ArrowLeft, DoorOpen } from 'lucide-react';
import AdminWalkthrough from '@/components/dashboard/AdminWalkthrough';
import logo from '@/assets/logo.png';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import SeasonStatus from '@/components/dashboard/SeasonStatus';
import AdminPanel from '@/components/dashboard/AdminPanel';
import MoviePickPhase from '@/components/dashboard/MoviePickPhase';
import BookPickPhase from '@/components/dashboard/BookPickPhase';
import GuessingPhase from '@/components/dashboard/GuessingPhase';
import WatchingPhase from '@/components/dashboard/WatchingPhase';
import ReviewPhase from '@/components/dashboard/ReviewPhase';
import MemberList from '@/components/dashboard/MemberList';
import Scoreboard from '@/components/dashboard/Scoreboard';
import History from '@/components/dashboard/History';
import MovieRevealDialog from '@/components/dashboard/MovieRevealDialog';
import { getClubLabels } from '@/lib/clubTypes';

const Dashboard = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const { user, signOut } = useAuth();
  const { group, season, moviePicks, members, profiles, loading, isAdmin, refetch, getProfile } = useGroup(groupId);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [hasEverGuessed, setHasEverGuessed] = useState(false);
  const [openProfileUserId, setOpenProfileUserId] = useState<string | null>(null);
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  const labels = getClubLabels(group?.club_type ?? 'movie');
  const isBookClub = labels.type === 'book';

  useEffect(() => {
    if (!groupId) return;
    const checkPastGuessing = async () => {
      const { data } = await supabase
        .from('seasons')
        .select('id')
        .eq('group_id', groupId)
        .eq('guessing_enabled', true)
        .limit(1);
      setHasEverGuessed((data?.length ?? 0) > 0);
    };
    checkPastGuessing();
  }, [groupId]);

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

  // Show walkthrough for new groups
  useEffect(() => {
    if (groupId && isAdmin && localStorage.getItem(`show_walkthrough_${groupId}`) === 'true') {
      setShowWalkthrough(true);
      localStorage.removeItem(`show_walkthrough_${groupId}`);
    }
  }, [groupId, isAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <img src={logo} alt="Loading" className="h-12 object-contain rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!group) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Admin Walkthrough */}
      {showWalkthrough && (
        <AdminWalkthrough
          groupId={groupId!}
          labels={labels}
          onDismiss={() => setShowWalkthrough(false)}
        />
      )}
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container max-w-5xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/clubs')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <img src={logo} alt="Club" className="h-8 sm:h-10 object-contain rounded-xl shrink-0" />
            <div className="min-w-0">
              <h1 className="font-display text-base sm:text-lg font-bold truncate">{group.name}</h1>
              {season && tab === 'current' && (
                <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                  {labels.seasonNoun} {season.season_number}{season.title ? ` — ${season.title}` : ''}
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
              <button
                onClick={() => setOpenProfileUserId(user.id)}
                className="relative group shrink-0"
              >
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                  {getProfile(user.id)?.avatar_url ? (
                    <img src={getProfile(user.id)?.avatar_url!} alt={getProfile(user.id)?.display_name || ''} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs sm:text-sm font-bold text-primary">
                      {getProfile(user.id)?.display_name?.charAt(0).toUpperCase() || '?'}
                    </span>
                  )}
                </div>
              </button>
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
              Current {labels.seasonNoun}
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

              {/* Movie Reveal Popup - only for movie clubs with guessing */}
              {season?.status === 'watching' && season.guessing_enabled && !isBookClub && (
                <MovieRevealDialog season={season} moviePicks={moviePicks} profiles={profiles} getProfile={getProfile} />
              )}

              {/* Season Status */}
              {season && <SeasonStatus season={season} moviePicks={moviePicks} getProfile={getProfile} clubType={labels.type} group={group} />}

              {/* Phase-specific content */}
              {season?.status === 'picking' && (
                isBookClub ? (
                  <BookPickPhase season={season} moviePicks={moviePicks} members={members} profiles={profiles} onUpdate={refetch} />
                ) : (
                  <MoviePickPhase season={season} moviePicks={moviePicks} members={members} profiles={profiles} onUpdate={refetch} />
                )
              )}
              {season?.status === 'guessing' && !isBookClub && (
                <GuessingPhase season={season} moviePicks={moviePicks} members={members} profiles={profiles} onUpdate={refetch} />
              )}
              {season?.status === 'watching' && (
                <WatchingPhase season={season} moviePicks={moviePicks} profiles={profiles} members={members} getProfile={getProfile} isAdmin={isAdmin} onUpdate={refetch} clubType={labels.type} />
              )}
              {season?.status === 'reviewing' && (
                <ReviewPhase season={season} moviePicks={moviePicks} profiles={profiles} members={members} onUpdate={refetch} clubType={labels.type} />
              )}

              {/* Scoreboard - only for clubs that have guessing */}
              {group && !isBookClub && (season?.guessing_enabled || hasEverGuessed) && (
                <Scoreboard group={group} season={season} profiles={profiles} members={members} collapsed={!season?.guessing_enabled} />
              )}

              {/* Members */}
              <MemberList members={members} profiles={profiles} group={group} isAdmin={isAdmin} onUpdate={refetch} externalSelectedUserId={openProfileUserId} onExternalSelectedClear={() => setOpenProfileUserId(null)} />

              {/* No season yet */}
              {!season && !isAdmin && (
                <div className="glass-card rounded-2xl p-12 text-center">
                  <img src={logo} alt="" className="h-16 object-contain rounded-xl mx-auto mb-4 opacity-30" />
                  <h2 className="text-xl font-display font-bold mb-2">No {labels.seasonNoun} Yet</h2>
                  <p className="text-muted-foreground">Waiting for your admin to start a new {labels.seasonNoun.toLowerCase()}.</p>
                </div>
              )}
            </>
          ) : (
            <History group={group} profiles={profiles} members={members} />
          )}

          {/* Always render MemberList dialog for profile access from any tab */}
          {tab !== 'current' && (
            <div className="hidden">
              <MemberList members={members} profiles={profiles} group={group} isAdmin={isAdmin} onUpdate={refetch} externalSelectedUserId={openProfileUserId} onExternalSelectedClear={() => setOpenProfileUserId(null)} />
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default Dashboard;
