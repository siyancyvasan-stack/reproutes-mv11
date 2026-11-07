import { Agent, Order, Product, Shop, AttendanceRecord, KpiSummary, SalesChartPoint } from '../types';

export const INITIAL_KPIS: KpiSummary = {
  totalAgents: 0,
  activeAgents: 0,
  agentsOnBreak: 0,
  offlineAgents: 0,
  todayOrdersCount: 0,
  totalCasesSold: 0,
  todaySalesLkr: 0,
  totalDistanceKm: 0,
};

export const MOCK_WEEKLY_SALES: SalesChartPoint[] = [];
export const MOCK_AGENTS: Agent[] = [];
export const MOCK_ORDERS: Order[] = [];
export const MOCK_PRODUCTS: Product[] = [];
export const MOCK_SHOPS: Shop[] = [];
export const MOCK_ATTENDANCE: AttendanceRecord[] = [];
