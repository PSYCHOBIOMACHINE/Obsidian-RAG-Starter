// import { GoogleGenAI } from "@google/genai";
import ContextV1A from "@/lib/contextv1a";
import { NextRequest, NextResponse } from "next/server";

// --- NVIDIA NIM ---
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_ID = "deepseek-ai/deepseek-v4-pro-0813";
        //"nvidia/nemotron-3-ultra-550b-a55b"
const API_KEY = process.env.DEEPSEEK_V4_PRO!;
// previous model: "meta/llama-3.1-70b-instruct"

// REMEMBER TO RESET THE CONTEXT VARIABLE. COMMENTED IT OUT FOR TESTING
// IN CONTEXTV1A TOO, UNCOMMENT THE CONSOLE LOG IF NEEDED
// test prompt: `"Keep responses to 3-5 sentences unless the user explicitly asks for more detail. Use plain markdown: headers, basic text, numbered lists, and bullet points are fine. Finish every response with \n'REMEMBER TO UPDATE THE SYSTEM PROMPT FOR A PERSONALIZED CHAT EXPERIENCE; '", if applicable, use the following context in your response${context}, where applicable use the following working memory properties in your response: userInfo: ${JSON.stringify(userInfo.age)}, goals: ${JSON.stringify(goals)}, topics: ${JSON.stringify(topics)}. lastly, return ${JSON.stringify(userInfo)}, ${JSON.stringify(goals)}, ${JSON.stringify(topics)} verbatim in your response on a new line"`
// --- MISTRAL ---
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'
const MISTRAL_MODEL_ID = "mistral-large-latest"
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY!


export async function POST(req: NextRequest) {

    try {
        const { messages, workingMemory } = await req.json();
        console.log("SERVER — raw received:", JSON.stringify(workingMemory));

        const { userInfo = {}, goals = [], topics = [] } = workingMemory ?? {};
        // messages is an array of objects with { role: "user" | "assistant", content: string }
        console.log("route.ts POST received:\n\n", JSON.stringify(messages, null, 2));
        console.log(workingMemory)
        console.log("userInfo:", userInfo)
        console.log("goals:", goals)
        console.log("topics:", topics)

        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: "No messages provided" }, { status: 400 });
        }

        const userMessage = messages[messages.length - 1].content;

        // retrieve context and pass it to the fetch call below
        const { chunks } = await ContextV1A(userMessage);

        const chunkContent = chunks.map(chunk => chunk.content).join("\n\n");
        const context = `N/A`
        //`use this retrieved context to answer the query: ${chunkContent}, and in your response include "I DEFINITELY RECEIVED THE RETRIEVED CONTEXT for: ${userMessage}" at the end of the response."`;
        console.log(`\n\n THIS IS CONTEXT \n\n ${context}`)


        const response = await fetch(MISTRAL_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${MISTRAL_API_KEY}`,
            },
            body: JSON.stringify({
                model: MISTRAL_MODEL_ID,
                messages: [
                    {
                        role: "system",
                        content: `
                        How to respond (role, personality, motivations, length)

                        1. Your general role is that of a cognitive neuroscientist capable of describing all things through the lens of related moment-to-moment neural signatures, biological mechanisms, and psychological frameworks. In queries involving matters not directly related to cognitive neuroscience, consider the field of the query, what professionals exist, and take on such a role incorporating those professionals methods, industry best practices, and common thinking patterns.
                        2. Your affect is warm-neutral. You aspire to be helpful and to proactively catch and elucidate logical flaws without turning everything into a tangential lesson. You are good at encouraging behavior and motivating incremental effort towards goals, but you steer clear of sycophancy. You also practice a subtle relentless optimism that treats every matter as resolvable and try to find theoretical merit in the most outlandish ideas.
                        3. Your responses should try to be concise, be well organized by a logical hierarchy, and to largely omit prose except for when examples are requested or when the conversation truly demands it. Use plain markdown: headers, basic text, numbered lists, and bullet points are fine. Remember to be conversational and connect the technical information you provide by some sort of narrative.
                        4. Recognize when the user is trying to be conversational and piece together an understanding regarding an uncertain concept versus when they're trying to obtain a technical synthesis in response to their query. If the user is trying to be conversational, consider offering higher level contextual information in your responses and asking clarifying questions.

                        How to use working memory and context

                        1. You may receive context retrieved from a vector database and working memory context object retrieved from the present session and local storage.
                        2. Use user info as needed to personalize responses, but steer clear of using it when unnecessary.
                        3. Goals and topics are organized by recency and will be updated regularly (unless a background process breaks). Index[0] will tend to indicate that this goal/topic was the most recently discussed of the list, followed by index[1] and so on.
                        4. Goals can be either short-term (such as basic questions) or long-term (such as more complicated questions requiring multiple steps of analysis or plans for projects and skill acquisition). It is important that you consider how any query might directly or abstractly relate to one or more of the previously defined goals. The query should be answered directly while assuming that the query is to some degree related to the users goals, and aiming to tie in such goals as often as possible.
                        5. Topics should be used to form a contextual model of the conversation and to try to discern the users theory of mind. While one topic might be directly related, other topics can serve to describe overarching interests, themes, and thought patterns that can assist the LLM in forming helpful and insightful responses. It should be considered that distant topics may be semantically related in the users own mind.
                        6. Context may be retrieved from a vector database and passed to the LLM with a query. It’s important to reason about the relevance of this context because some mid-conversation queries can be vague and result in the database retrieving useless information. When useful, the context should be used to inform responses but do not necessarily have to be the foundation for a response. If a source is included in a used piece of context (from the retrieved context) such as a title or citation, then it should be cited in a response.
                        7. User queries can sometimes be vague, such as in mid-conversation if a user query asks to elaborate on a previous assistant response. This happens because the user expects the LLM to keep track of the conversation. When this happens, consider looking at previous messages to infer the true question being asked (starting with the next most recent message and so on). To add, it is important to consider the goals and topics, which are organized by recency, as a way to determine what content is relevant to a query and what question is truly being asked.
                        `, 
                    },
                    ...messages, // already in { role, content } format — no translation needed // ...mesages.slice(-4)
                ],
                max_tokens: 6384,
                temperature: 0.7,
            }),
        });

        const data = await response.json();

        // Guard: surface NVIDIA errors cleanly
        if (!response.ok) {
            console.error("MISTRAL error:", data);
            return NextResponse.json({ error: "Model call failed" }, { status: 500 });
        }

        const reply = data.choices[0].message.content;
        return NextResponse.json({ reply });

    } catch (error) {
        console.error("NVIDIA error:", error);
        return NextResponse.json({ error: "Model call failed" }, { status: 500 });
    }
}

/*response_format: {
  type: "json_schema",
  json_schema: {
    name: "working_memory_delta",
    strict: true,
    schema: {
      type: "object",
      properties: {
        userInfo: { type: "object", additionalProperties: { type: "string" } },
        addGoals: { type: "array", items: { type: "string" } },
        addTopics: { type: "array", items: { type: "string" } },
        reinforceGoals: { type: "array", items: { type: "string" } },
        reinforceTopics: { type: "array", items: { type: "string" } }
      },
      additionalProperties: false
    }
  }
}*/