type VolumeInfo = {
  title?: string;
  authors?: string[];
  averageRating?: number;
  ratingsCount?: number;
};

type GoogleBookLike = {
  volumeInfo?: VolumeInfo;
};

const normalize = (value: string) => value.toLowerCase().trim();

const computeScore = (book: GoogleBookLike, term?: string) => {
  const info = book.volumeInfo ?? {};
  const ratingsCount = info.ratingsCount ?? 0;
  const avgRating = info.averageRating ?? 0;
  const title = info.title ? normalize(info.title) : '';
  const authors = (info.authors ?? []).map(normalize);

  let score = Math.log10(ratingsCount + 1) * 100 + avgRating * 10;

  if (term) {
    const q = normalize(term);
    if (title.startsWith(q)) score += 500;
    else if (title.includes(q)) score += 200;
    if (authors.some(a => a.includes(q))) score += 100;
  }

  return score;
};

export const sortBooksByPopularity = <T extends GoogleBookLike>(books: T[], term?: string) => {
  return [...books].sort((a, b) => computeScore(b, term) - computeScore(a, term));
};
