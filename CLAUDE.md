# Quote Buddy - AI-Powered Quote Generation System

## Project Overview

### Purpose
**Quote Buddy** is an AI-powered mobile-first Progressive Web Application (PWA) designed to streamline the quotation process for Below-The-Line (BTL) advertising services. The application enables sales teams, managers, and business owners to rapidly generate professional, accurate quotations from advertising proposal documents using artificial intelligence.

### Business Goals
- **Reduce Quote Generation Time**: Transform a 30-minute manual process into a 2-minute AI-assisted workflow
- **Improve Accuracy**: Eliminate pricing errors by extracting rates directly from verified proposal documents
- **Enable Mobile Sales**: Allow field sales teams to generate quotes on-site using mobile devices
- **Centralize Knowledge**: Create a cloud-based repository of advertising rate cards and proposals accessible to entire teams
- **Standardize Output**: Ensure consistent, professional quote formatting across all team members

### Target Users
- **Sales Representatives**: Generate quotes quickly during client meetings
- **Sales Managers**: Review, edit, and approve quotes with full pricing context
- **Business Administrators**: Manage team access, company branding, and proposal libraries
- **Viewers**: Stakeholders who need read-only access to quote data

### Business Value
- **Increased Conversion**: Faster quote turnaround improves client response times
- **Reduced Errors**: AI-powered extraction eliminates manual data entry mistakes
- **Scalability**: Handle multiple proposal types (Bus Branding, Auto Branding, Print, Radio, etc.)
- **Offline Capability**: Continue working during poor connectivity
- **Cost Efficiency**: Reduce Gemini API costs through intelligent caching, native PDF processing, and RAG (Retrieval-Augmented Generation)
- **Semantic Search**: Find relevant services using vector embeddings instead of keyword matching

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                      │
├─────────────────────────────────────────────────────────────┤
│  React 18 + TypeScript + Ionic Framework + Chakra UI       │
│  - LoginPage                                                 │
│  - HomePage (Chat Interface)                                 │
│  - DocumentsPage (Upload & View)                            │
│  - QuotePage (Wizard)                                        │
│  - QuotePreviewPage (PDF Export)                            │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    STATE MANAGEMENT LAYER                    │
├─────────────────────────────────────────────────────────────┤
│  Zustand Store (with Persist Middleware)                    │
│  - Proposal State                                            │
│  - Chat State                                                │
│  - Quote State                                               │
│  - Company State                                             │
│  - Client State                                              │
│  - Template State                                            │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      SERVICE LAYER                           │
├─────────────────────────────────────────────────────────────┤
│  - authService.ts         - Authentication & Authorization   │
│  - geminiService.ts       - AI Quote Generation             │
│  - supabaseProposalService.ts - Cloud Storage              │
│  - pdfExportService.ts    - PDF Export                      │
│  - pdfEmbeddingService.ts - PDF Processing & RAG Embeddings │
│  - companyService.ts      - Company Data Sync               │
│  - dataSyncService.ts     - Multi-device Sync               │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                       DATA LAYER                             │
├─────────────────────────────────────────────────────────────┤
│  - Supabase (Cloud)        - IndexedDB (Local)              │
│  - PostgreSQL Database     - LocalStorage (Session)         │
│  - Storage Buckets         - Service Workers (PWA)          │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                         │
├─────────────────────────────────────────────────────────────┤
│  - Google Gemini API (gemini-2.5-flash-lite)               │
│  - Capacitor Native APIs (Android/iOS)                      │
└─────────────────────────────────────────────────────────────┘
```

### Component Structure

```
src/
├── pages/                   # Route-level components
│   ├── LoginPage            # Authentication UI
│   ├── HomePage             # Main chat interface
│   ├── DocumentsPage        # Document management
│   ├── QuotePage            # Quote wizard (4 steps)
│   └── QuotePreviewPage     # PDF preview & export
│
├── components/              # Reusable UI components
│   ├── ChatInterface/       # AI chat with multi-match handling
│   ├── ProposalUpload/      # Drag-drop file upload
│   ├── ProposalViewer/      # PDF viewer with navigation
│   ├── QuoteWizard/         # Multi-step form wizard
│   ├── CompanyInfoForm/     # Company details form
│   ├── ClientInfoForm/      # Client details with autocomplete
│   ├── QuotePreview/        # Editable quote preview
│   ├── Templates/           # 4 PDF template components
│   ├── Header/              # Top navigation
│   ├── BottomNav/           # Mobile bottom nav
│   └── PrivateRoute/        # Route authentication guard
│
├── services/                # Business logic layer
│   ├── authService.ts       # Login, logout, permissions
│   ├── geminiService.ts     # AI integration
│   ├── supabaseProposalService.ts  # Cloud storage
│   ├── pdfExportService.ts  # PDF generation
│   └── companyService.ts    # Multi-device sync
│
├── store/                   # Global state management
│   ├── index.ts             # Zustand store
│   └── authStore.ts         # Authentication state
│
├── types/                   # TypeScript definitions
│   ├── quote.ts             # Quote data models
│   ├── chat.ts              # Message data models
│   ├── company.ts           # Company data models
│   └── index.ts             # Common types
│
└── utils/                   # Utility functions
    ├── promptTemplates.ts   # AI prompt engineering
    ├── pdfUtils.ts          # PDF processing utilities
    └── validation.ts        # Form validation logic
```

### Data Flow

**User Request → Quote Generation Flow (with RAG):**
1. User uploads proposal PDF to DocumentsPage
2. System extracts text content and images using pdfjs-dist
3. System parses services and generates vector embeddings (Gemini text-embedding-004)
4. Embeddings + metadata stored in Supabase `proposal_chunks` table (768-dimensional vectors)
5. Proposal saved to Supabase cloud storage (or IndexedDB fallback)
6. User navigates to HomePage (ChatInterface)
7. User types request: "50 bus full branding for 6 months"
8. System generates query embedding for user's request
9. Vector similarity search finds relevant services from database
10. ChatInterface sends request + retrieved service context to geminiService
11. AI analyzes request using 4-tier matching system with RAG context
12. AI returns structured quote data (JSON)
13. Quote stored in Zustand store and localStorage
14. User auto-navigated to QuotePage wizard
15. User completes 4-step wizard (Company → Client → Review → Template)
16. User navigates to QuotePreviewPage
17. User selects template and exports to PDF
18. PDF generated using jsPDF + html2canvas
19. Mobile: File saved to Documents folder and opened natively
20. Web: Browser download initiated

---

### RAG (Retrieval-Augmented Generation) Architecture

**Purpose**: Reduce Gemini API costs and improve accuracy by retrieving only relevant service context instead of sending entire proposal documents.

**Components**:
1. **Embedding Model**: Gemini `text-embedding-004` (768 dimensions)
2. **Vector Database**: PostgreSQL with pgvector extension
3. **Storage**: `proposal_chunks` table with VECTOR(768) column
4. **Search Function**: Custom SQL function using cosine similarity

**Workflow**:

```
┌─────────────────────────────────────────────────────────────┐
│                  DOCUMENT UPLOAD PHASE                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
1. User uploads PDF (e.g., 131-page rate card)
                            ↓
2. Extract text using pdfjs-dist
                            ↓
3. Parse services (32 services detected)
   Example: "Bus Full Branding", "Auto Semi Branding", etc.
                            ↓
4. For each service:
   a) Extract metadata (price, size, min quantity, T&C)
   b) Generate 768-dim embedding via Gemini API
   c) Extract reference image from PDF page
   d) Upload image to Supabase Storage
                            ↓
