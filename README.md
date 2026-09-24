# GR2 Capacitor App

A Capacitor-based mobile application for Android and iOS, built with TypeScript and Vite.

## Prerequisites

Before you begin, ensure you have the following installed:

### General Requirements
- Node.js (v16 or higher)
- npm (v8 or higher)

### For Android Development
- Java Development Kit (JDK) 11 or higher
- Android SDK (API level 30 or higher)
- Android Studio (recommended) or Android command-line tools
- Gradle (comes with Android Studio)

### For iOS Development
- macOS 11 or higher
- Xcode 12 or higher
- CocoaPods (`sudo gem install cocoapods`)
- iOS deployment target 12.0 or higher

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd gr2-capacitor-app-android-ios
```

2. Install dependencies:
```bash
npm install
```

3. Build the web assets:
```bash
npm run build
```

## Compiling for Android

### Step 1: Install Android Dependencies
Ensure Android SDK and Java are properly installed and environment variables are set:
```bash
# Set ANDROID_HOME and JAVA_HOME in your shell profile (~/.zshrc, ~/.bash_profile, etc.)
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
export JAVA_HOME=$(/usr/libexec/java_home)
```

### Step 2: Prepare the Build
```bash
npm run build
npx cap sync android
```

### Step 3: Build the APK
```bash
cd android
./gradlew assembleDebug
```

For a release build:
```bash
cd android
./gradlew assembleRelease
```

### Step 4: Build Location
- **Debug APK**: `android/app/build/outputs/apk/debug/app-debug.apk`
- **Release APK**: `android/app/build/outputs/apk/release/app-release.apk`

### Step 5: Open in Android Studio (Optional)
```bash
npx cap open android
```

This will open the Android project in Android Studio where you can build, run, and debug the app.

## Compiling for iOS

### Step 1: Install iOS Dependencies
```bash
npm run build
npx cap sync ios
```

### Step 2: Open in Xcode
```bash
npx cap open ios
```

### Step 3: Build in Xcode
1. Open the iOS project in Xcode
2. Select your target device or simulator
3. Build: `Product → Build` (or `Cmd + B`)
4. Archive (for distribution): `Product → Archive`

### Alternative: Build via Command Line
```bash
cd ios/App
pod install
cd ..
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS' build
```

For release:
```bash
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release -destination 'generic/platform=iOS' build
```

### Step 4: Build Location
- **Debug Build**: `ios/App/build/Debug-iphoneos/` or `~/Library/Developer/Xcode/DerivedData/`
- **Release Archive**: Available in Xcode's Organizer window

## Testing on a Physical Device

### Android

#### Connect via USB
1. Enable USB Debugging on your Android device:
   - Go to Settings → About Phone
   - Tap Build Number 7 times to enable Developer Options
   - Go to Settings → Developer Options
   - Enable USB Debugging

2. Connect your phone to your computer via USB cable

3. Verify the device is recognized:
```bash
adb devices
```

You should see your device listed with `device` status.

#### Install and Run
```bash
cd android
./gradlew installDebug
```

Or use Android Studio's Run button to deploy directly.

#### View Logs
```bash
adb logcat
```

### iOS

#### Connect via USB or Wireless
1. Connect your iPhone/iPad to your Mac via USB or over Wi-Fi (in Xcode: Window → Devices and Simulators)

2. Trust the computer when prompted on your device

3. In Xcode:
   - Select your device from the device dropdown
   - Click the Run button (or `Cmd + R`)

#### Install via Xcode
1. Open the project in Xcode:
```bash
npx cap open ios
```

2. Select your device from the device dropdown
3. Click the Run button to build and install

#### View Logs
In Xcode: View → Debug Area → Show Debug Area (or `Cmd + Shift + Y`)

Or use the console:
```bash
log stream --predicate 'process == "YOUR_APP_NAME"'
```

## Testing on an Emulator/Simulator

### Android Emulator
```bash
# List available emulators
emulator -list-avds

# Start an emulator
emulator -avd <emulator-name>

# Run the app on the emulator
cd android
./gradlew installDebug
```

### iOS Simulator
```bash
# Open Xcode and select a simulator from the device dropdown
# Then click Run (Cmd + R)
```

Or via command line:
```bash
npx cap open ios
# Then use Xcode to run on the selected simulator
```

## Development Workflow

### Hot Reload (Web)
```bash
npm run dev
```

This starts a dev server with hot module replacement for faster development.

### Sync Changes
After making changes to the web code, sync to native platforms:
```bash
npm run build
npx cap sync
```

For platform-specific sync:
```bash
npx cap sync ios
npx cap sync android
```

## Build Scripts

Refer to `package.json` for available scripts:
```bash
npm run build      # Build web assets
npm run dev        # Start dev server
npm run preview    # Preview production build
npm run lint       # Run linter
```

## Troubleshooting

### Android
- **Gradle sync fails**: Update Gradle and Android SDK in Android Studio
- **Device not found**: Ensure USB debugging is enabled and drivers are installed
- **Build fails with Java errors**: Verify Java version and JAVA_HOME path

### iOS
- **Pod dependency errors**: Run `cd ios/App && pod install --repo-update`
- **Code signing errors**: Update signing certificate in Xcode (Project → Signing & Capabilities)
- **Device not recognized**: Disconnect and reconnect the device; restart Xcode if needed

## Additional Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Android Development Guide](https://developer.android.com/guide)
- [iOS Development Guide](https://developer.apple.com/ios/)
- [Vite Documentation](https://vitejs.dev/)
