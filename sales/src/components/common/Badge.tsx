import React from 'react';
import { AgentStatus, OrderStatus } from '../../types';

interface BadgeProps {
  status: AgentStatus | OrderStatus | string;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ status, className = '' }) => {
  let style = 'bg-slate-800/80 text-slate-300 border-slate-700/50';
  const displayStatus = {
    online: 'Online',
    gps_delayed: 'GPS Delayed',
    gps_unavailable: 'GPS Unavailable',
    offline: 'Offline',
    off_shift: 'Off Shift',
    location_off: 'Location Off / Tracking Interrupted',
    idle_1h: 'Idle for 1+ Hour',
  }[status] ?? status;

  if (status === 'ONLINE' || status === 'LIVE' || status === 'online' || status === 'Active' || status === 'Online' || status === 'Tracking active' || status === 'Connected' || status === 'Approved' || status === 'Present' || status === 'Delivered') {
    style = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 glow-emerald';
  } else if (status === 'DELAYED' || status === 'ON_BREAK' || status === 'gps_delayed' || status === 'idle_1h' || status === 'On Break' || status === 'Delayed' || status === 'Reconnecting' || status === 'Requesting permission' || status === 'Poor accuracy' || status === 'Pending' || status === 'Late') {
    style = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  } else if (status === 'STALE' || status === 'UNAVAILABLE' || status === 'gps_unavailable') {
    style = 'bg-orange-500/15 text-orange-400 border-orange-500/30';
  } else if (status === 'OFFLINE' || status === 'offline' || status === 'location_off' || status === 'Offline' || status === 'Tracking stopped' || status === 'Permission denied' || status === 'GPS unavailable' || status === 'GPS timeout' || status === 'GPS error' || status === 'Cancelled' || status === 'Absent') {
    style = 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  } else if (status === 'OFF_SHIFT' || status === 'off_shift') {
    style = 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  } else if (status === 'WORKING' || status === 'Processing') {
    style = 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30 glow-cyan';
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-md transition-all whitespace-nowrap ${style} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
          status === 'ONLINE' || status === 'LIVE' || status === 'online' || status === 'Active' || status === 'Online' || status === 'Tracking active' || status === 'Connected' || status === 'Approved' || status === 'Present' || status === 'Delivered'
            ? 'bg-emerald-400 animate-pulse'
            : status === 'DELAYED' || status === 'ON_BREAK' || status === 'gps_delayed' || status === 'On Break' || status === 'Delayed' || status === 'Reconnecting' || status === 'Requesting permission' || status === 'Poor accuracy' || status === 'Pending'
            ? 'bg-amber-400'
            : status === 'STALE' || status === 'UNAVAILABLE' || status === 'gps_unavailable'
            ? 'bg-orange-400'
            : status === 'OFFLINE' || status === 'offline' || status === 'location_off' || status === 'Offline' || status === 'Tracking stopped' || status === 'Permission denied' || status === 'GPS unavailable' || status === 'GPS timeout' || status === 'GPS error' || status === 'Cancelled'
            ? 'bg-rose-400'
            : status === 'OFF_SHIFT' || status === 'off_shift' ? 'bg-slate-400' : 'bg-cyan-400'
        }`}
      />
      {displayStatus}
    </span>
  );
};
