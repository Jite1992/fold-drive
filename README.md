# Fold Drive

A driving companion app for the Samsung Galaxy Z Fold 8. Google Maps does the navigating, and Fold Drive shows your trip stats, quick access to calls, WhatsApp and calendar, and a fuel efficiency tracker. It has layouts for both the cover screen and the inner screen.

## Install on your phone

1. On the Fold, open **https://github.com/Jite1992/fold-drive/releases/latest** in Chrome.
2. Under **Assets**, tap **fold-drive.apk** to download it.
3. Open the downloaded file. If Android asks, allow **Install unknown apps** for Chrome, then tap **Install**.
   - Play Protect may warn that the app is from an unknown developer. Tap **More details → Install anyway**. This is normal for apps not from the Play Store.
4. Open **Fold Drive** and allow **Location**.
5. Go to **Settings (sliders button) → Permissions** and allow:
   - **Notification access**: lets Fold Drive read the turn, time left and km left from Google Maps. It also shows WhatsApp unread counts.
   - **Display over other apps**: the floating stats bubble on top of Google Maps.
   - **Calendar** and **Phone calls**: your meetings, and one-tap calls.
   - **Allow running in background (battery)**: stops Samsung from pausing trip recording.
6. In Settings, set **Home**, **Office** and a third place by typing the address as you would in Google Maps. Add your quick-dial contacts too.

### Updating

Each new version appears on the same releases page. Download the new **fold-drive.apk** and install it over the old one. Your fill-ups, trips and settings are kept.

## How it works

- **Navigating.** Choose a destination in Fold Drive (a saved place, a meeting, a search, or say "Navigate to …"). Google Maps opens and starts navigating.
  - On the inner screen, Google Maps opens side by side with Fold Drive.
  - On the cover screen, Google Maps opens full screen with the Fold Drive bubble floating on top. Tap the bubble to return.
- **Trip stats.** Drive time, average speed, km driven and top speed come from the phone's GPS. Time to destination, km to destination and arrival time come from Google Maps. Fold Drive combines them for total trip time, trip fuel and cost.
- **Ending a trip.** Tap **End** to save the trip. It then appears with your recent trips and the weekly km total.
- **If directions look wrong.** Google Maps occasionally changes how it words its notification. Open **Settings → Google Maps** to see exactly what Fold Drive read, and send a screenshot to have the reading adjusted. Your own GPS stats keep working regardless.

## Fuel prices

On the 28th–31st and the 1st–3rd of each month, the **Update UAE fuel prices** job reads the new UAE prices and saves them to `web/prices.json`. The app picks them up automatically.

If the job can't read the announcement, GitHub emails you. Until it's fixed, you can edit `web/prices.json` here or type your own price in the app.

## For developers

- `web/`: the app's screens (HTML, CSS, JavaScript). These also run as a web app.
- `android/`: the Android wrapper. It handles Google Maps notifications, background GPS, the floating bubble, calendar and calls.
- `.github/workflows/build-apk.yml`: builds and publishes the APK on every change.
- `android/signing/release.jks.b64`: the key that signs the APK, so updates install over the old version.
  - To keep the key private, add repository secrets `KEYSTORE_B64` (with this file's contents) and `KEYSTORE_PASSWORD` (`folddrive-sideload`), then delete the file.
