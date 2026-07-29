// @/scripts/ingest.ts
//
// Standalone ingestion pipeline for the E-PFC vault.
// Run with: pnpm tsx scripts/ingest.ts
//
// For each .md, .pdf, and .canvas file in vault/:
//   1. Parse raw text
//   2. Extract metadata (type, title, topic) from frontmatter or sidecar
//   3. Chunk into ~1000-token blocks
//   4. Delete existing Supabase rows for this source (idempotent)
//   5. Embed all chunks in one NVIDIA NIM API call (input_type: "passage")
//   6. Insert rows into vault_chunks

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { PDFParse } from 'pdf-parse'
import matter from 'gray-matter'
import * as dotenv from 'dotenv'
// Do not import the pre-instantiated `supabase` client from `lib/supabase` here
// because that module may read `process.env` at import time before dotenv
// has loaded `.env.local`. We'll instantiate the client after calling
// `dotenv.config()` so the env vars are available.
import { countLlamaTokens, countLlamaTokensBatch } from '@/lib/tokenizer'


// ─── Supabase client ──────────────────────────────────────────────────────────
// Instantiate Supabase client after dotenv loads env vars

dotenv.config({ path: '.env.local' })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

// ─── Config ───────────────────────────────────────────────────────────────────
// absolute path to obsidian vault on machine, or path to pulled vault in project root. I realized you can skip github entirely
const VAULT_DIR         = path.resolve('./your-path-to-vault-here')
const EMBED_MODEL       = 'nvidia/llama-nemotron-embed-1b-v2'
const EMBED_URL         = 'https://integrate.api.nvidia.com/v1/embeddings'


// ─── Types ────────────────────────────────────────────────────────────────────

interface ChunkMetadata {
  source: string   // relative path from vault/ e.g. cognitiveneuroscience/neuroanatomy/prefrontalcortex/notes/dlpfc.md
  topic:  string   // parent directory of source  e.g. cognitiveneuroscience/neuroanatomy/prefrontalcortex/notes
  type:   string   // soft vocabulary — declared in frontmatter or sidecar, defaults to "untyped"
  title:  string   // human-readable title
  emtags:  string[]  // semantic concept tags from 'emtags' custom frontmatter property

}

// ─── 1. Vault walker ─────────────────────────────────────────────────────────

function walkVault(dir: string): string[] {
  const filesArr: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip sidecar directories — meta/ folders are metadata, not content
      if (entry.name === 'meta') continue
      filesArr.push(...walkVault(fullPath)) 
      // recursion: passes latest path to walkVault until it gets to a non dir file. then pushes to the inner filesArr and movees on to the next entry. when an entire directory is walked, the filesArr is pushed to the filesArr of the previous recursion level and so on until it gets to the top level.
      // this recursion process creates a tree-like traversal  

    } else {
      const ext = path.extname(entry.name).toLowerCase()
      if (['.md', '.pdf', '.canvas'].includes(ext)) {
        filesArr.push(fullPath) // only supports these file types for now
      }
    }
  }

  return filesArr
} // end of 1. vault walker

// ─── 2. Parsers ───────────────────────────────────────────────────────────────

// .md — parse frontmatter, return body text and metadata
function parseMd(filePath: string): { text: string; type: string; title: string; emtags: string[] } {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)

  return { 
    text: content.trim(), 
    type: data.type ?? '', 
    title: data.title ?? 'untitled', 
    emtags: data.emtags ?? [],
  }
}

// // pdf.md — parse sidecar frontmatter, return metadata
// function parseSidecar(sideCar: string): { type: string; title: string } {
//   const raw = fs.readFileSync(sideCar, 'utf-8')
//   const { data } = matter(raw)

//   return { 
//     type: data.type ?? 'literature', 
//     title: data.title ?? '' 
//   }
// }

