import * as React from "react";
import { Toaster, toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface PromptRow {
  id: number;
  name: string;
  description: string;
  system_prompt: string;
}

// ─── Static bluff prompt data ─────────────────────────────────────────────────

const BLUFF_PROMPTS: PromptRow[] = [
  {
    id: 1,
    name: "General Help",
    description: "General purpose assistant for employee queries",
    system_prompt:
      "You are a helpful assistant. Answer employee questions clearly and concisely.",
  },
  {
    id: 2,
    name: "HR Assistant",
    description: "Handles HR-related queries and leave information",
    system_prompt:
      "You are an HR assistant. Help employees with leave, benefits, and HR policies.",
  },
  {
    id: 3,
    name: "IT Support",
    description: "Guides employees through IT requests and troubleshooting",
    system_prompt:
      "You are an IT support assistant. Help employees raise tickets and resolve tech issues.",
  },
];

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab() {
  const [messages, setMessages] = React.useState<Msg[]>([
    { role: "assistant", content: "Hello! How can I help you today?" },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const threadId = React.useRef(
    "bluff-" + Math.random().toString(36).slice(2)
  );

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/bluff/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bluff-Mode": "1",
        },
        body: JSON.stringify({ message: text, thread_id: threadId.current }),
      });

      if (!res.ok || !res.body) throw new Error("Request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "token" && evt.content) {
              assistantText += evt.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantText,
                };
                return updated;
              });
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I'm sorry, I couldn't process that request. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Message list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "72%",
                padding: "10px 14px",
                borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                background: m.role === "user" ? "#2563eb" : "#f1f5f9",
                color: m.role === "user" ? "#fff" : "#1e293b",
                fontSize: "14px",
                lineHeight: "1.6",
                wordBreak: "break-word",
              }}
            >
              {m.role === "user" ? (
                m.content || (loading && i === messages.length - 1 ? "…" : "")
              ) : (
                m.content ? (
                  <div style={{ "--md-color": "#1e293b" } as React.CSSProperties}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p style={{ margin: "0 0 8px" }}>{children}</p>,
                        ul: ({ children }) => <ul style={{ margin: "4px 0 8px", paddingLeft: "18px" }}>{children}</ul>,
                        ol: ({ children }) => <ol style={{ margin: "4px 0 8px", paddingLeft: "18px" }}>{children}</ol>,
                        li: ({ children }) => <li style={{ marginBottom: "2px" }}>{children}</li>,
                        strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                        h1: ({ children }) => <p style={{ fontWeight: 700, fontSize: "15px", margin: "8px 0 4px" }}>{children}</p>,
                        h2: ({ children }) => <p style={{ fontWeight: 600, fontSize: "14px", margin: "6px 0 4px" }}>{children}</p>,
                        h3: ({ children }) => <p style={{ fontWeight: 600, margin: "4px 0 2px" }}>{children}</p>,
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : (loading && i === messages.length - 1 ? "…" : "")
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "18px 18px 18px 4px",
                background: "#f1f5f9",
                color: "#94a3b8",
                fontSize: "14px",
              }}
            >
              …
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid #e2e8f0",
          display: "flex",
          gap: "8px",
          background: "#fff",
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Type a message..."
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: "8px",
            fontSize: "14px",
            outline: "none",
            background: loading ? "#f8fafc" : "#fff",
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            padding: "10px 20px",
            background: loading || !input.trim() ? "#94a3b8" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            fontWeight: 500,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab() {
  const [rows, setRows] = React.useState<PromptRow[]>(BLUFF_PROMPTS);
  const [editing, setEditing] = React.useState<PromptRow | null>(null);

  function openEdit(row: PromptRow) {
    setEditing({ ...row });
  }

  function closeEdit() {
    setEditing(null);
  }

  function save() {
    if (!editing) return;
    setRows((prev) => prev.map((r) => (r.id === editing.id ? editing : r)));
    toast.success("Prompt configuration saved.");
    setEditing(null);
  }

  return (
    <div style={{ padding: "24px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "#1e293b" }}>
        Prompt Configuration
      </h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "#64748b", fontWeight: 600 }}>Name</th>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "#64748b", fontWeight: 600 }}>Description</th>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "#64748b", fontWeight: 600 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "10px 12px", color: "#1e293b", fontWeight: 500 }}>{row.name}</td>
              <td style={{ padding: "10px 12px", color: "#475569" }}>{row.description}</td>
              <td style={{ padding: "10px 12px" }}>
                <button
                  onClick={() => openEdit(row)}
                  style={{
                    padding: "4px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontSize: "13px",
                    cursor: "pointer",
                    color: "#334155",
                  }}
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Edit modal */}
      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "28px",
              width: "480px",
              maxWidth: "90vw",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "16px", color: "#1e293b" }}>
              Edit Prompt — {editing.name}
            </h3>
            <label style={{ display: "block", fontSize: "13px", color: "#64748b", marginBottom: "4px" }}>
              Description
            </label>
            <input
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "14px",
                marginBottom: "12px",
                boxSizing: "border-box",
              }}
            />
            <label style={{ display: "block", fontSize: "13px", color: "#64748b", marginBottom: "4px" }}>
              System Prompt
            </label>
            <textarea
              value={editing.system_prompt}
              onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
              rows={5}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "14px",
                resize: "vertical",
                marginBottom: "20px",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                onClick={closeEdit}
                style={{
                  padding: "8px 18px",
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                style={{
                  padding: "8px 18px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "14px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root BluffApp ────────────────────────────────────────────────────────────

export function BluffApp() {
  const [tab, setTab] = React.useState<"chat" | "config">("chat");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          gap: "24px",
          height: "52px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "auto" }}>
          <span style={{ fontSize: "20px" }}>🤖</span>
          <span style={{ fontSize: "15px", fontWeight: 600, color: "#1e293b" }}>WorkAssist</span>
        </div>

        {/* Tabs */}
        {(["chat", "config"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 14px",
              border: "none",
              background: "none",
              fontSize: "14px",
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "#2563eb" : "#64748b",
              borderBottom: tab === t ? "2px solid #2563eb" : "2px solid transparent",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t === "chat" ? "Chat" : "Configuration"}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: "860px", width: "100%", margin: "0 auto", alignSelf: "center", height: "calc(100vh - 52px)" }}>
        <div style={{ flex: 1, background: "#fff", overflow: "hidden", display: "flex", flexDirection: "column", margin: "16px", borderRadius: "10px", border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
          {tab === "chat" ? <ChatTab /> : <ConfigTab />}
        </div>
      </div>

      <Toaster position="top-right" richColors />
    </div>
  );
}
