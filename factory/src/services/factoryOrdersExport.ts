import { exportToCsv, exportToPdf, type ReportConfig } from './exportService';

type FactoryOrderRow = Record<string, any>;
export type FactoryOrderExportFormat = 'csv' | 'pdf';

const reportDate = () => new Date().toISOString().slice(0, 10);
const titleCase = (value?: string) => (value ?? '—').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const orderQuantity = (row: FactoryOrderRow) => row.items?.reduce((total: number, item: FactoryOrderRow) => total + Number(item.cases ?? item.casesQuantity ?? 0), 0) ?? 0;

const reportConfig = (statusFilter: string, search: string): ReportConfig<FactoryOrderRow> => ({
  title: 'Factory Sales Orders Report',
  filters: {
    Status: statusFilter ? titleCase(statusFilter) : 'All',
    Search: search || 'None',
  },
  columns: [
    { header: 'Order ID', value: (row) => `#${String(row.id).slice(-8).toUpperCase()}` },
    { header: 'Customer', value: (row) => row.shopName ?? '—' },
    { header: 'Salesperson', value: (row) => row.agent?.name ?? '—' },
    { header: 'Products', value: (row) => row.items?.map((item: FactoryOrderRow) => item.product?.name).filter(Boolean).join(', ') || '—' },
    { header: 'Quantity', value: orderQuantity },
    { header: 'Order Date', value: (row) => row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—' },
    { header: 'Priority', value: (row) => titleCase(row.priority) },
    { header: 'Status', value: (row) => titleCase(row.status) },
  ],
});

export const downloadFactoryOrdersReport = async (rows: FactoryOrderRow[], format: FactoryOrderExportFormat, statusFilter: string, search: string) => {
  if (!rows.length) throw new Error('NO_EXPORT_DATA');
  const filename = `factory_orders_report_${reportDate()}.${format}`;
  const config = reportConfig(statusFilter, search);
  if (format === 'csv') exportToCsv(rows, config, filename);
  else await exportToPdf(rows, config, filename);
};
