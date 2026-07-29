//@/lib/tokenizer
import { AutoTokenizer, env } from '@huggingface/transformers';


//Tell the library to cache files locally 
env.useFSCache = true; 

let tokenizerInstance: any = null; //await autotokenizer... or null

async function getLlamaTokenizer() {
  if (!tokenizerInstance) {
    // This loads only the vocabulary configuration metadata (~1-2MB), NOT the actual model weights.
    tokenizerInstance = await AutoTokenizer.from_pretrained('nvidia/llama-nemotron-embed-1b-v2');
  }
  return tokenizerInstance; //returns tokenizer instance
}

// receives single string, returns number of tokens
export async function countLlamaTokens(text: string): Promise<number> {
  try {
    const tokenizer = await getLlamaTokenizer();
    const tokenIds = await tokenizer.encode(text);
    
    // Returns the exact array length (tokens count) matching llama-nemotron-embed-1b-v2
    return tokenIds.length; 
  } catch (error) {
    console.error("Tokenization error:", error);
    throw error;
  }
}

//uses Promise.all to process countLlamaTokens on every sentence in a document, returns array of token counts, indexing preserved
export async function countLlamaTokensBatch(sentences: string[]): Promise<number[]>{
	
	try{
		  const tokenizer = await getLlamaTokenizer();
		  
		  const countPromises = sentences.map(async (sentence)=>{
		    const tokenIds = await tokenizer.encode(sentence);
		    
		    return tokenIds.length;
		  });
		  return await Promise.all(countPromises)
	//sequential, but technically works

	//	let tokensArr: number[] = [];
				
	//	for (const sentence of sentences) {
			// run countLlamaTokens on sentence
	//		const count = await countLlamaTokens(sentence);
	//		tokensArr.push(count);
			
	//	}
	//	return tokensArr
	} catch (error) {
		console.error("Batch tokenization error:", error);
		throw error;
	}
}
