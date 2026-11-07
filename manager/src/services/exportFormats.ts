import type { ExportFormat } from './exportApi';

export const orderExportFormats = <T extends readonly [ExportFormat, ...unknown[]][]>(formats: T, allowed?: ExportFormat[]) =>
  allowed ? allowed.flatMap((format) => formats.filter(([candidate]) => candidate === format)) : formats;
