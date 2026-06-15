import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from './supabaseClient';
// Import PDF.js worker locally (Vite will bundle it)
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY!);

// Types
interface ServiceChunk {
  serviceName: string;
  serviceId: string;
  content: string;
  metadata: {
    city?: string; // 🆕 City identifier for folder organization
    unit_price: number;
    currency: string;
    size?: string;
    duration?: string;
    locations?: string[];
    category: string;
    production_included?: boolean;
    installation_included?: boolean;
    min_quantity?: number;
    [key: string]: any;
  };
}

/**
 * 🌆 CITY DETECTION: Extract city name from document filename
 * Supports common Indian cities and variations
 * 
 * @param fileName - PDF filename (e.g., "Chennai_Bus_Rates_2024.pdf")
 * @returns City slug (lowercase, no spaces) or null if not detected
 * 
 * Examples:
 * - "Chennai_Rates.pdf" → "chennai"
 * - "Bangalore Media Proposal.pdf" → "bangalore" 
 * - "Mumbai_BTL_Services.pdf" → "mumbai"
 * - "Random_Document.pdf" → null (requires user input)
 */
export function detectCityFromFileName(fileName: string): string | null {
  // Normalize filename: lowercase, replace special chars
  const normalized = fileName.toLowerCase()
    .replace(/[_\s-]+/g, ' ')
    .replace('.pdf', '')
    .replace('.xlsx', '')
    .replace('.jpg', '')
    .replace('.jpeg', '');
  
  // Common Indian cities with variations/spellings
  const cityPatterns = [
    { names: ['chennai', 'madras'], slug: 'chennai' },
    { names: ['bangalore', 'bengaluru', 'blore'], slug: 'bangalore' },
    { names: ['mumbai', 'bombay'], slug: 'mumbai' },
    { names: ['delhi', 'new delhi', 'ncr'], slug: 'delhi' },
    { names: ['hyderabad', 'hyd'], slug: 'hyderabad' },
    { names: ['pune', 'poona'], slug: 'pune' },
    { names: ['kolkata', 'calcutta'], slug: 'kolkata' },
    { names: ['ahmedabad', 'amdavad'], slug: 'ahmedabad' },
    { names: ['jaipur'], slug: 'jaipur' },
    { names: ['surat'], slug: 'surat' },
    { names: ['lucknow'], slug: 'lucknow' },
    { names: ['kanpur'], slug: 'kanpur' },
    { names: ['nagpur'], slug: 'nagpur' },
    { names: ['indore'], slug: 'indore' },
    { names: ['thane'], slug: 'thane' },
    { names: ['bhopal'], slug: 'bhopal' },
    { names: ['visakhapatnam', 'vizag'], slug: 'visakhapatnam' },
    { names: ['pimpri chinchwad', 'pcmc'], slug: 'pimpri-chinchwad' },
    { names: ['patna'], slug: 'patna' },
    { names: ['vadodara', 'baroda'], slug: 'vadodara' },
    { names: ['ghaziabad'], slug: 'ghaziabad' },
    { names: ['ludhiana'], slug: 'ludhiana' },
    { names: ['agra'], slug: 'agra' },
    { names: ['nashik'], slug: 'nashik' },
    { names: ['faridabad'], slug: 'faridabad' },
    { names: ['meerut'], slug: 'meerut' },
    { names: ['rajkot'], slug: 'rajkot' },
    { names: ['varanasi', 'banaras', 'kashi'], slug: 'varanasi' },
    { names: ['srinagar'], slug: 'srinagar' },
    { names: ['amritsar'], slug: 'amritsar' },
    { names: ['aurangabad'], slug: 'aurangabad' },
    { names: ['dhanbad'], slug: 'dhanbad' },
    { names: ['coimbatore'], slug: 'coimbatore' },
    { names: ['madurai'], slug: 'madurai' },
    { names: ['kochi', 'cochin'], slug: 'kochi' },
    { names: ['thiruvananthapuram', 'trivandrum'], slug: 'thiruvananthapuram' },
  ];
  
  // Check each city pattern
  for (const pattern of cityPatterns) {
    for (const cityName of pattern.names) {
      // Use word boundary to avoid partial matches
      // e.g., "bangalore" matches but not "bangalorecentral"
      const regex = new RegExp(`\\b${cityName}\\b`, 'i');
      if (regex.test(normalized)) {
        console.log(`🌆 [CITY-DETECT] Found "${cityName}" in "${fileName}" → ${pattern.slug}`);
        return pattern.slug;
      }
    }
  }
  
  console.log(`⚠️  [CITY-DETECT] No city detected in "${fileName}"`);
  return null;
}

/**
 * Convert base64 data URL to Blob
 * More reliable than fetch() which can fail or return wrong MIME types
 */
function dataUrlToBlob(dataUrl: string): Blob {
  try {
    // Extract MIME type and base64 data
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const base64Data = parts[1];
    
    // Decode base64 to binary string
    const binaryString = atob(base64Data);
    
    // Convert binary string to byte array
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return new Blob([bytes], { type: mime });
  } catch (error) {
    console.error('Failed to convert data URL to blob:', error);
    throw error;
  }
}

/**
 * Extract images from PDF by rendering pages to canvas and uploading to Supabase Storage
 * More reliable than extracting internal PDF image objects
 */
