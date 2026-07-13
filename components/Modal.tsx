"use client";

/**
 * Small accessible modal dialog matching the dark design system.
 *  - `role="dialog" aria-modal`, labelled by its title.
 *  - Esc and backdrop-click close.
 *  - Focus moves into the panel on open; body scroll is locked while open.
 *  - Renders nothing when `open` is false.
 *
 * Deliberately dependency-free (no portal lib): it renders a fixed-overlay at
 * the end of the component tree, which is fine for our single-modal-at-a-time
 * usage and keeps the CSP tight.
 */
import React, { useEffect, useRef } from "react";

export default function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible dialog label (also rendered as the header). */
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the panel so keyboard users land inside the dialog.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        // Backdrop click (but not clicks that started inside the panel) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`my-8 w-full max-w-lg rounded-2xl border border-line bg-surface shadow-card outline-none ${className}`}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-faint">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-muted hover:bg-raised hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