// .canvas — extract text nodes from Obsidian canvas JSON
// TODO: optimize for node-edge relationships
function parseCanvas(filePath: string): { text: string; type: string; title: string; emtags: string[] } {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const json = JSON.parse(raw)

  // Canvas files may have a frontmatter-style header node or not
  // Fall back to extracting all text nodes and joining
  const text = (json.nodes ?? [])
    .filter((n: any) => typeof n.text === 'string' && n.text.trim() && !n.text.trim().startsWith('```yaml'))
    .map((n: any) => n.text.trim())
    .join('\n\n')

  // Canvas files can optionally declare type/title in a dedicated metadata node
  // Convention: a node with id "meta" contains YAML frontmatter as text
  const metaNode = (json.nodes ?? []).find((n: any) => typeof n.text === 'string' && n.text.trim().startsWith('```yaml'));
  let type = '';
  let title = path.basename(filePath, '.canvas');
  let emtags: string[] = [];

  if (metaNode?.text) {
    try {
      const inner = metaNode.text.trim().replace(/^```yaml\n/,'').replace(/\n```$/,'')
      const { data } = matter(`---\n${inner}\n---`)
      type  = data.type  ?? type
      title = data.title ?? title
      emtags = data.emtags ?? emtags
    } catch {
      // malformed meta node — use defaults
    }
  }

  return { text, type, title, emtags }
}

// .pdf — parse text and read sidecar metadata from meta/ subdirectory
async function parsePdf(filePath: string): Promise<{ text: string; type: string; title: string; emtags: string[] }> {
  const buffer = fs.readFileSync(filePath)
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  const text = result.text.trim()

  // Sidecar lives at: <same-dir>/meta/<filename>.meta.md
  const dir      = path.dirname(filePath)
  const basename = path.basename(filePath, '.pdf')
  const sidecar  = path.join(dir, 'meta', `${basename}.meta.md`)

  let type  = 'literature'  // sensible default for anything in papers/
  let title = basename      // filename as fallback if no sidecar
  let emtags: string[] = [] // empty array if no sidecar

  if (fs.existsSync(sidecar)) {
    try {
      // ({ type, title } = parseSidecar(sidecar))
      const meta = parseMd(sidecar)
      type  = meta.type  || type
      title = meta.title || title
      emtags = meta.emtags || emtags
    } catch {
      console.warn(`  ⚠ Could not parse sidecar: ${sidecar}`)
    }
  } else {
    console.warn(`  ⚠ No sidecar found for ${path.basename(filePath)} — using defaults`)
  }

  return { text, type, title, emtags }
} // end of 2. parsers


// ─── 3. Chunker ───────────────────────────────────────────────────────────────

// Number of sentences carried forward from chunk N into chunk N+1.
// Increase for more context continuity, decrease to reduce redundancy.
const OVERLAP_SENTENCES = 3

// chunkText
async function chunkText(text: string, title: string, type: string, emtags: string[]): Promise<string[]> {  
  
  // ── 3.1 Split text into sentences ──────────────────────────────────────────────
  // Splits after . ! ? followed by whitespace and an uppercase letter.
  // The lookahead (?=\s+[A-Z]) keeps the capital letter in the next sentence
  // rather than consuming it. Filters empty strings.
  const sentences: string[] = text
    .split(/(?<=[.!?])(?=\s+)/)
    .map(s => s.trim())
    .filter(Boolean)
    
  // ── 3.2 create metadata header ──────────────────────────────────────────────
  const header: string = `title:${title}, type:${type}, tags:${emtags.join(',')};`;

  // ── 3.3 Accumulators ──────────────────────────────────────────────────────
  const chunks: string[] = [];    // final output per document
  let currentChunk: string[] = [];     // sentences staging the current chunk
  const tokenBudget: number = 2000; // max is 8196
  let tokensCount: number = 0; 
  let lastThree: string[] = [];
  let sumLastThreeTokens: number = 0; 
  let chunkBatchTokenIndexes: number[] = []; // collects token amounts in array for pulling last three

	// –– 3.4 ––– get tokens for header and sentences –––––––––––––––––––––––––––
	// pass header and sentences into async tokenizer function and return tokensArr
	let tokensHeader: number = await countLlamaTokens(header)
	let tokensBatch: number[] = await countLlamaTokensBatch(sentences) //token count for every sentence
	
	// ––3.5 ––– helpers ––––––––––––––––––––––––––––––––––––––––––––––––––––––
	// –– start chunk by prepending header and adjusting token budget ––
	function startChunk(){
	  currentChunk.push(header);
	  currentChunk.push(...lastThree); // something or no effect
	  tokensCount += tokensHeader;
	  tokensCount += sumLastThreeTokens; // number or 0
	}
	// –– clear chunk ––––––––––––––––––––––––––––––––––––––––––––––––––––––
	function clearChunk(){
	  currentChunk = [];
	  tokensCount = 0;
	  //chunkBatchTokenIndexes = [];
	}
	
	//–– 3.6 –– accumulate sentences into chunks –––––––––––––––––––––––––––––––––––
	
	for (let i = 0; i < sentences.length; i++) {
	
	  if (tokensBatch[i] > tokenBudget) {
      console.warn(`  ?? ._. ?? Sentence ${i} exceeds token budget (${tokensBatch[i]} tokens) — skipping`);
      continue;
    }
    if (!currentChunk.length) { startChunk() }

    if (tokensBatch[i] + tokensCount <= tokenBudget) {
      currentChunk.push(sentences[i]);
      tokensCount += tokensBatch[i];
      chunkBatchTokenIndexes.push(tokensBatch[i]);
    } else {
      lastThree = currentChunk.slice(-OVERLAP_SENTENCES);
      sumLastThreeTokens = chunkBatchTokenIndexes.slice(-OVERLAP_SENTENCES)
      .reduce((total, current) => total + current, 0);

      chunks.push(currentChunk.join(' '));

      chunkBatchTokenIndexes = chunkBatchTokenIndexes.slice(-OVERLAP_SENTENCES);
      clearChunk();
      startChunk();

      currentChunk.push(sentences[i]);
      tokensCount += tokensBatch[i];
      chunkBatchTokenIndexes.push(tokensBatch[i]);
    } 
  }
	
  // ── 3.7 Final flush ───────────────────────────────────────────────────────
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '))
  }

  return chunks
} 
// ───────────── end of 3. chunker ––––––––––––––––––––––––––––––––––––––––––––

