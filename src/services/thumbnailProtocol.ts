export interface ThumbnailRenderRequest {
  type: 'render';
  id: string;
  key: string;
  pageNumber: number;
  maxWidth: number;
  source: ArrayBuffer;
}

export interface ThumbnailRenderSuccess {
  type: 'success';
  id: string;
  key: string;
  pageNumber: number;
  width: number;
  height: number;
  blob: Blob;
}

export interface ThumbnailRenderError {
  type: 'error';
  id: string;
  key: string;
  pageNumber: number;
  error: string;
}

export type ThumbnailWorkerRequest = ThumbnailRenderRequest;
export type ThumbnailWorkerResponse = ThumbnailRenderSuccess | ThumbnailRenderError;
