// Member badges — computed live from picks, TMDB details, and group rankings.
// Threshold-based: multiple members can share a badge, some may earn none.
// Eligibility: a member must have at least MIN_PICKS watched picks (with the
// relevant metric available) to be considered for a badge.

export type BadgeId =
  | 'crowd_pleaser'
  | 'hidden_gems'
  | 'futurist'
  | 'time_traveler'
  | 'epic_picker'
  | 'quick_watch'
  | 'critics_choice'
  | 'group_favorite'
  | 'bold_choices'
  | 'casual_viewer';

export interface BadgeDef {
  id: BadgeId;
  emoji: string;
  label: string;
  description: string;
  /** Higher metric value = "more" of this badge. */
  direction: 'high' | 'low';
}

export const BADGES: Record<BadgeId, BadgeDef> = {
  crowd_pleaser: {
    id: 'crowd_pleaser',
    emoji: '🍿',
    label: 'Crowd Pleaser',
    description: 'Picks the most popular movies',
    direction: 'high',
  },
  hidden_gems: {
    id: 'hidden_gems',
    emoji: '💎',
    label: 'Hidden Gems',
    description: 'Picks under-the-radar movies',
    direction: 'low',
  },
  futurist: {
    id: 'futurist',
    emoji: '🆕',
    label: 'Futurist',
    description: 'Picks the newest movies',
    direction: 'high',
  },
  time_traveler: {
    id: 'time_traveler',
    emoji: '🏛️',
    label: 'Time Traveler',
    description: 'Picks classic, older movies',
    direction: 'low',
  },
  epic_picker: {
    id: 'epic_picker',
    emoji: '⏳',
    label: 'Epic Picker',
    description: 'Picks long, sprawling movies',
    direction: 'high',
  },
  quick_watch: {
    id: 'quick_watch',
    emoji: '⚡',
    label: 'Quick Watch',
    description: 'Picks short, snappy movies',
    direction: 'low',
  },
  critics_choice: {
    id: 'critics_choice',
    emoji: '⭐',
    label: "Critic's Choice",
    description: 'Picks highly-rated movies',
    direction: 'high',
  },
  group_favorite: {
    id: 'group_favorite',
    emoji: '🎯',
    label: 'Group Favorite',
    description: 'Picks the group consistently loves',
    direction: 'high',
  },
  bold_choices: {
    id: 'bold_choices',
    emoji: '💔',
    label: 'Bold Choices',
    description: 'Picks the group rarely loves — worn proudly',
    direction: 'low',
  },
  casual_viewer: {
    id: 'casual_viewer',
    emoji: '🛋️',
    label: 'Casual Viewer',
    description: "Skips a lot of guesses and rankings — here for the vibes, not the homework",
    direction: 'low',
  },
};

const MIN_PICKS_PER_MEMBER = 3;
// To award a badge, the group needs at least this many eligible members so
// "above/below average" actually means something.
const MIN_ELIGIBLE_MEMBERS = 2;

export interface BadgePickInput {
  /** Canonical pick id */
  pickId: string;
  pickerIds: string[]; // one or more (co-picks)
  runtime: number | null;
  voteAverage: number | null;
  popularity: number | null;
  releaseYear: number | null;
  /** 0..1 love score: 1 = group's favorite that season, 0 = least loved */
  groupLove: number | null;
}

export interface EarnedBadge {
  badge: BadgeDef;
  /** The metric value that earned it (already formatted for display) */
  metricLabel: string;
}

/**
 * Compute earned badges per member.
 * Returns a Map<userId, EarnedBadge[]>. Members with no badges are absent.
 */
