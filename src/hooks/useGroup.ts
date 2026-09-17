import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { extractAvatarPath } from '@/lib/security';

export interface Group {
  id: string;
  name: string;
  join_code: string;
  admin_user_id: string;
  club_type: 'movie' | 'book';
  meeting_type: 'remote' | 'in_person';
  meeting_location: string | null;
  created_at: string;
}

export interface Season {
  id: string;
  group_id: string;
  season_number: number;
  title: string | null;
  status: 'picking' | 'guessing' | 'watching' | 'reviewing' | 'completed';
  current_movie_index: number;
  next_call_date: string | null;
  movies_per_member: number;
  watch_interval_days: number;
  guessing_enabled: boolean;
  watch_start_date: string | null;
  call_link: string | null;
}

export interface MoviePick {
  id: string;
  season_id: string;
  /** null when the picker is still secret (guessing/watching, not yet revealed) */
  user_id: string | null;
  tmdb_id: number | null;
  title: string;
  poster_url: string | null;
  year: string | null;
  overview: string | null;
  watch_order: number | null;
  revealed: boolean;
  /** co-pick group number when this is a shared pick (season_participants.pick_group) */
  pick_group?: number | null;
}

export interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  cover_url?: string | null;
  is_placeholder?: boolean;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  profile?: Profile;
}

export function useGroup(groupId?: string) {
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [moviePicks, setMoviePicks] = useState<MoviePick[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  // user_ids in season_participants for the current season (empty = legacy season with no rows)
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    
    if (!groupId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {

      // Fetch group, members, profiles in parallel
      const [groupRes, membersRes, profilesRes] = await Promise.all([
        supabase.from('groups').select('*').eq('id', groupId).single(),
        supabase.from('group_members').select('*').eq('group_id', groupId),
        supabase.from('profiles').select('*'),
      ]);

      if (groupRes.data) {
        setGroup(groupRes.data as Group);
        setIsAdmin(groupRes.data.admin_user_id === user.id);
      }
      if (membersRes.data) setMembers(membersRes.data);
      if (profilesRes.data) {
        const rawProfiles = profilesRes.data as Profile[];
        const signedProfiles = await Promise.all(
          rawProfiles.map(async (profile) => {
            const path = extractAvatarPath(profile.avatar_url);
            if (!path) return profile;
            const { data, error } = await supabase.storage
              .from('avatars')
              .createSignedUrl(path, 60 * 60);
            if (error || !data?.signedUrl) return { ...profile, avatar_url: null };
            return { ...profile, avatar_url: data.signedUrl };
          })
        );
        setProfiles(signedProfiles);
      }

      // Get latest season
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('*')
        .eq('group_id', groupId)
        .order('season_number', { ascending: false })
        .limit(1);

      if (seasonData && seasonData.length > 0) {
        const s = seasonData[0] as Season;
        setSeason(s);

        // Get movie picks for this season via the masked feed: secret columns
        // (film during picking, picker until revealed) come back null.
        const { data: parts } = await supabase.from('season_participants').select('user_id').eq('season_id', s.id);
        setParticipantIds((parts ?? []).map(r => r.user_id));

        const { data: picks, error: picksErr } = await supabase.rpc('get_season_picks', { _season_id: s.id });
        if (picksErr) {
          // RPC not deployed yet (migration pending) — fall back to a direct read
          const { data: direct } = await supabase
            .from('movie_picks')
            .select('*')
            .eq('season_id', s.id)
            .order('watch_order', { ascending: true });
          setMoviePicks((direct as MoviePick[]) ?? []);
        } else if (picks) setMoviePicks(picks as MoviePick[]);
        else setMoviePicks([]);
      } else {
        setSeason(null);
        setMoviePicks([]);
        setParticipantIds([]);
      }
    } catch (err) {
      console.error('Error fetching group data:', err);
    } finally {
      setLoading(false);
    }
  }, [user, groupId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  // Members taking part in the current season. Seasons created before participant
  // tracking have no rows, so an empty list means everyone.
  const seasonMembers = participantIds.length > 0
    ? members.filter(m => participantIds.includes(m.user_id))
    : members;

  return { group, season, moviePicks, members, seasonMembers, participantIds, profiles, loading, isAdmin, refetch: fetchData, getProfile };
}
