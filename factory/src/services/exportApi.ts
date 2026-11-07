import { apiDownload } from './apiClient';

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';
export type ExportFilters = Record<string, string | number | boolean | undefined | null>;

export const downloadExport = async (dataset: string, format: ExportFormat, filters: ExportFilters = {}) => {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '' && value !== 'All') query.set(key, String(value)); });
  const result = await apiDownload(`/api/v1/exports/${encodeURIComponent(dataset)}/${format}${query.size ? `?${query}` : ''}`);
  const url = URL.createObjectURL(result.blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = result.filename ?? `Reproutes_${dataset}.${format}`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
