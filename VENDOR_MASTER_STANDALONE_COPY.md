# Vendor Master — Standalone Project Copy Guide

Use this document to copy the **Vendor Management** feature into a **separate project** (or recreate it elsewhere).  
If you follow the steps below with the same Supabase project + table, behavior matches Quote Buddy’s vendor tab.

---

## What this feature does

| Action | Result |
|--------|--------|
| Upload Excel on Vendor page | Each row → `vendor_rate_chunks` |
| Browse / search table | Read from `vendor_rate_chunks` |
| Quotes / Chat | **NOT used** — `proposal_chunks` only in Quote Buddy |

**RAG:** Not implemented for vendors (`embedding = null` on import).

---

## Files written in Quote Buddy (copy these)

```
src/
├── services/
│   └── vendorRateChunkService.ts      ← CORE (Excel parse + DB insert/load)
├── components/
│   ├── VendorUpload/
│   │   └── VendorUpload.tsx           ← Excel upload UI
│   └── DesktopNavLinks/
│       └── DesktopNavLinks.tsx        ← Only if keeping nav inside Quote Buddy
├── pages/
│   └── VendorManagementPage.tsx     ← Main vendor page
└── utils/
    └── fileUtils.ts                   ← Only need validateExcelFile() (see below)

App.tsx changes:
  - import VendorManagementPage
  - route: <PrivateRoute exact path="/vendors" component={VendorManagementPage} />

BottomNav.tsx changes:
  - add { path: '/vendors', icon: FiUsers, label: 'Vendors' }
```

---

## Standalone project — quick start

### 1. Create project

```bash
npm create vite@latest vendor-master -- --template react-ts
cd vendor-master
npm install @chakra-ui/react @emotion/react @emotion/styled framer-motion
npm install @supabase/supabase-js xlsx react-icons react-router-dom@5.3.4
```

### 2. Environment (`.env`)

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_MAX_FILE_SIZE_MB=10
```

Use the **same** Supabase project as Quote Buddy if you want the same `vendor_rate_chunks` data.

### 3. Supabase SQL (run once)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS vendor_rate_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name TEXT NOT NULL,
    service_id TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    embedding VECTOR(3072),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    document_id TEXT NOT NULL,
    document_name TEXT NOT NULL,
    user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_chunks_metadata
ON vendor_rate_chunks USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_chunks_service_id
ON vendor_rate_chunks (service_id);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_chunks_service_name
ON vendor_rate_chunks (service_name);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_chunks_vendor_name
ON vendor_rate_chunks ((metadata->>'vendor_name'));

CREATE INDEX IF NOT EXISTS idx_vendor_rate_chunks_city
ON vendor_rate_chunks ((metadata->>'city'));

CREATE INDEX IF NOT EXISTS idx_vendor_rate_chunks_document_id
ON vendor_rate_chunks (document_id);

-- RLS (adjust for your auth)
ALTER TABLE vendor_rate_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read vendor rates"
ON vendor_rate_chunks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert vendor rates"
ON vendor_rate_chunks FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update vendor rates"
ON vendor_rate_chunks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete vendor rates"
ON vendor_rate_chunks FOR DELETE TO authenticated USING (true);
```

### 4. Standalone folder structure

```
vendor-master/src/
├── main.tsx
├── App.tsx
├── theme.ts
├── services/
│   ├── supabaseClient.ts
│   └── vendorRateChunkService.ts    ← copy from Quote Buddy
├── utils/
│   └── excelValidation.ts           ← validateExcelFile only
├── components/
│   └── VendorUpload.tsx
└── pages/
    └── VendorManagementPage.tsx     ← simplify nav for standalone
```

---

## FILE: `src/services/supabaseClient.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

---

## FILE: `src/utils/excelValidation.ts`

```typescript
export const validateExcelFile = (file: File): { valid: boolean; error?: string } => {
  const maxSizeMB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 10;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const validTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ];

  const hasValidType =
    validTypes.includes(file.type) ||
    file.name.toLowerCase().endsWith('.xlsx') ||
    file.name.toLowerCase().endsWith('.xls');

  if (!hasValidType) {
    return { valid: false, error: 'Only Excel files (.xlsx, .xls) are allowed' };
  }

  if (file.size > maxSizeBytes) {
    return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
  }

  return { valid: true };
};
```

---

## FILE: `src/services/vendorRateChunkService.ts`

**Copy the full file from Quote Buddy:**

