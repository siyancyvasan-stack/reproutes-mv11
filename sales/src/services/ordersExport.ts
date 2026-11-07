import type { Order } from '../types';

export type OrderExportFormat = 'csv' | 'pdf';

const fileDate = () => new Date().toISOString().slice(0, 10);

const saveBlob = (blob: Blob, filename: string) => {
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

const csvCell = (value: string | number) => {
  const raw = String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

const exportCsv = (orders: Order[]) => {
  const headers = ['Order ID', 'Date', 'Time', 'Agent', 'Shop', 'Payment', 'Cases', 'Total LKR', 'Status'];
  const rows = orders.map((order) => [order.id, order.date, order.time, order.agentName, order.shopName, order.paymentTerm, order.casesCount, order.totalAmountLkr, order.status]);
  const content = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  saveBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), `Reproutes_Orders_${fileDate()}.csv`);
};

const pdfText = (value: string) => value
  .normalize('NFKD')
  .replace(/[^\x20-\x7E]/g, '?')
  .replaceAll('\\', '\\\\')
  .replaceAll('(', '\\(')
  .replaceAll(')', '\\)');

const buildTextPdf = (lines: string[]) => {
  const perPage = 44;
  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / perPage)) }, (_, index) => lines.slice(index * perPage, (index + 1) * perPage));
  const objects: string[] = [];
  const add = (content: string) => { objects.push(content); return objects.length; };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = pages.map((pageLines, pageIndex) => {
    const commands = [
      'BT', '/F1 11 Tf', '48 550 Td',
      ...pageLines.flatMap((line, lineIndex) => [lineIndex ? '0 -12 Td' : '', `(${pdfText(line)}) Tj`]).filter(Boolean),
      '0 -16 Td', `/F1 9 Tf`, `(Page ${pageIndex + 1} of ${pages.length}) Tj`, 'ET',
    ].join('\n');
    const contentId = add(`<< /Length ${new TextEncoder().encode(commands).length} >>\nstream\n${commands}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(new TextEncoder().encode(pdf).length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
};

export const downloadCsvData = (filename: string, headers: string[], rows: Array<Array<string | number>>) => {
  const content = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  saveBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), filename);
};

export const downloadPdfLines = (filename: string, lines: string[]) => saveBlob(buildTextPdf(lines), filename);

const buildPdf = (orders: Order[]) => buildTextPdf([
    'Reproutes - Orders Report',
    `Generated: ${new Date().toLocaleString()}`,
    `Total orders: ${orders.length}`,
    '',
    ...orders.flatMap((order) => [
      `${order.id} | ${order.date} ${order.time} | ${order.status}`,
      `${order.shopName} | ${order.agentName} | ${order.paymentTerm}`,
      `Cases: ${order.casesCount} | Total: LKR ${order.totalAmountLkr.toLocaleString()}`,
      '',
    ]),
  ]);

export const downloadOrders = (orders: Order[], format: OrderExportFormat) => {
  if (!orders.length) throw new Error('No orders are available for the selected filters.');
  if (format === 'csv') exportCsv(orders);
  else saveBlob(buildPdf(orders), `Reproutes_Orders_${fileDate()}.pdf`);
};

export const downloadOrderInvoice = (order: Order) => {
  const lines = [
    'Reproutes - Order Invoice',
    `Order: ${order.id}`,
    `Date: ${order.date} ${order.time}`,
    `Status: ${order.status}`,
    '',
    `Shop: ${order.shopName}`,
    `Address: ${order.shopAddress}`,
    `Booked by: ${order.agentName}`,
    `Payment terms: ${order.paymentTerm}`,
    '',
    'ORDER LINE ITEMS',
    '------------------------------------------------------------',
    ...order.items.flatMap((item) => [
      `${item.productName} (${item.sku || 'No SKU'})`,
      `${item.casesQuantity} cases x LKR ${item.pricePerCaseLkr.toLocaleString()} = LKR ${item.totalLkr.toLocaleString()}`,
    ]),
    '------------------------------------------------------------',
    `Total cases: ${order.casesCount}`,
    `TOTAL: LKR ${order.totalAmountLkr.toLocaleString()}`,
    ...(order.remarks ? ['', `Remarks: ${order.remarks}`] : []),
  ];
  saveBlob(buildTextPdf(lines), `Reproutes_Invoice_${order.id.replace(/[^a-z0-9_-]/gi, '_')}.pdf`);
};