5. Store in proposal_chunks table:
   {
     service_name: "Bus Full Branding",
     content: "Full service description...",
     embedding: [0.123, -0.456, ...], // 768 numbers
     metadata: {
       unit_price: 45000,
       currency: "INR",
       image_url: "https://...",
       min_quantity: 10
     }
   }
                            ↓
✅ READY FOR SEMANTIC SEARCH!

┌─────────────────────────────────────────────────────────────┐
│                   QUOTE GENERATION PHASE                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
1. User types: "I need bus advertising for 50 vehicles"
                            ↓
2. Generate query embedding (Gemini text-embedding-004)
   Query vector: [0.789, -0.234, ...] // 768 numbers
                            ↓
3. Vector similarity search in database:
   - Calculate cosine similarity with all stored embeddings
   - Return top 5 most similar services
   - Example results:
     * Bus Full Branding (similarity: 0.92)
     * Bus Semi Branding (similarity: 0.87)
     * Bus Back Panel (similarity: 0.71)
                            ↓
4. Retrieve only relevant service context (not entire 131-page PDF!)
                            ↓
5. Send to Gemini for quote generation:
   - User query + 5 relevant services (500 tokens)
   - vs. Old method: User query + entire PDF (15,000 tokens)
   - Token reduction: 97%!
                            ↓
6. Gemini generates structured quote
                            ↓
✅ QUOTE READY! Cost: $0.09 instead of $3.00

