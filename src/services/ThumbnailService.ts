export class ThumbnailService {
  static readonly shared = new ThumbnailService();
  
  // 恢复单数形式，供 heldStore 调用
  async ensureThumbnail(page: number): Promise<void> {
    void page;
  }

  async ensureThumbnails(pages: number[]): Promise<void> {
    void pages;
  }

  getThumbnailKey(pageNumber: number): string {
    return `thumb_${pageNumber}`;
  }
}

export const thumbnailService = ThumbnailService.shared;
