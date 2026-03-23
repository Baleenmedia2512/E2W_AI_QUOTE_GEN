# Build APK Script for AI Quote Generator
# This script builds a debug APK for Android

Write-Host "Building AI Quote Generator APK..." -ForegroundColor Cyan

# Step 1: Build web application
Write-Host "`n[1/4] Building web app..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Web build failed!" -ForegroundColor Red
    exit 1
}

# Step 2: Sync to Android
Write-Host "`n[2/4] Syncing to Android..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Host "Sync failed!" -ForegroundColor Red
    exit 1
}

# Step 3: Build APK
Write-Host "`n[3/4] Building APK..." -ForegroundColor Yellow
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
Set-Location android
.\gradlew assembleDebug
$buildResult = $LASTEXITCODE
Set-Location ..

if ($buildResult -ne 0) {
    Write-Host "APK build failed!" -ForegroundColor Red
    exit 1
}

# Step 4: Copy APK to project root
Write-Host "`n[4/4] Copying APK..." -ForegroundColor Yellow
Copy-Item "android\app\build\outputs\apk\debug\app-debug.apk" -Destination "AI-Quote-Generator.apk" -Force

$apk = Get-Item "AI-Quote-Generator.apk"
Write-Host "`n✓ SUCCESS! APK built successfully!" -ForegroundColor Green
Write-Host "Location: $($apk.FullName)" -ForegroundColor Green
Write-Host "Size: $([math]::Round($apk.Length/1MB, 2)) MB" -ForegroundColor Green
Write-Host "`nYou can now install this APK on your Android device." -ForegroundColor Cyan
