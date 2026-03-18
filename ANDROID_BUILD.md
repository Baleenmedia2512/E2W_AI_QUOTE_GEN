# Android Build Setup

## Prerequisites
- Node.js and npm installed
- Android Studio installed
- Java JDK 11 or higher
- Android SDK installed

## Setup Commands

### 1. Install Capacitor CLI (if not already installed)
```bash
npm install -g @capacitor/cli
```

### 2. Add Android Platform
```bash
npx cap add android
```

### 3. Sync Web Assets to Android
```bash
npm run build
npx cap sync android
```

### 4. Open in Android Studio
```bash
npx cap open android
```

### 5. Build and Run
- In Android Studio, connect a physical device or start an emulator
- Click the "Run" button or use Shift+F10
- Or build APK: Build > Build Bundle(s) / APK(s) > Build APK(s)

## Required Permissions

The app requires the following permissions (configured in AndroidManifest.xml):
- INTERNET: For API calls to Gemini
- WRITE_EXTERNAL_STORAGE: For saving PDF files (Android < 10)
- READ_EXTERNAL_STORAGE: For reading uploaded proposals

## Resources Needed

Create the following resources in `android/app/src/main/res/`:

### Icon Files (mipmap folders)
- `mipmap-mdpi/ic_launcher.png` (48x48)
- `mipmap-hdpi/ic_launcher.png` (72x72)
- `mipmap-xhdpi/ic_launcher.png` (96x96)
- `mipmap-xxhdpi/ic_launcher.png` (144x144)
- `mipmap-xxxhdpi/ic_launcher.png` (192x192)

### Splash Screen (drawable folders)
- `drawable/splash.png` (recommended: 1080x1920)

## Testing on Physical Device

1. Enable Developer Options on your Android device
2. Enable USB Debugging
3. Connect device via USB
4. Run: `npx cap run android`

## Troubleshooting

### Build Errors
- Clear cache: `./gradlew clean` in android folder
- Invalidate Android Studio caches: File > Invalidate Caches / Restart

### App Crashes
- Check LogCat in Android Studio
- Verify all required permissions are granted
- Check capacitor.config.ts settings

## Production Build

1. Generate signed APK or AAB:
   - In Android Studio: Build > Generate Signed Bundle / APK
   - Follow the wizard to create or use existing keystore

2. Optimize images and assets before building
3. Test on multiple devices and Android versions
4. Submit to Google Play Console

## Additional Configuration

### AndroidManifest.xml
Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" 
                 android:maxSdkVersion="28" />
```

### Network Security Config (Optional)
For http connections in development, create `android/app/src/main/res/xml/network_security_config.xml`
