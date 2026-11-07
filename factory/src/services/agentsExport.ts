import type { Agent } from '../types';
import { downloadCsvData, downloadPdfLines } from './ordersExport';

export type AgentExportFormat = 'csv' | 'pdf';

const date = () => new Date().toISOString().slice(0, 10);

export const downloadAgents = (agents: Agent[], format: AgentExportFormat) => {
  if (!agents.length) throw new Error('No agents are available for the selected filters.');
  const filename = `Reproutes_Agents_${date()}`;
  if (format === 'csv') {
    downloadCsvData(`${filename}.csv`, [
      'Employee Code', 'Name', 'Email', 'Phone', 'Status', 'Route', 'Vehicle', 'Mileage KM', 'Orders', 'Sales LKR', 'Visited Shops',
    ], agents.map((agent) => [
      agent.employeeCode, agent.name, agent.email, agent.phone, agent.status, agent.routeAssigned,
      agent.vehicleNo, agent.distanceKm, agent.ordersCount, agent.todayRevenueLkr, agent.visitedShopsCount,
    ]));
    return;
  }
  downloadPdfLines(`${filename}.pdf`, [
    'Reproutes - Field Sales Agents Report',
    `Generated: ${new Date().toLocaleString()}`,
    `Total agents: ${agents.length}`,
    '',
    ...agents.flatMap((agent) => [
      `${agent.employeeCode} | ${agent.name} | ${agent.status}`,
      `${agent.email} | ${agent.phone || 'No phone'} | ${agent.vehicleNo || 'No vehicle'}`,
      `Route: ${agent.routeAssigned || 'Unassigned'}`,
      `Mileage: ${agent.distanceKm} KM | Orders: ${agent.ordersCount} | Sales: LKR ${agent.todayRevenueLkr.toLocaleString()}`,
      '',
    ]),
  ]);
};
