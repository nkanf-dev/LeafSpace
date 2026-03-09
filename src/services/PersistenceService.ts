import type { WorkspaceSnapshot } from '../types/domain';

export class PersistenceService {
  // 确保方法名与 workspaceStore 调用一致
  async loadWorkspace(documentId: string): Promise<WorkspaceSnapshot | null> {
    console.log('Loading from DB...', documentId);
    return null;
  }

  async saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    console.log('Saving to DB...', snapshot.documentId);
  }
}

export const persistenceService = new PersistenceService();
