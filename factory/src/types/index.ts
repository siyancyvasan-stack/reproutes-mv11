export type UserRole = 'admin' | 'manager' | 'agent' | 'factory_manager';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  employeeCode: string;
  phone?: string;
  region?: string;
}

export type AgentStatus = 'Active' | 'On Break' | 'Offline';
export type TrackingFreshness = 'online' | 'gps_delayed' | 'gps_unavailable' | 'location_off' | 'idle_1h' | 'offline' | 'off_shift';
export type LocationPermission = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unavailable';
export type PresenceStatus = 'ONLINE' | 'OFFLINE';
export type ShiftStatus = 'OFF_SHIFT' | 'WORKING' | 'ON_BREAK';
export type GpsStatus = 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RoutePoint extends GeoPoint {
  label?: string;
  visited?: boolean;
  timestamp?: string;
}

export interface Geofence {
  id: string;
  center: GeoPoint;
  radiusMeters: number;
  label?: string;
}

export interface Agent {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  avatar: string;
  status: AgentStatus;
  loginTime: string;
  currentLocation: string;
  coordinates: GeoPoint;
  distanceKm: number;
  ordersCount: number;
  casesSold: number;
  breakDurationMinutes: number;
  batteryLevel: number;
  speedKmH: number;
  phone: string;
  vehicleNo: string;
  routeAssigned: string;
  todayRevenueLkr: number;
  visitedShopsCount: number;
  totalShopsAssigned: number;
  routeCoordinates: RoutePoint[];
  /** Optional fields populated by the live tracking transport when supplied by the backend. */
  heading?: number;
  altitude?: number;
  gpsAccuracyMeters?: number;
  trackingStatus?: TrackingFreshness;
  trackingStatusLabel?: string;
  trackingSecondaryStatus?: string;
  presenceStatus?: PresenceStatus;
  shiftStatus?: ShiftStatus;
  gpsStatus?: GpsStatus;
  shiftActive?: boolean;
  socketConnected?: boolean;
  lastHeartbeatAt?: string;
  lastLocationAt?: string;
  locationPermission?: LocationPermission;
  trackingState?: 'UNKNOWN' | 'ACTIVE' | 'INTERRUPTED';
  trackingStateAt?: string;
  idleStatus?: 'MOVING' | 'IDLE_1H';
  idleSince?: string;
  lastMovementAt?: string;
  idleAlert?: {
    id: string;
    latitude: number;
    longitude: number;
    idleStartedAt: string;
    lastMovementAt: string;
    lastGpsAt: string;
    battery?: number;
  };
  workDistanceKm?: number;
  breakDistanceKm?: number;
  workingDurationMinutes?: number;
  gpsCoverage?: number;
  deviceRecordedAt?: string;
  serverReceivedAt?: string;
  managerDisplayedAt?: string;
  managerDisplayDelayMs?: number;
  lastUpdatedAt?: string;
  lastPresenceAt?: string;
  travelledPath?: RoutePoint[];
  destination?: RoutePoint;
  destinationAddress?: string;
  etaMinutes?: number;
  remainingDistanceKm?: number;
  geofences?: Geofence[];
}

export type OrderStatus = 'Approved' | 'Pending' | 'Production Required' | 'In Production' | 'Quality Check' | 'Ready' | 'Dispatched' | 'Cancelled' | 'Delivered';

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  pricePerCaseLkr: number;
  casesQuantity: number;
  totalLkr: number;
}

export interface Order {
  id: string;
  agentId: string;
  agentName: string;
  shopId: string;
  shopName: string;
  shopAddress: string;
  casesCount: number;
  totalAmountLkr: number;
  time: string;
  date: string;
  status: OrderStatus;
  items: OrderItem[];
  paymentTerm: 'Cash' | 'Credit 14 Days' | 'Credit 30 Days' | 'Cheque';
  remarks?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  pricePerCaseLkr: number;
  unitsPerCase: number;
  unitPriceLkr: number;
  stockCases: number;
  image: string;
  active: boolean;
}

export interface Shop {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  address: string;
  city: string;
  coordinates: { lat: number; lng: number };
  routeGroup: string;
  territory?: string;
  status?: string;
  assignedAgentName?: string;
  lastVisitAt?: string;
  visitedToday: boolean;
  lastOrderDate?: string;
  outstandingBalanceLkr: number;
  images?: ShopImage[];
  primaryImageUrl?: string;
}

export interface ShopImage {
  id: string;
  url: string;
  type: 'FRONT' | 'INTERIOR' | 'DISPLAY_RACK';
  isPrimary: boolean;
  displayOrder: number;
}

export interface AttendanceRecord {
  id: string;
  agentId: string;
  agentName: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  checkInLocation: string;
  checkOutLocation?: string;
  checkInOdometerKm: number;
  checkOutOdometerKm?: number;
  totalDistanceKm: number;
  workingHours: string;
  status: 'Present' | 'Late' | 'Half Day' | 'Absent';
}

export interface KpiSummary {
  totalAgents: number;
  activeAgents: number;
  agentsOnBreak: number;
  offlineAgents: number;
  todayOrdersCount: number;
  totalCasesSold: number;
  todaySalesLkr: number;
  totalDistanceKm: number;
}

export interface SalesChartPoint {
  day: string;
  salesLkr: number;
  ordersCount: number;
}