`D:\E2W_AI_QUOTE_GEN\src\services\vendorRateChunkService.ts`

(~605 lines — Excel header mapping, row parse, batch insert, load, summary, delete by document)

Key exports:
- `importVendorExcelFile(file, userId?, onProgress?)`
- `loadVendorRateChunks(limit?)`
- `loadVendorSummary()`
- `deleteVendorRatesByDocument(documentId)`
- `parseVendorExcelRows(buffer)`

---

## FILE: `src/components/VendorUpload.tsx`

**Standalone version** (no auth store — pass `userId` optional):

```tsx
import React, { useRef, useState } from 'react';
import {
  Box, Button, HStack, Progress, Text, VStack, useToast,
} from '@chakra-ui/react';
import { FiUploadCloud } from 'react-icons/fi';
import { validateExcelFile } from '../utils/excelValidation';
import { importVendorExcelFile, VendorImportProgress } from '../services/vendorRateChunkService';

interface VendorUploadProps {
  userId?: string;
  onImported?: () => void;
}

const VendorUpload: React.FC<VendorUploadProps> = ({ userId, onImported }) => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<VendorImportProgress | null>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const validation = validateExcelFile(file);
    if (!validation.valid) {
      toast({ title: 'Invalid file', description: validation.error, status: 'error', duration: 4000, isClosable: true });
      return;
    }

    setIsUploading(true);
    setProgress({ phase: 'parsing', current: 0, total: 0, message: 'Starting import...' });

    try {
      const result = await importVendorExcelFile(file, userId, setProgress);
      toast({
        title: 'Vendor rates imported',
        description: `${result.imported} rates from ${result.vendorCount} vendors.`,
        status: 'success',
        duration: 5000,
        isClosable: true,
      });
      onImported?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to import vendor Excel.';
      toast({ title: 'Import failed', description: message, status: 'error', duration: 5000, isClosable: true });
    } finally {
      setIsUploading(false);
      setProgress(null);
    }
  };

  return (
    <Box bg="white" borderRadius="16px" p={5} boxShadow="sm" border="1px solid" borderColor="gray.100">
      <VStack align="stretch" spacing={4}>
        <Box>
          <Text fontWeight="700" fontSize="lg">Upload Vendor Excel</Text>
          <Text fontSize="sm" color="gray.600" mt={1}>
            Each Excel row is stored in vendor_rate_chunks.
          </Text>
        </Box>
        <Box border="2px dashed" borderColor="gray.200" borderRadius="14px" p={6} textAlign="center" bg="gray.50">
          <VStack spacing={3}>
            <FiUploadCloud size={28} color="#C91F3D" />
            <Button colorScheme="brand" leftIcon={<FiUploadCloud />} onClick={() => fileInputRef.current?.click()} isLoading={isUploading}>
              Select Excel File
            </Button>
          </VStack>
        </Box>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileSelect} />
        {progress && progress.total > 0 && (
          <Progress value={(progress.current / progress.total) * 100} size="sm" colorScheme="brand" borderRadius="full" />
        )}
      </VStack>
    </Box>
  );
};

export default VendorUpload;
```

**In Quote Buddy**, the file is at:  
`src/components/VendorUpload/VendorUpload.tsx`  
(it uses `useAuthStore` instead of `userId` prop)

---

## FILE: `src/pages/VendorManagementPage.tsx`

**Copy the full file from Quote Buddy:**

`D:\E2W_AI_QUOTE_GEN\src\pages\VendorManagementPage.tsx`

For **standalone project**, remove:
- `DesktopNavLinks` import and usage
- Quote Buddy desktop/mobile headers with multi-page nav

Keep:
- `VendorUpload`
- Stats cards
- Search + table

---

## FILE: `src/theme.ts` (minimal Chakra brand)

```typescript
import { extendTheme } from '@chakra-ui/react';

export const theme = extendTheme({
  colors: {
    brand: {
      50: '#FDF2F4',
      500: '#C91F3D',
      600: '#750926',
    },
  },
});
```

---

## FILE: `src/App.tsx` (standalone — single page app)

```tsx
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { theme } from './theme';
import VendorManagementPage from './pages/VendorManagementPage';

const App: React.FC = () => (
  <ChakraProvider theme={theme}>
    <VendorManagementPage />
  </ChakraProvider>
);

export default App;
```

---

## FILE: `src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

---

## Excel column headers supported

