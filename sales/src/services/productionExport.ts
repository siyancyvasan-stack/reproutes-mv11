import { exportToCsv, exportToPdf, type ReportConfig } from './exportService';

type ProductionRow = Record<string, any>;
export type ProductionExportFormat = 'csv' | 'pdf';

const reportDate = () => new Date().toISOString().slice(0, 10);
const titleCase = (value?: string) => (value ?? '—').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const quantity = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const productionReportConfig = (statusFilter: string): ReportConfig<ProductionRow> => ({
  title: 'Factory Production Report',
  filters: { Status: statusFilter ? titleCase(statusFilter) : 'All statuses' },
  columns: [
    { header: 'Production ID', value: (row) => `PR-${String(row.id).slice(-7).toUpperCase()}` },
    { header: 'Product', value: (row) => row.product?.name ?? '—' },
    { header: 'Required', value: (row) => quantity(row.requiredQuantity) },
    { header: 'Produced', value: (row) => quantity(row.producedQuantity) },
    { header: 'Remaining', value: (row) => Math.max(0, quantity(row.requiredQuantity) - quantity(row.producedQuantity)) },
    { header: 'Progress', value: (row) => `${Math.round(quantity(row.producedQuantity) / Math.max(quantity(row.requiredQuantity), 1) * 100)}%` },
    { header: 'Members', value: (row) => row.tasks?.map((task: ProductionRow) => task.factoryMember?.name).filter(Boolean).join(', ') || 'Unassigned' },
    { header: 'Due', value: (row) => row.expectedFinishAt ? new Date(row.expectedFinishAt).toLocaleDateString() : '—' },
    { header: 'Status', value: (row) => titleCase(row.status) },
  ],
});

export const downloadProductionReport = async (rows: ProductionRow[], format: ProductionExportFormat, statusFilter: string) => {
  if (!rows.length) throw new Error('NO_EXPORT_DATA');
  const filename = `production_report_${reportDate()}.${format}`;
  const config = productionReportConfig(statusFilter);
  if (format === 'csv') exportToCsv(rows, config, filename);
  else await exportToPdf(rows, config, filename);
};