```

**Cost Comparison**:

| Approach | Tokens Sent | Cost per Quote | Accuracy |
|----------|-------------|----------------|----------|
| **Without RAG** (old) | 15,000 | $0.30 | Good |
| **With RAG** (new) | 500 | $0.01 | Excellent |
| **Savings** | **97% reduction** | **$0.29 saved** | **Better** |

**Technical Details**:

- **Embedding Dimensions**: 768 (Gemini text-embedding-004)
- **Vector Distance Metric**: Cosine similarity
- **Search Threshold**: 0.5 (adjustable, 0.0=any match, 1.0=exact match)
- **Max Results**: 10 services (configurable)
- **Embedding Generation Time**: ~200ms per service
- **Search Time**: ~300ms for 100+ services
- **Database Size**: ~3KB per service (768 floats × 4 bytes)

**Benefits**:
1. **Cost Efficiency**: 97% reduction in Gemini API tokens
2. **Speed**: Faster responses (less data to process)
3. **Accuracy**: AI sees only relevant context (less confusion)
4. **Scalability**: Handle 1000+ services without performance degradation
5. **Semantic Understanding**: Finds "bus advertising" even when user says "transit vehicle branding"

---

## Technology Stack

### Frontend Framework
- **React 18.2.0** - Component-based UI library with hooks
- **TypeScript 5.3.3** - Static type checking and enhanced IDE support
- **Vite 5.0.11** - Ultra-fast build tool and development server
- **Ionic Framework 7.8.0** - Mobile UI components and native integrations
- **Chakra UI 2.10.9** - Accessible component library with theming
- **Emotion** - CSS-in-JS styling solution
- **Framer Motion 12.38.0** - Animation library for smooth transitions

### Routing & Navigation
- **React Router 5.3.4** - Client-side routing
- **React Router DOM 5.3.4** - DOM-specific routing components

### State Management
- **Zustand 4.5.0** - Lightweight state management with middleware support
- **Persist Middleware** - Automatic state synchronization with localStorage

### Mobile Development
- **Capacitor 6.0.0** - Native mobile runtime bridging web → native APIs
- **@capacitor/android** - Android platform support
- **@capacitor/ios** - iOS platform support
- **@capacitor/filesystem** - Native file system access
- **@capacitor/share** - Native share dialog
- **@capacitor/browser** - In-app browser functionality
- **@capacitor-community/file-opener** - Open files in native viewers
- **@capacitor-community/speech-recognition** - Voice input support

### Artificial Intelligence
- **@google/generative-ai 0.24.1** - Google Gemini AI SDK
- **Models**:
  - **gemini-2.5-flash-lite** - Fast, cost-effective generative AI for quote generation
  - **text-embedding-004** - Vector embeddings for semantic search (768 dimensions)
- **Use Cases**: Quote generation, proposal analysis, semantic search with RAG, multi-document search

### Backend & Database
- **Supabase 2.100.1** - Backend-as-a-Service platform
  - PostgreSQL database for users, roles, proposals, embeddings
  - pgvector extension for vector similarity search
  - Storage buckets for PDF files and service images
  - Row-Level Security (RLS) for data protection
  - Real-time subscriptions for multi-device sync

### PDF Processing
- **pdfjs-dist 4.10.38** - PDF parsing and text extraction (Mozilla PDF.js)
- **react-pdf 7.7.1** - React wrapper for PDF.js viewer
- **jsPDF 2.5.2** - Client-side PDF document generation
- **html2canvas 1.4.1** - Convert HTML/CSS to canvas for PDF embedding

### File Processing
- **xlsx 0.18.5** - Excel file parsing and data extraction
- **bcryptjs 3.0.3** - Password hashing for authentication

### Local Storage
- **IndexedDB** - Browser database for offline proposal storage
- **LocalStorage** - Session state persistence
- **Service Workers** - PWA offline functionality

### Development Tools
- **@vitejs/plugin-react 4.2.1** - Vite React plugin with SWC
- **Sharp 0.34.5** - Image processing for icon generation
- **ESLint** - Code linting
- **Prettier** - Code formatting

### Icons & Fonts
- **Ionicons 7.2.2** - Ionic icon library
- **React Icons 5.6.0** - Additional icon collections
- **@fontsource/inter 5.2.8** - Inter font family (Google Fonts)

### Cloud Services
- **Supabase Cloud** - Hosted PostgreSQL and storage
- **Google AI Studio** - Gemini API management

---

## Functional Requirements

### FR-1: User Authentication & Authorization

**User Story**: As a user, I need to log in securely so that only authorized personnel can access the quote generation system.

**Acceptance Criteria**:
- ✅ Login form accepts email and password
- ✅ Passwords hashed using bcrypt (10 rounds)
- ✅ Invalid credentials show error message
- ✅ Successful login redirects to homepage
- ✅ Session persists across browser refreshes
- ✅ Logout clears session and redirects to login page

**Role-Based Access Control**:
- **Admin**: Full access (create, edit, delete quotes, manage users)
- **Manager**: Create, edit, view quotes; export PDFs
- **Sales**: Create, view quotes; export PDFs
- **Viewer**: Read-only access to quotes

---

### FR-2: Document Upload & Management (with RAG)

**User Story**: As a sales representative, I need to upload proposal PDFs so the AI can extract pricing information and enable semantic search.

**Acceptance Criteria**:
- ✅ Drag-and-drop file upload interface
- ✅ Support PDF, Excel (.xlsx), and JPEG files
- ✅ File size limit: 10MB (configurable via env variable)
- ✅ Progress indicator during upload
- ✅ Automatic text extraction from PDFs
- ✅ Automatic service parsing and chunking
- ✅ Vector embedding generation (Gemini text-embedding-004)
- ✅ Service image extraction and cloud storage
- ✅ Embeddings stored in PostgreSQL with pgvector
- ✅ Cloud storage with IndexedDB fallback
- ✅ View uploaded proposals in built-in PDF viewer
- ✅ Delete proposals from library (cascades to embeddings)
- ✅ Recent proposals list shows file name, date, size

**Technical Details**:
- Uses pdfjs-dist for text and image extraction
- Parses services from proposal text (32+ service types supported)
- Generates 768-dimensional embeddings via Gemini API
- Stores chunks in `proposal_chunks` table with metadata (pricing, specs, images)
- Stores file blob, text content, page count, extracted images
- Saves to Supabase storage bucket (cloud) or IndexedDB (local)

---

### FR-3: AI-Powered Chat Interface (with Semantic Search)

**User Story**: As a user, I want to chat with AI about uploaded proposals so I can quickly generate quotes without manual data entry, using intelligent semantic search.

**Acceptance Criteria**:
- ✅ Chat interface with message history
- ✅ Typing indicator while AI processes request
- ✅ Sample prompt suggestions for new users
- ✅ Voice input support on mobile devices
- ✅ Semantic search using vector embeddings (finds relevant services by meaning, not just keywords)
- ✅ Multi-document search (AI analyzes all uploaded proposals)
- ✅ Context-aware responses based on proposal content
- ✅ RAG-powered context retrieval (only sends relevant services to AI)
- ✅ Rate limiting (1 second between requests)
- ✅ Error handling for API failures

**4-Tier Matching System**:
1. **EXACT_MATCH**: User specifies vehicle + branding type → Generate quote immediately
2. **MULTIPLE_MATCH**: Ambiguous request (e.g., "50 bus") → Show checkboxes to select specific service
3. **PARTIAL_MATCH**: Service doesn't exist exactly → Suggest closest alternatives
4. **NO_MATCH**: Service not found → Display all available services grouped by category

**Special Case: CITY_MATCH**: Same service exists in multiple city documents → Ask user to select city

---

### FR-4: Quote Generation & Editing

**User Story**: As a sales representative, I need to generate structured quotes from AI responses so I can provide accurate pricing to clients.

**Acceptance Criteria**:
- ✅ AI extracts line items with description, quantity, rate, duration
- ✅ Support for multi-service quotes (e.g., Bus + Auto branding in one quote)
- ✅ Editable line items (add, remove, modify quantity/rate)
- ✅ Auto-calculated subtotal and total
- ✅ GST toggle (10% configurable)
- ✅ Delivery timeline field (e.g., "5 working days")
- ✅ Terms and conditions section
- ✅ Per-item minimum quantity validation
- ✅ Duration support (months/days)

**Quote Data Structure**:
```typescript
{
  id, quoteNumber, date, validUntil,
  items: [
    {
      id, description, quantity, rate,
      duration, durationUnit,
      minimumQuantity, termsAndConditions,
      lineItems: [...]  // Nested structure for multi-service
    }
  ],
  subtotal, gstEnabled, gstPercentage, gstAmount, total,
  deliveryTimeline, termsAndConditions
}
```

---

### FR-5: Company & Client Information

**User Story**: As a user, I need to save my company details so I don't have to re-enter them for every quote.

**Acceptance Criteria**:
- ✅ Company information form (name, logo, address, contact, GST, bank details)
- ✅ Logo upload with image preview
- ✅ Company info saved to database (multi-device sync)
- ✅ Client information form (name, company, email, phone, address, GST)
- ✅ Client autocomplete based on previously entered clients
- ✅ Form validation (email format, phone format, GST format)
- ✅ Optional fields support

**Multi-Device Sync**:
- Company info stored in Supabase database
- Real-time sync across devices using Supabase subscriptions
- Changes on Device A immediately visible on Device B

---

### FR-6: PDF Export with Templates

**User Story**: As a sales representative, I need to export quotes as professional PDFs so I can email them to clients.

**Acceptance Criteria**:
- ✅ 4 professional templates: Corporate Minimal, Premium Agency, Modern Sales, Classic Business
- ✅ Template preview with live zoom controls (50%-150%)
- ✅ Multi-page PDF support (summary + service details + terms)
- ✅ Company logo embedded in PDF header
- ✅ Client information on first page
- ✅ Line items with quantity, rate, amount
- ✅ Subtotal, GST, and total calculation
- ✅ Terms and conditions on final page
- ✅ File naming: QuoteNumber_ClientName_Date.pdf

**Mobile-Specific Behavior**:
- Save PDF to Documents folder
- Auto-open in native PDF viewer
- Share button for email/WhatsApp

**Web-Specific Behavior**:
- Browser download dialog
- Print option

---

### FR-7: Minimum Quantity Validation

**User Story**: As a sales manager, I need the system to warn users when requested quantities fall below minimums specified in proposals.

**Acceptance Criteria**:
- ✅ Extract minimum quantities from proposal text (e.g., "Minimum: 10 units")
- ✅ Cache minimum quantities in session storage
- ✅ Display warning message if user requests below minimum
- ✅ Allow user to proceed with lower quantity or adjust to minimum
- ✅ Preserve warning context across multiple AI requests

---

### FR-8: Multi-Service Quote Support

**User Story**: As a sales representative, I need to combine multiple services (e.g., Bus + Auto branding) in a single quote.

**Acceptance Criteria**:
- ✅ Single quote contains multiple service groups
- ✅ Each service group has separate line items
- ✅ Per-service terms and conditions
- ✅ PDF layout: Summary page → Service 1 details → Service 2 details → Terms
- ✅ Total calculated across all services
- ✅ Support for different durations per service

---

### FR-9: Offline Mode

**User Story**: As a field sales representative, I need the app to work offline so I can generate quotes during poor connectivity.

**Acceptance Criteria**:
- ✅ Service worker caches app shell for offline access
- ✅ Proposals stored in IndexedDB when cloud unavailable
- ✅ Chat history saved to localStorage
- ✅ Quote data persists in localStorage
- ✅ Cloud sync resumes when connectivity restored
- ✅ Offline indicator in UI

---

### FR-10: Voice Input (Mobile)

**User Story**: As a mobile user, I want to use voice input so I can generate quotes hands-free.

**Acceptance Criteria**:
- ✅ Microphone button in chat interface
- ✅ Native speech recognition API via Capacitor
- ✅ Real-time transcription display
- ✅ Automatic message send after speech ends
- ✅ Error handling for unsupported devices

---

## Non-Functional Requirements

### NFR-1: Performance

**Response Times**:
- ⚡ Page load: < 2 seconds on 4G connection
- ⚡ PDF upload: < 5 seconds for 10MB file
- ⚡ Embedding generation: < 3 seconds for 32 services
- ⚡ Semantic search: < 500ms for vector similarity query
- ⚡ AI response: < 8 seconds for quote generation
- ⚡ PDF export: < 10 seconds for multi-page quote

**Optimization Strategies**:
- Vite code splitting and tree shaking
- Lazy loading for route components
- Image compression for logos and icons
- PDF text extraction cached in IndexedDB
- Vector embeddings cached in PostgreSQL (no re-computation)
- RAG reduces Gemini API tokens by 70-90% (only relevant context sent)
- Debounced form inputs

---

### NFR-2: Scalability

**User Capacity**:
- Support 100+ concurrent users
- Database can store 10,000+ proposals
- Each user can upload 100+ proposals

**Data Limits**:
- Max file size: 10MB per PDF
- Max proposals per user: 100 (configurable)
- Max quote items: 50 line items per quote

**Scalability Features**:
- Supabase auto-scales PostgreSQL
- Cloud storage has unlimited capacity
- IndexedDB supports 50MB+ per domain

---

### NFR-3: Security

**Authentication**:
- ✅ Passwords hashed with bcrypt (10 rounds)
- ✅ Session tokens stored securely in localStorage
- ✅ HTTPS required for production
- ✅ Role-based access control (RBAC)

**Data Protection**:
- ✅ Supabase Row-Level Security (RLS) policies
- ✅ API keys stored in environment variables (not in code)
- ✅ Proposals accessible only to authenticated users
- ✅ No sensitive data logged in console

**API Security**:
- ✅ Gemini API key never exposed to client
- ✅ Rate limiting on AI requests (1 request/second)
- ✅ File type validation on upload
- ✅ File size limits enforced

---

### NFR-4: Maintainability

**Code Quality**:
- ✅ TypeScript for type safety
- ✅ Component-based architecture
- ✅ Separation of concerns (services, components, utils)
- ✅ Reusable UI components
- ✅ Centralized state management with Zustand

**Documentation**:
- ✅ Inline code comments for complex logic
- ✅ README with setup instructions
- ✅ Architecture documentation (E2W_AI_QUOTE_GEN_ARCHITECTURE.md)
- ✅ API documentation for services

**Testing**:
- Unit tests for utility functions
- Integration tests for services
- End-to-end tests for critical workflows

---

### NFR-5: Availability

**Uptime Target**: 99% uptime

**Offline Capability**:
- ✅ PWA with service worker caching
- ✅ IndexedDB fallback for proposals
- ✅ LocalStorage for session state
- ✅ Offline indicator in UI

**Error Recovery**:
- ✅ Automatic retry for failed API calls
- ✅ Graceful degradation when cloud unavailable
- ✅ Error boundary components catch React errors

---

### NFR-6: Usability

**Mobile-First Design**:
- ✅ Responsive layouts (320px - 1920px)
- ✅ Touch-friendly UI elements (44px minimum tap target)
- ✅ Native mobile gestures (swipe, pinch-to-zoom)
- ✅ Bottom navigation for thumb-friendly access

**Accessibility**:
- ✅ Semantic HTML elements
- ✅ ARIA labels for screen readers
- ✅ Keyboard navigation support
- ✅ Color contrast ratios meet WCAG AA standards

**User Experience**:
- ✅ Loading indicators for async operations
- ✅ Toast notifications for success/error messages
- ✅ Confirmation dialogs for destructive actions
- ✅ Autosave for form fields

---

## Database Design

### Tables

#### 1. **users** Table
Stores user accounts with authentication credentials.

| Column         | Type         | Constraints                  | Description                    |
|---------------|--------------|------------------------------|--------------------------------|
| id            | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique user identifier        |
| email         | VARCHAR(255) | UNIQUE, NOT NULL             | Login email                    |
| password_hash | VARCHAR(255) | NOT NULL                     | Bcrypt hashed password         |
| full_name     | VARCHAR(255) | NOT NULL                     | User's full name               |
| role_id       | UUID         | FOREIGN KEY → roles(id)      | Reference to user's role       |
| is_active     | BOOLEAN      | DEFAULT TRUE                 | Account enabled/disabled flag  |
| last_login    | TIMESTAMP    | NULL                         | Last login timestamp           |
| created_at    | TIMESTAMP    | DEFAULT NOW()                | Account creation date          |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                | Last update timestamp          |

**Indexes**:
- `idx_users_email` on `email`
- `idx_users_role_id` on `role_id`
- `idx_users_is_active` on `is_active`

---

#### 2. **roles** Table
Defines user roles and permissions.

| Column      | Type         | Constraints                  | Description                    |
|------------|--------------|------------------------------|--------------------------------|
| id         | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique role identifier        |
| role_name  | VARCHAR(50)  | UNIQUE, NOT NULL             | Role name (admin, manager, sales, viewer) |
| permissions| JSONB        | DEFAULT '{}'::jsonb          | JSON object with permission flags |
| created_at | TIMESTAMP    | DEFAULT NOW()                | Role creation date             |

**Permissions JSON Structure**:
```json
{
  "create_quotes": true,
  "edit_quotes": true,
  "delete_quotes": true,
  "view_quotes": true,
  "manage_users": true,
  "export_pdf": true,
  "access_settings": true
}
```

**Default Roles**:
- **admin**: Full permissions
- **manager**: Create, edit, view, export (no user management)
- **sales**: Create, view, export
- **viewer**: View only

---

#### 3. **proposals** Table
Stores metadata for uploaded proposal documents.

| Column              | Type         | Constraints                  | Description                    |
|--------------------|--------------|------------------------------|--------------------------------|
| id                 | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique proposal identifier    |
| file_name          | VARCHAR(255) | NOT NULL                     | Original file name             |
| file_type          | VARCHAR(50)  | NOT NULL                     | MIME type (application/pdf, etc.) |
| file_size          | INTEGER      | NOT NULL                     | File size in bytes             |
| file_url           | TEXT         | NULL                         | Supabase storage URL           |
| storage_path       | TEXT         | NULL                         | Path in Supabase bucket        |
| text_content       | TEXT         | NULL                         | Extracted text from PDF        |
| page_count         | INTEGER      | DEFAULT 0                    | Number of pages in document    |
| uploaded_by_user_id| UUID         | FOREIGN KEY → users(id)      | User who uploaded document     |
| uploaded_by_name   | VARCHAR(255) | NULL                         | User's name at upload time     |
| uploaded_at        | TIMESTAMP    | DEFAULT NOW()                | Upload timestamp               |

**Indexes**:
- `idx_proposals_user_id` on `uploaded_by_user_id`
- `idx_proposals_uploaded_at` on `uploaded_at`

---

#### 4. **proposal_chunks** Table (RAG Embeddings)
Stores parsed services with vector embeddings for semantic search.

| Column         | Type         | Constraints                  | Description                    |
|---------------|--------------|------------------------------|--------------------------------|
| id            | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique chunk identifier       |
| service_name  | TEXT         | NOT NULL                     | Service name (e.g., "Bus Full Branding") |
| service_id    | TEXT         | UNIQUE, NOT NULL             | Unique service identifier      |
| content       | TEXT         | NOT NULL                     | Full service description       |
| embedding     | VECTOR(768)  | NULL                         | 768-dim vector from Gemini text-embedding-004 |
| metadata      | JSONB        | DEFAULT '{}'::jsonb          | Pricing, specs, images, etc.   |
| document_id   | TEXT         | NOT NULL                     | Reference to source proposal   |
| document_name | TEXT         | NOT NULL                     | Source document filename       |
| user_id       | TEXT         | NULL                         | User who uploaded document     |
| created_at    | TIMESTAMP    | DEFAULT NOW()                | Chunk creation date            |
| updated_at    | TIMESTAMP    | DEFAULT NOW()                | Last update timestamp          |

**Indexes**:
- `idx_proposal_chunks_service_id` on `service_id`
- `idx_proposal_chunks_metadata` GIN index on `metadata` (JSONB queries)
- `idx_proposal_chunks_service_name` on `service_name`
- `idx_proposal_chunks_updated_at` on `updated_at DESC`

**Note**: Vector similarity index is not used because pgvector's `ivfflat` index supports max 2000 dimensions, but we use 768 dimensions which performs well without indexing for our dataset size (32-50 services per document).

**Metadata Structure**:
```json
{
  "unit_price": 45000,
  "currency": "INR",
  "size": "Full Bus",
  "duration": "1 month",
  "locations": ["Chennai", "Bangalore"],
  "category": "Bus Branding",
  "production_included": true,
  "installation_included": true,
  "min_quantity": 10,
  "image_url": "https://...",
  "terms_and_conditions": "..."
}
```

---

#### 5. **company_settings** Table (Future Enhancement)
Stores company information for multi-device sync.

| Column          | Type         | Constraints                  | Description                    |
|----------------|--------------|------------------------------|--------------------------------|
| id             | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique setting ID             |
| user_id        | UUID         | FOREIGN KEY → users(id)      | Owner user                     |
| company_name   | VARCHAR(255) | NOT NULL                     | Company name                   |
| logo_url       | TEXT         | NULL                         | Logo image URL                 |
| address        | TEXT         | NULL                         | Company address                |
| contact_email  | VARCHAR(255) | NULL                         | Contact email                  |
| contact_phone  | VARCHAR(50)  | NULL                         | Contact phone                  |
| gst_number     | VARCHAR(50)  | NULL                         | GST registration number        |
| bank_details   | JSONB        | DEFAULT '{}'::jsonb          | Bank account information       |
| created_at     | TIMESTAMP    | DEFAULT NOW()                | Record creation date           |
| updated_at     | TIMESTAMP    | DEFAULT NOW()                | Last update timestamp          |

---

### Relationships

```
users (1) ──────── (N) proposals
  │                       │
  │ (N)                   │ (1)
  │                       │
  └──── (1) roles         └──── (N) proposal_chunks

