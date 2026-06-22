# PDF Export Architecture — OLD (html2canvas + jsPDF)

## Overview

The old system captured the **live DOM as a screenshot** and embedded it into a PDF.  
No separate PDF renderer existed — the screen HTML was photographed.

---

## Files Involved

| File | Role |
|---|---|
| `src/services/pdfExportService.ts` | Main engine — 1,508 lines |
| `src/components/Templates/CorporateMinimal.tsx` | Screen preview (also source for PDF) |
| `src/components/Templates/CorporateMinimal.css` | Styles for both screen + PDF |
| `src/components/Templates/ReferenceImages.tsx` | Renders images in DOM for html2canvas to capture |

---

## How Export Worked — Step by Step

```
User clicks "Export PDF"
        ↓
QuotePreviewPage.tsx
  calls exportToPDF(previewRef.current, quoteNumber, template, clientName)
        ↓
pdfExportService.ts
  1. ensurePdfFontLoaded()          — preloads Calibri via document.fonts API
  2. Detects multi-service or single
        ↓
  [MULTI-SERVICE]
  3. waitForPdfReady('pdf-page-summary')
     captureSectionAtA4('pdf-page-summary')   ← summary page
  4. waitForPdfReady('pdf-page-services')
     measureSectionBlocks('pdf-page-services')  ← DOM measurement
     computeVirtualPagesWithTableRows()          ← split into virtual pages
     captureVirtualPage() × N                   ← capture each page
  5. waitForPdfReady('pdf-page-terms')
     captureSectionAtA4('pdf-page-terms')     ← terms page

  [SINGLE-SERVICE]
  3. waitForPdfReady('pdf-page-1')
     measureSectionBlocks('pdf-page-1')
     computeVirtualPagesWithTableRows()
     captureVirtualPage() × N
        ↓
  For EACH page captured:
  6. compositeWithPageFooter()   ← re-capture footer separately, composite onto canvas
  7. addCanvasToPDF()            ← embed canvas image into jsPDF
        ↓
  8. Inject page numbers via jsPDF.text('i / N', ...)
  9. Mobile: Filesystem.writeFile() → FileOpener.open()
     Web:    URL.createObjectURL() → anchor.click()
```

---

## Key Functions

### `captureSectionAtA4(containerId)`
- Clones the DOM element
- Positions clone off-screen at A4 width (794px)
- Applies `forcePdfFontInTree()` — walks every node, sets Calibri font-size
- Applies `normalizeFontSize()` — scales all font sizes by `PDF_FONT_SCALE = 1.45`
- Calls `html2canvas()` with `scale:2, windowWidth:794`
- Returns `{ canvas, links }`

### `compositeWithPageFooter(contentCanvas, sectionEl)`
- Clones footer separately
- Captures footer with html2canvas
- Creates full A4 canvas (1588×2246px at scale:2)
- Draws content at top, footer at bottom
- Returns composited canvas

### `measureSectionBlocks(containerId)`
- Clones DOM at A4 width
- Injects desktop CSS overrides to match html2canvas layout
- Calls `getBoundingClientRect()` on every `[data-pdf-block]` element
- Returns array of `MeasuredBlock` with height, type, marginBottom

### `computeVirtualPagesWithTableRows(blocks, usableHeight)`
- Pure function — no DOM access
- Assigns blocks to virtual pages
- Table-row-aware splitting: thead repeats, tfoot stays with last row
- Orphan prevention: heading never left alone at bottom

### `captureVirtualPage(containerId, virtualPage, blocks)`
- Clones DOM
- Removes blocks NOT in `virtualPage.blockIndices`
- For table splits: removes tbody rows outside `[startRow, endRow]`
- Injects desktop CSS overrides into html2canvas `onclone` head
- Calls html2canvas → compositeWithPageFooter

---

## Constants

```typescript
const A4_WIDTH_PX = 794           // 210mm at 96dpi
const A4_HEIGHT_PX = 1123         // 297mm at 96dpi
const PDF_USABLE_HEIGHT_PX = 900  // usable content height (accounts for font inflation)
const PDF_FONT_SCALE = 1.45       // multiplied to all font sizes before capture
const PDF_FONT_MIN_PX = 14        // floor after scaling
const PDF_FONT_MAX_PX = 44        // ceiling after scaling
const TEXT_INFLATION = 1.67       // html2canvas inflates text blocks by this factor
const IMAGE_INFLATION = 1.12      // html2canvas inflates image blocks by this factor
```

