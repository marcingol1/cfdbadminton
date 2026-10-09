# Deadminton on iOS and Android

The phone apps are the same web build wrapped by [Capacitor 8](https://capacitorjs.com):
`apps/web/dist` runs inside the system WebView, with a few native extras (landscape lock,
full screen, haptics, the Android back button, splash screen). There is one codebase: every
change to the game ships to the web, iOS and Android at once.

| Path                           | What                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/web/capacitor.config.ts` | App id (`com.marcingol.deadminton`), name, splash settings                               |
| `apps/web/android/`            | Android Studio / Gradle project                                                          |
| `apps/web/ios/`                | Xcode project (Swift Package Manager, no CocoaPods)                                      |
| `apps/web/src/platform/`       | Native glue: `native.ts` (status bar, orientation, back button, wake lock), `haptics.ts` |
| `apps/web/scripts/icons.ts`    | Draws the pixel-art icon and splash in code                                              |
| `apps/web/assets/`             | The generated source images (icon, adaptive icon layers, splash)                         |
| `.github/workflows/mobile.yml` | CI: Android debug APK, iOS simulator build, signed Android release                       |

## Try it on your Android phone (no tools needed)

Every pull request and every push to `master` builds a debug APK in GitHub Actions:

1. Open the repository's **Actions** tab → **Mobile** → the latest run → **Artifacts** →
   download **deadminton-debug-apk** (a zip with `app-debug.apk`).
2. Copy the APK to the phone and open it. Android asks to allow installing apps from that
   source (Files or Chrome); allow it once.
3. Debug builds are not signed with a store key, so Play Protect may warn. That's
   expected for test builds.

## Build it yourself

You need Node 22, plus Android Studio (Android) or a Mac with Xcode 16+ (iOS).

```bash
npm install
npm run android -w @deadminton/web   # builds, syncs, opens Android Studio → ▶ Run
npm run ios -w @deadminton/web       # builds, syncs, opens Xcode → pick a device → ▶ Run
npm run android:apk -w @deadminton/web   # just the debug APK (needs the Android SDK)
```

`npm run mobile:sync -w @deadminton/web` rebuilds the web app and copies it into both
native projects. Run it after any game change before building natively.

To run on your own iPhone from Xcode, sign in with your Apple ID (Xcode → Settings →
Accounts) and pick it as the Team under **Signing & Capabilities**. A free Apple ID works
for your own device (the app expires after 7 days). The paid program is needed for
TestFlight and the App Store.

## What's different in the app

- **Landscape only**, full screen (no status or navigation bars; swipe from the edge to
  peek at them on Android).
- **Touch controls** use the whole screen, so on wide phones they sit beside the 16:9
  game. Settings → Controls → Touch has a left-handed layout, three button sizes and
  vibration.
- **Haptics** on your hits, smashes, body hits, nearby explosions and KOs.
- **Back button** (Android): one step back through menus; in a match it pauses; on the
  main menu it exits.
- The game **pauses** when the app goes to the background, and the **screen stays on**
  during matches.
- **Settings → Sound & Video → Detail: Low** hides the crowd and thins out particles for
  slower phones.
- The FPS counter is off by default in the app (Settings → Sound & Video, or F3 on the
  web).

## Icon and splash screen

They are pixel art drawn by `apps/web/scripts/icons.ts`. To change them, edit the script
and run:

```bash
npm run icons -w @deadminton/web
```

That writes `apps/web/assets/*.png` and the web icons, then generates every native size
with `@capacitor/assets`.

## Releasing to the stores

Everything in the repository is ready; what remains needs your accounts and keys.

### Before either store

- **App id** is `com.marcingol.deadminton` (in `capacitor.config.ts`, the Android
  `build.gradle` and the Xcode project). It can't change after the first upload, so change
  it now if you want a different one.
- **Privacy policy URL**: `https://<your-vercel-domain>/privacy.html` (the page is
  `apps/web/public/privacy.html`). The answer to every data question is "no data
  collected".
- **Age rating**: cartoon violence with explosions, no blood, no online chat, no
  purchases. Expect around PEGI 7 / ESRB E10+ / App Store 9+ from the questionnaires.
- **Screenshots**: landscape gameplay. The browser test setup can capture them at the exact
  store sizes; ask for a fresh set before each release.

### Google Play

1. Create a Google Play Console developer account (one-time fee of $25). New personal
   accounts currently have to run a closed test (about 12 testers for 14 days) before
   production. The debug APK above is fine for finding those testers early.
2. Create the upload key once, and keep it safe (losing it means asking Google to reset
   it):
   ```bash
   keytool -genkeypair -v -keystore deadminton-upload.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
3. Add three repository secrets (Settings → Secrets and variables → Actions):
   `ANDROID_KEYSTORE_BASE64` (output of `base64 -w0 deadminton-upload.jks`),
   `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD`.
4. Actions → **Mobile** → **Run workflow**. The `android-release` job builds a signed
   `app-release.aab` (version code = the run number, so it always grows) and attaches it
   to the run.
5. In Play Console: create the app, enable Play App Signing, upload the `.aab` to a
   testing track, and fill in the store listing, content rating, data safety ("no data
   collected") and target audience (13+).

To build it locally instead, set `DEADMINTON_KEYSTORE` (path), `DEADMINTON_KEYSTORE_PASSWORD`
and `DEADMINTON_KEY_PASSWORD`, then run
`cd apps/web/android && ./gradlew bundleRelease -PversionCode=2 -PversionName=1.0.1`.

### Apple App Store

1. Join the Apple Developer Program ($99 per year).
2. In App Store Connect, create the app with bundle id `com.marcingol.deadminton`.
3. On a Mac: `npm run ios -w @deadminton/web`, set your Team under Signing &
   Capabilities, then Product → Archive → Distribute App → App Store Connect. The build
   appears in TestFlight for testing, then you submit it for review.
4. Fill in the listing: App Privacy "Data Not Collected", the age rating questionnaire
   (infrequent cartoon violence), the privacy policy URL, and iPhone screenshots (plus
   iPad ones, since the app runs on iPad too; set it to iPhone only in Xcode if you'd
   rather skip those).

Automating iOS uploads from CI (fastlane, an App Store Connect API key and signing
certificates as secrets) is possible later; the manual Xcode route is simpler for the
first release.

## Limits

- Online play (M5) isn't built yet; on phones the modes are vs Bot, Watch, Tutorial,
  Challenges and Replays. Local 2 players needs two Bluetooth gamepads.
- Touch controls can be moved and resized, but not remapped button by button.
- Saving a replay file works on Android; on iOS the WebView may not offer a download.
  Rewatching the last match works everywhere.
