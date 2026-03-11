export interface ThumbnailLoadDocumentRequest {
  type: 'load-document';
  documentId: string;
  source: ArrayBuffer;
}

export interface ThumbnailRenderRequest {
  type: 'render';
  id: string;
  key: string;
  documentId: string;
  pageNumber: number;
  maxWidth: number;
}

export interface ThumbnailDocumentReady {
  type: 'document-ready';
  documentId: string;
}

export interface ThumbnailDocumentError {
  type: 'document-error';
  documentId: string;
  error: string;
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

export type ThumbnailWorkerRequest = ThumbnailLoadDocumentRequest | ThumbnailRenderRequest;
export type ThumbnailWorkerResponse = ThumbnailDocumentReady | ThumbnailDocumentError | ThumbnailRenderSuccess | ThumbnailRenderError;
