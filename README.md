# AI Quote Generator

A mobile-first React + Ionic application that uses AI to generate professional quotations from proposal PDFs.

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Edit `.env` file and add your Gemini API key:
```bash
VITE_GEMINI_API_KEY=your_actual_api_key_here
VITE_MAX_FILE_SIZE_MB=10
```

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

## Tech Stack

- **React 18** with TypeScript
- **Ionic Framework 7.8** for mobile UI components
- **React Router 5.3** for navigation
- **Zustand** for state management
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
