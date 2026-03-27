# App Icon Setup Instructions

## 📱 Setting Your App Icon

I've set up an automated icon generation system for your app. Follow these steps:

### Step 1: Save Your Icon
1. Save the attached icon image as **`icon-source.png`** in the root directory of your project
   - Location: `c:\xampp\htdocs\E2W_AI_QUOTE_GEN\icon-source.png`
   - The image should be at least 1024x1024 pixels for best quality
   - PNG format is recommended

### Step 2: Generate All Icon Sizes
Run the following command to automatically generate all required icon sizes:
```bash
npm run generate-icons
```

This will create:
- **Android icons**: All mipmap sizes (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi)
  - `ic_launcher.png` - Square launcher icon
  - `ic_launcher_round.png` - Round launcher icon
  - `ic_launcher_foreground.png` - Adaptive icon foreground
- **Web PWA icons**: public/icons/ (72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512)
- **Favicon**: public/favicon.png

### Step 3: Sync with Capacitor
After generating the icons, sync the changes:
```bash
npm run sync
```

### Step 4: Rebuild Your App
For Android:
```bash
npm run android
```

## 📂 Generated Files

### Android Icons
- `android/app/src/main/res/mipmap-mdpi/`
- `android/app/src/main/res/mipmap-hdpi/`
- `android/app/src/main/res/mipmap-xhdpi/`
- `android/app/src/main/res/mipmap-xxhdpi/`
- `android/app/src/main/res/mipmap-xxxhdpi/`

### Web Icons
- `public/icons/icon-*.png` (various sizes)
- `public/favicon.png`

## ✨ What's Been Set Up

1. ✅ Installed `sharp` package for image processing
2. ✅ Created `generate-icons.js` script with automatic resizing
3. ✅ Added `npm run generate-icons` command to package.json
4. ✅ Configured for both Android and PWA icon generation

## 🎨 Icon Design Tips

Your current icon design looks great! The red gradient background with the PDF, AI Quote, and € symbols clearly represents your app's purpose.

For best results:
- The icon should have important content in the center (safe zone)
- Avoid putting text or small details near the edges
- Test how it looks at small sizes (48x48px)
