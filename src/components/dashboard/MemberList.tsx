import { Group, GroupMember, Profile } from '@/hooks/useGroup';
import { Users, Crown, Ghost } from 'lucide-react';

interface Props {
  members: GroupMember[];
  profiles: Profile[];
  group: Group;
  isAdmin: boolean;
  onUpdate: () => void;
}

const MemberList = ({ members, profiles, group, isAdmin, onUpdate }: Props) => {
  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <Users className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
        <h2 className="font-display text-base sm:text-lg font-bold">Members</h2>
        <span className="text-[10px] sm:text-xs text-muted-foreground ml-auto">{members.length} members</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
        {members.map((member) => {
          const profile = getProfile(member.user_id);
          const isGroupAdmin = member.user_id === group.admin_user_id;
          const isPlaceholder = profile?.is_placeholder === true;
          return (
            <div
              key={member.id}
              className={`flex items-center gap-2 rounded-xl p-2 sm:p-3 ${isPlaceholder ? 'bg-muted/10 border border-dashed border-border' : 'bg-muted/20'}`}
            >
              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0 ${isPlaceholder ? 'bg-muted/30 text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                {isPlaceholder ? <Ghost className="w-3 h-3 sm:w-4 sm:h-4" /> : (profile?.display_name?.charAt(0).toUpperCase() || '?')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{profile?.display_name || 'Unknown'}</p>
                {isGroupAdmin && (
                  <span className="flex items-center gap-1 text-xs text-primary">
                    <Crown className="w-3 h-3" /> Admin
                  </span>
                )}
                {isPlaceholder && (
                  <span className="text-xs text-muted-foreground">Member</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MemberList;
