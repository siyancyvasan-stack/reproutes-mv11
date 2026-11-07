import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoSrc from '../assets/logo.png';

export type ExportValue = string | number | boolean | null | undefined;
export type ExportColumn<T> = { header: string; value: (row: T) => ExportValue };
export type ReportConfig<T> = {
  title: string;
  subtitle?: string;
  metadata?: Array<[string, ExportValue]>;
  filters?: Record<string, ExportValue>;
  kpis?: Array<[string, ExportValue]>;
  columns: ExportColumn<T>[];
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
};

export const csvCell = (value: ExportValue) => {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

export const buildCsv = <T,>(rows: T[], columns: ExportColumn<T>[]) =>
  `\uFEFF${[
    columns.map((column) => csvCell(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(',')),
  ].join('\r\n')}\r\n`;

export const exportToCsv = <T,>(rows: T[], config: Pick<ReportConfig<T>, 'columns'>, filename: string) => {
  downloadBlob(new Blob([buildCsv(rows, config.columns)], { type: 'text/csv;charset=utf-8' }), filename);
};

const loadLogo = async () => {
  try {
    const response = await fetch(logoSrc);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
};

const displayValue = (value: ExportValue) => value === null || value === undefined || value === '' ? '—' : String(value);

export const exportToPdf = async <T,>(rows: T[], config: ReportConfig<T>, filename: string) => {
  const landscape = config.columns.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const logo = await loadLogo();
  if (logo) doc.addImage(logo, 'PNG', 40, 28, 30, 30, undefined, 'FAST');
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Reproutes', logo ? 78 : 40, 48);
  doc.setFontSize(15);
  doc.text(config.title, 40, 82);
  let y = 100;
  if (config.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(config.subtitle, 40, y);
    y += 15;
  }
  const filters = Object.entries(config.filters ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
  const details: Array<[string, ExportValue]> = [
    ['Exported', new Date().toLocaleString()],
    ['Selected filters', filters.length ? filters.map(([key, value]) => `${key}: ${value}`).join(' | ') : 'None'],
    ...(config.metadata ?? []),
  ];
  doc.setFontSize(8.5);
  details.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold'); doc.text(`${label}:`, 40, y);
    doc.setFont('helvetica', 'normal'); doc.text(displayValue(value), 125, y, { maxWidth: pageWidth - 165 });
    y += 13;
  });
  if (config.kpis?.length) {
    y += 5;
    const gap = 8;
    const width = (pageWidth - 80 - gap * (config.kpis.length - 1)) / config.kpis.length;
    config.kpis.forEach(([label, value], index) => {
      const x = 40 + index * (width + gap);
      doc.setFillColor(241, 245, 249); doc.roundedRect(x, y, width, 40, 4, 4, 'F');
      doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(label.toUpperCase(), x + 8, y + 13);
      doc.setTextColor(15, 23, 42); doc.setFontSize(10); doc.text(displayValue(value), x + 8, y + 29, { maxWidth: width - 16 });
    });
    y += 53;
  }
  autoTable(doc, {
    startY: y,
    head: [config.columns.map((column) => column.header)],
    body: rows.map((row) => config.columns.map((column) => displayValue(column.value(row)))),
    theme: 'striped',
    margin: { left: 40, right: 40, bottom: 34 },
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 5, overflow: 'linebreak' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
  if (!rows.length) {
    const tableEndY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('No assigned stores are available for this report.', 40, tableEndY + 24);
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text(`Page ${page} of ${pages}`, pageWidth - 40, doc.internal.pageSize.getHeight() - 18, { align: 'right' });
  }
  doc.save(filename);
};
