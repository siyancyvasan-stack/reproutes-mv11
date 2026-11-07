# Reproutes Mobile

Single Expo development-build application for `manager`, `factory_manager`, and `agent` accounts.

## Background salesperson tracking

Salesperson route tracking uses the native Expo location task and is active only while an attendance shift is open. GPS points are written to SQLite before upload, synchronized in idempotent batches after reconnect, and accompanied by permission/provider heartbeats. Android displays the required foreground-service notification; iOS uses the `location` background mode and background-location indicator.

Background tracking requires a development or release build (`npm run android`, `npm run ios`, or EAS). Expo Go and the browser/PWA are not supported for screen-locked all-day tracking. Force-stop, device shutdown, or OS-level permission revocation can prevent all apps from collecting data until the OS permits execution again.

## Run locally

1. Copy `.env.example` to `.env` and set its single `EXPO_PUBLIC_API_URL` value
   to the backend origin reachable from the device. The app has no runtime URL
   fallback and stops with a configuration error when this value is missing.
2. Run `npm install` in this directory.
3. Run `npm run android` or `npm run ios`. Expo Go is not the supported runtime because push and location use native configuration.

Android emulators reach the Nginx/API entry point on the host through `http://10.0.2.2:4001`. Physical devices need the host machine's current LAN address and must share a network with an API server listening on `0.0.0.0`. Keep device-specific addresses only in the ignored `.env` file. Set `EXPO_PUBLIC_API_URL` to the deployed HTTPS endpoint for release builds.

## Navigation

```text
Root (restore SecureStore session)
├── signed out → Login
└── signed in → role gate
    ├── manager         → Project Manager tabs/stacks
    ├── factory_manager → Factory Manager tabs/stacks
    └── agent           → Sales Person tabs/stacks
```

## Offline behavior

SQLite stores cached query responses and queued mutations per user. Connectivity restoration replays operations in creation order with idempotency keys, exponential backoff, and a visible sync state. Validation failures remain visible for user attention. Sales visits/orders and factory production/inventory are the highest-priority offline workflows.

The server must enforce `X-Idempotency-Key` for every mutation before production offline writes are enabled. GPS visit check-in is captured at event time; server validation remains authoritative.

## Push notifications

Expo Notifications uses FCM on Android and APNs on iOS. Configure the EAS project ID and platform credentials, then the app registers its Expo push token with `POST /api/v1/mobile/devices`. A production worker must deliver persisted role notifications to registered device tokens.

## Backend additions

- Shared/mobile: device registration and native refresh-token response.
- Project Manager: projects, tasks, progress, team status, and project reports.
- Factory Manager still needs a machine/line model and report-shaped JSON endpoint; current production/inventory routes are reused.
- Sales Person reuses shops, visits, orders, products, analytics, tracking, and notifications. Add server idempotency persistence before enabling mutation replay in production.
