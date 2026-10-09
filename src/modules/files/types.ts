import type { DocumentExtension } from './formats';

export type DocumentRow = {
  id: string;
  name: string;
  extension: DocumentExtension;
  sizeBytes: number;
  folder: string | null;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
};

export type DocumentVersionRow = {
  version: number;
  sizeBytes: number;
  createdAt: Date;
  createdByName: string | null;
};

export type DocumentDetail = DocumentRow & { versions: DocumentVersionRow[] };
