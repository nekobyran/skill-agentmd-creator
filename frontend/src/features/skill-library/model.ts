export interface CodexSkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  source: string;
  relativePath: string;
  sourcePath: string;
  fileCount: number;
  byteSize: number;
  imported: boolean;
  importedId?: string | null;
}

export interface CodexSkillCatalog {
  entries: CodexSkillCatalogEntry[];
  roots: string[];
  scannedAt: number;
  warnings: string[];
}

export interface CodexSkillImportResult {
  discovered: number;
  requested: number;
  imported: string[];
  skipped: string[];
  errors: string[];
}