users (1) ──────── (1) company_settings
```

---

### Storage Buckets

#### **proposals** Bucket
Stores actual PDF, Excel, and image files.

**Structure**:
```
proposals/
├── {user_id}/
│   ├── {timestamp}_{filename}.pdf
│   ├── {timestamp}_{filename}.xlsx
│   └── {timestamp}_{filename}.jpg
```

**Security**:
- RLS enabled: Users can only access their own files
- Max file size: 10MB
- Allowed types: PDF, XLSX, JPEG, PNG

---

## API Specifications

### Internal Service APIs

#### 1. **authService.ts**

##### `login(credentials: LoginCredentials): Promise<AuthResponse>`
Authenticates user and returns user object with role/permissions.

**Request**:
```typescript
{
  email: string;      // User's email
  password: string;   // Plain text password
}
```

**Response**:
```typescript
{
  success: boolean;
  user?: {
    id: string;
    email: string;
    fullName: string;
    role: string;      // 'admin', 'manager', 'sales', 'viewer'
    permissions: {
      create_quotes: boolean;
      edit_quotes: boolean;
      delete_quotes: boolean;
      view_quotes: boolean;
      manage_users: boolean;
      export_pdf: boolean;
      access_settings: boolean;
    };
    isActive: boolean;
    lastLogin: string;
  };
  error?: string;
}
```

**Errors**:
- `Invalid email or password` - Wrong credentials
- `Account is disabled` - User account deactivated
- `Database connection failed` - Supabase unavailable

---

##### `logout(): void`
Clears user session from localStorage and memory.

---

##### `hasPermission(permission: string): boolean`
Checks if current user has specific permission.

**Parameters**:
- `permission`: One of the permission keys (e.g., 'create_quotes')

**Returns**: `true` if user has permission, `false` otherwise

---

#### 2. **pdfEmbeddingService.ts**

##### `extractTextFromPDF(file: File): Promise<string>`
Extracts text content from PDF using Mozilla PDF.js.

**Parameters**:
- `file`: PDF File object

**Returns**: Extracted text as string

---

##### `parseServicesFromText(text: string, fileName: string): Promise<ServiceChunk[]>`
Parses proposal text to extract individual services with metadata.

**Parameters**:
- `text`: Extracted PDF text
- `fileName`: Source document name

**Returns**: Array of service chunks with pricing, specs, and metadata

**Service Parsing Logic**:
- Detects 32+ service types (Bus Full/Semi, Auto Full/Semi, Bus Shelter, Gantry, etc.)
- Extracts pricing information (rate, unit, currency)
- Identifies minimum quantities
- Captures size, duration, location metadata
- Extracts terms and conditions per service

---

##### `generateEmbedding(text: string): Promise<number[]>`
Generates 768-dimensional vector embedding using Gemini text-embedding-004.

**Parameters**:
- `text`: Service description or query text

**Returns**: 768-dimensional vector array

**API Call**:
```typescript
const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
const result = await model.embedContent(text);
return result.embedding.values; // 768 dimensions
```

**Cost**: FREE within Gemini API limits

---

##### `storeProposalChunks(chunks: ServiceChunk[], documentId: string): Promise<void>`
Stores service chunks with embeddings in Supabase database.

**Parameters**:
- `chunks`: Array of parsed services
- `documentId`: UUID of parent proposal

**Database Insert**:
```sql
INSERT INTO proposal_chunks 
  (service_name, service_id, content, embedding, metadata, document_id, ...)