export async function extractImagesFromPDF(file: File): Promise<Array<{ pageNum: number; imageUrl: string; serviceName: string }>> {
  console.log('🎬 Starting smart page screenshot extraction with service matching...');
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = await import('pdfjs-dist');
  
  // Use local worker (bundled by Vite, no CDN dependency)
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const imageResults: Array<{ pageNum: number; imageUrl: string; serviceName: string }> = [];
  
  console.log(`📄 PDF has ${pdf.numPages} pages`);
  
  // STEP 1: Quick scan to find pages with large service images
  console.log(`\n🔍 STEP 1: Scanning all pages for service images...`);
  const pagesWithImages: number[] = [];
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const operatorList = await page.getOperatorList();
      
      let hasValidImage = false;
      
      // Check if page has large images
      for (let i = 0; i < operatorList.fnArray.length; i++) {
        const operator = operatorList.fnArray[i];
        
        // paintImageXObject = 85, paintJpegXObject = 86
        if (operator === 85 || operator === 86) {
          try {
            const imageName = operatorList.argsArray[i][0];
            const image = await page.objs.get(imageName);
            
            if (image && image.width && image.height) {
              const MIN_WIDTH = 400;
              const MIN_HEIGHT = 300;
              const aspectRatio = image.width / image.height;
              const MIN_ASPECT = 0.4;
              const MAX_ASPECT = 3.0;
              
              // Check if this is a substantial service image
              if (image.width >= MIN_WIDTH && 
                  image.height >= MIN_HEIGHT &&
                  aspectRatio >= MIN_ASPECT && 
                  aspectRatio <= MAX_ASPECT) {
                hasValidImage = true;
                console.log(`  ✅ Page ${pageNum}: Contains service image (${image.width}x${image.height})`);
                break;
              }
            }
          } catch (err) {
            // Ignore resolution errors during scan
          }
        }
      }
      
      if (hasValidImage) {
        pagesWithImages.push(pageNum);
      }
    } catch (err) {
      console.error(`  ❌ Error scanning page ${pageNum}:`, err);
    }
  }
  
  console.log(`\n📊 Found ${pagesWithImages.length} pages with service images:`, pagesWithImages);
  
  // STEP 2: For each page with images, extract text and identify service
  console.log(`\n🎨 STEP 2: Rendering pages and identifying services...`);
  
  for (const pageNum of pagesWithImages) {
    try {
      console.log(`\n📄 Processing page ${pageNum}...`);
      const page = await pdf.getPage(pageNum);
      
      // Extract text from this page to identify service
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      
      console.log(`  📝 Page text: ${pageText.substring(0, 200)}...`);
      
      // Extract service name from page text using regex patterns
      let serviceName = 'Unknown Service';
      
      // Common service patterns in the PDF
      const servicePatterns = [
        { regex: /BUS\s+FULL\s+BRANDING/i, name: 'Bus Full Branding' },
        { regex: /BUS\s+SEMI\s+BRANDING/i, name: 'Bus Semi Branding' },
        { regex: /AUTO\s+FULL\s+BRANDING/i, name: 'Auto Full Branding' },
        { regex: /AUTO\s+SEMI\s+BRANDING/i, name: 'Auto Semi Branding' },
        { regex: /BUS\s+SHELTER\s*-?\s*DOUBLE\s+PANEL\s*-?\s*LIT/i, name: 'Bus Shelter - Double Panel - Lit' },
        { regex: /BUS\s+SHELTER\s*-?\s*SINGLE\s+PANEL/i, name: 'Bus Shelter - Single Panel' },
        { regex: /GANTRY/i, name: 'Gantry' },
        { regex: /UNIPOLE/i, name: 'Unipole' },
        { regex: /POLE\s+KIOSK/i, name: 'Pole Kiosk' },
      ];
      
      // Try to match service name
      for (const pattern of servicePatterns) {
        if (pattern.regex.test(pageText)) {
          serviceName = pattern.name;
          console.log(`  🏷️ Identified service: "${serviceName}"`);
          break;
        }
      }
      
      if (serviceName === 'Unknown Service') {
        console.warn(`  ⚠️ Could not identify service from page text, using fallback`);
        serviceName = `Service from Page ${pageNum}`;
      }
      
      // Render page to canvas
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) {
        console.error(`  ❌ No canvas context for page ${pageNum}`);
        continue;
      }
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      console.log(`  🎨 Rendering ${viewport.width}x${viewport.height}...`);
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      console.log(`  ✅ Rendered successfully`);
      
      // Convert to blob
      console.log(`  🔄 Converting to JPEG...`);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.90);
      });
      
      if (!blob) {
        console.error(`  ❌ No blob created for page ${pageNum}`);
        continue;
      }
      
      console.log(`  ✅ Blob: ${(blob.size/1024).toFixed(1)}KB`);
      
      // Upload to Supabase
      const fileName = `rate-card-images/service-page-${pageNum}-${Date.now()}.jpg`;
      console.log(`  ☁️ Uploading ${fileName}...`);
      
      const { data, error } = await supabase.storage
        .from('proposal-images')
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          upsert: false
        });
      
      if (error) {
        console.error(`  ❌ Upload failed:`, error.message);
        continue;
      }
      
      if (data) {
        console.log(`  ✅ Uploaded: ${data.path}`);
        const { data: urlData } = supabase.storage
          .from('proposal-images')
          .getPublicUrl(fileName);
        
        imageResults.push({
          pageNum,
          imageUrl: urlData.publicUrl,
          serviceName
        });
        
        console.log(`  ✅ URL: ${urlData.publicUrl}`);
        console.log(`  📷 SUCCESS - Page ${pageNum} → ${serviceName}`);
      }
    } catch (err) {
      console.error(`  ❌ Error processing page ${pageNum}:`, err);
    }
  }
  
  console.log(`\n📸 FINAL: Extracted ${imageResults.length} images matched to services`);
  return imageResults;
}

/**
 * Extract text from PDF file
 * Note: For web, you'll need to use pdf.js or similar browser-compatible library
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  // For browser environment, use pdf.js
  // This is a placeholder - actual implementation depends on your environment
  
  // Option 1: Using FileReader + pdf.js (browser)
  const arrayBuffer = await file.arrayBuffer();
  
  // Import pdf.js dynamically
  const pdfjsLib = await import('pdfjs-dist');
  
  // Use local worker (bundled by Vite, no CDN dependency)
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  
  // Extract text from each page
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }
  
  return fullText;
}

/**
 * Parse extracted text into service chunks using Gemini AI
 * AI-based parsing automatically extracts ALL services - no manual patterns needed!
 * Works even when new services are added to the PDF.
 * 
 * Uses the same proven prompt structure as useCityServiceRegistry for consistency.
 * 
 * @param text - Extracted text from PDF document
 * @param city - City identifier to add to service metadata (optional)
 * @returns Array of service chunks with metadata
 */
