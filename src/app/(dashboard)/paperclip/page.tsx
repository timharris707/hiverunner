"use client";

import { useState } from "react";
import { Blocks, ExternalLink, RefreshCw } from "lucide-react";

const PAPERCLIP_URL = "http://localhost:3100";

export default function PaperclipPage() {
  const [key, setKey] = useState(0);

  return (
    <div
      className="flex flex-col"
      style={{
        height: "calc(100vh - 48px - 32px - 48px)",
        margin: "-24px",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Blocks className="w-5 h-5 text-amber-400" />
          <h1 className="text-xl font-bold text-white">Paperclip</h1>
          <span className="text-sm text-white/40">Agent Companies</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setKey((k) => k + 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <a
            href={PAPERCLIP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in Tab
          </a>
        </div>
      </div>

      {/* Iframe — fills remaining space */}
      <iframe
        key={key}
        src={PAPERCLIP_URL}
        className="flex-1 w-full border-0"
        style={{ minHeight: 0 }}
        allow="clipboard-read; clipboard-write"
        title="Paperclip"
      />
    </div>
  );
}
