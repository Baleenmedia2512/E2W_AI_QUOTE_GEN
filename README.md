# AI Quote Generator

A mobile-first React + Ionic application that uses AI to generate professional quotations from proposal PDFs.

## Features

### ✅ SLICE 1 & 2: PDF Upload & Viewing
- Upload PDF proposals (drag & drop or click to browse)
- PDF viewer with page navigation
- Text extraction from PDFs
- File validation and error handling

### ✅ SLICE 3: AI Chat Interface
- Real-time chat with Google Gemini AI
- Context-aware responses based on uploaded proposals
- Sample prompt suggestions
- Typing indicators
- Session storage for chat history
- Rate limiting and error handling
- Mobile-optimized keyboard interactions

### ✅ SLICE 4: Quote Generation
- AI-powered structured quote generation
- Editable line items with quantity and pricing
- Add/remove sections and line items
- Auto-calculated subtotals and totals
- GST calculation toggle (10%)
- Delivery timeline customization
- Terms and conditions section
- Real-time quote preview

### ✅ SLICE 5: Company & Client Information
- Company information form with validation
- Logo upload with preview
- Saved company info (localStorage)
- Client information form
- Form validation (email, phone, GST)
- Step-by-step wizard interface
- Optional fields support

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory (copy from `.env.example`):
```bash
VITE_GEMINI_API_KEY=your_actual_api_key_here
VITE_MAX_FILE_SIZE_MB=10
```

**Get your Gemini API Key:** https://makersuite.google.com/app/apikey

### 3. Run Development Server
```bash
npm run dev
```
The app will be available at: **http://localhost:5173/**

### 4. Build for Production
```bash
npm run build
```

### 5. Mobile Setup (Optional)

#### Android
```bash
npm run android
```

#### iOS
```bash
npm run ios
```

## Usage Guide

1. **Upload Proposal**: Click or drag-drop a PDF file on the home page
2. **Chat with AI**: Use the chat interface to ask questions about the proposal or request a quote
3. **Generate Quote**: Ask the AI to "generate a quote" based on the proposal
4. **Create Quote**: Click the "Create Quote" button to start the quote creation process
5. **Enter Company Info**: Fill in your company details (saved for future use)
6. **Enter Client Info**: Fill in client/customer details
7. **Review & Edit**: Review the generated quote, edit as needed
8. **Save/Export**: Save or export the finalized quote (coming soon)

## Project Structure

```
src/
├── components/
│   ├── ChatInterface/          # AI chat UI
│   ├── QuotePreview/           # Editable quote display
│   ├── CompanyInfoForm/        # Company details form
│   ├── ClientInfoForm/         # Client details form
│   ├── ProposalUpload/         # PDF upload component
│   ├── ProposalViewer/         # PDF viewer
│   └── Layout/                 # App layout wrapper
├── pages/
│   ├── HomePage.tsx            # Main page with upload, chat & viewer
│   └── QuotePage.tsx           # Quote creation wizard
├── services/
│   └── geminiService.ts        # Google Gemini API integration
├── store/
│   └── index.ts                # Zustand global state
├── types/
│   ├── index.ts                # Core type definitions
│   ├── chat.ts                 # Chat message types
│   ├── quote.ts                # Quote structure types
│   ├── company.ts              # Company info types
│   └── client.ts               # Client info types
└── utils/
    ├── pdfUtils.ts             # PDF processing utilities
    ├── promptTemplates.ts      # AI prompt templates
    └── localStorage.ts         # Browser storage helpers
```

## Tech Stack

- **React 18** with TypeScript
- **Ionic Framework 7.8** for mobile UI components
- **React Router 5.3** for navigation
- **Zustand** for state management
- **Google Gemini AI** for intelligent quote generation
- **PDF.js** for PDF reading
- **jsPDF** for PDF generation
- **Vite** for fast development
- **Capacitor 6** for mobile deployment

## Features Completed (Part 1)

✅ **SLICE 1: Project Foundation**
- React.js with TypeScript
- Ionic Framework configured
- Capacitor for mobile support
- Vertical slice folder structure
- Environment variables setup
- PDF processing libraries (pdf.js, react-pdf)
- PDF generation library (jsPDF)
- React Router navigation
- Base layout component
- Mobile-first responsive design
- State management (Zustand)
- Utility helpers

✅ **SLICE 2: Upload & View Proposal**
- ProposalUpload component with file input UI
- File validation (PDF only, max size limit)
- PDF file reader functionality
- Text extraction from uploaded PDF
- Proposal state management
- ProposalViewer component with embedded PDF renderer
- Page navigation controls (prev/next)
- Zoom in/out functionality
- Page thumbnail preview sidebar
- Jump to page feature
- Mobile-friendly touch gestures
- Loading states and error handling

## Project Structure

```
src/
├── components/
│   ├── Layout/
│   ├── ProposalUpload/
│   └── ProposalViewer/
├── pages/
│   └── HomePage.tsx
├── store/
│   └── index.ts (Zustand store)
├── types/
│   └── index.ts
├── utils/
│   └── pdfUtils.ts
├── App.tsx
└── main.tsx
```

## Next Steps (Part 2 & 3)

Continue with the remaining slices in the next session.
