import { WorkingMemoryDelta, workingMemoryDeltaSchema } from "@/lib/workingMemory";
import { NextRequest, NextResponse } from "next/server";

// --- NVIDIA NIM ---
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL_ID = "meta/llama-3.1-8b-instruct"; 
const API_KEY = process.env.NVIDIA_NEMOTRON_3_ULTRA_API_KEY!; // Ensure this is set in your environment variables
//previously tried: "nvidia/nemotron-3.5-lightning-30b-a3b" 
// "meta/llama-3.1-8b-instruct"

// import working memory store

export async function POST(req: NextRequest) {

    try {
        const { messages, WMSnapshot } = await req.json();
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
                        content: `You are extracting structured memory updates from a conversation. Your output is parsed as JSON and passed directly into JavaScript functions — it must strictly follow the required schema.

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
                        Return ONLY a raw JSON object. No markdown, no headers, no bullet points, no explanation text, no code fences. Your entire response must start with { and end with }.`,
                        //instructions for the model to follow, including the non-negotiable structure of the return statement
                    },
                    ...messages, // already in { role, content } format — no translation needed
                ],
                //nvext: { guided_json: workingMemoryDeltaSchema}, // sits alongside model/messages, no wrapper needed
                max_tokens: 500,
                temperature: 0.3,
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