// ─── 4. Embedder ─────────────────────────────────────────────────────────────

// Batches all chunks from a single file into one API call.
// embedChunks
// IN:  string[] — array of text chunks from chunkText
//      e.g. ["The dorsolateral prefrontal cortex...", "Working memory capacity..."]
// OUT: Promise<number[][]> — array of 1024-dimension embedding vectors
//      e.g. [[0.023, -0.817, ...1024 values], [0.104, 0.293, ...1024 values],...]
// FROM: ingest() main loop, once per file
// TO:   ingest() main loop, zipped with chunks[] to build Supabase rows

async function embedChunks(chunks: string[]): Promise<number[][]> {

  // ── 4.1 POST all chunks to NVIDIA NIM in a single batch request ───────────
  const response = await fetch(EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NVIDIA_EMBED_API_KEY}`,
    },
    body: JSON.stringify({
      model:           EMBED_MODEL,
      input:           chunks,         // entire string[] sent as one batch
      input_type:      'passage',      // required at ingest — tells model these are documents being stored
      encoding_format: 'float', 
      dimensions:      2048,       // raw floats, not base64
    }),
  })

  // ── 4.2 Guard against API errors ──────────────────────────────────────────
  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Embedding API error (${response.status}): ${err}`)
  }

  // ── 4.3 Extract embedding vectors from response ───────────────────────────
  // data returned from fetch looks like:
  // {
  //   data: [
  //    { index: 0, embedding: [0.023, -0.817, ... ] },  // 2048 floats
  //    { index: 1, embedding: [0.104,  0.293, ... ] },
  //     one entry per chunk
  //    ]
  //  }

  // return from embedder functionlooks like:
  // [
  //   [0.023, -0.817, 0.441, ...],   // 2048 floats for chunk 0
  //   [0.104,  0.293, 0.009, ...],   // 2048 floats for chunk 1
  //   [-0.312, 0.551, 0.873, ...],   // 2048 floats for chunk 2
  //  ...]
  
  const data = await response.json()
  return data.data.map((item: any) => item.embedding)
} // end of 4. embedder

