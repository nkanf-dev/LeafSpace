import Dexie, { type EntityTable } from 'dexie';

import type { WorkspaceSnapshot } from '../types/domain';

export interface WorkspacePersistencePort {
  clear: (documentId: string) => Promise<void>;
  load: (documentId: string) => Promise<WorkspaceSnapshot | null>;
  save: (snapshot: WorkspaceSnapshot) => Promise<void>;
}

export interface WorkspaceSnapshotRecord extends WorkspaceSnapshot {}

class WorkspaceDexieDatabase extends Dexie {
  workspaces!: EntityTable<WorkspaceSnapshotRecord, 'documentId'>;

  constructor(databaseName: string) {
    super(databaseName);

    this.version(1).stores({
      workspaces: '&documentId,savedAt',
    });
  }
}

function cloneSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return typeof structuredClone === 'function'
    ? structuredClone(snapshot)
    : JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot;
}

export class InMemoryWorkspacePersistencePort implements WorkspacePersistencePort {
  private snapshots = new Map<string, WorkspaceSnapshot>();

  async clear(documentId: string): Promise<void> {
    this.snapshots.delete(documentId);
  }

  async load(documentId: string): Promise<WorkspaceSnapshot | null> {
    const snapshot = this.snapshots.get(documentId);

    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    this.snapshots.set(snapshot.documentId, cloneSnapshot(snapshot));
  }
}

export class DexieWorkspacePersistencePort implements WorkspacePersistencePort {
  private database: WorkspaceDexieDatabase;

  constructor(databaseName = 'LeafSpaceWorkspaceDB') {
    this.database = new WorkspaceDexieDatabase(databaseName);
  }

  async clear(documentId: string): Promise<void> {
    await this.database.workspaces.delete(documentId);
  }

  async load(documentId: string): Promise<WorkspaceSnapshot | null> {
    const snapshot = await this.database.workspaces.get(documentId);

    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    await this.database.workspaces.put(cloneSnapshot(snapshot));
  }

  async deleteDatabase(): Promise<void> {
    this.database.close();
    await this.database.delete();
  }
}

export class PersistenceService {
  private port: WorkspacePersistencePort;

  constructor(port: WorkspacePersistencePort = new DexieWorkspacePersistencePort()) {
    this.port = port;
  }

  async clearWorkspace(documentId: string): Promise<void> {
    await this.port.clear(documentId);
  }

  async restoreWorkspace(documentId: string): Promise<WorkspaceSnapshot | null> {
    return this.port.load(documentId);
  }

  async saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    await this.port.save(snapshot);
  }
}

export const persistenceService = new PersistenceService();
