import type { Agent, GpsStatus, PresenceStatus, ShiftStatus, TrackingFreshness } from '../types';

const ageOf = (timestamp?: string, now = Date.now()) => {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) ? Math.max(0, now - value) : Number.POSITIVE_INFINITY;
};

export const derivePresenceStatus = (agent: Pick<Agent, 'lastHeartbeatAt'>, now = Date.now()): PresenceStatus =>
  ageOf(agent.lastHeartbeatAt, now) <= 90_000 ? 'ONLINE' : 'OFFLINE';

export const deriveShiftStatus = (agent: Pick<Agent, 'shiftActive' | 'status'>): ShiftStatus =>
  !agent.shiftActive ? 'OFF_SHIFT' : agent.status === 'On Break' ? 'ON_BREAK' : 'WORKING';

export const deriveGpsStatus = (agent: Pick<Agent, 'lastLocationAt'>, now = Date.now()): GpsStatus => {
  const age = ageOf(agent.lastLocationAt, now);
  if (age <= 30_000) return 'LIVE';
  if (age <= 120_000) return 'DELAYED';
  if (age <= 300_000) return 'STALE';
  return 'UNAVAILABLE';
};

export const getAgentMapStatusMessage = (
  agent: Pick<Agent, 'name' | 'gpsStatus' | 'lastLocationAt'>,
  hasPosition: boolean,
  hasDestination: boolean,
  now = Date.now(),
) => {
  if (!hasPosition) return `Waiting for ${agent.name} to check in and send the first GPS fix`;
  if (hasDestination) return null;

  const gpsStatus = agent.gpsStatus ?? deriveGpsStatus(agent, now);
  if (gpsStatus === 'LIVE') return 'Live GPS · No destination assigned';
  if (gpsStatus === 'DELAYED') return 'GPS delayed · No destination assigned';
  if (gpsStatus === 'STALE') return 'Showing last known location · No destination assigned';
  return 'Last known location available · GPS currently unavailable · No destination assigned';
};

export const deriveTrackingStatus = (agent: Pick<Agent, 'shiftActive' | 'status' | 'lastHeartbeatAt' | 'lastLocationAt' | 'trackingState' | 'locationPermission' | 'idleStatus'>, now = Date.now()): TrackingFreshness => {
  const shift = deriveShiftStatus(agent);
  const presence = derivePresenceStatus(agent, now);
  const gps = deriveGpsStatus(agent, now);
  if (shift === 'OFF_SHIFT') return 'off_shift';
  if (agent.trackingState === 'INTERRUPTED' || agent.locationPermission === 'denied' || agent.locationPermission === 'unavailable') return 'location_off';
  if (presence === 'OFFLINE') return 'offline';
  if (agent.idleStatus === 'IDLE_1H') return 'idle_1h';
  if (gps === 'LIVE') return 'online';
  if (gps === 'DELAYED' || gps === 'STALE') return 'gps_delayed';
  return 'gps_unavailable';
};

export const trackingStatusLabel = (status: TrackingFreshness) => ({
  online: 'Online', gps_delayed: 'GPS Delayed', gps_unavailable: 'GPS Unavailable', location_off: 'Location Off / Tracking Interrupted', idle_1h: 'Idle for 1+ Hour', offline: 'Offline', off_shift: 'Off Shift',
}[status]);

export const withDerivedTrackingStatus = (agent: Agent, now = Date.now()): Agent => {
  const presenceStatus = derivePresenceStatus(agent, now);
  const shiftStatus = deriveShiftStatus(agent);
  const gpsStatus = deriveGpsStatus(agent, now);
  const trackingStatus = deriveTrackingStatus(agent, now);
  return {
    ...agent,
    presenceStatus,
    shiftStatus,
    gpsStatus,
    trackingStatus,
    trackingStatusLabel: trackingStatusLabel(trackingStatus),
    trackingSecondaryStatus: `${presenceStatus} • ${shiftStatus.replace('_', ' ')} • GPS ${gpsStatus}`,
  };
};