// ─── 5. MAIN ─────────────────────────────────────────────────────────────────
// THIS IS THE MAIN FUNCTION — everything starts here. It orchestrates the entire pipeline:
// THE ABOVE FUNCTIONS ARE PLUGGED IN
// IN:  nothing — reads vault/ from disk, env vars from .env.local
// OUT: nothing — side effect only: writes rows to Supabase vault_chunks table
async function ingest() {

  // ── 5.1 Walk vault ────────────────────────────────────────────────────────
  const files = walkVault(VAULT_DIR) //returns filesArr: string[]
  console.log(`\nFound ${files.length} file(s) in vault/\n`)

  if (files.length === 0) {
    console.log('Nothing to ingest. Add files to vault/ and re-run.')
    return
  }

  let totalChunks   = 0
  let skippedFiles  = 0
  // ── 5.2 Process each file : parse -> chunk -> delete stale-> embed-> insert rows ────────────
  for (const filePath of files) {
    const source = path.relative(VAULT_DIR, filePath)
    const topic  = path.dirname(source)  // full relative directory path — encodes knowledge hierarchy
    const ext    = path.extname(filePath).toLowerCase()

    console.log(` 5.2 ━━ running parse, chunk, embed, delete on ${source} `)

    // ── 5.2.1 Parse ────────────────────────────────────────────────────────────────
    let text: string
    let type: string
    let title: string
    let emtags: string[] = []

    try {
      if (ext === '.md') {
        ({ text, type, title, emtags } = parseMd(filePath))
      } else if (ext === '.canvas') {
        ({ text, type, title, emtags } = parseCanvas(filePath))
      } else if (ext === '.pdf') {
        ({ text, type, title, emtags } = await parsePdf(filePath))
      } else {
        console.log(`  >:| Unsupported file type: ${ext} — skipping\n`)
        skippedFiles++
        continue //skips unsupported file types
      }
    } catch (err) {
      console.error(`  :( Parse failed: ${err}\n`)
      skippedFiles++
      continue
    }

    if (!text.trim()) {
      console.log(`  :/ No text extracted — skipping\n`)
      skippedFiles++
      continue
    }

    console.log(`  topic: ${topic}`)
    console.log(`  type:  ${type}`)
    console.log(`  title: ${title}`)

    // ── 5.2.2 Chunk ────────────────────────────────────────────────────────────────
    const chunks = await chunkText(text, title, type, emtags)
    
    console.log(`  chunks: ${chunks.length}`)



    // ── 5.2.3 Embed ────────────────────────────────────────────────────────────────
    let embeddings: number[][]
    try {
      embeddings = await embedChunks(chunks)
    } catch (err) {
      console.error(`  :( Embedding failed: ${err}\n`)
      skippedFiles++
      continue
    }

    // ── 5.2.4 Build rows for Supabase insert ───────────────────────────────────────
    const rows = chunks.map((content, i) => ({
      source,
      topic, // dont think I care about 'topic' anymore
      emtags,
      type,
      title,
      content, // chunk from chunks
      chunk_index: i,
      embedding: embeddings[i],
    }));
    
    if (rows) {
      console.log(`  :D Prepared ${source}: ${rows.length} row(s) for insert`)
    }

    // ── 5.2.5 Delete stale rows ────────────────────────────────────────────────────
    const { error: deleteError } = await supabase
      .from('vault_chunks')
      .delete()
      .eq('source', source)

    if (deleteError) {
      console.error(`  :( Delete failed: ${deleteError.message}\n`)
      skippedFiles++
      continue
    }

    // ── 5.2.6 Insert ───────────────────────────────────────────────────────────────
    // Each row represents one chunk. emtags is the same string[] on every row —
    // tags are a file-level property, not a per-chunk one.
    //
    // rows shape:
    // [
    //   { source: 'notes/dlpfc.md', topic: 'notes', type: 'observation',
    //     title: 'dlPFC Notes', emtags: ['working memory', 'dlPFC'],
    //     chunk_index: 0, content: '...text...', embedding: [0.023, -0.817, ...] },
    //   { ...same metadata, chunk_index: 1, content: '...next chunk...', embedding: [...] },
    //   ...
    // ]
    //

    const { error: insertError } = await supabase //insert rows into vault_chunks table, return error if fails
      .from('vault_chunks')
      .insert(rows)

    if (insertError) {
      console.error(`  :( Insert failed: ${insertError.message}\n`)
      skippedFiles++
      continue
    }

    console.log(`  :D Inserted ${rows.length} chunk(s)\n`)
    totalChunks += rows.length
  }

  // ── 5.2.7 Summary ──────────────────────────────────────────────────────────────
  console.log('–––––––––––––––––––––––––––––––––')
  console.log(`Ingestion complete.`)
  console.log(`  Files processed: ${files.length - skippedFiles}/${files.length}`)
  console.log(`  Total chunks:    ${totalChunks}`)
  if (skippedFiles > 0) {
    console.log(`  Skipped:         ${skippedFiles} (see errors above)`)
  }
  console.log('–––––––––––––––––––––––––––––––––\n')
}

ingest().catch(err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})