export async function parseServicesFromText(text: string, city?: string): Promise<ServiceChunk[]> {
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash-lite' 
    });
    
    // Enhanced prompt with complete data extraction including pricing structure and materials
    const prompt = `You are reading an outdoor advertising rate card PDF.
Your task is to build a structured service registry with COMPLETE data extraction. Follow these THREE STEPS exactly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — EXTRACT SERVICE NAMES FROM INNER-PAGE HEADINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The PDF has individual service detail pages. Each has a prominent heading such as:
  "BUS SEMI BRANDING"
  "APARTMENT LOBBY SCREEN BRANDING"
  "AUTO FULL BRANDING"

Rules for Step 1:
- Use ONLY these inner-page headings as service names.
- Do NOT use Pricing Summary table names or document titles (like "MADURAI PROPOSAL 1").
- Strip page-number suffixes like "(1/3)", "(2/2)" — exclude them from the name.
- Each unique heading = one entry.
- Output the name in Title Case (e.g., "Bus Semi Branding").
- Do NOT invent, guess, or carry over names from prior knowledge.
- Do NOT include prices, sizes, durations, city names, or page numbers in the name.
- Include ALL variants separately (e.g., "Auto Full Branding" and "Auto Semi Branding" are different).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — EXTRACT PRICING STRUCTURE (CRITICAL!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PDFs may have THREE different pricing structures:

TYPE A - SEPARATE DISPLAY + PRODUCTION:
  "DISPLAY PRICE: ₹3,25,500 per month"
  "PRINTING & FIXING PRICE: ₹10,500 per Van"
  → Extract BOTH prices separately

TYPE B - CAMPAIGN PRICING:
  "Unit Price: ₹2,000 per month"
  "Minimum: 30 Frames"
  "Campaign Total: ₹60,000"
  → Extract unit_price, min_quantity, and total

TYPE C - ALL-INCLUSIVE:
  "DISPLAY, PRINTING & MOUNTING PRICE: ₹2,800 per month"
  → Extract single combined price

Always extract:
- What IS included (display? printing? mounting? installation?)
- What is NOT included (monitoring? maintenance?)
- Period/duration ("per month", "30 days", "1 month")
- Minimum quantity requirements

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — EXTRACT COMPLETE METADATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For EACH service, extract ALL available details:

REQUIRED:
- Full description/benefits (2-3 sentences)
- Pricing structure (see Step 2)
- Size/dimensions (e.g., "12 sq ft", "18\"x18\"")
- Category (e.g., "Bus Advertising")
- Page range [start, end]

OPTIONAL (if present):
- Material details ("Vinyl with lamination", "Flex with LED backlighting")
- Specifications (exact dimensions, colors, placement details)
- Locations/cities available
- Terms & conditions
- Installation details
- Maintenance requirements
- Image page types:
  * Pages with reference images (product photos, examples)
  * Pages with specification images (technical drawings, measurements)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — return ONLY valid JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[{
  "serviceName": "Mobile Van-LED",
  "serviceId": "mobile-van-led",
  "content": "Mobile Van-LED advertising provides dynamic reach across city areas. Features LED screen for animated content with high visibility during day and night.",
  "metadata": {
    "pricing": {
      "structure": "separate",
      "display_price": 325500,
      "display_period": "per month",
      "production_price": 10500,
      "production_unit": "per Van",
      "inclusions": ["LED screen", "driver", "fuel"],
      "exclusions": ["content creation", "permits"]
    },
    "currency": "INR",
    "size": "LED Screen: 6ft x 4ft",
    "material": "LED panel with weatherproof casing",
    "specifications": {
      "dimensions": "6ft x 4ft",
      "placement": "Mobile van mounted"
    },
    "duration": "30 days",
    "locations": ["Bangalore", "Delhi"],
    "category": "Mobile Advertising",
    "min_quantity": 1,
    "terms": "Minimum 1 month booking required. Advance payment mandatory.",
    "page_range": [5, 7],
    "image_pages": {
      "reference": [5, 6],
      "specification": [7]
    }
  }
}]

CRITICAL RULES:
- serviceId must be lowercase kebab-case derived from the EXACT inner-page heading words
- Do NOT use words from the pricing summary table that differ from the actual inner-page heading
  (e.g. if table says "Metro Train Inside Branding" but heading says "Metro Train Wrap", use "metro-train-wrap")
- content must be 2-3 complete sentences
- pricing.structure MUST be "separate", "combined", or "campaign"
- Extract ALL pricing components found in PDF (display, production, installation)
- If material/specifications not found, omit those fields (don't make up data)
- image_pages helps identify which pages show what type of content
- Every value must come directly from the document
- Return ONLY valid JSON array — no markdown fences, no explanation
- Extract ALL services, but ONLY from inner-page service headings
- terms: Extract ALL bullet points and conditions COMPLETELY — do NOT summarize or skip any point.
  Join them with ". " so the full text is preserved (e.g. "GST 18% Extra. Lead time 7 days. One representative from client side must be present at installation. Baleen Media will provide installation photos. Autos operate on public routes...")

Rate card content:
${text.substring(0, 50000)}`;

    const startTime = performance.now();
    
    // Retry logic for 503 errors (API overload)
    let result;
    let retries = 3;
    let lastError: any;
    
    while (retries > 0) {
      try {
        result = await model.generateContent(prompt);
        break; // Success - exit retry loop
      } catch (error: any) {
        lastError = error;
        if (error?.message?.includes('503') && retries > 1) {
          console.warn(`⚠️ API overloaded (503), retrying... (${retries - 1} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
          retries--;
          continue;
        }
        // Non-503 error or last retry - throw
        throw error;
      }
    }
    
    if (!result) {
      throw lastError;
    }
    
    const responseText = result.response.text();
    const processingTimeMs = performance.now() - startTime;
    
    // Track token usage
    const usageMetadata = result.response.usageMetadata;
    console.log(`🤖 [PDF Extraction] Gemini response: ${responseText.length} chars, ` +
      `${usageMetadata?.promptTokenCount || 0} input tokens, ` +
      `${usageMetadata?.candidatesTokenCount || 0} output tokens, ` +
      `${processingTimeMs.toFixed(0)}ms`);
    
    // Extract JSON from response (remove markdown if present)
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }
    
    const services = JSON.parse(jsonText);
    
    console.log(`✅ AI extracted ${services.length} services from PDF`);
    return services;
    
  } catch (error) {
    console.error('AI parsing error:', error);
    console.log('Falling back to basic extraction...');
    
    // Fallback: Basic extraction if AI fails
    return extractServicesBasic(text);
  }
}

/**
 * Fallback: Basic service extraction (used if AI parsing fails)
 */
function extractServicesBasic(text: string): ServiceChunk[] {
  const services: ServiceChunk[] = [];
  
  // Split by common section headers or double newlines
  const sections = text.split(/\n\n+/);
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();
    
    // Look for price indicators (likely a service)
    if (section.match(/[₹Rs\.]\s*\d{1,3}(?:,?\d{3})*/)) {
      // Extract service name (usually first line or heading)
      const lines = section.split('\n');
      const serviceName = lines[0].replace(/[^\w\s]/g, '').trim();
      
      if (serviceName && serviceName.length > 5) {
        const serviceId = serviceName.toLowerCase().replace(/\s+/g, '-');
        const metadata = extractMetadataFromText(section);
        
        services.push({
          serviceName,
          serviceId,
          content: section,
          metadata: {
            ...metadata,
            city: undefined, // City added at parse time, not in fallback
          }
        });
      }
    }
  }
  
  console.log(`⚠️ Basic extraction found ${services.length} services`);
  return services;
}

/**
 * Extract metadata (price, size, duration) from service text
 * Provides defaults to ensure all services have complete metadata
 */
function extractMetadataFromText(text: string): ServiceChunk['metadata'] {
  const metadata: any = {
    unit_price: 0, // Default if not found
    currency: 'INR',
    category: 'Outdoor Advertising',
    production_included: false,
    installation_included: false,
    min_quantity: 1
  };
  
  // Extract price (₹16,000 or Rs. 16000)
  const priceMatch = text.match(/[₹Rs\.]\s*(\d{1,3}(?:,\d{3})*)/);
  if (priceMatch) {
    metadata.unit_price = parseInt(priceMatch[1].replace(/,/g, ''));
  }
  
  // Extract size (12 sq ft, 8 sq ft, etc.)
  const sizeMatch = text.match(/(\d+)\s*sq\.?\s*ft/i);
  if (sizeMatch) {
    metadata.size = `${sizeMatch[1]} sq ft`;
  }
  
  // Extract duration (30 days, 1 month, etc.)
  const durationMatch = text.match(/(\d+)\s*(days?|months?)/i);
  if (durationMatch) {
    metadata.duration = `${durationMatch[1]} ${durationMatch[2]}`;
  }
  
  // Extract locations
  const locationPatterns = ['Bangalore', 'Delhi', 'Mumbai', 'Hyderabad', 'Chennai', 'Pune', 'Gurgaon', 'Kolkata', 'Ahmedabad'];
  const foundLocations = locationPatterns.filter(loc => 
    text.toLowerCase().includes(loc.toLowerCase())
  );
  if (foundLocations.length > 0) {
    metadata.locations = foundLocations;
  }
  
  // Check for included services
  metadata.production_included = text.toLowerCase().includes('production');
  metadata.installation_included = text.toLowerCase().includes('installation');
  
  return metadata;
}

/**
 * Generate embedding for a text using Gemini
 * Try multiple embedding models until one works
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // List of actual embedding models available in your API key (in order of preference)
  // NOTE: Database expects 768 dimensions, but gemini-embedding-001 returns 3072
  const modelsToTry = [
    'gemini-embedding-2',          // Try this first - might be 768 dims
    'gemini-embedding-2-preview',  // Preview version
    'gemini-embedding-001'         // Fallback - 3072 dims (requires DB update)
  ];
  
  let lastError: any;
  
  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.embedContent(text);
      
      // Success! Log which model worked
      console.log(`✅ Embedding model working: ${modelName} (${result.embedding.values.length} dimensions)`);
      return result.embedding.values;
      
    } catch (error: any) {
      console.warn(`⚠️ Model ${modelName} failed:`, error.message);
      lastError = error;
      continue; // Try next model
    }
  }
  
  // All models failed
  console.error('❌ All embedding models failed. Your API key may not support embeddings.');
  console.error('Last error:', lastError);
  throw new Error('No embedding model available. Please check your Gemini API key permissions.');
}

/**
 * Store service chunk with embedding in database
 */
export async function storeServiceChunk(
  chunk: ServiceChunk, 
  embedding: number[], 
  documentMetadata?: { documentId: string; documentName: string; userId?: string }
) {
  // Scope service_id per city/document so the same service in Chennai vs Madurai
  // does not overwrite via upsert onConflict: 'service_id'.
  const citySlug = documentMetadata?.documentName
    ? detectCityFromFileName(documentMetadata.documentName)
    : chunk.metadata?.city || null;
  const scopedServiceId = citySlug
    ? `${citySlug}-${chunk.serviceId}`
    : chunk.serviceId;

  if (citySlug) {
    const cityLabel = citySlug.charAt(0).toUpperCase() + citySlug.slice(1);
    const locs: string[] = chunk.metadata?.locations || [];
    if (!locs.some((l) => l.toLowerCase().includes(citySlug))) {
      chunk.metadata = { ...chunk.metadata, locations: [...locs, cityLabel] };
    }
  }

  console.log(`\n💾 [STORE-CHUNK] Storing service: ${chunk.serviceName}`);
  console.log(`   [STORE-CHUNK] service_id: ${scopedServiceId}${citySlug ? ` (city-scoped from ${chunk.serviceId})` : ''}`);
  console.log(`   [STORE-CHUNK] embedding dimensions: ${embedding.length}`);
  console.log(`   [STORE-CHUNK] document_id: ${documentMetadata?.documentId}`);
  console.log(`   [STORE-CHUNK] document_name: ${documentMetadata?.documentName}`);
  console.log(`   [STORE-CHUNK] user_id: ${documentMetadata?.userId}`);
  
  const dataToInsert = {
    service_name: chunk.serviceName,
    service_id: scopedServiceId,
    content: chunk.content,
    embedding: embedding,
    metadata: chunk.metadata,
    document_id: documentMetadata?.documentId || 'baleen-rate-card-2024',
    document_name: documentMetadata?.documentName || 'Baleen Media Rate Card',
    user_id: documentMetadata?.userId || null
  };
  
  console.log(`   [STORE-CHUNK] Data structure:`, {
    service_name: dataToInsert.service_name,
    service_id: dataToInsert.service_id,
    content_length: dataToInsert.content.length,
    embedding_length: dataToInsert.embedding.length,
    metadata_keys: Object.keys(dataToInsert.metadata || {}),
    document_id: dataToInsert.document_id,
    document_name: dataToInsert.document_name,
    user_id: dataToInsert.user_id
  });
  
  console.log(`   [STORE-CHUNK] Calling Supabase upsert on 'proposal_chunks' table...`);
  
  const { data, error } = await supabase
    .from('proposal_chunks')
    .upsert(dataToInsert, {
      onConflict: 'service_id'
    });
  
  if (error) {
    console.error(`❌ [STORE-CHUNK] Database error for ${chunk.serviceName}:`);
    console.error(`   [STORE-CHUNK] Error message: ${error.message}`);
    console.error(`   [STORE-CHUNK] Error code: ${error.code}`);
    console.error(`   [STORE-CHUNK] Error details:`, error.details);
    console.error(`   [STORE-CHUNK] Error hint:`, error.hint);
    console.error(`   [STORE-CHUNK] Full error object:`, error);
    throw error;
  }
  
  console.log(`✅ [STORE-CHUNK] Successfully stored: ${chunk.serviceName}`);
  console.log(`   [STORE-CHUNK] Response data:`, data);
}

/**
 * BACKGROUND ENHANCEMENT: Process already-extracted proposal data for RAG
 * This is called AFTER the OLD upload method completes
 * Reuses extracted text and images - no re-extraction needed!
 * 
 * @param params.city - City identifier for folder organization (e.g., "chennai", "bangalore")
 *                      If not provided, images will be stored in root folder
 */
export async function processProposalForRAG(params: {
  textContent: string;
  pageImages: Array<{ 
    pageNumber: number; 
    imageDataUrl: string; 
    text?: string; 
    croppedImages?: string[]; // DEPRECATED - use croppedImagesWithTypes
    croppedImagesWithTypes?: Array<{
      dataUrl: string;
      imageType: 'reference' | 'specification' | 'review';
    }>;
    imageType?: 'reference' | 'specification' | 'review'; // DEPRECATED - kept for backward compatibility
  }>;
  proposalId: string;
  fileName: string;
  userId?: string;
  city?: string; // 🆕 City identifier for folder organization
  onProgress?: (progress: number, message: string) => void;
}) {
  const { textContent, pageImages, proposalId, fileName, userId, city, onProgress } = params;
  
  try {
    console.log('🎯 [PROCESS-RAG] Function called with:', {
      textContentLength: textContent?.length,
      pageImagesCount: pageImages?.length,
      proposalId,
      fileName,
      userId: userId || 'anonymous'
    });
    
    // Debug: Show what page numbers we have in pageImages
    if (pageImages && pageImages.length > 0) {
      const availablePages = pageImages.map(p => p.pageNumber).sort((a, b) => a - b);
      const totalCroppedImages = pageImages.reduce((sum, p) => sum + (p.croppedImages?.length || 0), 0);
      console.log('📄 [PROCESS-RAG] Available page images:', availablePages);
      console.log(`   Total cropped images: ${totalCroppedImages}`);
      console.log('   Sample page data:', {
        pageNumber: pageImages[0].pageNumber,
        hasImageDataUrl: !!pageImages[0].imageDataUrl,
        croppedImagesCount: pageImages[0].croppedImages?.length || 0,
        imageDataUrlLength: pageImages[0].imageDataUrl?.length,
        hasText: pageImages[0].text !== undefined,
        textLength: pageImages[0].text?.length || 0,
        textPreview: (pageImages[0].text || '').substring(0, 100) + '...'
      });
    } else {
      console.warn('⚠️ [PROCESS-RAG] No pageImages provided!');
    }
    
    // Step 1: Parse services from text (using FIXED prompt with filtering rules)
    console.log('🤖 [PROCESS-RAG] Step 1: Parsing services from text with Gemini...');
    if (city) {
      console.log(`   🌆 City: ${city} (images will be organized by city)`);
    } else {
      console.log(`   ⚠️  No city specified (images will be stored in root folder)`);
    }
    onProgress?.(20, 'Parsing services with AI...');
    const services = await parseServicesFromText(textContent, city);
    
    console.log(`📋 [PROCESS-RAG] Parsed ${services.length} services from Gemini`);
    
    if (services.length === 0) {
      throw new Error('No services found in document');
    }
    
    console.log(`✅ [PROCESS-RAG] Extracted ${services.length} services (no junk data)`);
    
    // Step 2: Smart match EVERY page with images to a service
    console.log('🖼️ [PROCESS-RAG] Step 2: Smart matching pages to services...');
    onProgress?.(40, 'Matching images to services...');
    
    // Create service name map for matching (lowercase for case-insensitive matching)
    const serviceMap = new Map<string, typeof services[0]>();
    console.log('\n📋 Registering services for matching:');
    for (const service of services) {
      // Normalize service names the same way as page text
      const fullName = service.serviceName.toLowerCase()
        .replace(/\|/g, ' ')           // Remove pipe separators
        .replace(/\s+/g, ' ')          // Collapse multiple spaces  
        .trim();
      
      // Also create simplified version (without special chars like dashes)
      const simpleName = fullName.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      
      serviceMap.set(fullName, service);
      if (simpleName !== fullName) {
        serviceMap.set(simpleName, service);
      }
      
      console.log(`   📋 "${service.serviceName}"`);
      console.log(`      → Search keys: "${fullName}"${simpleName !== fullName ? ` | "${simpleName}"` : ''}`);
    }
    console.log(`   Total: ${services.length} services registered with ${serviceMap.size} search keys\n`);
    
    // Track which pages get matched to which services
    const pageToServiceMap = new Map<number, typeof services[0]>();
    const unmatchedPages: number[] = [];
    
    // Match each page with images to a service
    console.log('🔍 Matching pages to services:');
    for (const pageImage of pageImages) {
      // Skip pages without images
      if (!pageImage.croppedImages || pageImage.croppedImages.length === 0) {
        continue;
      }
      
      const pageNum = pageImage.pageNumber;
      const rawPageText = (pageImage.text || '').toLowerCase();
      
      // Normalize page text: remove pipes and extra spaces
      // PDF text often has "BUS | FULL | BRANDING" but Gemini returns "Bus Full Branding"
      const pageText = rawPageText
        .replace(/\|/g, ' ')           // Remove pipe separators
        .replace(/\s+/g, ' ')          // Collapse multiple spaces
        .trim();

      // Fix 1: Skip (1/N) pricing/T&C pages — only when they have NO ref/spec/review heading.
      // "(1/3)" pages = first page of service = pricing only (no images needed).
      // But if (1/N) page happens to have "reference image" heading, don't skip.
      const isFirstPagePattern = /\(1\/\d+\)/.test(pageText);
      const hasContentHeading = /reference\s*(image|photo)|design\s*spec|specification|display\s*area|customer\s*review|google\s*review|client\s*review/.test(pageText);
      if (isFirstPagePattern && !hasContentHeading) {
        console.log(`   ⏭️  Page ${pageNum}: Skipping (1/N) pricing page — no ref/spec/review heading`);
        continue;
      }

      // Fix 2: Extract heading area (first 200 chars) for discriminator matching.
      // PDF text is sorted top→bottom (Y position), so heading always comes first.
      // This prevents material names like "Material: Sun Pack" from matching
      // sun-pack keywords on a dye-cutting page.
      const headingArea = pageText.substring(0, 200);

      // 🐛 DEBUG: Show page text details
      console.log(`\n   📄 Page ${pageNum} analysis:`);
      console.log(`      Has text field: ${pageImage.text !== undefined}`);
      console.log(`      Text length: ${pageText.length} chars`);
      console.log(`      Raw text preview: "${rawPageText.substring(0, 100).replace(/\n/g, ' ')}..."`);
      console.log(`      Normalized text: "${pageText.substring(0, 100)}..."`);
      console.log(`      Heading area (first 200): "${headingArea}"`);
      console.log(`      Image count: ${pageImage.croppedImages?.length || 0}`);
      
      // ── FUZZY KEYWORD MATCHING ──────────────────────────────────────────────
      // Extract keywords from a service name for fuzzy matching.
      // Keeps words ≥3 chars AND short discriminator codes like "a4","a5","b5".
      const extractKeywords = (name: string): string[] => {
        return name
          .replace(/[()\/\-_]/g, ' ')
          .split(/\s+/)
          .map(w => w.trim().toLowerCase())
          .filter(w => w.length >= 3 || /^[a-z]\d+$/i.test(w)); // Fix 4: keep "a4","a5"
      };

      // Build keyword sets for ALL services once (for discriminator detection).
      // A discriminator is a keyword that appears in THIS service but NOT in any sibling
      // that shares 2+ other keywords — e.g. "elevated" vs "underground".
      const allServiceKeywords = new Map<string, string[]>();
      for (const [svcName, svc] of serviceMap.entries()) {
        allServiceKeywords.set(svcName, extractKeywords(svcName));
      }

      // Try to find service name in page text — fuzzy keyword overlap
      let matchedService: typeof services[0] | null = null;
      let matchScore = 0;
      let matchDetails: string[] = [];

      // Collect all candidates first (score >= 0.75), then resolve ties with discriminators
      const candidates: Array<{ service: typeof services[0]; svcName: string; score: number; matched: number; keywords: string[] }> = [];

      for (const [serviceName, service] of serviceMap.entries()) {
        const keywords = allServiceKeywords.get(serviceName) || [];
        if (keywords.length === 0) continue;

        // Count how many keywords appear in page text — with plural/singular + typo tolerance
        // Fix 2: Simple includes() misses "boards"→"board" and "awareness"→"awarness"
        const matchedKws = keywords.filter(kw => {
          if (pageText.includes(kw)) return true;
          // plural → singular: "boards" checks "board"
          if (kw.endsWith('s') && kw.length > 3 && pageText.includes(kw.slice(0, -1))) return true;
          // singular → plural: "board" checks "boards"
          if (!kw.endsWith('s') && pageText.includes(kw + 's')) return true;
          // typo tolerance: first 4 chars match + similar length (catches "awarness"/"awareness")
          if (kw.length >= 5) {
            const prefix = kw.substring(0, 4);
            return pageText.split(' ').some(w =>
              w.length >= kw.length - 2 &&
              w.length <= kw.length + 2 &&
              w.substring(0, 4) === prefix
            );
          }
          return false;
        });
        const score = matchedKws.length / keywords.length;

        if (score >= 0.75) {
          candidates.push({ service, svcName: serviceName, score, matched: matchedKws.length, keywords });
          matchDetails.push(`"${serviceName}" ${matchedKws.length}/${keywords.length}=${Math.round(score*100)}%`);
          console.log(`      🔍 Candidate: "${serviceName}" score=${Math.round(score*100)}% matched=[${matchedKws.join(',')}]`);
        }
      }

      if (candidates.length === 1) {
        // Unambiguous match
        matchedService = candidates[0].service;
        matchScore = candidates[0].matched;
        console.log(`      🎯 UNIQUE MATCH: "${candidates[0].svcName}" (${Math.round(candidates[0].score*100)}%)`);
      } else if (candidates.length > 1) {
        // Fix 3: Multiple candidates — use discriminator word to resolve tie
        console.log(`      ⚠️  ${candidates.length} candidates — applying discriminator check`);

        // For each candidate, find keywords that are UNIQUE to it (not in any other candidate)
        const resolved = candidates.filter(cand => {
          const otherKws = new Set(
            candidates
              .filter(c => c.svcName !== cand.svcName)
              .flatMap(c => c.keywords)
          );
          const discriminators = cand.keywords.filter(kw => !otherKws.has(kw));
          if (discriminators.length === 0) {
            // No discriminator — keep as candidate (tie-break by score below)
            console.log(`      ℹ️  "${cand.svcName}" — no unique discriminator`);
            return true;
          }
          // At least one discriminator must appear in the heading area (first 200 chars).
          // Fix 2: Using headingArea prevents material names (e.g. "Material: Sun Pack")
          // from matching discriminators of a sibling service on a different page.
          const discriminatorFound = discriminators.some(kw => headingArea.includes(kw));
          console.log(`      🔑 "${cand.svcName}" discriminators=[${discriminators.join(',')}] foundInHeading=${discriminatorFound}`);
          return discriminatorFound;
        });

        if (resolved.length === 1) {
          matchedService = resolved[0].service;
          matchScore = resolved[0].matched;
          console.log(`      🎯 DISCRIMINATOR MATCH: "${resolved[0].svcName}"`);
        } else if (resolved.length > 1) {
          // Still tied — pick highest score, then most keywords matched
          resolved.sort((a, b) => b.score - a.score || b.matched - a.matched);
          matchedService = resolved[0].service;
          matchScore = resolved[0].matched;
          console.log(`      🎯 TIE-BREAK (highest score): "${resolved[0].svcName}"`);
        }
      }
      // ── END FUZZY MATCHING ───────────────────────────────────────────────────

      if (matchedService) {
        pageToServiceMap.set(pageNum, matchedService);
        console.log(`   ✅ Page ${pageNum}: Matched to "${matchedService.serviceName}"`);
        if (matchDetails.length > 0) {
          console.log(`      Candidates: ${matchDetails.join(' | ')}`);
        }
      } else {
        unmatchedPages.push(pageNum);
        console.warn(`   ⚠️  Page ${pageNum}: No service match found (fuzzy + discriminator both failed)`);
        console.warn(`      → Will upload to _unassigned folder`);
      }
    }
    
    console.log(`📊 Matching complete: ${pageToServiceMap.size} matched, ${unmatchedPages.length} unmatched`);
    
    // Step 3: Upload images based on page-to-service mapping
    console.log('📤 [PROCESS-RAG] Step 3: Uploading images...');
    onProgress?.(60, 'Uploading images to cloud...');
    
    // Upload matched pages for each service
    for (const service of services) {
      const serviceImages: Array<{ url: string; type: string; pageNumber: number }> = [];
      
      // Find all pages matched to this service
      const matchedPages = Array.from(pageToServiceMap.entries())
        .filter(([_, svc]) => svc.serviceId === service.serviceId)
        .map(([pageNum, _]) => pageNum)
        .sort((a, b) => a - b);
      
      console.log(`  📄 ${service.serviceName} (ID: ${service.serviceId}):`);
      console.log(`     Matched pages: [${matchedPages.join(', ')}]`);
      
      if (matchedPages.length === 0) {
        console.warn(`     ⚠️  No pages matched to this service - skipping image upload`);
        continue;
      }
      
      // Upload images from matched pages
      for (const pageNum of matchedPages) {
        const pageImage = pageImages.find(img => img.pageNumber === pageNum);
        if (!pageImage) continue;
        
        // 🆕 COORDINATE-BASED TYPE DETECTION: Use per-image types if available
        const hasPerImageTypes = pageImage.croppedImagesWithTypes && pageImage.croppedImagesWithTypes.length > 0;
        
        if (hasPerImageTypes) {
          console.log(`    📄 Page ${pageNum}: ${pageImage.croppedImagesWithTypes!.length} image(s) with individual types`);
          
          // Upload each image with its specific type
          for (let cropIndex = 0; cropIndex < pageImage.croppedImagesWithTypes!.length; cropIndex++) {
            const { dataUrl, imageType } = pageImage.croppedImagesWithTypes![cropIndex];
            
            try {
              const blob = dataUrlToBlob(dataUrl);
              console.log(`       📦 Crop ${cropIndex} (${imageType}): ${(blob.size / 1024).toFixed(1)}KB`);
              
              // Create organized path: [city/]{serviceId}/{imageType}/page-X-crop-Y.jpg
              const basePath = city ? `${city}/${service.serviceId}` : service.serviceId;
              const fileName = pageImage.croppedImagesWithTypes!.length > 1
                ? `${basePath}/${imageType}/page-${pageNum}-crop-${cropIndex}.jpg`
                : `${basePath}/${imageType}/page-${pageNum}.jpg`;
              
              // Upload to Supabase Storage (upsert creates folder automatically)
              const { data, error } = await supabase.storage
                .from('proposal-images')
                .upload(fileName, blob, {
                  contentType: 'image/jpeg',
                  upsert: true
                });
              
              if (!error && data) {
                const { data: urlData } = supabase.storage
                  .from('proposal-images')
                  .getPublicUrl(fileName);
                
                serviceImages.push({
                  url: urlData.publicUrl,
                  type: imageType,
                  pageNumber: pageNum
                });
                console.log(`       ✅ Uploaded: ${fileName}`);
              } else if (error) {
                console.error(`       ❌ Upload failed for ${fileName}:`, error.message);
              }
            } catch (err) {
              console.error(`       ❌ Error processing crop ${cropIndex}:`, err);
            }
          }
        } else {
          // FALLBACK: Legacy single imageType for whole page
          const imageType = pageImage.imageType || 'reference';
          
          if (!pageImage.croppedImages || pageImage.croppedImages.length === 0) {
            console.warn(`    ⚠️  Page ${pageNum}: No cropped images available, skipping`);
            continue;
          }
          
          const imagesToUpload = pageImage.croppedImages;
          console.log(`    📄 Page ${pageNum} (${imageType}): ${imagesToUpload.length} cropped image(s) to upload [legacy mode]`);
          
          // Upload each cropped image with same type
          for (let cropIndex = 0; cropIndex < imagesToUpload.length; cropIndex++) {
            const imageDataUrl = imagesToUpload[cropIndex];
            
            try {
              const blob = dataUrlToBlob(imageDataUrl);
              console.log(`       📦 Crop ${cropIndex}: ${(blob.size / 1024).toFixed(1)}KB`);
              
              // Create organized path: [city/]{serviceId}/{imageType}/page-X-crop-Y.jpg
              const basePath = city ? `${city}/${service.serviceId}` : service.serviceId;
              const fileName = imagesToUpload.length > 1
                ? `${basePath}/${imageType}/page-${pageNum}-crop-${cropIndex}.jpg`
                : `${basePath}/${imageType}/page-${pageNum}.jpg`;
              
              // Upload to Supabase Storage
              const { data, error } = await supabase.storage
                .from('proposal-images')
                .upload(fileName, blob, {
                  contentType: 'image/jpeg',
                  upsert: true
                });
              
              if (!error && data) {
                const { data: urlData } = supabase.storage
                  .from('proposal-images')
                  .getPublicUrl(fileName);
                
                serviceImages.push({
                  url: urlData.publicUrl,
                  type: imageType,
                  pageNumber: pageNum
                });
                console.log(`       ✅ Uploaded: ${fileName}`);
              } else if (error) {
                console.error(`       ❌ Upload failed for ${fileName}:`, error.message);
              }
            } catch (err) {
              console.error(`       ❌ Error processing crop ${cropIndex}:`, err);
            }
          }
        }
      }
      
      // Store images with type information
      service.metadata.images = serviceImages;
      service.metadata.thumbnail = serviceImages.length > 0 ? serviceImages[0].url : null;
      
      if (serviceImages.length > 0) {
        const uploadedPages = serviceImages.map(img => img.pageNumber).join(', ');
        const referenceCount = serviceImages.filter(img => img.type === 'reference').length;
        const specCount = serviceImages.filter(img => img.type === 'specification').length;
        console.log(`  ✅ Uploaded ${serviceImages.length} images from pages [${uploadedPages}]`);
        console.log(`     🏷️  ${referenceCount} reference, ${specCount} specification`);
      }
    }
    
    // Step 3.5: Handle unmatched pages (upload to _unassigned folder)
    if (unmatchedPages.length > 0) {
      console.log(`\n📂 [PROCESS-RAG] Handling ${unmatchedPages.length} unmatched pages...`);
      console.log(`   Unmatched pages: [${unmatchedPages.join(', ')}]`);
      
      for (const pageNum of unmatchedPages) {
        const pageImage = pageImages.find(img => img.pageNumber === pageNum);
        if (!pageImage) continue;
        
        // 🆕 Use per-image types if available
        const hasPerImageTypes = pageImage.croppedImagesWithTypes && pageImage.croppedImagesWithTypes.length > 0;
        
        if (hasPerImageTypes) {
          console.log(`  📄 Page ${pageNum}: ${pageImage.croppedImagesWithTypes!.length} image(s) with individual types -> _unassigned/`);
          
          for (let cropIndex = 0; cropIndex < pageImage.croppedImagesWithTypes!.length; cropIndex++) {
            const { dataUrl, imageType } = pageImage.croppedImagesWithTypes![cropIndex];
            
            try {
              const blob = dataUrlToBlob(dataUrl);
              
              // Upload to _unassigned folder with optional city prefix
              const unassignedBase = city ? `${city}/_unassigned` : '_unassigned';
              const fileName = pageImage.croppedImagesWithTypes!.length > 1
                ? `${unassignedBase}/${imageType}/page-${pageNum}-crop-${cropIndex}.jpg`
                : `${unassignedBase}/${imageType}/page-${pageNum}.jpg`;
              
              const { data, error } = await supabase.storage
                .from('proposal-images')
                .upload(fileName, blob, {
                  contentType: 'image/jpeg',
                  upsert: true
                });
              
              if (!error && data) {
                console.log(`     ✅ Uploaded: ${fileName}`);
              } else if (error) {
                console.error(`     ❌ Upload failed for ${fileName}:`, error.message);
              }
            } catch (err) {
              console.error(`     ❌ Error uploading unmatched page ${pageNum}:`, err);
            }
          }
        } else {
          // FALLBACK: Legacy single type for whole page
          if (!pageImage.croppedImages || pageImage.croppedImages.length === 0) {
            continue;
          }
          
          const imageType = pageImage.imageType || 'reference';
          console.log(`  📄 Page ${pageNum} (${imageType}): ${pageImage.croppedImages.length} image(s) -> _unassigned/ [legacy mode]`);
          
          for (let cropIndex = 0; cropIndex < pageImage.croppedImages.length; cropIndex++) {
            const imageDataUrl = pageImage.croppedImages[cropIndex];
            
            try {
              const blob = dataUrlToBlob(imageDataUrl);
              
              // Upload to _unassigned folder with optional city prefix
              const unassignedBase = city ? `${city}/_unassigned` : '_unassigned';
              const fileName = pageImage.croppedImages.length > 1
                ? `${unassignedBase}/${imageType}/page-${pageNum}-crop-${cropIndex}.jpg`
                : `${unassignedBase}/${imageType}/page-${pageNum}.jpg`;
              
              const { data, error } = await supabase.storage
                .from('proposal-images')
                .upload(fileName, blob, {
                  contentType: 'image/jpeg',
                  upsert: true
                });
              
              if (!error && data) {
                console.log(`     ✅ Uploaded: ${fileName}`);
              } else if (error) {
                console.error(`     ❌ Upload failed for ${fileName}:`, error.message);
              }
            } catch (err) {
              console.error(`     ❌ Error uploading unmatched page ${pageNum}:`, err);
            }
          }
        }
      }
    }
    
    // Step 3.75: OCR review images → metadata.review (persisted with chunk on store)
    console.log('\n⭐ [PROCESS-RAG] Step 3.75: OCR review images...');
    onProgress?.(62, 'Extracting customer reviews...');
    const { extractReviewViaGemini } = await import('../utils/pdfUtils');
    for (const service of services) {
      if (service.metadata.review?.reviewText) continue;
      const images = service.metadata.images as Array<{ url: string; type: string }> | undefined;
      const reviewImg = images?.find((img) => img.type === 'review');
      if (!reviewImg?.url) continue;
      try {
        console.log(`   ⭐ OCR review for "${service.serviceName}"...`);
        const ocr = await extractReviewViaGemini(reviewImg.url);
        if (ocr?.reviewText) {
          service.metadata.review = ocr;
          console.log(`   ✅ Review OCR: ${ocr.reviewerName} — "${ocr.reviewText.substring(0, 60)}..."`);
        } else {
          console.warn(`   ⚠️ No review text extracted for "${service.serviceName}"`);
        }
      } catch (ocrErr) {
        console.warn(`   ⚠️ Review OCR failed for "${service.serviceName}":`, ocrErr);
      }
    }

    // Step 4: Generate embeddings and store each service
    const total = services.length;
    console.log(`\n🔄 [PROCESS-RAG] Step 4: Generating embeddings and storing ${total} services...`);
    
    for (let i = 0; i < total; i++) {
      const service = services[i];
      const progress = 40 + ((i / total) * 50);
      
      console.log(`\n📦 [PROCESS-RAG] Processing service ${i + 1}/${total}: ${service.serviceName}`);
      onProgress?.(progress, `Processing ${service.serviceName}...`);
      
      try {
        // Generate embedding
        console.log(`   [PROCESS-RAG] Generating embedding for: ${service.serviceName}`);
        const embedding = await generateEmbedding(service.content);
        console.log(`   [PROCESS-RAG] ✅ Embedding generated: ${embedding.length} dimensions`);
        
        // Store in database with document metadata
        console.log(`   [PROCESS-RAG] Storing to database...`);
        await storeServiceChunk(service, embedding, {
          documentId: proposalId,
          documentName: fileName,
          userId
        });
        console.log(`   [PROCESS-RAG] ✅ Service ${i + 1}/${total} stored successfully`);
        
      } catch (serviceError: any) {
        console.error(`❌ [PROCESS-RAG] Failed to process service ${i + 1}/${total}: ${service.serviceName}`);
        console.error(`   [PROCESS-RAG] Error:`, serviceError);
        throw serviceError; // Re-throw to stop the entire process
      }
    }
    
    onProgress?.(100, '✅ RAG enhancement complete!');
    
    console.log(`🎉 [PROCESS-RAG] RAG enhancement complete: ${services.length} services stored with embeddings`);
    
    return {
      success: true,
      servicesProcessed: services.length
    };
    
  } catch (error: any) {
    console.error('❌ [PROCESS-RAG] RAG enhancement failed:', error);
    console.error('    [PROCESS-RAG] Error details:', {
      message: error?.message,
      stack: error?.stack?.split('\n').slice(0, 5),
      name: error?.name,
      cause: error?.cause
    });
    throw error;
  }
}

/**
 * MAIN FUNCTION: Process uploaded PDF (with images)
 * Used by PDFUploader component for direct RAG upload
 */
export async function processAndStorePDF(
  file: File, 
  onProgress?: (progress: number, message: string) => void,
  documentMetadata?: { documentId?: string; userId?: string }
) {
  try {
    // Step 1: Extract text from PDF
    onProgress?.call(null, 5, 'Extracting text from PDF...');
    const text = await extractTextFromPDF(file);
    
    // Step 2: Extract images from PDF WITH service name matching
    onProgress?.call(null, 15, 'Extracting and matching images to services...');
    console.log('\n📸 === IMAGE EXTRACTION START ===');
    const imageResults = await extractImagesFromPDF(file);
    console.log(`📸 === IMAGE EXTRACTION COMPLETE: ${imageResults.length} images matched ===\n`);
    
    // Step 3: Parse services from text (using Gemini AI with FIXED prompt)
    onProgress?.call(null, 30, 'Parsing services with AI...');
    const services = await parseServicesFromText(text);
    
    if (services.length === 0) {
      throw new Error('No services found in PDF. Check parsing logic.');
    }
    
    console.log(`Found ${services.length} services`);
    
    // Step 4: Smart matching - associate images with services by name
    console.log(`\n🔗 Smart matching images to services...`);
    
    for (const service of services) {
      // Find images that match this service name (fuzzy match)
      const serviceImages = imageResults
        .filter(img => {
          // Normalize names for comparison
          const imgServiceNorm = img.serviceName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const serviceNameNorm = service.serviceName.toLowerCase().replace(/[^a-z0-9]/g, '');
          
          // Check if they match (exact or contains)
          return imgServiceNorm === serviceNameNorm || 
                 imgServiceNorm.includes(serviceNameNorm) ||
                 serviceNameNorm.includes(imgServiceNorm);
        })
        .map(img => img.imageUrl);
      
      service.metadata.images = serviceImages;
      service.metadata.thumbnail = serviceImages[0] || null;
      
      console.log(`  📎 ${service.serviceName}: ${serviceImages.length} images matched`);
      if (serviceImages.length === 0) {
        console.warn(`    ⚠️ No images found for "${service.serviceName}"`);
      } else {
        console.log(`    ✅ Matched from pages: ${imageResults.filter(img => serviceImages.includes(img.imageUrl)).map(img => img.pageNum).join(', ')}`);
      }
    }
    
    // Step 5: Generate embeddings and store each service
    const total = services.length;
    for (let i = 0; i < total; i++) {
      const service = services[i];
      const progress = 30 + (i / total) * 60;
      
      onProgress?.call(null, progress, `Processing ${service.serviceName}...`);
      
      // Generate embedding
      const embedding = await generateEmbedding(service.content);
      
      // Store in database with document metadata
      await storeServiceChunk(service, embedding, {
        documentId: documentMetadata?.documentId || 'baleen-rate-card-2024',
        documentName: file.name,
        userId: documentMetadata?.userId
      });
    }
    
    onProgress?.call(null, 100, 'Complete! All services and images stored.');
    
    return {
      success: true,
      servicesProcessed: services.length,
      imagesExtracted: imageResults.length
    };
    
  } catch (error) {
    console.error('PDF processing error:', error);
    throw error;
  }
}

[
  {
    serviceName: "Bus Semi Branding",
    serviceId: "bus-semi-branding",
    content: "Bus Semi Branding: Premium outdoor...",
    metadata: {
      unit_price: 16000,
      currency: "INR",
      size: "12 sq ft",
      duration: "30 days",
      locations: ["Bangalore", "Delhi", "Mumbai"],
      category: "Bus Advertising",
      images: ["https://...bus-semi-1.jpg"]
    }
  },
  // ... 31 more services
]/**
 * Search for services using semantic search
 */
export async function searchServices(query: string, limit = 10, filters?: any) {
  try {
    console.log(`🔍 [SEARCH] Query: "${query}", Limit: ${limit}`);
    
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    console.log(`   [SEARCH] Query embedding: ${queryEmbedding.length} dimensions`);
    
    // Search in database
    const { data, error } = await supabase.rpc('search_proposals', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: limit,
      filter_metadata: filters || null
    });
    
    if (error) {
      console.error('❌ [SEARCH] Database error:', error);
      throw error;
    }
    
    console.log(`✅ [SEARCH] Found ${data?.length || 0} results`);
    return data || [];
    
  } catch (error) {
    console.error('❌ [SEARCH] Search failed:', error);
    throw error;
  }
}

/**
 * Parse flexible pricing structure from metadata
 * Handles: separate (display + production), combined (all-inclusive), campaign (unit x quantity)
 */
export function parsePricingFromMetadata(metadata: any): {
  structure: string;
  display: string;
  breakdown: Array<{ label: string; value: string }>;
  total?: string;
} {
  const pricing = metadata.pricing || {};
  const currency = metadata.currency || 'INR';
  
  // Format currency
  const formatPrice = (amount: number) => `₹${amount.toLocaleString()}`;
  
  // TYPE A: Separate Display + Production
  if (pricing.structure === 'separate' || (pricing.display_price && pricing.production_price)) {
    return {
      structure: 'separate',
      display: `Display: ${formatPrice(pricing.display_price)} ${pricing.display_period || ''}`,
      breakdown: [
        { label: 'Display Price', value: `${formatPrice(pricing.display_price)} ${pricing.display_period || ''}` },
        { label: 'Production Price', value: `${formatPrice(pricing.production_price)} ${pricing.production_unit || ''}` },
        ...(pricing.inclusions ? [{ label: 'Includes', value: pricing.inclusions.join(', ') }] : []),
        ...(pricing.exclusions ? [{ label: 'Excludes', value: pricing.exclusions.join(', ') }] : [])
      ]
    };
  }
  
  // TYPE B: Campaign Pricing (unit x min quantity)
  if (pricing.structure === 'campaign' || (metadata.unit_price && metadata.min_quantity)) {
    const unitPrice = pricing.unit_price || metadata.unit_price;
    const minQty = pricing.min_quantity || metadata.min_quantity;
    const total = unitPrice * minQty;
    
    return {
      structure: 'campaign',
      display: `${formatPrice(unitPrice)} × ${minQty} units = ${formatPrice(total)}`,
      breakdown: [
        { label: 'Unit Price', value: `${formatPrice(unitPrice)} ${pricing.period || metadata.duration || ''}` },
        { label: 'Minimum Quantity', value: minQty.toString() },
        { label: 'Campaign Total', value: formatPrice(total) }
      ],
      total: formatPrice(total)
    };
  }
  
  // TYPE C: All-Inclusive / Combined
  const price = pricing.total || pricing.combined_price || metadata.unit_price || 0;
  return {
    structure: 'combined',
    display: `${formatPrice(price)} ${pricing.period || metadata.duration || 'per month'}`,
    breakdown: [
      { label: 'Price', value: `${formatPrice(price)} ${pricing.period || metadata.duration || ''}` },
      ...(pricing.inclusions ? [{ label: 'Includes', value: pricing.inclusions.join(', ') }] : [])
    ]
  };
}

/**
 * Update embedding for existing service
 */
export async function updateServiceEmbedding(serviceId: string, content: string) {
  try {
    const embedding = await generateEmbedding(content);
    
    const { error } = await supabase
      .from('proposal_chunks')
      .update({ embedding, content })
      .eq('service_id', serviceId);
    
    if (error) throw error;
    
    console.log(`✅ Updated embedding for ${serviceId}`);
    
  } catch (error) {
    console.error('Update error:', error);
    throw error;
  }
}

/**
 * TEST FUNCTION: Search from browser console
 * Usage: window.testSearch("bus full branding")
 */
export async function testSearch(query: string) {
  console.log(`🔍 Searching for: "${query}"`);
  console.log('⏳ Generating embedding...');
  
  try {
    const results = await searchServices(query, 5);
    
    console.log(`\n✅ Found ${results.length} results:\n`);
    results.forEach((r: any, i: number) => {
      console.log(`${i + 1}. ${r.service_name} (${r.service_id})`);
      console.log(`   Similarity: ${(r.similarity * 100).toFixed(1)}%`);
      console.log(`   Content: ${r.content.substring(0, 100)}...`);
      console.log('');
    });
    
    return results;
  } catch (error) {
    console.error('❌ Search failed:', error);
    throw error;
  }
}

// Expose to window for console testing
if (typeof window !== 'undefined') {
  (window as any).testSearch = testSearch;
}