export function computeMemberBadges(
  picks: BadgePickInput[],
  /** Subset of badge ids to consider — e.g. book clubs skip runtime ones. */
  enabledBadges: BadgeId[] = Object.keys(BADGES) as BadgeId[],
): Map<string, EarnedBadge[]> {
  // Aggregate per-member metric sums + counts
  type Agg = { sum: number; count: number };
  type MemberAggs = {
    runtime: Agg;
    voteAverage: Agg;
    popularity: Agg;
    releaseYear: Agg;
    groupLove: Agg;
    pickCount: number;
  };
  const byMember = new Map<string, MemberAggs>();

  const ensure = (uid: string): MemberAggs => {
    let m = byMember.get(uid);
    if (!m) {
      m = {
        runtime: { sum: 0, count: 0 },
        voteAverage: { sum: 0, count: 0 },
        popularity: { sum: 0, count: 0 },
        releaseYear: { sum: 0, count: 0 },
        groupLove: { sum: 0, count: 0 },
        pickCount: 0,
      };
      byMember.set(uid, m);
    }
    return m;
  };

  const seenPickByMember = new Set<string>(); // `${uid}:${pickId}`
  for (const p of picks) {
    for (const uid of p.pickerIds) {
      const key = `${uid}:${p.pickId}`;
      if (seenPickByMember.has(key)) continue;
      seenPickByMember.add(key);
      const m = ensure(uid);
      m.pickCount += 1;
      if (p.runtime != null) {
        m.runtime.sum += p.runtime;
        m.runtime.count += 1;
      }
      if (p.voteAverage != null) {
        m.voteAverage.sum += p.voteAverage;
        m.voteAverage.count += 1;
      }
      if (p.popularity != null) {
        m.popularity.sum += p.popularity;
        m.popularity.count += 1;
      }
      if (p.releaseYear != null) {
        m.releaseYear.sum += p.releaseYear;
        m.releaseYear.count += 1;
      }
      if (p.groupLove != null) {
        m.groupLove.sum += p.groupLove;
        m.groupLove.count += 1;
      }
    }
  }

  type MetricKey =
    | 'runtime'
    | 'voteAverage'
    | 'popularity'
    | 'releaseYear'
    | 'groupLove';

  const badgeToMetric: Partial<Record<BadgeId, MetricKey>> = {
    crowd_pleaser: 'popularity',
    hidden_gems: 'popularity',
    futurist: 'releaseYear',
    time_traveler: 'releaseYear',
    epic_picker: 'runtime',
    quick_watch: 'runtime',
    critics_choice: 'voteAverage',
    group_favorite: 'groupLove',
    bold_choices: 'groupLove',
  };

  const formatRuntime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins - h * 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  const formatMetric = (metric: MetricKey, value: number): string => {
    switch (metric) {
      case 'runtime':
        return `Avg ${formatRuntime(value)}`;
      case 'voteAverage':
        return `Avg TMDB ${value.toFixed(1)}/10`;
      case 'popularity':
        return `Avg popularity ${Math.round(value)}`;
      case 'releaseYear':
        return `Avg year ${Math.round(value)}`;
      case 'groupLove':
        return `${Math.round(value * 100)}% group love`;
    }
  };

  const result = new Map<string, EarnedBadge[]>();

  for (const badgeId of enabledBadges) {
    const def = BADGES[badgeId];
    const metric = badgeToMetric[badgeId];
    if (!metric) continue; // skip non-pick-metric badges (e.g. casual_viewer)

    // Eligible members: enough total picks AND has data for this metric
    const eligible: { uid: string; avg: number }[] = [];
    for (const [uid, agg] of byMember) {
      if (agg.pickCount < MIN_PICKS_PER_MEMBER) continue;
      const a = agg[metric];
      if (a.count < MIN_PICKS_PER_MEMBER) continue;
      eligible.push({ uid, avg: a.sum / a.count });
    }

    if (eligible.length < MIN_ELIGIBLE_MEMBERS) continue;

    // Group stats
    const values = eligible.map(e => e.avg).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    const min = values[0];
    const max = values[values.length - 1];
    const range = max - min;
    if (range <= 0) continue; // everyone identical → nobody stands out

    // Threshold: a member earns the badge if they're in the top/bottom
    // tertile relative to the group's range. With small groups (2-3
    // eligible), we still allow only the clear leader to earn it.
    const tertileSize = range / 3;
    for (const e of eligible) {
      const passes =
        def.direction === 'high'
          ? e.avg >= max - tertileSize && e.avg > median
          : e.avg <= min + tertileSize && e.avg < median;
      if (!passes) continue;

      const earned: EarnedBadge = {
        badge: def,
        metricLabel: formatMetric(metric, e.avg),
      };
      const list = result.get(e.uid) || [];
      list.push(earned);
      result.set(e.uid, list);
    }
  }

  return result;
}

export interface EngagementInput {
  /** All members eligible to earn this badge (typically all group members). */
  memberIds: string[];
  /**
   * For each member, how many guesses they were *expected* to submit
   * (across all seasons where guessing was enabled, the member was a
   * participant, and at least one non-self pick has been watched/revealed).
   */
  guessesExpected: Record<string, number>;
  guessesMade: Record<string, number>;
  /**
   * For each member, how many picks they were expected to rank
   * (across all seasons in reviewing/completed where they participated and
   * didn't pick the movie). Members rank everyone else's picks.
   */
  rankingsExpected: Record<string, number>;
  rankingsMade: Record<string, number>;
}

/**
 * Award the "Casual Viewer" badge to members whose participation rate in
 * guessing + ranking is meaningfully below the rest of the group.
 *
 * Rules:
 * - Member must have had a meaningful number of expected actions
 *   (>= MIN_EXPECTED_ACTIONS) for their stats to count.
 * - Their completion rate must be at most CASUAL_THRESHOLD.
 * - At least one peer must have a noticeably higher rate (>= GAP) — we don't
 *   shame anyone in a group where everyone is equally checked-out.
 */
export function computeCasualViewerBadges(input: EngagementInput): Map<string, EarnedBadge> {
  const MIN_EXPECTED_ACTIONS = 5;
  const CASUAL_THRESHOLD = 0.6; // completed 60% or less
  const GAP = 0.25; // at least one peer is 25 percentage points more engaged

  const rates = new Map<string, { rate: number; expected: number; made: number }>();
  for (const uid of input.memberIds) {
    const expected = (input.guessesExpected[uid] || 0) + (input.rankingsExpected[uid] || 0);
    if (expected < MIN_EXPECTED_ACTIONS) continue;
    const made = (input.guessesMade[uid] || 0) + (input.rankingsMade[uid] || 0);
    rates.set(uid, { rate: made / expected, expected, made });
  }

  if (rates.size < 2) return new Map();

  const allRates = Array.from(rates.values()).map(r => r.rate);
  const maxRate = Math.max(...allRates);

  const result = new Map<string, EarnedBadge>();
  for (const [uid, r] of rates) {
    if (r.rate > CASUAL_THRESHOLD) continue;
    if (maxRate - r.rate < GAP) continue;
    result.set(uid, {
      badge: BADGES.casual_viewer,
      metricLabel: `Completed ${r.made}/${r.expected} (${Math.round(r.rate * 100)}%) of guesses & rankings`,
    });
  }
  return result;
}

