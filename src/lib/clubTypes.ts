export type ClubType = 'movie' | 'book';

export interface ClubLabels {
  type: ClubType;
  item: string;         // "movie" or "book"
  Item: string;         // "Movie" or "Book"
  items: string;        // "movies" or "books"
  Items: string;        // "Movies" or "Books"
  pick: string;         // "movie" or "book"
  Pick: string;         // "Movie" or "Book"
  watching: string;     // "watching" or "reading"
  Watching: string;     // "Watching" or "Reading"
  watched: string;      // "watched" or "read"
  Watched: string;      // "Watched" or "Read"
  watch: string;        // "watch" or "read"
  Watch: string;        // "Watch" or "Read"
  searchPlaceholder: string;
  nowAction: string;    // "Now Watching" or "Now Reading"
  statusLabels: Record<string, string>;
  scheduleLabel: string; // "Watch Schedule" or "Reading Schedule"
  pickVerb: string;     // "Pick Your Movie" or "Pick Your Book"
  letterboxdEnabled: boolean;
  externalLink?: { label: string; getUrl: (title: string, year?: string) => string };
  seasonNoun: string;   // "Season" or "Book"
  seasonNounPlural: string; // "Seasons" or "Books"
}

const movieLabels: ClubLabels = {
  type: 'movie',
  item: 'movie', Item: 'Movie',
  items: 'movies', Items: 'Movies',
  pick: 'movie', Pick: 'Movie',
  watching: 'watching', Watching: 'Watching',
  watched: 'watched', Watched: 'Watched',
  watch: 'watch', Watch: 'Watch',
  searchPlaceholder: 'Search for a movie...',
  nowAction: 'Now Watching',
  statusLabels: {
    picking: '🎬 Picking Movies',
    guessing: '🔮 Guessing Round',
    watching: '🍿 Watching Season',
    reviewing: '⭐ Season Review',
    completed: '✅ Book Complete',
  },
  scheduleLabel: 'Watch Schedule',
  pickVerb: 'Pick Your Movie',
  letterboxdEnabled: true,
  seasonNoun: 'Season',
  seasonNounPlural: 'Seasons',
  externalLink: {
    label: 'Letterboxd',
    getUrl: (title: string, year?: string) => {
      const q = encodeURIComponent(year ? `${title} ${year}` : title);
      return `https://letterboxd.com/search/${q}/`;
    },
  },
};

const bookLabels: ClubLabels = {
  type: 'book',
  item: 'book', Item: 'Book',
  items: 'books', Items: 'Books',
  pick: 'book', Pick: 'Book',
  watching: 'reading', Watching: 'Reading',
  watched: 'read', Watched: 'Read',
  watch: 'read', Watch: 'Read',
  searchPlaceholder: 'Search for a book...',
  nowAction: 'Now Reading',
  statusLabels: {
    picking: '📚 Picking Books',
    guessing: '🔮 Guessing Round',
    watching: '📖 Reading Book',
    reviewing: '⭐ Book Review',
    completed: '✅ Season Complete',
  },
  scheduleLabel: 'Reading Schedule',
  pickVerb: 'Pick Your Book',
  letterboxdEnabled: false,
  seasonNoun: 'Book',
  seasonNounPlural: 'Books',
  externalLink: {
    label: 'Goodreads',
    getUrl: (title: string) => {
      const q = encodeURIComponent(title);
      return `https://www.goodreads.com/search?q=${q}`;
    },
  },
};

export function getClubLabels(clubType: ClubType): ClubLabels {
  return clubType === 'book' ? bookLabels : movieLabels;
}
