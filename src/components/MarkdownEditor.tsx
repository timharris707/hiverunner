"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Save, AlertCircle } from "lucide-react";

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave: () => Promise<void>;
  hasUnsavedChanges: boolean;
  disabled?: boolean;
}

export function MarkdownEditor({
  content,
  onChange,
  onSave,
  hasUnsavedChanges,
  disabled = false,
}: MarkdownEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;

      const newValue =
        content.substring(0, start) + "  " + content.substring(end);
      onChange(newValue);

      // Restore cursor position after state update
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      }, 0);
    }

    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  const handleSave = async () => {
    if (!hasUnsavedChanges || isSaving) return;
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{
          backgroundColor: "var(--card)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <span
              className="flex items-center gap-1.5 text-sm"
              style={{ color: "#F59E0B" }}
            >
              <AlertCircle className="w-4 h-4" />
              Unsaved changes
            </span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={!hasUnsavedChanges || isSaving || disabled}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            backgroundColor:
              hasUnsavedChanges && !isSaving && !disabled
                ? "var(--accent)"
                : "var(--border)",
            color:
              hasUnsavedChanges && !isSaving && !disabled
                ? "var(--text-primary)"
                : "var(--text-muted)",
            cursor:
              !hasUnsavedChanges || isSaving || disabled
                ? "not-allowed"
                : "pointer",
          }}
        >
          <Save className="w-4 h-4" />
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Select a file to edit..."
        className="flex-1 w-full p-4 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: "var(--card)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', 'Fira Code', 'Roboto Mono', Consolas, monospace",
          fontSize: "13px",
          lineHeight: "1.7",
          tabSize: 2,
          letterSpacing: "0.01em",
        }}
      />
    </div>
  );
}
