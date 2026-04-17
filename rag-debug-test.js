/**
 * RAG Debug and Testing Script
 * 
 * HOW TO USE:
 * 1. Open the app in browser (npm run dev)
 * 2. Open DevTools Console (F12)
 * 3. Copy and paste this entire script into console
 * 4. Run: await testRAGSystem()
 * 
 * This will test all components of the RAG system and report results
 */

async function testRAGSystem() {
  console.log('🧪 ===== RAG SYSTEM DEBUG TEST =====\n');
  
  const results = {
    databaseSetup: false,
    embeddingModel: false,
    chunking: false,
    vectorStore: false,
    proposalUpload: false,
    ragQuery: false,
    errors: []
  };

  // Helper to log test results
  const logTest = (name, passed, details = '') => {
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}`);
    if (details) console.log(`   ${details}`);
    if (!passed && details) results.errors.push(`${name}: ${details}`);
  };

  try {
    // TEST 1: Database Setup
    console.log('\n📊 Test 1: Database Setup');
    console.log('---------------------------');
    try {
      const { supabase } = await import('./src/services/supabaseClient.js');
      
      // Check pgvector extension
      const { data: extensions, error: extError } = await supabase
        .from('pg_extension')
        .select('*')
        .eq('extname', 'vector')
        .single();
      
      logTest('pgvector extension', !extError, extError?.message);
      
      // Check document_chunks table
      const { count, error: countError } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true });
      
      logTest('document_chunks table exists', !countError, countError?.message || `Found ${count} chunks`);
      
      // Check proposals table columns
      const { data: proposals, error: propError } = await supabase
        .from('proposals')
        .select('chunk_count, embedding_status')
        .limit(1);
      
      logTest('proposals table has RAG columns', !propError, propError?.message);
      
      results.databaseSetup = !extError && !countError && !propError;
    } catch (err) {
      logTest('Database setup', false, err.message);
    }

    // TEST 2: Embedding Model
    console.log('\n🤖 Test 2: Embedding Model');
    console.log('---------------------------');
    try {
      const { initializeEmbeddingModel, generateEmbedding, getModelInfo } = 
        await import('./src/services/embeddingService.js');
      
      console.log('   Initializing embedding model (may take 5-10s first time)...');
      await initializeEmbeddingModel();
      
      const modelInfo = getModelInfo();
      logTest('Model initialized', modelInfo.isLoaded, 
        `Model: ${modelInfo.name}`);
      
      // Test embedding generation
      const { embedding, processingTime } = await generateEmbedding('test query');
      const isCorrectDimension = embedding.length === 384;
      logTest('Generate embedding', isCorrectDimension, 
        `Dimension: ${embedding.length}, Time: ${processingTime.toFixed(2)}ms`);
      
      results.embeddingModel = modelInfo.isLoaded && isCorrectDimension;
    } catch (err) {
      logTest('Embedding model', false, err.message);
    }

    // TEST 3: Chunking Service
    console.log('\n📄 Test 3: Chunking Service');
    console.log('---------------------------');
    try {
      const { chunkDocument, getChunkStatistics } = 
        await import('./src/services/chunkingService.js');
      
      const testText = `
        This is a test document for the RAG system.
        It contains multiple sentences and paragraphs.
        
        The chunking service should split this into appropriate chunks.
        Each chunk should be around 1000 characters by default.
        
        This allows the embedding model to process the text effectively.
        And enables semantic search to find relevant information.
      `.trim();
      
      const chunks = chunkDocument(testText, 'test-id', 'test.txt');
      const stats = getChunkStatistics(chunks);
      
      logTest('Create chunks', chunks.length > 0, 
        `Created ${chunks.length} chunks, avg size: ${stats.avgChunkSize} chars`);
      
      results.chunking = chunks.length > 0;
    } catch (err) {
      logTest('Chunking service', false, err.message);
    }

    // TEST 4: Vector Store
    console.log('\n💾 Test 4: Vector Store');
    console.log('---------------------------');
    try {
      const { supabase } = await import('./src/services/supabaseClient.js');
      
      // Try to query chunks (even if empty)
      const { data: chunks, error: queryError } = await supabase
        .from('document_chunks')
        .select('id, proposal_id, chunk_index, chunk_text')
        .limit(5);
      
      logTest('Query chunks', !queryError, 
        queryError?.message || `Found ${chunks?.length || 0} chunks in database`);
      
      // Check if we can access the match function
      const testEmbedding = Array(384).fill(0.1);
      const { data: matchResult, error: matchError } = await supabase
        .rpc('match_document_chunks', {
          query_embedding: testEmbedding,
          match_threshold: 0.7,
          match_count: 5
        });
      
      logTest('Similarity search function', !matchError, 
        matchError?.message || `Function works, found ${matchResult?.length || 0} matches`);
      
      results.vectorStore = !queryError && !matchError;
    } catch (err) {
      logTest('Vector store', false, err.message);
    }

    // TEST 5: Check Latest Proposal
    console.log('\n📤 Test 5: Latest Proposal Status');
    console.log('---------------------------');
    try {
      const { supabase } = await import('./src/services/supabaseClient.js');
      
      const { data: proposal, error: propError } = await supabase
        .from('proposals')
        .select('*')
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .single();
      
      if (!propError && proposal) {
        console.log(`   📄 File: ${proposal.file_name}`);
        console.log(`   📊 Chunk Count: ${proposal.chunk_count || 'NULL'}`);
        console.log(`   🔄 Status: ${proposal.embedding_status || 'NULL'}`);
        console.log(`   📝 Text Length: ${proposal.text_content?.length || 0} chars`);
        console.log(`   📅 Uploaded: ${new Date(proposal.uploaded_at).toLocaleString()}`);
        
        // Check actual chunks
        const { count: actualChunks } = await supabase
          .from('document_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('proposal_id', proposal.id);
        
        console.log(`   ✨ Actual Chunks in DB: ${actualChunks || 0}`);
        
        const hasChunks = actualChunks > 0;
        logTest('Proposal has chunks', hasChunks, 
          hasChunks ? `${actualChunks} chunks found` : 'No chunks - RAG processing may have failed');
        
        results.proposalUpload = hasChunks;
      } else {
        logTest('Latest proposal', false, 'No proposals found in database');
      }
    } catch (err) {
      logTest('Proposal check', false, err.message);
    }

    // TEST 6: End-to-End RAG Query
    console.log('\n🔍 Test 6: RAG Query (if chunks exist)');
    console.log('---------------------------');
    try {
      const { queryRAG } = await import('./src/services/ragService.js');
      
      const result = await queryRAG('test query about services and pricing');
      
      const hasResults = result.chunks.length > 0;
      logTest('RAG query execution', true, 
        `Found ${result.chunks.length} chunks in ${result.queryTime.toFixed(2)}ms`);
      
      if (hasResults) {
        console.log(`   🎯 Relevance: ${(result.relevanceScore * 100).toFixed(1)}%`);
        console.log(`   📝 Context Length: ${result.context.length} chars`);
      } else {
        console.log('   ℹ️ No chunks found - upload a document first');
      }
      
      results.ragQuery = true; // Query worked even if no results
    } catch (err) {
      logTest('RAG query', false, err.message);
    }

  } catch (err) {
    console.error('❌ Fatal error during testing:', err);
    results.errors.push(`Fatal: ${err.message}`);
  }

  // FINAL SUMMARY
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  
  const testResults = [
    ['Database Setup', results.databaseSetup],
    ['Embedding Model', results.embeddingModel],
    ['Chunking Service', results.chunking],
    ['Vector Store', results.vectorStore],
    ['Proposal Upload', results.proposalUpload],
    ['RAG Query', results.ragQuery]
  ];
  
  testResults.forEach(([name, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
  });
  
  const allPassed = Object.values(results).filter(v => typeof v === 'boolean').every(v => v);
  
  console.log('\n' + '='.repeat(50));
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED! RAG system is working correctly.');
  } else {
    console.log('⚠️ SOME TESTS FAILED. Check errors below:');
    results.errors.forEach(err => console.log(`   ❌ ${err}`));
    console.log('\n💡 See RAG_TESTING_GUIDE.md for troubleshooting steps.');
  }
  console.log('='.repeat(50) + '\n');
  
  return results;
}

// Quick test functions
async function testUploadFlow(file) {
  console.log('🧪 Testing upload flow with file:', file.name);
  
  const { extractPDFContent } = await import('./src/utils/pdfUtils.js');
  const { uploadProposalToCloud } = await import('./src/services/supabaseProposalService.js');
  
  // Extract text
  console.log('📄 Extracting text from PDF...');
  const { text, pageCount } = await extractPDFContent(file);
  console.log(`   ✅ Extracted ${text.length} chars, ${pageCount} pages`);
  
  // Upload
  console.log('📤 Uploading to cloud...');
  const result = await uploadProposalToCloud(file, text, pageCount);
  
  if (result.success) {
    console.log(`   ✅ Upload successful, ID: ${result.proposal.id}`);
    console.log('   ⏳ RAG processing started in background, wait 10-30 seconds...');
    
    // Poll for completion
    setTimeout(async () => {
      const { supabase } = await import('./src/services/supabaseClient.js');
      const { count } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('proposal_id', result.proposal.id);
      
      console.log(`   ${count > 0 ? '✅' : '❌'} Found ${count} chunks in database`);
    }, 15000);
    
    return result.proposal;
  } else {
    console.error('   ❌ Upload failed:', result.error);
    return null;
  }
}

async function checkDatabaseStatus() {
  const { supabase } = await import('./src/services/supabaseClient.js');
  
  // Get chunk count
  const { count: chunkCount } = await supabase
    .from('document_chunks')
    .select('*', { count: 'exact', head: true });
  
  // Get proposal stats
  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, file_name, chunk_count, embedding_status, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(10);
  
  console.log('📊 DATABASE STATUS');
  console.log('==================');
  console.log(`Total Chunks: ${chunkCount}`);
  console.log(`\nRecent Proposals:`);
  
  proposals?.forEach((p, i) => {
    console.log(`\n${i + 1}. ${p.file_name}`);
    console.log(`   ID: ${p.id}`);
    console.log(`   Chunks: ${p.chunk_count || 'NULL'}`);
    console.log(`   Status: ${p.embedding_status || 'NULL'}`);
    console.log(`   Date: ${new Date(p.uploaded_at).toLocaleString()}`);
  });
}

// Export functions for console use
window.testRAGSystem = testRAGSystem;
window.testUploadFlow = testUploadFlow;
window.checkDatabaseStatus = checkDatabaseStatus;

console.log('🧪 RAG Debug Script Loaded!');
console.log('');
console.log('Available commands:');
console.log('  await testRAGSystem()        - Run full test suite');
console.log('  await checkDatabaseStatus()  - Check current database state');
console.log('  await testUploadFlow(file)   - Test upload with a file');
console.log('');
console.log('Example:');
console.log('  await testRAGSystem()');
console.log('');
