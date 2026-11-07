const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees) => degrees * Math.PI / 180;
export const distanceMeters = (a, b) => {
    const latitudeDelta = toRadians(b.latitude - a.latitude);
    const longitudeDelta = toRadians(b.longitude - a.longitude);
    const latitudeA = toRadians(a.latitude);
    const latitudeB = toRadians(b.latitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
};
export const calculateTrackingMetrics = (points, shiftStart, shiftEnd, intervalSeconds = 15) => {
    const ordered = [...points].sort((a, b) => (a.deviceRecordedAt ?? a.recordedAt).getTime() - (b.deviceRecordedAt ?? b.recordedAt).getTime());
    let workMeters = 0;
    let breakMeters = 0;
    let delayCount = 0;
    let longestGapSeconds = 0;
    let totalStops = 0;
    let idleSeconds = 0;
    let idleStartedAt;
    const speeds = [];
    ordered.forEach((point, index) => {
        const capturedAt = (point.deviceRecordedAt ?? point.recordedAt).getTime();
        const speed = Math.max(0, point.speedKmH ?? 0);
        speeds.push(speed);
        if (speed < 1)
            idleStartedAt ??= capturedAt;
        else if (idleStartedAt !== undefined) {
            const duration = Math.max(0, capturedAt - idleStartedAt) / 1000;
            if (duration >= 120)
                totalStops += 1;
            idleSeconds += duration;
            idleStartedAt = undefined;
        }
        if (!index)
            return;
        const previous = ordered[index - 1];
        const previousAt = (previous.deviceRecordedAt ?? previous.recordedAt).getTime();
        const gapSeconds = Math.max(0, capturedAt - previousAt) / 1000;
        if (gapSeconds > intervalSeconds * 2)
            delayCount += 1;
        longestGapSeconds = Math.max(longestGapSeconds, gapSeconds);
        const segment = distanceMeters(previous, point);
        if (segment < 10)
            return;
        if (point.shiftStatus === 'ON_BREAK')
            breakMeters += segment;
        else
            workMeters += segment;
    });
    if (idleStartedAt !== undefined)
        idleSeconds += Math.max(0, shiftEnd.getTime() - idleStartedAt) / 1000;
    const durationSeconds = Math.max(0, (shiftEnd.getTime() - shiftStart.getTime()) / 1000);
    const expectedPoints = Math.max(1, Math.floor(durationSeconds / intervalSeconds) + 1);
    const totalMeters = workMeters + breakMeters;
    return {
        expectedPoints,
        receivedPoints: ordered.length,
        gpsCoverage: Math.min(100, Number(((ordered.length / expectedPoints) * 100).toFixed(1))),
        workDistanceKm: Number((workMeters / 1000).toFixed(3)),
        breakDistanceKm: Number((breakMeters / 1000).toFixed(3)),
        totalDistanceKm: Number((totalMeters / 1000).toFixed(3)),
        averageSpeedKmH: speeds.length ? Number((speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length).toFixed(1)) : 0,
        maximumSpeedKmH: speeds.length ? Number(Math.max(...speeds).toFixed(1)) : 0,
        totalStops,
        totalIdleMinutes: Math.round(idleSeconds / 60),
        gpsDelayCount: delayCount,
        longestGpsGapSeconds: Math.round(longestGapSeconds),
        lastKnownLocation: ordered.at(-1) ? { latitude: ordered.at(-1).latitude, longitude: ordered.at(-1).longitude } : null,
    };
};
