"use client";

import { useState, type ReactNode } from "react";
import type { Field, ParsedEvent } from "@calendar-auto/core";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/confidence";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/datetime-input";

export interface DraftEventRow {
  id: string;
  draftId: string;
  event: ParsedEvent;
  deleted: boolean;
  conflictState: "none" | "overlap" | "duplicate";
}

/**
 * §4.3/§4.4: wraps a single field with its confidence flag (border + weight
 * + icon, never gray text — §8.2) and tap-to-reveal provenance (FR-4.4.1).
 * Self-contained so DraftCard doesn't need per-field reveal state.
 */
function FieldFlag({ field, sourceText, children }: { field: Field<unknown>; sourceText: string | null; children: ReactNode }) {
  const [showSource, setShowSource] = useState(false);
  const lowConfidence = field.confidence < LOW_CONFIDENCE_THRESHOLD;
  const hasTextProvenance = field.provenance !== null && field.provenance.kind === "text";

  return (
    <div className={lowConfidence ? "border-l-2 border-amber-500 pl-1.5 font-semibold" : ""}>
      <div className="flex items-center gap-1">
        {children}
        {lowConfidence && (
          <span aria-label="low confidence, needs review" title="Low confidence">
            ⚠
          </span>
        )}
        {hasTextProvenance && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowSource((s) => !s);
            }}
            className="text-zinc-500"
            aria-label="Show source"
            title="Show source"
          >
            🔍
          </button>
        )}
        {field.inferred && <span className="text-xs italic text-zinc-500">(inferred{field.inferredFrom ? `: ${field.inferredFrom}` : ""})</span>}
      </div>
      {showSource && sourceText && field.provenance?.kind === "text" && (
        <div className="mt-1 rounded bg-zinc-900 p-1 text-xs text-zinc-400">
          …{sourceText.slice(Math.max(0, field.provenance.span.start - 20), field.provenance.span.start)}
          <mark className="bg-amber-500/40 text-white">
            {sourceText.slice(field.provenance.span.start, field.provenance.span.end)}
          </mark>
          {sourceText.slice(field.provenance.span.end, field.provenance.span.end + 20)}…
        </div>
      )}
    </div>
  );
}

export function DraftCard({
  row,
  sourceText,
  isSelected,
  onSelect,
  onFieldChange,
  onDeleteToggle,
}: {
  row: DraftEventRow;
  sourceText: string | null;
  isSelected: boolean;
  onSelect: () => void;
  onFieldChange: (field: string, value: unknown) => void;
  onDeleteToggle: (deleted: boolean) => void;
}) {
  const { event } = row;
  const timezone = event.timezone;

  if (row.deleted) {
    return (
      <div className="flex items-center justify-between rounded border border-zinc-800 p-3 text-sm text-zinc-500">
        <span className="line-through">{event.title.value ?? "(untitled)"}</span>
        <button type="button" onClick={() => onDeleteToggle(false)} className="text-xs underline">
          Restore
        </button>
      </div>
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- FR-4.1.4 bidirectional selection needs the whole card clickable
    <div
      onClick={onSelect}
      className={`flex cursor-pointer flex-col gap-2 rounded border p-3 text-sm ${isSelected ? "border-white" : "border-zinc-700"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <FieldFlag field={event.title} sourceText={sourceText}>
          <input
            className="min-w-0 flex-1 bg-transparent font-medium outline-none"
            defaultValue={event.title.value ?? ""}
            placeholder="(untitled)"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onFieldChange("title", e.target.value || null)}
          />
        </FieldFlag>
        <div className="flex shrink-0 items-center gap-2">
          {row.conflictState !== "none" && (
            <span className="text-xs text-amber-500">{row.conflictState === "duplicate" ? "Duplicate" : "Overlaps"}</span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteToggle(true);
            }}
            className="text-xs text-zinc-500 underline"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-zinc-400">
        <FieldFlag field={event.startDateTime} sourceText={sourceText}>
          <input
            type="datetime-local"
            className="bg-transparent outline-none"
            defaultValue={toLocalInputValue(event.startDateTime.value, timezone)}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onFieldChange("startDateTime", fromLocalInputValue(e.target.value, timezone))}
          />
        </FieldFlag>
        <span>to</span>
        <FieldFlag field={event.endDateTime} sourceText={sourceText}>
          <input
            type="datetime-local"
            className="bg-transparent outline-none"
            defaultValue={toLocalInputValue(event.endDateTime.value, timezone)}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onFieldChange("endDateTime", fromLocalInputValue(e.target.value, timezone))}
          />
        </FieldFlag>
      </div>

      <FieldFlag field={event.location} sourceText={sourceText}>
        <input
          className="w-full bg-transparent text-zinc-400 outline-none"
          placeholder="Location"
          defaultValue={event.location.value ?? ""}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onFieldChange("location", e.target.value || null)}
        />
      </FieldFlag>
    </div>
  );
}
