import assert from 'node:assert/strict';
import test from 'node:test';
import { getAndroidApkConfig } from '../src/services/androidApp';

test('accepts a verified transport URL for the Android APK', () => {
  assert.deepEqual(getAndroidApkConfig('https://downloads.example.com/tracksale.apk'), {
    available: true,
    url: 'https://downloads.example.com/tracksale.apk',
  });
});

test('keeps the download unavailable when no URL is configured', () => {
  assert.equal(getAndroidApkConfig('').available, false);
});

test('rejects an APK URL without HTTPS', () => {
  assert.equal(getAndroidApkConfig('http://downloads.example.com/tracksale.apk').available, false);
});
