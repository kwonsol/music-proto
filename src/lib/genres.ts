export type GenreId = 'pop' | 'hiphop' | 'electronic' | 'rock' | 'rnb';

export const GENRE_IDS: GenreId[] = ['pop', 'hiphop', 'electronic', 'rock', 'rnb'];

export const GENRE_LABEL: Record<GenreId, string> = {
  pop: 'Pop',
  hiphop: 'Hip-hop',
  electronic: 'Electronic',
  rock: 'Rock',
  rnb: 'R&B',
};

export const GENRE_INDEX: Record<GenreId, number> = { pop: 0, hiphop: 1, electronic: 2, rock: 3, rnb: 4 };
