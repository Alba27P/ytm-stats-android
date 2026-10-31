# YTM Stats for Android

Tracks what you play in the **YouTube Music app** and shows all-time stats and listening habits: the same dashboard as the Chrome extension, adapted for phones. Everything stays on your phone.

## Build the APK

### Option A: GitHub (no software to install)
1. Create a new repository on github.com (private is fine).
2. Upload the contents of this folder (including the hidden `.github` folder and `gradlew`). The easiest way is GitHub Desktop or `git push`. The web uploader skips hidden folders, so if you use it, create `.github/workflows/build.yml` by hand with the same contents.
3. Open the **Actions** tab → **Build APK**. It runs automatically on every push (or press **Run workflow**).
4. When it finishes (about 3–5 minutes), open the run and download **YTMStats-apk** under *Artifacts*. Unzip it to get the `.apk`.

### Option B: Android Studio
1. Install Android Studio and open this folder (**File → Open**).
2. Let Gradle sync, then **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
3. Or plug in your phone with USB debugging on and press **Run**.

## Install and set up
1. Copy the APK to your phone and open it. Allow "install unknown apps" for your file manager or browser when asked.
2. Open **YTM Stats** and tap **Grant access**, then switch on YTM Stats under *Notification access*.
   - **If the switch is greyed out** (Android 13+ restricts sideloaded apps): go back, tap **Open app info**, then **⋮ (top right) → Allow restricted settings**, and try again.
3. Play something in YouTube Music. It appears in the app within a few seconds.

Notification access is the only way Android lets an app see what another app is playing. YTM Stats only reads YouTube Music's media info (title, artist, album, artwork, play/pause, position). It never reads your notifications' contents.

## How it works
- `TrackerService`: a notification-listener service that follows YouTube Music's media session. It counts only real playback time (not pauses or seeks), treats a repeat as a new play, skips ads, and saves every 15 seconds and whenever you pause.
- `PlayStore`: an SQLite database on your phone, using the same record format as the extension, so backups move between the two.
- `MainActivity`: shows the dashboard (`assets/web`, shared with the extension) in a WebView, plus a bridge for data access, file import/export and settings.
- Same rules as the extension: 30 seconds or more, or half of a short track, counts as a play; anything shorter is a skip.

## Moving data between Chrome and Android
Export a JSON backup on one and import it on the other, from the *Your data* section. Duplicate sessions are skipped, so you can import repeatedly. Google Takeout `watch-history.json` imports work too.

## Battery
Tracking adds almost nothing. The app reacts to YouTube Music's own playback updates and only checks every 5 seconds while music is playing. If your phone's battery saver kills background apps aggressively (some Samsung, Xiaomi and Huawei phones do), set YTM Stats to *Unrestricted* battery usage in App info.
