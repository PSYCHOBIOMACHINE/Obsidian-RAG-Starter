"use client";

import ContextV1A from "@/lib/contextv1a";
import { useState } from "react";
import ReactMarkdown from "react-markdown"
import { useWorkingMemoryStore } from "@/lib/zustand/workingMemoryStore";
import remarkGfm from "remark-gfm";

// Each message in the conversation has a role and text content
export type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function EPFCChat() {
  const [messages, setMessages] = useState<Message[]>([]); // all messages, both user and model
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const memory = useWorkingMemoryStore(($) => $.memory);
  const userInfo = useWorkingMemoryStore(($) => $.memory.userInfo);
  const goals = useWorkingMemoryStore(($) => $.memory.goals);
  const topics = useWorkingMemoryStore(($) => $.memory.topics);
  const findMemoryDelta = useWorkingMemoryStore(($) => $.findMemoryDelta);

  async function sendMessage() {
    if (!input.trim()) return;

    // Add the user's message to the visible chat immediately
    const userMessage: Message = { role: "user", content: input };
    const messagesWithUser = [...messages, userMessage];

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    console.log("CLIENT — raw store values:", userInfo, goals, topics);
    console.log("CLIENT — outgoing body:", JSON.stringify({ workingMemory: { userInfo, goals, topics }, messages: [...messages, userMessage] }));
    // POST to our route.ts API — the route handles the actual NVIDIA call
    const res = await fetch("/api/epfc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        workingMemory: { userInfo: userInfo, goals: goals, topics: topics }, // added this 
        messages: [...messages, userMessage] 
      }), // this makes me think the last two items in this array are 'userMessage'. setMessages is called appending userMessage, and then the fetch request adds another copy of userMessage to the array
    });

    const data = await res.json();
    console.log(data)

    // Add the model's reply to the chat
    const assistantMessage: Message = {
      role: "assistant",
      content: data.reply ?? "Something went wrong.",
    };
    const finalMessages = [...messagesWithUser, assistantMessage];
    findMemoryDelta(messagesWithUser) // runs llm call, updates working memory store
    setMessages(finalMessages);
    setLoading(false);

  }

  return (
    <div className="flex-1" style={{ maxWidth: 700, margin: "10px auto", padding: "2rem", overflowY: "auto" }}>
      <h1>EPFC Chat</h1>

      {/* Chat history */}
      <div style={{ minHeight: 300, marginBottom: "1rem" }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: "0.75rem" }}>
            <strong>{msg.role === "user" ? "You" : "Assistant"}:</strong>{" "}
            <div className="prose dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {loading && <div>Thinking…</div>}
      </div>

      {/* Input area */}
      <div style={{ display: "flex", gap: "0.5rem", height: "2.5rem"}}>
        <input
          style={{ flex: 1, padding: "0.5rem", }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          // Let the user press Enter instead of clicking Send
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message…"
        />
        <button onClick={sendMessage} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  );
}