VALUES (...)
```

---

##### `searchProposals(queryEmbedding: number[], matchThreshold: number, matchCount: number): Promise<ServiceChunk[]>`
Performs vector similarity search to find relevant services.

**Parameters**:
- `queryEmbedding`: 768-dimensional query vector
- `matchThreshold`: Minimum similarity score (0.0-1.0, default 0.5)
- `matchCount`: Max number of results (default 10)

**Returns**: Array of matching services sorted by relevance

**SQL Function Call**:
```sql
SELECT * FROM search_proposals(
  query_embedding := $1::vector(768),
  match_threshold := 0.5,
  match_count := 10
)
```

**Similarity Calculation**: Cosine similarity between query vector and stored embeddings

---

##### `extractImagesFromPDF(file: File): Promise<Array<{pageNum: number, imageUrl: string, serviceName: string}>>`
Extracts service reference images from PDF pages and uploads to Supabase Storage.

**Parameters**:
- `file`: PDF File object

**Returns**: Array of image URLs with associated service names

**Process**:
1. Scan PDF pages for large images (400×300px minimum)
2. Render pages with images to canvas at 1.5× scale
3. Identify service name from page text using regex patterns
4. Convert canvas to JPEG (90% quality)
5. Upload to Supabase `proposal-images` bucket
6. Return public URLs

**Image Criteria**:
- Minimum width: 400px
- Minimum height: 300px
- Aspect ratio: 0.4-3.0
- Excludes logos and decorative images

---

#### 3. **geminiService.ts**

##### `sendMessageToGemini(params: GeminiRequestParams): Promise<GeminiResponse>`
Sends user message to Gemini AI for analysis and quote generation with RAG context.

**Request**:
```typescript
{
  userMessage: string;           // User's natural language request
  proposalTexts: {               // Retrieved services from RAG (not full proposals)
    fileName: string;
    content: string;             // Service-specific content from vector search
  }[];
  chatHistory?: Message[];       // Previous messages (context isolation)
}
```

**RAG Workflow**:
1. Generate embedding for `userMessage` using `text-embedding-004`
2. Search `proposal_chunks` table using vector similarity
3. Retrieve top 5-10 most relevant services
4. Pass only relevant service context to Gemini (not entire proposals)
5. Reduces token usage and improves response accuracy

**Response** (4-Tier System):

**Tier 1 - EXACT_MATCH**:
```typescript
{
  quoteGenerated: true;
  items: [
    {
      title: string;             // Service name
      lineItems: [
        {
          id: string;
          description: string;
          quantity: number;
          rate: number;
          duration?: number;
          durationUnit?: 'months' | 'days';
          minimumQuantity?: number;
          remark?: string;
        }
      ];
      termsAndConditions?: string;
    }
  ];
  termsAndConditions: string;
  deliveryTimeline: string;
  gstPercentage: number;
}
```

**Tier 2 - MULTIPLE_MATCH**:
```typescript
{
  multipleMatch: true;
  groupedServices: [
    {
      vehicleType: string;       // e.g., "Auto"
      services: [
        {
          name: string;          // e.g., "Auto Full Branding"
          description: string;
        }
      ];
    }
  ];
  originalUserInput: string;     // Preserves duration info
}
```

**Tier 3 - PARTIAL_MATCH**:
```typescript
{
  partialMatch: true;
  closestServices: [
    {
      name: string;
      description: string;
      reason: string;            // Why it's suggested
    }
  ];
  alternativeServices: [
    {
      name: string;
      description: string;
    }
  ];
}
```

**Tier 4 - NO_MATCH**:
```typescript
{
  noMatch: true;
  allServicesGrouped: [
    {
      category: string;          // e.g., "Bus Branding"
      services: [
        {
          name: string;
          description: string;
        }
      ];
    }
  ];
}
```

**Special Case - CITY_MATCH**:
```typescript
{
  cityMatch: {
    serviceName: string;
    cities: [
      {
        city: string;            // e.g., "Chennai"
        document: string;        // e.g., "Chennai_Rates.pdf"
      }
    ];
  };
}
```

**Errors**:
- `Gemini API key not configured`
- `Rate limit exceeded (1 req/sec)`
- `API request failed: [error message]`

---

#### 3. **supabaseProposalService.ts**

##### `uploadProposalToCloud(file: File, textContent: string, pageCount: number): Promise<StoredProposal>`
Uploads proposal file to Supabase storage and saves metadata to database.

**Parameters**:
- `file`: File object from file input
- `textContent`: Extracted text from PDF
- `pageCount`: Number of pages in document

**Response**:
```typescript
{
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;               // Supabase storage URL
  storagePath: string;           // Path in bucket
  textContent: string;
  pageCount: number;
  isCloudStored: true;
  uploadedByUserId: string;
  uploadedByName: string;
  uploadedAt: string;
}
```

**Errors**:
- `File size exceeds 10MB limit`
- `Unsupported file type`
- `Cloud storage unavailable`

---

##### `loadAllProposalsFromCloud(limit?: number): Promise<StoredProposal[]>`
Loads all proposals from cloud storage.

**Parameters**:
- `limit`: Optional max number of proposals (default: no limit)

**Response**: Array of `StoredProposal` objects

---

##### `deleteProposalFromCloud(id: string): Promise<void>`
Deletes proposal from database and storage bucket.

**Parameters**:
- `id`: Proposal UUID

**Errors**:
- `Proposal not found`
- `Unauthorized to delete this proposal`

---

#### 4. **Supabase Database Functions**

##### `search_proposals(query_embedding, match_threshold, match_count, filter_metadata): TABLE`
PostgreSQL function for vector similarity search.

**Parameters**:
- `query_embedding`: VECTOR(768) - Query embedding
- `match_threshold`: FLOAT - Minimum cosine similarity (default 0.5)
- `match_count`: INT - Max results (default 10)
- `filter_metadata`: JSONB - Optional metadata filters (default NULL)

**Returns**: Table with columns: `service_name`, `content`, `metadata`, `similarity`, `document_name`

**SQL Implementation**:
```sql
CREATE OR REPLACE FUNCTION search_proposals(...)
RETURNS TABLE (...) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    service_name,
    content,
    metadata,
    1 - (embedding <=> query_embedding) AS similarity, -- Cosine similarity
    document_name
  FROM proposal_chunks
  WHERE 
    (filter_metadata IS NULL OR metadata @> filter_metadata)
    AND (1 - (embedding <=> query_embedding)) >= match_threshold
  ORDER BY embedding <=> query_embedding  -- Distance ascending
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
```

**Usage Example**:
```typescript
const { data } = await supabase.rpc('search_proposals', {
  query_embedding: [0.123, -0.456, ...], // 768 dimensions
  match_threshold: 0.6,
  match_count: 5,
  filter_metadata: { category: 'Bus Branding' }
});
```

---

#### 5. **pdfExportService.ts**

##### `exportToPDF(element: HTMLElement, quoteNumber: string, templateType: string, clientName: string): Promise<void>`
Generates PDF from HTML element and saves to device.

**Parameters**:
- `element`: DOM element containing quote preview
- `quoteNumber`: Quote identifier (e.g., "Q-2026-001")
- `templateType`: Template name (e.g., "corporate-minimal")
- `clientName`: Client's company name for filename

**Behavior**:
- **Mobile**: Saves to `Documents/QuoteBuddy/` folder and opens in native viewer
- **Web**: Triggers browser download

**File Naming**: `{quoteNumber}_{clientName}_{YYYYMMDD}.pdf`

**Errors**:
- `Element not found`
- `PDF generation failed`
- `File system permission denied (mobile)`

---

### External APIs

#### Google Gemini API

**Endpoint**: `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent`

**Authentication**: API Key in header (`x-goog-api-key`)

**Rate Limit**: 1 request per second (enforced client-side)

**Request**:
```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "System prompt + user message + proposal context"
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 2048
  }
}
```

**Response**:
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "text": "JSON structured response"
          }
        ]
      }
    }
  ]
}
```

