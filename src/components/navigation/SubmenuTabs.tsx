"use client";

import Link from "next/link";

export type SubmenuTab = {
  key: string;
  label: string;
  href: string;
  onClick?: () => void;
};

export function SubmenuTabs({
  tabs,
  activeKey,
  className,
}: {
  tabs: SubmenuTab[];
  activeKey: string;
  className?: string;
}) {
  return (
    <div className={className} style={{ borderBottom: "0.5px solid var(--border)" }}>
      <nav className="flex gap-0">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              onClick={tab.onClick}
              className="relative px-3 py-2.5 text-sm font-medium no-underline transition-colors"
              style={{ color: active ? "var(--text-primary)" : "var(--text-muted)" }}
            >
              {tab.label}
              {active ? (
                <span
                  className="absolute inset-x-0 bottom-0 h-0.5"
                  style={{ background: "var(--accent)" }}
                />
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
