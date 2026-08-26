import { Message } from "@/app/page";
import { WorkingMemoryDelta, workingMemoryDeltaSchema } from "@/lib/workingMemory";
import { NextRequest, NextResponse } from "next/server";

// --- NVIDIA NIM ---
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_ID = "nvidia/nemotron-3.5-lightning-30b-a3b"; 
const API_KEY = process.env.NVIDIA_LIGHTNING_API_KEY!; // Ensure this is set in your environment variables
//previously tried: "nvidia/nemotron-3.5-lightning-30b-a3b" 
// "meta/llama-3.1-8b-instruct"

// import working memory store

export async function POST(req: NextRequest) {

    try {
        const { messages, WMSnapshot } = await req.json();
        const userMessage: Message = messages[messages.length - 1].content;

        const { userInfo = {}, goals = [], topics = [] } = WMSnapshot ?? {};


        // messages is an array of objects with { role: "user" | "assistant", content: string }
        console.log("route.ts bg-POST received:\n\n", JSON.stringify(messages, null, 2));
        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: "No messages provided" }, { status: 400 });
        }

        const prompt = `You are extracting structured memory updates from a conversation. Your output is parsed as JSON and passed directly into JavaScript functions — it must strictly follow the required schema.

        CURRENT STATE:
        userInfo: ${JSON.stringify(userInfo)}
        goals: ${JSON.stringify(goals)}
        topics: ${JSON.stringify(topics)}

        TASK — two parts:

        1. NEW INFORMATION: Review the message history and the current state above. Identify any new user information, goals, or topics that should be captured.
        - userInfo: an object of descriptive user properties (name, preferences, etc.)
        - goals: short-term or long-term desired outcomes. Optionally include what's being done toward them.
        - topics: subjects the user is engaged with, scoped so a downstream LLM is primed with useful context.
        - Every goal/topic string must be one sentence, dense with context — like a research paper title that fully scopes a finding, not a vague label.
        - Before adding a new goal or topic, check it against the CURRENT STATE lists above. If it's a restatement or close match of something already there, treat it as reinforcement (see part 2), not a new entry — avoid near-duplicates.

        2. REINFORCEMENT: Check whether the most recent message(s) bring any existing goal or topic back into relevance — including paraphrased restatements, not just exact repeats. If so, return that existing entry **verbatim, exactly as it appears above** in reinforceGoals/reinforceTopics.

        OUTPUT:
        - New user info → userInfo
        - New goals/topics → addGoals / addTopics
        - Existing goals/topics brought back into scope → reinforceGoals / reinforceTopics (verbatim)
        - Omit any field entirely if there's nothing to report for it — do not return empty arrays.
        - Do not invent or infer information not actually present in the conversation.
        
        OUTPUT FORMAT — CRITICAL:
        Return ONLY a raw JSON object. No markdown, no headers, no bullet points, no explanation text, no code fences. Your entire response must start with { and end with }.`;
        ;
   

        const response = await fetch(NVIDIA_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                model: `${MODEL_ID}`,
                messages: [
                    {
                        role: "system",
                        content: `You are extracting structured memory updates from a conversation. You are part of a background process for updating the working memory object, which tracks user information, goals, and topics so the app can maintain context and keep it organized by recency. Your output is parsed as JSON and passed directly into JavaScript functions — it must strictly follow the required schema.

                        Object properties
                        1. userInfo — an object of basic descriptive string information about the user, such as their name or age.
                        2. goals — a string array where each string is a well-scoped goal, descriptive as a scientific title and up to one sentence in length. Goals are explicitly outcome-oriented and can describe short-term inquiries, long-term thesis questions, project plans, or skill-acquisition plans. Optionally include what effort is being contributed toward them.
                        3. topics — a string array where each string is a well-scoped topic, descriptive as a scientific title, up to 15 words. A single bare noun or noun phrase is never an acceptable topic, even if it seems like the obvious label — always expand it into the specific angle or relationship being discussed.

                            Examples:
                            - Conversation mentions the hippocampus and CA1/CA3 subfields →
                                BAD:  "Neuroanatomy", "Brain regions", "CA3-CA1 interactions"
                                GOOD: "Hippocampal subfield connectivity, focusing on CA3-to-CA1 signal propagation"
                            - Conversation mentions social memory and CA2 →
                                BAD:  "Social memory", "CA2 function"
                                GOOD: "CA2's distinct plasticity profile and its role in social memory encoding"
                            - Conversation mentions dopamine and motivation →
                                BAD:  "Dopamine", "Motivation"
                                GOOD: "Dopaminergic modulation of goal-directed motivation and task initiation"

                        CURRENT STATE:
                        userInfo: ${JSON.stringify(userInfo)}
                        goals: ${JSON.stringify(goals)}
                        topics: ${JSON.stringify(topics)}

                        Task
                        1. Interpret the most recent query in the conversation, and the previous assistant response and previous messages if nothing descriptive is declared in the recent query, to identify any new user information, goals, or topics.
                        2. Compare each identified item to the CURRENT STATE above.
                        3. If it matches an existing entry (including paraphrased restatements, not just exact repeats):
                            1. matching userInfo → do nothing.
                            2. matching goals → add the existing goal, verbatim, to \`reinforceGoals\`.
                            3. matching topics → add the existing topic, verbatim, to \`reinforceTopics\`.
                        4. If it is new:
                            1. new userInfo → add the new key:value pair(s) to a \`userInfo\` object.
                            2. new goals → add each to an \`addGoals\` string array.
                            3. new topics → add each to an \`addTopics\` string array.
                        5. Only include the fields you actually have content for (\`userInfo\`, \`addGoals\`, \`addTopics\`, \`reinforceGoals\`, \`reinforceTopics\`) — never restate \`userInfo\`, \`goals\`, or \`topics\` from CURRENT STATE. If none of those fields have anything to report, output exactly \`{}\`.

                        Additional Output rules
                        - Return ONLY a raw JSON object. No markdown, no headers, no bullet points, no explanation text, no code fences. Your entire response must start with { and end with }.`,
                        //instructions for the model to follow, including the non-negotiable structure of the return statement
                    },
                    ...messages, // already in { role, content } format — no translation needed
                    // maybe dont include all of the messages. even one long assistant message breaks the model sometimes
                ],
                //nvext: { guided_json: workingMemoryDeltaSchema}, // sits alongside model/messages, no wrapper needed
                max_tokens: 4000, // account for reasoning budget
                top_p: 0.95, //recommended on model card
                temperature: 1, //recommended on model card
                reasoning_budget: 3000, //this comes out of max token budget
                chat_template_kwargs: {"enable_thinking":true},
                stream: false,
            }),
        });
        const rawText = await response.text();
        console.log("RAW NVIDIA RESPONSE:", rawText);

        let data;
        try {
        data = JSON.parse(rawText);
        console.log("MODEL OUTPUT (full):", data.choices[0].message.content);
        } catch (parseErr) {
        console.error("Failed to parse NVIDIA response as JSON:", parseErr);
        return NextResponse.json({ error: "Invalid response from NVIDIA" }, { status: 502 });
        }
        // const data = await response.json();

        // Guard: surface NVIDIA errors cleanly
        if (!response.ok) {
            console.error("NVIDIA error:", data);
            return NextResponse.json({ error: "Model call failed" }, { status: 500 });
        }
        
        // Robust parsing: try direct parse, fall back to extracting the first {...} block
        function extractDelta(raw: string): WorkingMemoryDelta | null {
            try {
                return JSON.parse(raw);
            } catch {
                const match = raw.match(/\{[\s\S]*\}/); // first {...} block, greedy
                if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch {
                    return null;
                }
                }
                return null;
            }
        }

        const deltas = extractDelta(data.choices[0].message.content);
        // const deltas = JSON.parse(data.choices[0].message.content);
        console.log(deltas);
        if (!deltas) {
        console.error("Could not extract valid JSON from model output:", data.choices[0].message.content);
        return NextResponse.json({ error: "bg-Model did not return valid JSON" }, { status: 502 });
        }

        return NextResponse.json(deltas);

    } catch (error) {
        console.error("NVIDIA error:", error);
        return NextResponse.json({ error: "bg-Model call failed" }, { status: 500 });
    }
}