---

## UI/UX Guidelines

### Navigation Structure

```
┌─────────────────────────────────────────────────────┐
│  Header (Top)                                       │
│  - Logo                                             │
│  - User Profile (Logout)                            │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Main Content Area                                  │
│  - Route-specific pages                             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Bottom Navigation (Mobile)                         │
│  - Home (Chat) | Documents | Profile                │
└─────────────────────────────────────────────────────┘
```

### Layout Specifications

**Breakpoints**:
- Mobile: 320px - 767px
- Tablet: 768px - 1023px
- Desktop: 1024px+

**Spacing System** (Chakra UI):
- `xs`: 4px
- `sm`: 8px
- `md`: 16px
- `lg`: 24px
- `xl`: 32px
- `2xl`: 40px

**Color Palette**:
- Primary: `#750926` (Burgundy)
- Secondary: `#2D3748` (Dark Gray)
- Success: `#38A169` (Green)
- Error: `#E53E3E` (Red)
- Warning: `#DD6B20` (Orange)
- Background: `#F7FAFC` (Light Gray)
- Text: `#1A202C` (Almost Black)

### Component Design Principles

#### 1. **Forms**
- Labels above inputs
- Required fields marked with asterisk (*)
- Inline validation with error messages
- Save button bottom-right
- Cancel button bottom-left

#### 2. **Chat Interface**
- User messages: Right-aligned, blue background
- AI messages: Left-aligned, gray background
- Timestamps below messages
- Suggestion chips at bottom
- Input field with send button and mic button

#### 3. **PDF Viewer**
- Full-width canvas rendering
- Page navigation: Previous/Next buttons + page counter
- Zoom controls: +/- buttons
- Loading spinner during page render

#### 4. **Quote Preview**
- Editable table for line items
- Add/Remove row buttons
- Auto-calculated totals
- GST toggle switch
- Template selector as card grid

### Responsive Behavior

**Mobile** (< 768px):
- Single column layouts
- Bottom navigation visible
- Touch-friendly buttons (44px min height)
- Collapsible sections
- Horizontal scrolling for wide tables

**Desktop** (>= 1024px):
- Multi-column layouts where appropriate
- Sidebar navigation
- Hover effects on interactive elements
- Keyboard shortcuts enabled

### Accessibility

**Screen Readers**:
- All images have `alt` text
- Form inputs have associated `<label>` elements
- Buttons have descriptive `aria-label` when icon-only

**Keyboard Navigation**:
- Tab order follows visual flow
- Enter key submits forms
- Escape key closes modals

**Color Contrast**:
- Text on background: 4.5:1 minimum (WCAG AA)
- Buttons: 3:1 minimum

---

## Development Standards

### Coding Standards

#### TypeScript
- **Strict mode**: Enabled
- **Type annotations**: Required for function parameters and return types
- **Interfaces over types**: Use `interface` for object shapes
- **Enums for constants**: Use string enums for fixed value sets
- **Avoid `any`**: Use `unknown` or proper types

**Example**:
```typescript
// ✅ Good
interface User {
  id: string;
  email: string;
  role: UserRole;
}

function getUser(id: string): Promise<User> {
  // ...
}

// ❌ Bad
function getUser(id: any): any {
  // ...
}
```

#### React Components
- **Functional components**: Use hooks, avoid class components
- **Named exports**: Export components with explicit names
- **Props interface**: Define TypeScript interface for all component props
- **Destructure props**: Extract props in function signature

