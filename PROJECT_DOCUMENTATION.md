# Quote Buddy - Complete Project Documentation

> **AI-Powered Quote Generation System**  
> A comprehensive mobile-first application for generating professional quotations from proposal documents using Google Gemini AI.

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Features & Functionality](#features--functionality)
4. [Project Structure](#project-structure)
5. [Setup & Installation](#setup--installation)
6. [Authentication System](#authentication-system)
7. [Cloud Storage & Sync](#cloud-storage--sync)
8. [Cache Management](#cache-management)
9. [Mobile Development](#mobile-development)
10. [API Integration](#api-integration)
11. [Database Schema](#database-schema)
12. [Deployment](#deployment)
13. [Troubleshooting](#troubleshooting)

---

## 🎯 Project Overview

**Quote Buddy** is a mobile-first React + Ionic application that leverages AI to generate professional quotations from proposal PDFs, Excel files, and images. The application provides a complete workflow from document upload to quote generation, editing, and PDF export.

### Key Capabilities
- **AI-Powered Analysis**: Uses Google Gemini AI to analyze proposals and generate structured quotes
- **Multi-Format Support**: Handles PDF, Excel (.xlsx), and JPEG files
- **Offline-First**: Works seamlessly offline with IndexedDB storage
- **Cloud Sync**: Team-wide proposal sharing via Supabase
- **Mobile Native**: Android and iOS apps via Capacitor
- **Role-Based Access**: Complete authentication with RBAC
- **Professional Templates**: Multiple quote templates with customization

### Application Type
- **Platform**: Progressive Web App (PWA) + Native Mobile (Android/iOS)
- **Architecture**: Single Page Application (SPA)
- **Deployment**: Web + Mobile App Stores

---

## 🛠️ Tech Stack

### Frontend Framework
- **React 18.2.0** - UI library with TypeScript
- **Ionic Framework 7.8.0** - Mobile UI components
- **Chakra UI 2.10.9** - Component library
- **Emotion** - CSS-in-JS styling
- **Framer Motion 12.38.0** - Animations

### Routing & Navigation
- **React Router 5.3.4** - Client-side routing
- **React Router DOM 5.3.4** - DOM bindings

### State Management
- **Zustand 4.5.0** - Lightweight state management
- **Persist middleware** - State persistence

### Mobile Development
- **Capacitor 6.0.0** - Native mobile runtime
- **@capacitor/android** - Android platform
- **@capacitor/ios** - iOS platform
- **@capacitor/filesystem** - File system access
- **@capacitor/share** - Native sharing
- **@capacitor/browser** - In-app browser
- **@capacitor-community/file-opener** - File opening
- **@capacitor-community/speech-recognition** - Voice input

### AI & APIs
- **@google/generative-ai 0.24.1** - Google Gemini AI SDK
- **Custom prompt engineering** - Optimized for quote generation

### Database & Storage
- **Supabase 2.100.1** - PostgreSQL database + Storage
- **IndexedDB** - Local browser database
- **LocalStorage** - Quick key-value storage
- **bcryptjs 3.0.3** - Password hashing

### PDF Processing
- **pdfjs-dist 4.0.379** - PDF parsing and rendering
- **react-pdf 7.7.1** - React PDF viewer
- **jsPDF 2.5.2** - PDF generation
- **html2canvas 1.4.1** - HTML to canvas conversion

### Excel Processing
- **xlsx 0.18.5** - Excel file parsing

### Build Tools
- **Vite 5.0.11** - Fast build tool and dev server
- **TypeScript 5.3.3** - Type safety
- **@vitejs/plugin-react 4.2.1** - React plugin for Vite

### Icons & Fonts
- **Ionicons 7.2.2** - Icon library
- **React Icons 5.6.0** - Additional icons
- **@fontsource/inter 5.2.8** - Inter font family

### Development Tools
- **Sharp 0.34.5** - Image processing for icon generation
- **ESLint** - Code linting
- **TypeScript types** - Type definitions

---

## ✨ Features & Functionality

### 1. Document Upload & Processing

#### Supported Formats
- **PDF Files** (.pdf)
  - Multi-page support
  - Text extraction
  - Page-by-page rendering
  - Image extraction from pages
- **Excel Files** (.xlsx)
  - Sheet parsing
  - Data extraction
  - Table recognition
- **Image Files** (.jpg, .jpeg)
  - OCR-ready format
  - Preview support

#### Upload Methods
- Drag & drop interface
- Click to browse
- File validation (type, size)
- Duplicate detection (local + cloud)
- Progress indicators

#### Processing Features
- Text extraction from all formats
- Page count detection
- File size validation (configurable max size)
- Automatic thumbnail generation
- Metadata extraction

### 2. AI Chat Interface

#### Chat Capabilities
- Real-time conversation with Google Gemini AI
- Context-aware responses based on uploaded proposals
- Multi-turn conversations
- Message history persistence
- Typing indicators
- Error handling and retry logic

#### Sample Prompts
- "Generate a quote for this proposal"
- "What services are mentioned in this document?"
- "Create a quote for [specific service]"
- "Summarize the proposal"

#### AI Features
- Intelligent quote structure generation
- Service/product identification
- Pricing suggestions
- Timeline estimation
- Terms and conditions generation

### 3. Quote Generation & Editing

#### Quote Structure
```typescript
{
  sections: [
    {
      title: "Section Name",
      items: [
        {
          description: "Service/Product",
          quantity: number,
          unit: "string",
          unitPrice: number,
          total: number
        }
      ]
    }
  ],
  subtotal: number,
  gst: number,
  total: number,
  deliveryTimeline: string,
  termsAndConditions: string[]
}
```

#### Editing Features
- Add/remove sections
- Add/remove line items
- Edit quantities and prices
- Auto-calculated totals
- GST toggle (10% configurable)
- Delivery timeline customization
- Terms and conditions editor
- Real-time preview

#### Quote Grouping
- Multi-location support
- City-wise service grouping
- Automatic proposal association
- Service registry building

### 4. Company & Client Management

#### Company Information
- Company name and logo
- Contact details (email, phone, website)
- Address information
- GST number
- Bank details
- Persistent storage (localStorage + cloud)
- Cross-device sync via Supabase

#### Client Information
- Client/customer name
- Contact person details
- Email and phone
- Address
- GST number (optional)
- Form validation
- Auto-save functionality

### 5. Template System

#### Available Templates
1. **Corporate Minimal**
   - Clean, professional design
   - Minimalist layout
   - Corporate color scheme

2. **Premium Agency**
   - Modern, stylish design
   - Bold typography
   - Agency-focused layout

3. **Classic Professional**
   - Traditional business format
   - Conservative styling
   - Formal presentation

#### Template Features
- Dynamic data binding
- Responsive layouts
- Print-optimized
- PDF export ready
- Customizable colors and fonts

### 6. PDF Export

#### Web Export
- Browser download
- Standard PDF format
- High-quality rendering
- Embedded fonts

#### Mobile Export (Android/iOS)
- Save to device storage
- **Android notification bar integration**
- Tap notification to open PDF
- Native file sharing
- WhatsApp, Email, Drive integration
- File manager access

#### Export Features
- Multiple page support
- Header/footer customization
- Logo embedding
- Table formatting
- Professional styling

### 7. Proposal Library

#### Local Storage (IndexedDB)
- Offline-first architecture
- Fast access
- Unlimited storage (browser-dependent)
- Automatic cleanup

#### Cloud Storage (Supabase)
- Team-wide visibility
- Cross-device access
- Automatic sync
- Conflict resolution

#### Library Features
- Recent uploads view
- Search and filter
- Sort by date/name
- Preview thumbnails
- Delete functionality
- Duplicate detection
- Cloud indicator (☁️ badge)

### 8. Multi-Proposal Support

#### Active Proposals
- Load multiple proposals simultaneously
- Isolated page extraction per proposal
- Source tracking (sourceId, sourceName)
- Independent chat contexts
- Proposal-specific quotes

#### Use Cases
- Multi-location quotes
- Comparative analysis
- Bundled services
- Regional pricing

### 9. Authentication & Authorization

#### User Management
- Email/password authentication
- Session persistence
- Auto-login on app start
- Secure logout

#### Role-Based Access Control (RBAC)
- **Admin**: Full access + user management
- **Manager**: Create, edit, view quotes
- **Sales**: Create and view quotes
- **Viewer**: View-only access

#### Permissions
- `create_quotes`
- `edit_quotes`
- `delete_quotes`
- `view_quotes`
- `manage_users`

#### Security Features
- Bcrypt password hashing (10 rounds)
- Row Level Security (RLS) in database
- Protected routes
- Permission checking
- Session timeout (configurable)

### 10. Cache Management & Updates

#### Service Worker
- Dynamic cache versioning
- Network-first strategy
- Auto-cleanup of old caches
- Skip waiting for instant updates
- Works in development and production

#### Update System
- Automatic update detection (30s interval)
- Visual update notifications
- One-click update
- Version tracking
- Build timestamp comparison

#### Data Sync
- Unified storage API
- Conflict resolution (newest wins)
- Offline queue
- Auto-sync on reconnection
- Pending changes tracking

### 11. Progressive Web App (PWA)

#### PWA Features
- Installable on mobile/desktop
- Offline functionality
- App-like experience
- Splash screen
- App icons (multiple sizes)
- Manifest configuration

#### Offline Capabilities
- Full app functionality offline
- Local data storage
- Queue sync when online
- Offline indicator

---

## 📁 Project Structure

```
E2W_AI_QUOTE_GEN/
│
├── public/                          # Static assets
│   ├── icons/                       # App icons (various sizes)
│   ├── favicon.png
│   ├── manifest.json                # PWA manifest
│   ├── offline.html                 # Offline fallback page
│   └── service-worker.js            # Service worker for PWA
│
├── src/                             # Source code
│   ├── components/                  # React components
│   │   ├── AutocompleteInput/       # Autocomplete input component
│   │   ├── BottomNav/               # Mobile bottom navigation
│   │   ├── ChatInterface/           # AI chat UI
│   │   ├── ClientInfoForm/          # Client details form
│   │   ├── CompanyInfoForm/         # Company details form
│   │   ├── ErrorBoundary/           # Error boundary wrapper
│   │   ├── Header/                  # Desktop header with user profile
│   │   ├── Layout/                  # App layout wrapper
│   │   ├── LoadingSpinner/          # Loading indicator
│   │   ├── MultiProposalViewer/     # Multi-PDF viewer
│   │   ├── PrivateRoute/            # Route protection wrapper
│   │   ├── ProposalUpload/          # File upload component
│   │   ├── ProposalViewer/          # PDF viewer
│   │   ├── QuotePreview/            # Editable quote display
│   │   ├── QuoteWizard/             # Quote creation wizard
│   │   ├── Templates/               # Quote templates
│   │   │   ├── CorporateMinimal.tsx
│   │   │   ├── PremiumAgency.tsx
│   │   │   └── ClassicProfessional.tsx
│   │   ├── TemplateSelector/        # Template chooser
│   │   ├── UpdateNotification/      # Update banner
│   │   └── UserProfile/             # User dropdown menu
│   │
│   ├── pages/                       # Page components
│   │   ├── HomePage.tsx             # Main page (upload, chat, viewer)
│   │   ├── DocumentsPage.tsx        # Proposal library page
│   │   ├── QuotePage.tsx            # Quote creation wizard
│   │   ├── QuotePreviewPage.tsx     # Final quote preview & export
│   │   ├── LoginPage.tsx            # Login form
│   │   └── UnauthorizedPage.tsx     # Access denied page
│   │
│   ├── services/                    # Business logic & API
│   │   ├── geminiService.ts         # Google Gemini AI integration
│   │   ├── pdfExportService.ts      # PDF generation & export
│   │   ├── authService.ts           # Authentication logic
│   │   ├── companyService.ts        # Company data sync
│   │   ├── leadService.ts           # Lead management
│   │   ├── dataSyncService.ts       # Unified storage & sync
│   │   ├── supabaseClient.ts        # Supabase connection
│   │   └── supabaseProposalService.ts # Cloud proposal storage
│   │
│   ├── store/                       # State management
│   │   ├── index.ts                 # Main Zustand store
│   │   └── authStore.ts             # Auth state management
│   │
│   ├── types/                       # TypeScript definitions
│   │   ├── index.ts                 # Core types
│   │   ├── chat.ts                  # Chat message types
│   │   ├── quote.ts                 # Quote structure types
│   │   ├── company.ts               # Company info types
│   │   ├── client.ts                # Client info types
│   │   ├── auth.ts                  # Auth types
│   │   ├── lead.ts                  # Lead types
│   │   └── template.ts              # Template types
│   │
│   ├── utils/                       # Utility functions
│   │   ├── pdfUtils.ts              # PDF processing utilities
│   │   ├── promptTemplates.ts       # AI prompt templates
│   │   ├── localStorage.ts          # Browser storage helpers
│   │   ├── fileUtils.ts             # File handling utilities
│   │   ├── imageStorage.ts          # Image storage utilities
│   │   ├── proposalStorage.ts       # Proposal storage utilities
│   │   ├── cacheVersion.ts          # Cache versioning
│   │   ├── pwa.ts                   # PWA utilities
│   │   └── quoteGrouping.ts         # Quote grouping logic
│   │
│   ├── hooks/                       # Custom React hooks
│   │   ├── useCompanySync.ts        # Company data sync hook
│   │   └── useCityServiceRegistry.ts # City service registry hook
│   │
│   ├── constants/                   # Constants
│   │   └── defaultCompany.ts        # Default company data
│   │
│   ├── plugins/                     # Capacitor plugins
│   │   └── downloadNotification.ts  # Android notification plugin
│   │
│   ├── styles/                      # Global styles
│   │   ├── global.css               # Global CSS
│   │   └── pdfExport.css            # PDF export styles
│   │
│   ├── theme/                       # Chakra UI theme
│   │   └── index.ts                 # Theme configuration
│   │
│   ├── App.tsx                      # Root component
│   ├── main.tsx                     # Entry point
│   └── vite-env.d.ts                # Vite type definitions
│
├── android/                         # Android native project
│   ├── app/
│   │   └── src/main/
│   │       ├── java/com/baleenmedia/quotegen/
│   │       │   ├── MainActivity.java
│   │       │   └── DownloadNotificationPlugin.java
│   │       ├── res/                 # Android resources
│   │       └── AndroidManifest.xml
│   ├── build.gradle
│   └── gradle/
│
├── dist/                            # Production build output
│
├── node_modules/                    # Dependencies
│
├── .env                             # Environment variables (gitignored)
├── .env.example                     # Environment template
├── .gitignore                       # Git ignore rules
├── package.json                     # NPM dependencies & scripts
├── package-lock.json                # Dependency lock file
├── tsconfig.json                    # TypeScript config
├── tsconfig.node.json               # TypeScript config for Node
├── vite.config.ts                   # Vite configuration
├── capacitor.config.ts              # Capacitor configuration
├── index.html                       # HTML entry point
│
├── database-setup.sql               # Database schema for auth
├── database-proposals-setup.sql     # Database schema for proposals
│
├── generate-icons.js                # Icon generation script
├── generate-password-hash.js        # Password hashing utility
├── build-apk.ps1                    # Android build script
│
├── README.md                        # Main readme
├── AUTHENTICATION.md                # Auth system docs
├── CACHE_MANAGEMENT.md              # Cache system docs
├── CLOUD_STORAGE_SETUP.md           # Cloud storage docs
├── MOBILE_PDF_EXPORT.md             # Mobile PDF docs
├── ANDROID_BUILD.md                 # Android build docs
├── QUICK_START_AUTH.md              # Auth quick start
├── CACHE_QUICK_START.md             # Cache quick start
├── ICON_SETUP.md                    # Icon setup guide
├── FIXES_APPLIED.md                 # Bug fixes log
└── PROJECT_DOCUMENTATION.md         # This file
```

---

## 🚀 Setup & Installation

### Prerequisites

1. **Node.js** (v16 or higher)
2. **npm** or **yarn**
3. **Git**
4. **Android Studio** (for Android development)
5. **Xcode** (for iOS development, macOS only)
6. **Supabase Account** (for cloud features)
7. **Google Gemini API Key**

### Step 1: Clone Repository

```bash
git clone https://github.com/Baleenmedia2512/E2W_AI_QUOTE_GEN.git
cd E2W_AI_QUOTE_GEN
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Environment Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and add your API keys:
```env
# Google Gemini AI API Key
VITE_GEMINI_API_KEY=your_gemini_api_key_here

# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# App Configuration
VITE_MAX_FILE_SIZE_MB=10
```

#### Get Google Gemini API Key
1. Visit: https://makersuite.google.com/app/apikey
2. Sign in with Google account
3. Create new API key
4. Copy and paste into `.env`

#### Get Supabase Keys
1. Visit: https://app.supabase.com
2. Create new project or select existing
3. Go to Settings → API
4. Copy `URL` and `anon public` key
5. Paste into `.env`

### Step 4: Database Setup

#### Authentication Tables

1. Open Supabase SQL Editor
2. Run `database-setup.sql`:
```sql
-- Creates roles and users tables
-- Sets up Row Level Security
-- Creates indexes
```

3. Create your first admin user:
```bash
node generate-password-hash.js
# Enter password when prompted
# Copy the hash
```

4. Insert admin user:
```sql
INSERT INTO users (email, password_hash, full_name, role_id, is_active)
VALUES (
  'admin@example.com',
  'paste_bcrypt_hash_here',
  'Admin User',
  (SELECT id FROM roles WHERE role_name = 'admin'),
  true
);
```

#### Proposal Storage Tables

1. In Supabase SQL Editor, run `database-proposals-setup.sql`
2. Go to Storage → Create new bucket
3. Bucket name: `proposals`
4. Make it **private**
5. Policies are auto-created by SQL script

### Step 5: Generate App Icons

```bash
npm run generate-icons
```

This creates icons for:
- Web (favicon, PWA icons)
- Android (mipmap resources)
- iOS (app icons)

### Step 6: Run Development Server

```bash
npm run dev
```

App will be available at: **http://localhost:5173/**

### Step 7: Build for Production

```bash
npm run build
```

Output in `dist/` folder.

### Step 8: Preview Production Build

```bash
npm run preview
```

---

## 🔐 Authentication System

### Overview
Complete authentication system with PostgreSQL (Supabase) and role-based access control.

### Database Tables

#### 1. Roles Table
```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name VARCHAR(50) UNIQUE NOT NULL,
  permissions JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Default Roles:**
- `admin` - Full access + user management
- `manager` - Create, edit, view quotes
- `sales` - Create and view quotes
- `viewer` - View-only access

#### 2. Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role_id UUID REFERENCES roles(id),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Authentication Flow

1. **Login**
   - User enters email/password
   - `authService.login()` validates credentials
   - Bcrypt compares password hash
   - User object + permissions loaded
   - Session saved to localStorage
   - Redirect to home page

2. **Session Persistence**
   - Zustand persist middleware
   - Auto-restore on app start
   - Token refresh (if implemented)

3. **Logout**
   - Clear localStorage
   - Reset auth store
   - Redirect to login

### Protected Routes

```typescript
// Protect entire route
<PrivateRoute exact path="/" component={HomePage} />

// Require specific permission
<PrivateRoute 
  exact 
  path="/quote" 
  component={QuotePage}
  requiredPermission="create_quotes"
/>

// Require specific role
<PrivateRoute 
  exact 
  path="/admin" 
  component={AdminPage}
  requiredRole="admin"
/>
```

### Using Auth in Components

```typescript
import { useAuthStore } from '../store/authStore';

function MyComponent() {
  const { user, isAuthenticated, hasPermission, logout } = useAuthStore();

  if (!isAuthenticated) {
    return <div>Please login</div>;
  }

  if (!hasPermission('create_quotes')) {
    return <div>No permission</div>;
  }

  return (
    <div>
      <p>Welcome, {user?.full_name}!</p>
      <p>Role: {user?.role.role_name}</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Security Features

- ✅ Bcrypt password hashing (10 rounds)
- ✅ Row Level Security (RLS) in database
- ✅ Session persistence
- ✅ Auto-restore on app start
- ✅ Permission-based access control
- ✅ Role-based access control
- ✅ Protected routes
- ✅ Secure logout

---

## ☁️ Cloud Storage & Sync

### Overview
Hybrid storage system combining local IndexedDB with cloud Supabase for team-wide proposal sharing.

### Storage Layers

#### 1. Local Storage (IndexedDB)
- **Purpose**: Offline capability, fast access
- **Capacity**: Browser-dependent (typically 50MB+)
- **Persistence**: Permanent until cleared
- **Access**: Instant

#### 2. Cloud Storage (Supabase)
- **Purpose**: Team sharing, cross-device sync
- **Capacity**: Unlimited (plan-dependent)
- **Persistence**: Permanent
- **Access**: Network-dependent

### Features

#### Global Proposal Library
- All users see all proposals
- Uploaded by anyone in the team
- Shows uploader's name
- Cloud indicator (☁️ badge)

#### Hybrid Upload Flow
```
User uploads file
  ↓
1. Save to IndexedDB (local) ✅
2. Upload to Supabase Storage ✅
3. Save metadata to proposals table ✅
4. Reload recent proposals (merge local + cloud) ✅
```

#### Duplicate Detection

Checks **both** local and cloud:
```typescript
// Check local IndexedDB
const localDuplicate = await findLocalDuplicate(fileName, fileSize);

// Check cloud Supabase
const cloudDuplicate = await findCloudDuplicate(fileName, fileSize);

if (localDuplicate || cloudDuplicate) {
  // Ask user to confirm replacement
}
```

### Conflict Resolution

**Strategy**: Newest wins (timestamp-based)

```typescript
function resolveConflict(localData, cloudData) {
  if (localData.timestamp > cloudData.timestamp) {
    return localData; // Local is newer
  } else {
    return cloudData; // Cloud is newer
  }
}
```

---

## 🗄️ Cache Management

### Overview
Comprehensive cache management system solving version update and data sync issues.

### Components

#### 1. Enhanced Service Worker

**Features:**
- Dynamic versioning (version + timestamp)
- Network-first strategy
- Auto-cleanup of old caches
- Skip waiting for instant updates
- Message handling

#### 2. Update System

**Update Flow:**

1. Developer deploys new version
2. User opens app (SW checks every 30s)
3. Notification appears
4. User clicks "Update Now"
5. New SW activates
6. Old caches deleted
7. Page reloads

### Debug Tools

```javascript
// In browser console

// Show cache info
window.debugCache()

// Clear all caches
window.clearCache()
```

---

## 📱 Mobile Development

### Platforms Supported
- **Android** (6.0+)
- **iOS** (12.0+)

### Capacitor Configuration

```typescript
// capacitor.config.ts
{
  appId: 'com.baleenmedia.quotegen',
  appName: 'Quote Buddy',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
}
```

### Android Development

#### Build APK

**Quick Build:**
```powershell
.\build-apk.ps1
```

**Manual Build:**
```bash
npm run build
npx cap sync android
npx cap open android
# Build APK in Android Studio
```

**Output:** `AI-Quote-Generator.apk`

#### Android Permissions

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

#### Custom Android Plugin: DownloadNotification

**Purpose:** Show PDF download notifications in Android notification bar

**Features:**
- Creates notification channel
- Shows download complete notification
- Tappable to open PDF
- Auto-dismisses when tapped

### Mobile PDF Export

#### Android Flow
1. User clicks "Export PDF"
2. PDF saved to Documents folder
3. **Notification appears in notification bar**
4. User can tap notification to open PDF
5. Share via WhatsApp, Email, etc.

---

## 🤖 API Integration

### Google Gemini AI

#### Configuration

```typescript
// .env
VITE_GEMINI_API_KEY=your_api_key_here
```

#### Service: `geminiService.ts`

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
```

#### Chat Function

```typescript
async function sendMessage(
  message: string,
  proposalContext: string
): Promise<string> {
  const prompt = `
    Context: ${proposalContext}
    User: ${message}
    Assistant:
  `;
  
  const result = await model.generateContent(prompt);
  return result.response.text();
}
```

### Supabase API

#### Client Configuration

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

#### Database Operations

```typescript
// Select
const { data, error } = await supabase
  .from('users')
  .select('*')
  .eq('email', email)
  .single();

// Insert
const { data, error } = await supabase
  .from('proposals')
  .insert({ file_name: fileName });

// Update
const { data, error } = await supabase
  .from('users')
  .update({ last_login: new Date() })
  .eq('id', userId);

// Delete
const { error } = await supabase
  .from('proposals')
  .delete()
  .eq('id', proposalId);
```

---

## 🗃️ Database Schema

### Authentication Schema

#### Roles Table
```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name VARCHAR(50) UNIQUE NOT NULL,
  permissions JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role_id UUID REFERENCES roles(id),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Proposals Schema

#### Proposals Table
```sql
CREATE TABLE proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  file_size BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  text_content TEXT,
  page_count INTEGER,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🚀 Deployment

### Web Deployment

#### Build for Production

```bash
npm run build
```

#### Deploy to Vercel

```bash
npm i -g vercel
vercel
vercel --prod
```

#### Deploy to Netlify

```bash
npm i -g netlify-cli
netlify deploy
netlify deploy --prod
```

### Android Deployment

#### Build Release APK

1. Generate Keystore
2. Configure Gradle
3. Build: `./gradlew assembleRelease`
4. Output: `android/app/build/outputs/apk/release/`

#### Publish to Google Play

1. Create Google Play Developer account
2. Create new app
3. Upload APK/AAB
4. Submit for review

---

## 🐛 Troubleshooting

### Common Issues

#### 1. "API Key Invalid" Error

**Solutions:**
- Verify key in `.env` file
- Check key is active
- Restart dev server

#### 2. "Cannot Connect to Database"

**Solutions:**
- Check Supabase URL and key
- Verify project is active
- Check network connection

#### 3. "PDF Upload Failed"

**Solutions:**
- Check file size limit
- Verify file is valid PDF
- Clear browser cache

#### 4. "Service Worker Not Updating"

**Solutions:**
- Hard refresh: Ctrl+Shift+R
- Clear cache via DevTools
- Use `window.clearCache()`

#### 5. "Mobile App Crashes"

**Solutions:**
- Check LogCat (Android)
- Verify permissions
- Rebuild app

### Debug Tools

```javascript
// Browser console
console.log('Version:', __APP_VERSION__);
window.debugCache();
window.clearCache();
```

---

## 📝 Additional Resources

### Documentation Files

- **README.md** - Main readme
- **AUTHENTICATION.md** - Auth system guide
- **CACHE_MANAGEMENT.md** - Cache system
- **CLOUD_STORAGE_SETUP.md** - Cloud storage
- **MOBILE_PDF_EXPORT.md** - Mobile PDF
- **ANDROID_BUILD.md** - Android build

### External Documentation

- **React**: https://react.dev/
- **Ionic**: https://ionicframework.com/docs
- **Capacitor**: https://capacitorjs.com/docs
- **Chakra UI**: https://chakra-ui.com/docs
- **Google Gemini**: https://ai.google.dev/docs
- **Supabase**: https://supabase.com/docs

### Useful Commands

```bash
# Development
npm run dev                    # Start dev server
npm run build                  # Build for production
npm run preview                # Preview build

# Mobile
npm run android                # Build and open Android
npm run ios                    # Build and open iOS
npm run sync                   # Sync assets

# Utilities
npm run generate-icons         # Generate icons
npm run version                # Show version
```

---

## 🎉 Conclusion

**Quote Buddy** is a comprehensive, production-ready application for AI-powered quote generation with robust architecture, offline-first design, and extensive features.

### Key Highlights

✅ **AI-Powered** - Google Gemini integration  
✅ **Mobile-First** - Native Android & iOS apps  
✅ **Offline-Capable** - Works without internet  
✅ **Cloud-Synced** - Team-wide collaboration  
✅ **Secure** - Role-based access control  
✅ **Professional** - Multiple quote templates  
✅ **Scalable** - Supabase backend  
✅ **Modern** - Latest React & TypeScript  

### Version Information

- **Version**: 1.0.0
- **Last Updated**: May 16, 2026
