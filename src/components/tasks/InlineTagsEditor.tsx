"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { color } from "@/lib/ui/tokens";

function cleanTag(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 48);
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const tag of tags) {
    const cleaned = cleanTag(tag);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    next.push(cleaned);
  }
  return next;
}

export function InlineTagsEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [saving, setSaving] = useState(false);
  const normalizedTags = uniqueTags(tags);
  const showAddButton = hovered || adding;

  const commit = async () => {
    const tag = cleanTag(draft);
    if (!tag || saving) {
      setDraft("");
      setAdding(false);
      return;
    }
    setSaving(true);
    try {
      await onChange(uniqueTags([...normalizedTags, tag]));
      setDraft("");
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tag: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await onChange(normalizedTags.filter((item) => item.toLowerCase() !== tag.toLowerCase()));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, minWidth: 0 }}
    >
      {normalizedTags.length === 0 && !adding && (
        <span style={{ fontSize: 12, color: color.textSecondary }}>No tags</span>
      )}
      {normalizedTags.map((tag) => (
        <span
          key={tag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(255,255,255,0.06)",
            color: color.textMuted,
            maxWidth: 132,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag}</span>
          <button
            type="button"
            onClick={() => { void remove(tag); }}
            disabled={saving}
            title={`Remove ${tag}`}
            style={{
              border: "none",
              background: "transparent",
              color: color.textMuted,
              cursor: saving ? "wait" : "pointer",
              padding: 0,
              fontSize: 12,
              lineHeight: 1,
              opacity: 0.55,
            }}
          >
            x
          </button>
        </span>
      ))}
      {adding ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            minWidth: 84,
            height: 22,
            borderRadius: 5,
            border: `0.5px solid ${color.border}`,
            background: "rgba(255,255,255,0.03)",
            padding: "0 5px",
          }}
        >
          <Plus size={11} color={saving ? color.textMuted : color.textSecondary} />
          <input
            autoFocus
            value={draft}
            disabled={saving}
            placeholder="Add tag"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commit();
              }
              if (event.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              void commit();
            }}
            style={{
              width: 58,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: color.text,
              fontSize: 11,
              fontFamily: "inherit",
              padding: 0,
            }}
          />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={saving}
          title="Add tag"
          aria-label="Add tag"
          tabIndex={showAddButton ? 0 : -1}
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            border: "none",
            background: "transparent",
            color: color.textMuted,
            cursor: saving ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            opacity: showAddButton ? 1 : 0,
            pointerEvents: showAddButton ? "auto" : "none",
            transition: "opacity 120ms ease",
          }}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}