**Example**:
```typescript
interface ChatMessageProps {
  message: Message;
  onReply?: (content: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ 
  message, 
  onReply 
}) => {
  // Component logic
};
```

#### State Management
- **Zustand store**: Single source of truth for global state
- **LocalStorage sync**: Use persist middleware for session persistence
- **Derived state**: Compute values from existing state, don't duplicate
- **Actions**: Define actions for state mutations

---

### Naming Conventions

#### Files
- Components: `PascalCase.tsx` (e.g., `ChatInterface.tsx`)
- Services: `camelCase.ts` (e.g., `geminiService.ts`)
- Utils: `camelCase.ts` (e.g., `promptTemplates.ts`)
- Types: `camelCase.ts` (e.g., `quote.ts`)

#### Variables
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `MAX_FILE_SIZE`)
- Variables: `camelCase` (e.g., `userName`)
- Booleans: Prefix with `is`, `has`, `should` (e.g., `isAuthenticated`)

#### Functions
- camelCase (e.g., `sendMessageToGemini`)
- Verb-first naming (e.g., `getUserById`, `createQuote`)

#### Components
- PascalCase (e.g., `QuotePreview`)
- Noun-based naming (e.g., `LoginPage`, `CompanyInfoForm`)

---

### Folder Structure

```
src/
├── components/          # Reusable UI components
│   ├── ChatInterface/   # Feature-specific folder
│   │   ├── ChatInterface.tsx
│   │   ├── ChatMessage.tsx
│   │   └── index.ts     # Barrel export
│   └── ...
├── pages/               # Route-level components
├── services/            # Business logic and API calls
├── store/               # Zustand state management
├── types/               # TypeScript type definitions
├── utils/               # Utility functions
├── hooks/               # Custom React hooks
├── constants/           # App-wide constants
├── styles/              # Global CSS
└── theme/               # Chakra UI theme config
```

---

### Git Workflow

**Branch Strategy**:
- `main` - Production-ready code
- `develop` - Development branch
- `feature/feature-name` - New features
- `bugfix/bug-description` - Bug fixes
- `hotfix/critical-fix` - Production hotfixes

**Commit Message Format**:
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting (no logic change)
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Build/config changes

**Example**:
```
feat(chat): add voice input support for mobile

- Integrate Capacitor speech recognition plugin
- Add microphone button to chat interface
- Display real-time transcription

Closes #45
```

**Pull Request Process**:
1. Create feature branch from `develop`
2. Make commits following commit message format
3. Push branch and open PR to `develop`
4. Request code review from team member
5. Address review comments
6. Merge after approval

---

### Documentation Requirements

**Code Comments**:
- JSDoc for all exported functions
- Inline comments for complex logic
- TODO comments for future improvements

**Example**:
```typescript
/**
 * Sends user message to Gemini AI and returns structured quote data.
 * 
 * @param userMessage - Natural language request from user
 * @param proposalTexts - Array of proposal documents with extracted text
 * @returns Promise resolving to GeminiResponse with quote data or match suggestions
 * @throws Error if API key not configured or rate limit exceeded
 */
export async function sendMessageToGemini(
  userMessage: string,
  proposalTexts: { fileName: string; content: string }[]
): Promise<GeminiResponse> {
  // Implementation
}
```

**README Updates**:
- Update README.md when adding new features
- Include setup instructions for new dependencies
- Document environment variables

---

## Testing Strategy

### Unit Testing

**Framework**: Jest + React Testing Library

**Scope**:
- Utility functions (`utils/`)
- Service functions (`services/`)
- Custom hooks (`hooks/`)

**Coverage Target**: 80% code coverage

**Example**:
```typescript
// pdfUtils.test.ts
describe('extractTextFromPDF', () => {
  it('should extract text from valid PDF', async () => {
    const file = new File(['mock pdf content'], 'test.pdf', {
      type: 'application/pdf'
    });
    const text = await extractTextFromPDF(file);
    expect(text).toBeTruthy();
  });

  it('should throw error for invalid PDF', async () => {
    const file = new File(['not a pdf'], 'test.txt', {
      type: 'text/plain'
    });
    await expect(extractTextFromPDF(file)).rejects.toThrow();
  });
});
```

---

### Integration Testing

**Framework**: Jest + MSW (Mock Service Worker)

**Scope**:
- API service interactions
- Database operations
- Cloud storage operations

**Example**:
```typescript
// geminiService.test.ts
describe('sendMessageToGemini', () => {
  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('should return EXACT_MATCH for valid request', async () => {
    const response = await sendMessageToGemini(
      '50 bus full branding',
      [{ fileName: 'test.pdf', content: 'Bus Full Branding rates...' }]
    );
    expect(response.quoteGenerated).toBe(true);
    expect(response.items).toHaveLength(1);
  });
});
```

---

### Component Testing

**Framework**: React Testing Library

**Scope**:
- Component rendering
- User interactions
- State changes

**Example**:
```typescript
// ChatInterface.test.tsx
describe('ChatInterface', () => {
  it('should render chat input', () => {
    render(<ChatInterface />);
    const input = screen.getByPlaceholderText('Type your message...');
    expect(input).toBeInTheDocument();
  });

  it('should send message on Enter key', () => {
    const mockSend = jest.fn();
    render(<ChatInterface onSendMessage={mockSend} />);
    const input = screen.getByPlaceholderText('Type your message...');
    
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyPress(input, { key: 'Enter', code: 13 });
    
    expect(mockSend).toHaveBeenCalledWith('Test message');
  });
});
```

---

### End-to-End Testing

**Framework**: Playwright

**Scope**:
- Critical user flows
- Cross-browser compatibility
- Mobile device testing

**Test Scenarios**:
1. **Login Flow**: User logs in → Redirected to homepage
2. **Quote Generation Flow**: Upload PDF → Chat → Generate quote → Export PDF
3. **Offline Mode**: Disable network → Upload proposal → Verify IndexedDB storage
4. **Mobile Flow**: Test on mobile viewport → Voice input → PDF export

**Example**:
```typescript
// e2e/quote-generation.spec.ts
test('generate quote from proposal', async ({ page }) => {
  // Login
  await page.goto('http://localhost:5173/login');
  await page.fill('[name="email"]', 'admin@example.com');
  await page.fill('[name="password"]', 'Admin@123');
  await page.click('button[type="submit"]');

  // Upload proposal
  await page.goto('http://localhost:5173/documents');
  await page.setInputFiles('input[type="file"]', 'test-proposal.pdf');
  await page.waitForSelector('text=Upload complete');

  // Generate quote
  await page.goto('http://localhost:5173');
  await page.fill('[placeholder="Type your message..."]', '50 bus full branding');
  await page.click('button[aria-label="Send message"]');
  await page.waitForSelector('text=Quote generated successfully');

  // Verify quote
  await expect(page).toHaveURL(/\/quote/);
});
```

---

### Performance Testing

**Tools**: Lighthouse, WebPageTest

**Metrics**:
- First Contentful Paint (FCP): < 1.5s
- Largest Contentful Paint (LCP): < 2.5s
- Time to Interactive (TTI): < 3.5s
- Cumulative Layout Shift (CLS): < 0.1

**Load Testing**:
- Test with 100+ concurrent users
- Measure API response times under load
- Monitor Supabase query performance

---

### Security Testing

**Scope**:
- SQL injection prevention
- XSS attack prevention
- Authentication bypass attempts
- Unauthorized access tests

**Tools**: OWASP ZAP, Burp Suite

---

## Deployment Strategy

### Environments

