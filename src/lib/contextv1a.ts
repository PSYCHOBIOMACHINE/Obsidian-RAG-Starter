//@/lib/contextv1a.ts
// V1A ––––––––––––––––––––––––––––––––––––––––––––––––––––
// user query only-> embed -> supabase match chunks RPC function -> return query and chunks verbatim
import { supabase } from '@/lib/supabase'

// ––––– types –––––––––––––––––––––––––––––––––––––––––––––––
interface Row {
    source: string;
    topic: string;
    type: string;
    title: string;
    emtags: string[];
    chunk_index: number;
    content: string;
    similarity: number;
}

interface ContextResult {
    query: string;
    chunks: Row[];
}

// ––––– config –––––––––––––––––––––––––––––––––––––––––––––––
const EMBED_MODEL       = 'nvidia/llama-nemotron-embed-1b-v2'
const EMBED_URL         = 'https://integrate.api.nvidia.com/v1/embeddings'

// –– 2. Embed query ––––––––––––––––––––––––––––––––––––––––––––
async function EmbedQuery(query: string): Promise<number[]>{
    let embedding: number[] = [];

        const embed = await fetch(EMBED_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.NVIDIA_EMBED_API_KEY}`
        },
        body: JSON.stringify({
            model: EMBED_MODEL,
            input: query,
            input_type: 'query',
            encoding_format: 'float',
            dimensions: 2048,
        })

    });

    if (!embed.ok) {
        const err = await embed.text();
        throw new Error(`Embedding API error( ${embed.status}: ${err})`);
    }

    const data = await embed.json();
    embedding = await data.data[0].embedding; // return the embedding vector

    return embedding
}

//–– 1 MAIN OP ––––––––––––––––––––––––––––––––––––
// user query only -> embed -> supabase match chunks RPC function -> return query and chunks verbatim
export default async function ContextV1A(query: string): Promise<ContextResult> {
//    let nocontext: context = 'no context; fucked up somewhere'; 
    
    // –– 1.1 embed query –––––––––––––––––––––––––––
    let embedding: number[] = []; // so far designed to only work with queries. messages ignored for now. 
    try {
        embedding = await EmbedQuery(query);
     } catch (error) {
        console.error(`\n\n ?? ._. ?? \nEmbedding failed: ${error}`)
        return { query, chunks: [] }
     }
    // at this point should have an embedding vector, 
    // time for a Supabase RPC function

    // –– 1.2 supabase RPC function: match_chunks –––––––––––––––––––––––
    const { data, error } = await supabase.rpc('match_chunks',{
        query_embedding: embedding,
        match_count: 3,
    })
    if (error) {
        console.error(` ?? ._. ?? \n RPC match_chunks failed: ${error.message}`)
    }

    console.log(` DATA FROM RPC match_chunks: \n\n ${JSON.stringify(data, null, 2)}`)
return { query, chunks: (data as Row[]) ?? [] }
//return { query, chunks: data ?? [] }


}