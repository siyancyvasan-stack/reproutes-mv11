# TrackSale Android deployment

The Sales Portal enables the APK button only when `VITE_ANDROID_APK_URL` is a valid HTTPS URL. Keep it blank until the exact hosted artifact has passed the checks below.

## 1. Build the signed APK with EAS

The `production-apk` profile embeds the production API and Sales Portal origins. From `mobile/`:

```bash
npm ci
npm run typecheck
npm run lint
npx expo-doctor
npx eas-cli login
npx eas-cli build --platform android --profile production-apk --wait
```

EAS creates or uses the Android upload keystore associated with the Expo project. Do not publish the local Gradle `release` output: the checked-in native project currently uses the debug keystore for local builds.

## 2. Download and verify the exact EAS artifact

Copy the artifact URL printed by EAS, then:

```bash
curl --fail --location --proto '=https' --tlsv1.2 "$EAS_APK_URL" --output tracksale-release.apk
file tracksale-release.apk
apksigner verify --verbose --print-certs tracksale-release.apk
aapt dump badging tracksale-release.apk | head -n 5
```

The package must be `com.tracksale.mobile`. Save the SHA-256 digest and file size for release records:

```bash
sha256sum tracksale-release.apk
stat --format='%s bytes' tracksale-release.apk
```

Install the same file on a test Android device and exercise login, Punch In/Out, one shop visit, offline GPS collection, reconnect sync, and Punch Out:

```bash
adb install -r tracksale-release.apk
adb shell monkey -p com.tracksale.mobile 1
```

Confirm the device prompts for precise and background location, the foreground tracking notification remains visible during an active shift, and queued points reach the production API after connectivity returns.

## 3. Host the verified APK

Upload `tracksale-release.apk` to an HTTPS object-storage/CDN location controlled by the project, for example `https://downloads.reproutes.com/android/tracksale-1.0.0.apk`. Configure these response headers:

```text
Content-Type: application/vnd.android.package-archive
Content-Disposition: attachment; filename="TrackSale-1.0.0.apk"
Cache-Control: public, max-age=3600
```

Verify the public response and compare it with the tested local file:

```bash
curl --fail --location --proto '=https' --tlsv1.2 --head "$APK_URL"
curl --fail --location --proto '=https' --tlsv1.2 "$APK_URL" --output hosted-tracksale.apk
sha256sum tracksale-release.apk hosted-tracksale.apk
apksigner verify --verbose --print-certs hosted-tracksale.apk
```

Both SHA-256 values must match. The final response must be HTTP 200 and use the Android package content type.

## 4. Deploy the Sales Portal on Vercel

Set the verified URL on all required Vercel environments. From `sales/` in the linked Vercel project:

```bash
vercel env add VITE_ANDROID_APK_URL production
vercel env add VITE_ANDROID_APK_URL preview
vercel env add VITE_API_URL production
vercel env add VITE_TRACKING_SOCKET_URL production
vercel --prod
```

Enter the verified `$APK_URL` for `VITE_ANDROID_APK_URL`, and `https://api.reproutes.com` for the two backend origins. Vite reads environment variables during build, so the portal must be redeployed after changing the URL.

Finally test `https://reproutes.com/sales/login` on Android and desktop. The login and Sales dashboard buttons must download the same verified APK, and the installation-help dialog must remain readable at both widths.