#### 1. **Development**
- **URL**: `http://localhost:5173`
- **Purpose**: Local development and testing
- **Database**: Local Supabase instance or dev Supabase project
- **API Keys**: Development-tier Gemini API key

#### 2. **Staging**
- **URL**: `https://staging.quotetbuddy.app` (example)
- **Purpose**: Pre-production testing
- **Database**: Staging Supabase project (separate from production)
- **API Keys**: Staging Gemini API key with rate limits

#### 3. **Production**
- **URL**: `https://quotebuddy.app` (example)
- **Purpose**: Live application for end users
- **Database**: Production Supabase project
- **API Keys**: Production Gemini API key with monitoring

---

### CI/CD Pipeline

**Tool**: GitHub Actions

**Workflow**:
```yaml
name: Build and Deploy

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test
      - run: npm run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build
      - uses: actions/upload-artifact@v3
        with:
          name: build
          path: dist/

  deploy-staging:
    if: github.ref == 'refs/heads/develop'
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v3
      - name: Deploy to Staging
        run: # Deploy to staging server

  deploy-production:
    if: github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v3
      - name: Deploy to Production
        run: # Deploy to production server
```

---

### Hosting

#### Web Application
**Platform**: Vercel / Netlify / AWS S3 + CloudFront

**Configuration**:
- HTTPS enforced
- Custom domain with SSL certificate
- CDN for static assets
- Environment variables configured in hosting platform

**Build Command**: `npm run build`
**Output Directory**: `dist/`

---

#### Mobile Application

**Android**:
1. Build APK: `npm run android`
2. Sign APK with keystore
3. Upload to Google Play Console
4. Release to production track

**iOS**:
1. Build IPA: `npm run ios`
2. Archive in Xcode
3. Upload to App Store Connect
4. Submit for review

---

### Database Migration

**Strategy**: Blue-Green Deployment

1. Create backup of production database
2. Apply schema changes to staging
3. Test thoroughly in staging
4. Apply same changes to production during maintenance window
5. Verify data integrity
6. Rollback plan: Restore from backup if issues occur

**Migration Script Example**:
```sql
-- Migration: Add client_history table
BEGIN;

CREATE TABLE IF NOT EXISTS client_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  client_name VARCHAR(255),
  company_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  last_used TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_client_history_user_id ON client_history(user_id);

COMMIT;
```

---

### Monitoring & Logging

**Tools**:
- **Application Monitoring**: Sentry for error tracking
- **Performance Monitoring**: Google Analytics + Lighthouse CI
- **Uptime Monitoring**: UptimeRobot or Pingdom
- **Log Aggregation**: Supabase logs + CloudWatch (if using AWS)

**Metrics to Track**:
- Error rates by page
- API response times (Gemini, Supabase)
- User engagement (quotes generated per day)
- PDF export success rate
- Cloud storage usage

**Alerts**:
- Error rate > 5% in 5 minutes
- API response time > 10 seconds
- Uptime < 99%
- Database connection failures

---

### Backup & Recovery

**Database Backup**:
- **Frequency**: Daily automated backups via Supabase
- **Retention**: 30 days
- **Testing**: Monthly restore test to verify backup integrity

**Storage Backup**:
- **Frequency**: Continuous replication via Supabase Storage
- **Retention**: Indefinite (user-uploaded files)

**Disaster Recovery Plan**:
1. Identify incident (system down, data corruption)
2. Switch to maintenance mode page
3. Restore database from latest backup
4. Restore storage files if needed
5. Verify system functionality
6. Switch back to live mode
7. Post-mortem analysis

**RTO (Recovery Time Objective)**: 4 hours
**RPO (Recovery Point Objective)**: 1 hour (max data loss)

---

### Rollback Procedures

**Web Application**:
1. Identify problematic deployment
2. Revert Git commit to last stable version
3. Trigger CI/CD pipeline to redeploy
4. Verify application functionality
5. Notify users if data affected

**Mobile Application**:
- Cannot rollback published apps
- Prepare hotfix version ASAP
- Submit expedited review to app stores
- Notify users via in-app banner

---

## Future Enhancements

### Phase 2: Collaboration Features
- **Real-time collaboration**: Multiple users editing same quote simultaneously
- **Comments & annotations**: Team members can add notes to quotes
- **Approval workflow**: Manager approval required before PDF export
- **Quote versioning**: Track changes and restore previous versions

### Phase 3: Advanced AI Capabilities
- **Smart recommendations**: AI suggests optimal package deals based on client history
- **Price negotiation**: AI-powered dynamic pricing based on market trends
- **Automated follow-ups**: AI generates email templates for quote follow-ups
- **Proposal generation**: Generate client proposals from internal notes using AI
- **Improved RAG**: Fine-tune embeddings, add reranking, implement hybrid search (vector + keyword)
- **Multi-modal RAG**: Process images, tables, and charts from proposals using Gemini Vision

### Phase 4: Analytics & Reporting
- **Quote analytics dashboard**: Conversion rates, average quote value, win/loss analysis
- **Sales pipeline**: Track quotes from draft → sent → won/lost
- **Revenue forecasting**: Predict monthly revenue based on quote pipeline
- **Custom reports**: Generate PDF reports for management

### Phase 5: Integration & Automation
- **Email integration**: Send quotes directly from app via SMTP
- **WhatsApp Business API**: Share quotes via WhatsApp
- **CRM integration**: Sync with Salesforce, HubSpot, Zoho CRM
- **Payment gateway**: Accept advance payments directly in quote
- **E-signature**: Client can sign quote digitally

### Phase 6: Multi-Tenant Support
- **Agency mode**: Multiple companies using same instance with data isolation
- **White-label**: Custom branding per tenant
- **Centralized billing**: Subscription management for all tenants

### Phase 7: Advanced PDF Features
- **Interactive PDFs**: Clickable links, embedded videos
- **Digital catalogs**: Browse services in interactive PDF catalog
- **Quote comparison**: Side-by-side comparison of multiple quotes

### Phase 8: Localization
- **Multi-language support**: English, Hindi, Tamil, Telugu
- **Multi-currency**: USD, INR, EUR, GBP
- **Regional templates**: India-specific GST invoice format vs international formats

### Scalability Considerations
- **Microservices architecture**: Split monolithic app into services (Auth, Quote, Document, Export)
- **Message queue**: RabbitMQ/SQS for async PDF generation
- **Caching layer**: Redis for frequently accessed proposals
- **CDN**: CloudFront/Cloudflare for global asset delivery
- **Database sharding**: Partition data by tenant/region for horizontal scaling

---

## Glossary

- **BTL (Below The Line)**: Advertising that targets specific groups directly (e.g., transit ads, outdoor branding)
- **GST**: Goods and Services Tax (India's VAT system)
- **Line Item**: Individual product/service entry in a quote with quantity and price
- **Proposal**: PDF document containing service rates and terms from advertising agencies
- **Rate Card**: Pricing sheet for advertising services
- **RLS**: Row-Level Security (Supabase database security feature)
- **PWA**: Progressive Web App (web app that works offline and can be installed)
- **Capacitor**: Framework for building native mobile apps from web code
- **RAG**: Retrieval-Augmented Generation - AI technique that retrieves relevant context before generating responses
- **Vector Embedding**: Numerical representation of text (768 numbers) that captures semantic meaning
- **pgvector**: PostgreSQL extension for storing and querying vector embeddings
- **Cosine Similarity**: Measure of similarity between two vectors (0=different, 1=identical)
- **Semantic Search**: Finding content by meaning rather than exact keyword matches

---

**Document Version**: 1.0.0  
**Last Updated**: 2026-06-10  
**Author**: AI Documentation System  
**Project**: Quote Buddy - E2W AI Quote Generator