---

## Template Structure (DOM IDs)

### Single Service
```
#pdf-page-1
  [data-pdf-block="atomic"]  ← header + client
  [data-pdf-block="table"]   ← pricing table
  ReferenceImages (ref image, spec, review)  [data-pdf-ready]
  [data-pdf-block="list"]    ← service terms
  [data-pdf-block="list"]    ← general terms
  [data-pdf-block="atomic"]  ← bank details
  [data-pdf-block="atomic"]  ← system notice
  .company-contact-footer
```

### Multi Service
```
#pdf-page-summary
  [data-pdf-block="atomic"]  ← header + client
  [data-pdf-block="table"]   ← all items summary table
  .company-contact-footer

#pdf-page-services
  (for each service group)
  [data-pdf-block="atomic"]  ← service heading
  [data-pdf-block="table"]   ← pricing table
  ReferenceImages            [data-pdf-ready]
  .company-contact-footer    ← one shared footer

#pdf-page-terms
  [data-pdf-block="list"]    ← general terms
  [data-pdf-block="atomic"]  ← bank details
  [data-pdf-block="atomic"]  ← system notice
  .company-contact-footer
```

---

## ReferenceImages Flow

```
ReferenceImages.tsx mounts
  ↓
filterPagesByCategory()  — finds PDF pages matching service
  ↓
cropReferencePageImage() — crops reference photo section
cropSpecAboveReference() — crops spec table section
cropSpecDiagram()        — crops spec diagram
cropPageSlice()          — crops specific % of page
  ↓
extractReviewViaGemini() — calls Gemini Vision API
  OR reads from metadata.review (if cached in DB)
  ↓
renders <img> tags into DOM
  ↓
sets containerRef.setAttribute('data-pdf-ready', 'true')
  ↓
pdfExportService polls every 150ms (max 15 seconds)
  ↓
html2canvas screenshots the rendered <img> tags
```

---

## Problems with Old Architecture

| Problem | Cause |
|---|---|
| **15–30 second export time** | html2canvas captures DOM at 2× scale, multiple times per page |
| **23 pages for one quote** | Block packer over-flushes pages (font inflation estimate wrong) |
| **White gaps (40% empty page)** | After TOTAL row, no more content — footer composited to A4 bottom |
| **Content cut at page break** | Font inflation (1.67×) underestimated — block measured at 500px, rendered at 835px |
| **Missing thead on continuation page** | No thead repeat — table block captured as whole unit |
| **Footer floating mid-page** | compositeWithPageFooter places footer at fixed Y from bottom regardless of content height |
| **Blurry text in PDF** | html2canvas rasterises vector text to PNG at 144dpi |
| **Emoji breaking (🌐 📍)** | System emoji font not loaded in html2canvas clone |
| **Mobile vs desktop layout drift** | getBoundingClientRect() uses mobile viewport, html2canvas uses windowWidth:794 |
| **15s timeout** | waitForPdfReady polls for data-pdf-ready="true" — async image cropping can take time |
| **Font scale hacks** | PDF_FONT_SCALE=1.45, TEXT_INFLATION=1.67, IMAGE_INFLATION=1.12 all guesses |
| **4 layers of CSS injection** | desktopOverride + captureOverride + onclone head style + forcePdfFontInTree() |

---

## Timing Breakdown (per export)

| Step | Time |
|---|---|
| Font preload | 200–500ms |
| waitForPdfReady (images) | 500ms–15,000ms |
| DOM clone per virtual page | ~100ms × N |
| Block measurement pass | ~300ms per section |
| setTimeout delays | 300ms + 80ms + 300ms minimum |
| html2canvas per page | 1,000–3,000ms × N pages |
| Footer composite per page | ~200ms × N |
| **Total** | **15–30 seconds** |

---

## Backup Location

The old `pdfExportService.ts` is preserved at:
```
src/services/pdfExportService.backup.ts
```

To restore: rename back to `pdfExportService.ts`
