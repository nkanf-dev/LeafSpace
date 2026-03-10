import { create } from 'zustand';
import { persistenceService } from '../services/PersistenceService';
import type { RecentBook } from '../types/domain';

export interface RecentBooksStoreState {
  books: RecentBook[];
  isLoading: boolean;
  addBook: (book: Omit<RecentBook, 'lastOpenedAt'>) => Promise<void>;
  loadBooks: () => Promise<void>;
}

export const useRecentBooksStore = create<RecentBooksStoreState>((set, get) => ({
  books: [],
  isLoading: false,

  addBook: async (book) => {
    const entry: RecentBook = {
      ...book,
      lastOpenedAt: new Date().toISOString(),
    };
    await persistenceService.saveRecentBook(entry);
    // Refresh the list, keeping the newest first
    const books = get().books.filter((b) => b.documentId !== entry.documentId);
    set({ books: [entry, ...books] });
  },

  loadBooks: async () => {
    set({ isLoading: true });
    try {
      const books = await persistenceService.loadRecentBooks();
      set({ books, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));

export const recentBooksStore = useRecentBooksStore;
