import { MoviePick } from '@/hooks/useGroup';

/**
 * A "unit" is what occupies one slot in the watch schedule: a solo pick, or all
 * rows of one shared pick (a co-pick group — same film, credited to several
 * members). Rows of a shared pick carry the same pick_group and, once ordered,
 * the same watch_order. Anything that assigns slots, counts films, or reveals a
 * picker must operate on units, never on raw rows.
 */
export function pickUnits(picks: MoviePick[]): MoviePick[][] {
  const units: MoviePick[][] = [];
  const byGroup = new Map<number, MoviePick[]>();
  picks.forEach((p) => {
    if (p.pick_group == null) {
      units.push([p]);
      return;
    }
    let unit = byGroup.get(p.pick_group);
    if (!unit) {
      unit = [];
      byGroup.set(p.pick_group, unit);
      units.push(unit);
    }
    unit.push(p);
  });
  return units;
}

/** Units sorted by their current watch_order (unordered rows sort last). */
export function orderedUnits(picks: MoviePick[]): MoviePick[][] {
  const sorted = [...picks].sort((a, b) => (a.watch_order ?? Infinity) - (b.watch_order ?? Infinity));
  return pickUnits(sorted);
}

/** All rows occupying a given slot. */
export function unitAtSlot(picks: MoviePick[], slot: number): MoviePick[] {
  return picks.filter((p) => p.watch_order === slot);
}

/** Number of slots in the schedule. */
export function unitCount(picks: MoviePick[]): number {
  return pickUnits(picks).length;
}

/** Fisher–Yates; the sort(() => Math.random() - 0.5) idiom is biased. */
export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Display name(s) for a unit's picker(s), e.g. "Julia & Gavin". */
export function unitPickerNames(unit: MoviePick[], nameOf: (userId: string | null) => string): string {
  return unit.map((p) => nameOf(p.user_id)).join(' & ');
}
