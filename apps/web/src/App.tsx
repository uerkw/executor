import React from "react";
import {
  ExecutorProvider,
  useAtomValue,
  toolsAtom,
} from "@executor/react";

function ToolList() {
  const tools = useAtomValue(toolsAtom());

  if (tools._tag === "Initial" || tools.waiting) {
    return <p>Loading tools…</p>;
  }

  if (tools._tag === "Failure") {
    return <p style={{ color: "red" }}>Failed to load tools</p>;
  }

  return (
    <div>
      <h2>Tools ({tools.value.length})</h2>
      {tools.value.length === 0 ? (
        <p style={{ color: "#888" }}>No tools registered yet.</p>
      ) : (
        <ul>
          {tools.value.map((t) => (
            <li key={t.id}>
              <strong>{t.name}</strong>
              {t.description && <span> — {t.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function App() {
  return (
    <ExecutorProvider>
      <div style={{ fontFamily: "system-ui", padding: "2rem" }}>
        <h1>Executor</h1>
        <ToolList />
      </div>
    </ExecutorProvider>
  );
}
