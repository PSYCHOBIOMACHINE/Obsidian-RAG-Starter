// import { GoogleGenAI } from "@google/genai";
import ContextV1A from "@/lib/contextv1a";
import { NextRequest, NextResponse } from "next/server";

// --- NVIDIA NIM ---
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";


export async function POST(req: NextRequest) {

    try {
        const { messages } = await req.json();
        // messages is an array of objects with { role: "user" | "assistant", content: string }
        console.log("route.ts POST received:\n\n", JSON.stringify(messages, null, 2));
        if (!messages || messages.length === 0) {
            return NextResponse.json({ error: "No messages provided" }, { status: 400 });
        }

        const userMessage = messages[messages.length - 1].content;

        // retrieve context and pass it to the fetch call below
        const { chunks } = await ContextV1A(userMessage);

        const chunkContent = chunks.map(chunk => chunk.content).join("\n\n");
        const context = `use this retrieved context to answer the query: ${chunkContent}, and in your response include "I DEFINITELY RECEIVED THE RETRIEVED CONTEXT for: ${userMessage}" at the end of the response."`;
        console.log(`\n\n THIS IS CONTEXT \n\n ${context}`)

        const response = await fetch(NVIDIA_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.NVIDIA_META_LLAMA3_70B_API_KEY!}`,
            },
            body: JSON.stringify({
                model: "meta/llama-3.1-70b-instruct",
                messages: [
                    {
                        role: "system",
                        content: `"You are a concise assistant. Keep responses to 3-5 sentences unless the user explicitly asks for more detail. Use plain markdown: headers, basic text, numbered lists, and bullet points are fine. Finish every response with 'REMEMBER TO UPDATE THE SYSTEM PROMPT FOR A PERSONALIZED CHAT EXPERIENCE; '", ${context}`,
                    },
                    ...messages, // already in { role, content } format — no translation needed
                ],
                max_tokens: 1024,
                temperature: 0.7,
            }),
        });

        const data = await response.json();

        // Guard: surface NVIDIA errors cleanly
        if (!response.ok) {
            console.error("NVIDIA error:", data);
            return NextResponse.json({ error: "Model call failed" }, { status: 500 });
        }

        const reply = data.choices[0].message.content;
        return NextResponse.json({ reply });

    } catch (error) {
        console.error("NVIDIA error:", error);
        return NextResponse.json({ error: "Model call failed" }, { status: 500 });
    }
}

