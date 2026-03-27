import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Source icon should be at least 1024x1024 for best quality
const SOURCE_ICON = join(__dirname, 'icon-source.png');

// Android icon sizes
const ANDROID_SIZES = {
  'mipmap-mdpi': {
    launcher: 48,
    foreground: 108
  },
  'mipmap-hdpi': {
    launcher: 72,
    foreground: 162
  },
  'mipmap-xhdpi': {
    launcher: 96,
    foreground: 216
  },
  'mipmap-xxhdpi': {
    launcher: 144,
    foreground: 324
  },
  'mipmap-xxxhdpi': {
    launcher: 192,
    foreground: 432
  }
};

// Web PWA icon sizes
const WEB_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function generateAndroidIcons() {
  console.log('📱 Generating Android icons...');
  
  const resDir = join(__dirname, 'android', 'app', 'src', 'main', 'res');
  
  for (const [folder, sizes] of Object.entries(ANDROID_SIZES)) {
    const folderPath = join(resDir, folder);
    await ensureDir(folderPath);
    
    // Generate ic_launcher.png (square icon)
    await sharp(SOURCE_ICON)
      .resize(sizes.launcher, sizes.launcher, {
        fit: 'cover',
        position: 'center'
      })
      .png()
      .toFile(join(folderPath, 'ic_launcher.png'));
    
    // Generate ic_launcher_round.png (round icon)
    await sharp(SOURCE_ICON)
      .resize(sizes.launcher, sizes.launcher, {
        fit: 'cover',
        position: 'center'
      })
      .png()
      .toFile(join(folderPath, 'ic_launcher_round.png'));
    
    // Generate ic_launcher_foreground.png (for adaptive icon)
    await sharp(SOURCE_ICON)
      .resize(sizes.foreground, sizes.foreground, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(join(folderPath, 'ic_launcher_foreground.png'));
    
    console.log(`✅ Generated icons for ${folder}`);
  }
}

async function generateWebIcons() {
  console.log('🌐 Generating web PWA icons...');
  
  const iconsDir = join(__dirname, 'public', 'icons');
  await ensureDir(iconsDir);
  
  for (const size of WEB_SIZES) {
    await sharp(SOURCE_ICON)
      .resize(size, size, {
        fit: 'cover',
        position: 'center'
      })
      .png()
      .toFile(join(iconsDir, `icon-${size}x${size}.png`));
    
    console.log(`✅ Generated icon-${size}x${size}.png`);
  }
  
  // Generate favicon
  await sharp(SOURCE_ICON)
    .resize(32, 32, {
      fit: 'cover',
      position: 'center'
    })
    .png()
    .toFile(join(__dirname, 'public', 'favicon.png'));
  
  console.log('✅ Generated favicon.png');
}

async function main() {
  try {
    if (!existsSync(SOURCE_ICON)) {
      console.error('❌ Error: icon-source.png not found!');
      console.log('📝 Please save your icon as "icon-source.png" in the root directory.');
      console.log('   The icon should be at least 1024x1024 pixels for best quality.');
      process.exit(1);
    }
    
    console.log('🎨 Starting icon generation...\n');
    
    await generateAndroidIcons();
    console.log('');
    await generateWebIcons();
    
    console.log('\n✨ All icons generated successfully!');
    console.log('📱 Android icons: android/app/src/main/res/mipmap-*/');
    console.log('🌐 Web icons: public/icons/');
    console.log('\n💡 Next steps:');
    console.log('   1. Run: npm run sync');
    console.log('   2. Rebuild your Android app');
    
  } catch (error) {
    console.error('❌ Error generating icons:', error);
    process.exit(1);
  }
}

main();