Your sheet headers are auto-mapped (case-insensitive):

| Excel header | Stored as |
|--------------|-----------|
| Vendor Name | `metadata.vendor_name` |
| City | `metadata.city` |
| Medium | `service_name` + `metadata.medium` |
| Type1 / Type2 / Type3 | `metadata.type1` etc. |
| Min. Qty. | `metadata.min_qty` |
| Qty. Measurement | `metadata.qty_measurement_unit` |
| Total / Display / Printing / Mounting Cost | `metadata.total_cost` etc. |
| Printing & Mounting Cost | `metadata.printing_and_mounting_cost` |
| RTO Certificate / RTO Cost | `metadata.rto_certificate` |
| Extra KM | `metadata.extra_km` |
| Space Rental Cost | `metadata.space_rental_cost` |
| Location, Traffic | `metadata.location`, `metadata.traffic` |
| Display Width/Height/Unit | `metadata.display_width` etc. |
| Min Duration, Duration Unit | `metadata.min_duration` etc. |
| per Spot | `metadata.duration_per_spot` |
| Audio Enabled | `metadata.audio_enabled` |
| Day Start / Day End | `metadata.day_start`, `metadata.day_end` |
| Replacement | `metadata.replacement` |
| No. of spots per day | `metadata.spots_per_day` |
| Lead Time (in days) | `metadata.lead_time_days` |

`NA`, empty, `-` → skipped.

---

## DB row shape (per Excel row)

```json
{
  "service_name": "AUTO BACK STICKER",
  "service_id": "vrc-chennai-auto-back-sticker-touche-12",
  "content": "AUTO BACK STICKER advertising service, available in Chennai, offered by TOUCHE.",
  "embedding": null,
  "metadata": {
    "vendor_name": "TOUCHE",
    "city": "chennai",
    "medium": "AUTO BACK STICKER",
    "unit_price": 500,
    "min_qty": 50,
    "pricing": { "structure": "campaign", "unit_price": 500 },
    "source": "excel-import",
    "excel_row_index": 12
  },
  "document_id": "vendor_excel_1739012345678",
  "document_name": "Vendor_Master.xlsx"
}
```

---

## Quote Buddy integration changes (already done)

### `App.tsx`
```tsx
import VendorManagementPage from './pages/VendorManagementPage';
// ...
<PrivateRoute exact path="/vendors" component={VendorManagementPage} />
```

### `BottomNav.tsx`
```tsx
{ path: '/vendors', icon: FiUsers, label: 'Vendors' },
```

### `DesktopNavLinks.tsx` — shared nav with Vendors link

---

## npm packages required (vendor feature only)

```json
{
  "@chakra-ui/react": "^2.10.9",
  "@emotion/react": "^11.14.0",
  "@emotion/styled": "^11.14.1",
  "@supabase/supabase-js": "^2.100.1",
  "framer-motion": "^12.38.0",
  "react-icons": "^5.6.0",
  "xlsx": "^0.18.5"
}
```

---

## Checklist — will it work the same?

- [ ] Same Supabase URL + anon key in `.env`
- [ ] `vendor_rate_chunks` table exists (SQL above)
- [ ] RLS allows INSERT + SELECT for your user
- [ ] `vendorRateChunkService.ts` copied完整
- [ ] `xlsx` package installed
- [ ] Excel has **Vendor Name**, **City**, **Medium** columns + at least one cost column
- [ ] Chakra `brand` color in theme (`colorScheme="brand"`)

---

## NOT included (future work)

- Edit form in UI → update DB (you asked for this separately)
- RAG / embeddings for vendor table
- Chat / quote using vendor data
- Link from Quote Buddy to external vendor app URL

---

## Fastest copy method from Quote Buddy repo

Copy these 4 files as-is:

1. `src/services/vendorRateChunkService.ts`
2. `src/components/VendorUpload/VendorUpload.tsx`
3. `src/pages/VendorManagementPage.tsx`
4. `src/utils/excelValidation.ts` (extract `validateExcelFile` from `fileUtils.ts`)

Plus:
- `src/services/supabaseClient.ts` (or reuse existing)
- SQL + `.env`
- Standalone `App.tsx` + `theme.ts`

Run `npm run dev` → open app → upload Excel → check `vendor_rate_chunks` in Supabase.

---

**Document version:** 2026-07-09  
**Source project:** Quote Buddy (`E2W_AI_QUOTE_GEN`)
