import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { ensureAccessToken, getAccessToken } from '../services/apiClient';
import { useToast } from '../context/ToastContext';

type SafetyAlert = {
  id: string;
  type: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  agent?: { name?: string };
};

type IdleAlert = {
  id: string;
  agentName: string;
  latitude: number;
  longitude: number;
  stoppedDurationMinutes: number;
};

let audioContext: AudioContext | undefined;

const armEmergencyAudio = () => {
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume();
};

const ringEmergencyAlarm = () => {
  try {
    armEmergencyAudio();
    if (!audioContext) return;
    [0, 0.38, 0.76, 1.14, 1.52, 1.9].forEach((offset, index) => {
      const oscillator = audioContext!.createOscillator();
      const gain = audioContext!.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = index % 2 ? 720 : 940;
      gain.gain.setValueAtTime(0.0001, audioContext!.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, audioContext!.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext!.currentTime + offset + 0.3);
      oscillator.connect(gain).connect(audioContext!.destination);
      oscillator.start(audioContext!.currentTime + offset);
      oscillator.stop(audioContext!.currentTime + offset + 0.32);
    });
  } catch {
    // Browser audio policies can block playback until the first interaction.
  }
};

export const useCriticalSafetyAlerts = (onNotification?: () => void) => {
  const { showToast } = useToast();

  useEffect(() => {
    const arm = () => {
      armEmergencyAudio();
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    };
    window.addEventListener('pointerdown', arm, { once: true });
    return () => window.removeEventListener('pointerdown', arm);
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: ReturnType<typeof io> | undefined;
    void ensureAccessToken().then(() => {
      if (disposed) return;
      const configured = import.meta.env.VITE_TRACKING_SOCKET_URL?.trim();
      socket = io(configured === 'same-origin' ? undefined : configured, { transports: ['websocket'], withCredentials: true,
        auth: (callback) => callback({ token: getAccessToken() ?? undefined }),
      });
      socket.on('safety:alert', (alert: SafetyAlert) => {
        const critical = alert.type === 'SOS' || alert.type === 'INCIDENT';
        if (!critical) return;
        const agentName = alert.agent?.name ?? 'Sales Agent';
        const location = alert.latitude == null || alert.longitude == null
          ? 'Location unavailable'
          : `${alert.latitude.toFixed(5)}, ${alert.longitude.toFixed(5)}`;
        ringEmergencyAlarm();
        showToast(`🚨 ${alert.type}: ${agentName}`, `${alert.description || 'Immediate attention required'} · ${location}`, 'error');
        if ('Notification' in window && Notification.permission === 'granted') {
          const notification = new Notification(`Emergency ${alert.type}: ${agentName}`, {
            body: `${alert.description || 'Immediate attention required'}\n${location}`,
            tag: `safety-${alert.id}`,
            requireInteraction: true,
          });
          notification.onclick = () => {
            window.focus();
            window.location.assign('/manager/safety');
          };
        }
        onNotification?.();
        window.dispatchEvent(new Event('reproutes:notifications-changed'));
      });
      socket.on('tracking:idle-alert', (alert: IdleAlert) => {
        const location = `${alert.latitude.toFixed(5)}, ${alert.longitude.toFixed(5)}`;
        const message = `${alert.agentName} has stayed at the same place for ${alert.stoppedDurationMinutes} minutes · ${location}`;
        showToast(`⚠️ Same-place alert: ${alert.agentName}`, message, 'error');
        if ('Notification' in window && Notification.permission === 'granted') {
          const notification = new Notification(`${alert.agentName} stayed at the same place`, {
            body: `${alert.stoppedDurationMinutes} minutes without confirmed movement\nLocation: ${location}`,
            tag: `idle-${alert.id}`,
            requireInteraction: true,
          });
          notification.onclick = () => {
            window.focus();
            window.location.assign('/manager/live-tracking');
          };
        }
        onNotification?.();
        window.dispatchEvent(new Event('reproutes:notifications-changed'));
      });
      socket.on('notification:created', () => {
        onNotification?.();
        window.dispatchEvent(new Event('reproutes:notifications-changed'));
      });
    }).catch(() => undefined);
    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [onNotification, showToast]);
};
