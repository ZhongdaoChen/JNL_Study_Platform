import type { Word } from './types';

export type WordSortKey = 'dueDate' | 'readProficiency';
export type SortDirection = 'asc' | 'desc';

export interface WordSort {
  key: WordSortKey;
  direction: SortDirection;
}

export function sortWords(words: Word[], sort: WordSort): Word[] {
  return [...words].sort((a, b) => {
    const result = sort.key === 'dueDate'
      ? compareDateThenText(a, b)
      : compareNumberThenText(a.repetitions, b.repetitions, a, b);
    return sort.direction === 'asc' ? result : -result;
  });
}

function compareDateThenText(a: Word, b: Word): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return compareText(a, b);
}

function compareNumberThenText(aValue: number, bValue: number, a: Word, b: Word): number {
  if (aValue !== bValue) return aValue - bValue;
  return compareText(a, b);
}

function compareText(a: Word, b: Word): number {
  return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
}
