# Cashbox Native

Expo React Native app for the Cashbox mobile workflow.

## Setup

```bash
git clone https://github.com/SLL288/cashbox-native.git
cd cashbox-native
npm install
npx eas-cli login
```

Check the project before building:

```bash
npx tsc --noEmit
npm run lint
npx eas-cli config --profile production --platform ios
npx eas-cli config --profile production --platform android
```

## Local Builds

Local EAS builds must be run one platform at a time. Do not use `--platform all` with `--local`.

### iOS on Mac

Requirements: macOS, Xcode, CocoaPods, fastlane, and an Apple Developer account with valid signing credentials.

```bash
npm run build:ios:local
```

The output file is:

```text
build/Cashbox.ipa
```

Upload the IPA to App Store Connect/TestFlight with Transporter or EAS Submit.

### Android APK for Direct Install

Requirements: Android Studio, Android SDK, Java/OpenJDK, and Expo login.

```bash
npm run build:android:local:apk
```

The output file is:

```text
build/Cashbox.apk
```

Send this APK to managers for direct Android install.

### Android AAB for Play Console

```bash
npm run build:android:local:aab
```

The output file is:

```text
build/Cashbox.aab
```

Use the AAB for Google Play Console internal testing or production tracks.

## Cloud Builds

Cloud builds consume Expo/EAS quota:

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli build --platform android --profile production
```

