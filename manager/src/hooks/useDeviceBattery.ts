import { useEffect, useState } from 'react';

export interface DeviceBatteryState {
  level: number | null;
  charging: boolean;
  supported: boolean;
}

interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

export const useDeviceBattery = (): DeviceBatteryState => {
  const [batteryState, setBatteryState] = useState<DeviceBatteryState>({
    level: null,
    charging: false,
    supported: false,
  });

  useEffect(() => {
    let disposed = false;
    let batteryManager: BatteryManager | null = null;

    const updateBattery = () => {
      if (!batteryManager || disposed) return;
      const level = Math.round(batteryManager.level * 100);
      setBatteryState({
        level: Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : null,
        charging: Boolean(batteryManager.charging),
        supported: true,
      });
    };

    const handleWindowMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && (data.type === 'BATTERY_STATUS' || data.type === 'DEVICE_BATTERY')) {
          const rawLevel = typeof data.level === 'number' ? data.level : typeof data.battery === 'number' ? data.battery : null;
          const level = rawLevel !== null ? Math.round(rawLevel <= 1 ? rawLevel * 100 : rawLevel) : null;
          if (level !== null && !disposed) {
            setBatteryState({
              level: Math.max(0, Math.min(100, level)),
              charging: Boolean(data.charging || data.isCharging),
              supported: true,
            });
          }
        }
      } catch {
        // Ignore malformed message payloads
      }
    };

    window.addEventListener('message', handleWindowMessage);

    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManager>;
    };

    if (typeof nav.getBattery === 'function') {
      nav.getBattery()
        .then((bm) => {
          if (disposed) return;
          batteryManager = bm;
          updateBattery();
          bm.addEventListener('levelchange', updateBattery);
          bm.addEventListener('chargingchange', updateBattery);
        })
        .catch(() => {
          if (!disposed) {
            setBatteryState((prev) => ({ ...prev, supported: false }));
          }
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener('message', handleWindowMessage);
      if (batteryManager) {
        batteryManager.removeEventListener('levelchange', updateBattery);
        batteryManager.removeEventListener('chargingchange', updateBattery);
      }
    };
  }, []);

  return batteryState;
};
