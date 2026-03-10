import Dexie from 'dexie';
import type { WorkspaceSnapshot, RecentBook } from '../types/domain';

// ---------------------------------------------------------------------------
// Dexie database schema
// ---------------------------------------------------------------------------

class LeafSpaceDb extends Dexie {
  workspaces!: Dexie.Table<WorkspaceSnapshot, string>;
  recentBooks!: Dexie.Table<RecentBook, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      workspaces: 'documentId',
      recentBooks: 'documentId',
    });
  }
}

// ---------------------------------------------------------------------------
// Port – wraps the Dexie instance; can be swapped in tests
// ---------------------------------------------------------------------------

export class DexieWorkspacePersistencePort {
  private db: LeafSpaceDb;

  constructor(name = 'leafspace-workspace') {
    this.db = new LeafSpaceDb(name);
  }

  async loadWorkspace(documentId: string): Promise<WorkspaceSnapshot | null> {
    return (await this.db.workspaces.get(documentId)) ?? null;
  }

  async saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    await this.db.workspaces.put(snapshot);
  }

  async loadRecentBooks(): Promise<RecentBook[]> {
    return this.db.recentBooks.orderBy('lastOpenedAt').reverse().toArray();
  }

  async saveRecentBook(book: RecentBook): Promise<void> {
    await this.db.recentBooks.put(book);
  }

  async deleteDatabase(): Promise<void> {
    await this.db.delete();
  }
}

// ---------------------------------------------------------------------------
// Service – public API consumed by stores
// ---------------------------------------------------------------------------

export class PersistenceService {
  private port: DexieWorkspacePersistencePort;

  constructor(port: DexieWorkspacePersistencePort = new DexieWorkspacePersistencePort()) {
    this.port = port;
  }

  async loadWorkspace(documentId: string): Promise<WorkspaceSnapshot | null> {
    return this.port.loadWorkspace(documentId);
  }

  async saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    return this.port.saveWorkspace(snapshot);
  }

  async loadRecentBooks(): Promise<RecentBook[]> {
    return this.port.loadRecentBooks();
  }

  async saveRecentBook(book: RecentBook): Promise<void> {
    return this.port.saveRecentBook(book);
  }
}

export const persistenceService = new PersistenceService();
