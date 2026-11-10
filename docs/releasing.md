# Releasing Mimic

Releases are APKs attached to GitHub Releases. The app finds new releases through a static
`version.json` (served at https://mimic.shing.in/version.json), with GitHub's latest-release API as a
fallback. There is no backend.

## Versioning

The version lives in one place, `app/build.gradle.kts`:

```kotlin
val mimicVersion = "0.1.0"
```

- `versionName` = `mimicVersion` (`MAJOR.MINOR.PATCH`; MINOR and PATCH stay below 100).
- `versionCode` = `MAJOR * 10000 + MINOR * 100 + PATCH`, derived automatically (0.2.0 -> 200, 1.4.12 -> 10412).
- Git tag = `v<version>` (for example `v0.2.0`), release APK = `mimic-<version>.apk`.

Every release must increase the version: Android refuses to install a lower `versionCode` over a higher one.

## One-time setup: the release keystore

The keystore signs every release. **Keep it and its passwords safe and backed up outside the repo.**
If it is lost, existing installs can never be updated again (users would have to uninstall first).

Create it outside the repository (you will be prompted for the passwords; choose your own):

```sh
keytool -genkeypair -v \
  -keystore ~/keys/mimic-release.jks \
  -alias mimic \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Mimic, O=Mimic"
```

On Windows PowerShell, put it on one line and use a path such as `$HOME\keys\mimic-release.jks`.
`keytool` ships with the JDK.

Then create `keystore.properties` in the repo root (it is git-ignored; never commit it):

```properties
storeFile=C:/Users/<you>/keys/mimic-release.jks
storePassword=<your store password>
keyAlias=mimic
keyPassword=<your key password>
```

`storeFile` may be absolute or relative to the repo root. Instead of the file you can set environment
variables (useful in CI): `MIMIC_KEYSTORE`, `MIMIC_KEYSTORE_PASSWORD`, `MIMIC_KEY_ALIAS`,
`MIMIC_KEY_PASSWORD`.

Without either, `assembleRelease` still builds but signs with the **debug** key and prints a warning.
Such an APK is for testing only: never publish it.

Record the certificate fingerprint once, for the release notes and for anyone who wants to check it:

```sh
keytool -list -v -keystore ~/keys/mimic-release.jks -alias mimic | grep SHA256
```

## Cutting a release

1. **Bump the version** in `app/build.gradle.kts` and move the "Unreleased" notes in `CHANGELOG.md`
   under the new version.
2. **Test and build:**

   ```sh
   ./gradlew clean testDebugUnitTest assembleRelease
   ```

   The APK is `app/build/outputs/apk/release/mimic-<version>.apk`. Check that it is signed with the
   release key (`apksigner` is in the SDK's `build-tools/<version>/`):

   ```sh
   apksigner verify --print-certs app/build/outputs/apk/release/mimic-0.2.0.apk
   ```

   The SHA-256 digest of the signer must match your keystore's fingerprint, not the debug key.
   Install it on a phone that has the previous release and confirm it updates in place.
3. **Checksum** (goes into `version.json`):

   ```sh
   sha256sum app/build/outputs/apk/release/mimic-0.2.0.apk                         # Git Bash / Linux
   certutil -hashfile app\build\outputs\apk\release\mimic-0.2.0.apk SHA256         # Windows cmd / PowerShell
   ```

4. **Commit and tag** (after review):

   ```sh
   git commit -am "Release 0.2.0"
   git tag -a v0.2.0 -m "Mimic 0.2.0"
   git push origin main v0.2.0
   ```

5. **Create the GitHub Release** with the APK (and, if you like, the tray helper):

   ```sh
   gh release create v0.2.0 \
     app/build/outputs/apk/release/mimic-0.2.0.apk \
     --title "Mimic 0.2.0" \
     --notes-file release-notes.md
   ```

   Optional: build `windows\out\MimicTray.exe` with `windows\build.ps1` and add it to the same command.
   `--draft` lets you review the release page before publishing (`gh release edit v0.2.0 --draft=false`).

6. **Update the manifest** at https://mimic.shing.in/version.json (see the schema below) with the new
   version, the release asset URL and the SHA-256. Publish it **after** the GitHub Release is live, so
   the URL it points to already works. Check it:

   ```sh
   curl -s https://mimic.shing.in/version.json
   curl -sIL https://github.com/shing1Sks/mimic/releases/download/v0.2.0/mimic-0.2.0.apk | head -n 1
   ```

Phones running a release build pick it up within a day (the app checks at launch, at most once every
24 hours) and show an "Update available" card on Home.

## version.json schema

```json
{
  "versionName": "0.2.0",
  "versionCode": 200,
  "apkUrl": "https://github.com/shing1Sks/mimic/releases/download/v0.2.0/mimic-0.2.0.apk",
  "sha256": "3f5a...64 hex characters...9c1e",
  "size": 9876543,
  "minSdk": 29,
  "notes": "Grip mode, in-app updates.",
  "releaseUrl": "https://github.com/shing1Sks/mimic/releases/tag/v0.2.0"
}
```

| Field | Required | Meaning |
|---|---|---|
| `versionName` | yes | The release's version name, `MAJOR.MINOR.PATCH`. |
| `versionCode` | no | Android versionCode. If missing it is derived from `versionName` with the same formula as the build. It decides whether the release is newer. |
| `apkUrl` | yes | Direct `https://` download URL of the APK. Plain `http` is rejected. |
| `sha256` | yes | Lower- or upper-case hex SHA-256 of the APK (64 characters). The app refuses to install a download whose hash differs. |
| `size` | no | APK size in bytes; used for the progress bar when the server sends no length. |
| `minSdk` | no | Lowest Android API level the release supports. Older phones do not see the update. |
| `notes` | no | Short plain text shown on the update card (first three lines). |
| `releaseUrl` | no | Human-readable release page. |

Unknown fields are ignored, so the schema can grow without breaking older app versions.
Serve it with `Content-Type: application/json` over HTTPS. A manifest that fails to parse or fails
validation is ignored, and the app falls back to the GitHub API.

### What the app does with it

- At launch (release builds only), at most once per 24 hours, it fetches `version.json`. If that fails,
  it asks `https://api.github.com/repos/shing1Sks/mimic/releases/latest` and takes the first
  `mimic-*.apk` asset, using GitHub's per-asset `digest` (`sha256:...`) as the checksum. If a release
  has no digest, the card only offers to open the release page.
- If the release is newer than the installed build, Home shows an "Update available" card. "Later"
  hides it until the next version.
- "Update" streams the APK into the app's cache while computing its SHA-256, rejects it on mismatch,
  checks the file is a Mimic package with the expected `versionCode`, then opens Android's installer.
  The first time, Android asks the user to allow Mimic to install apps; the card explains this and
  continues when they come back and tap Install.
- Android itself rejects an update signed by a different key, so only APKs signed with the release
  keystore can replace an installed release.

The URLs are constants in `app/src/main/java/dev/mimic/update/UpdateManifest.kt` (`UpdateSource`).
If the GitHub repository is created under a different owner or name, change `GITHUB_REPO` there and the
links in this file and in `README.md`.

## Debug builds

Debug builds (`assembleDebug`) are signed with the local debug key and never check for updates. A phone
with a debug build installed cannot take a release APK over it (or the reverse): uninstall first.
