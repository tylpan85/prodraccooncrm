'use client';

import type { CustomerNoteDto, NoteOp } from '@openclaw/shared';
import { useMemo, useState } from 'react';
import { Button } from '../ui/button';

export type DisplayNote = {
  id: string;
  content: string;
  authorEmail: string | null;
  createdAt: string | null;
  isNew: boolean;
  isEdited: boolean;
};

export function buildDisplayNotes(
  serverNotes: CustomerNoteDto[],
  noteOps: NoteOp[],
): DisplayNote[] {
  const deletedIds = new Set(
    noteOps.filter((o) => o.op === 'delete').map((o) => (o as { id: string }).id),
  );
  const updatesById = new Map(
    noteOps
      .filter((o) => o.op === 'update')
      .map((o) => [(o as { id: string }).id, (o as { content: string }).content]),
  );
  const existing: DisplayNote[] = serverNotes
    .filter((n) => !deletedIds.has(n.id))
    .map((n) => ({
      id: n.id,
      content: updatesById.get(n.id) ?? n.content,
      authorEmail: n.authorEmail,
      createdAt: n.createdAt,
      isNew: false,
      isEdited: updatesById.has(n.id),
    }));
  const pending: DisplayNote[] = noteOps
    .filter((o) => o.op === 'create')
    .map((o) => ({
      id: (o as { tempId: string }).tempId,
      content: (o as { content: string }).content,
      authorEmail: null,
      createdAt: null,
      isNew: true,
      isEdited: false,
    }));
  return [...existing, ...pending];
}

/**
 * Dedupe notes that belong to the same noteGroupId (recurring-series replicas).
 * Pass through customer-level notes (noteGroupId = null) untouched. Used by the
 * customer detail page so each logical note appears once even when the series
 * has many replicated rows.
 */
export function dedupeByNoteGroup(notes: CustomerNoteDto[]): CustomerNoteDto[] {
  const seenGroups = new Set<string>();
  const out: CustomerNoteDto[] = [];
  for (const n of notes) {
    if (n.noteGroupId === null) {
      out.push(n);
      continue;
    }
    if (seenGroups.has(n.noteGroupId)) continue;
    seenGroups.add(n.noteGroupId);
    out.push(n);
  }
  return out;
}

/**
 * Stateful notes editor backed by a noteOps queue. Hosts the AddNote, the
 * note rows, and inline edit/delete affordances. Parent owns persistence —
 * pass `noteOps` and the setter, plus the server `notes` (already deduped if
 * needed). Optimistic create/update/delete are merged into the displayed list.
 */
export function NotesPanel(props: {
  notes: CustomerNoteDto[];
  noteOps: NoteOp[];
  setNoteOps: (ops: NoteOp[] | ((prev: NoteOp[]) => NoteOp[])) => void;
  saving: boolean;
  loading?: boolean;
  title?: string;
  emptyMessage?: string;
  className?: string;
}) {
  const {
    notes,
    noteOps,
    setNoteOps,
    saving,
    loading = false,
    title = 'Customer notes',
    emptyMessage = 'No notes yet.',
    className,
  } = props;

  const [newNoteContent, setNewNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const displayNotes = useMemo(() => buildDisplayNotes(notes, noteOps), [notes, noteOps]);

  function addNote() {
    const content = newNoteContent.trim();
    if (!content) return;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setNoteOps((prev) => [...prev, { op: 'create', tempId, content }]);
    setNewNoteContent('');
  }

  function startEditNote(note: DisplayNote) {
    setEditingNoteId(note.id);
    setEditingContent(note.content);
  }

  function saveEditNote() {
    if (!editingNoteId) return;
    const content = editingContent.trim();
    if (!content) return;
    const target = displayNotes.find((n) => n.id === editingNoteId);
    if (!target) {
      setEditingNoteId(null);
      setEditingContent('');
      return;
    }
    if (target.isNew) {
      setNoteOps((prev) =>
        prev.map((o) =>
          o.op === 'create' && o.tempId === editingNoteId ? { ...o, content } : o,
        ),
      );
    } else {
      setNoteOps((prev) => {
        const without = prev.filter(
          (o) => !(o.op === 'update' && (o as { id: string }).id === editingNoteId),
        );
        return [...without, { op: 'update', id: editingNoteId, content }];
      });
    }
    setEditingNoteId(null);
    setEditingContent('');
  }

  function cancelEditNote() {
    setEditingNoteId(null);
    setEditingContent('');
  }

  function deleteNote(note: DisplayNote) {
    if (note.isNew) {
      setNoteOps((prev) => prev.filter((o) => !(o.op === 'create' && o.tempId === note.id)));
      return;
    }
    setNoteOps((prev) => {
      const without = prev.filter(
        (o) => !(o.op === 'update' && (o as { id: string }).id === note.id),
      );
      return [...without, { op: 'delete', id: note.id }];
    });
  }

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {noteOps.length > 0 && (
          <span className="text-xs text-amber-600">{noteOps.length} unsaved</span>
        )}
      </div>

      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-slate-500">Loading notes…</p>
        ) : displayNotes.length === 0 ? (
          <p className="text-sm text-slate-500">{emptyMessage}</p>
        ) : (
          displayNotes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              isEditing={editingNoteId === note.id}
              editingContent={editingContent}
              setEditingContent={setEditingContent}
              saveEditNote={saveEditNote}
              cancelEditNote={cancelEditNote}
              startEditNote={startEditNote}
              deleteNote={deleteNote}
              saving={saving}
            />
          ))
        )}
      </div>

      <AddNote
        newNoteContent={newNoteContent}
        setNewNoteContent={setNewNoteContent}
        addNote={addNote}
        saving={saving}
      />
    </div>
  );
}

function NoteRow(props: {
  note: DisplayNote;
  isEditing: boolean;
  editingContent: string;
  setEditingContent: (v: string) => void;
  saveEditNote: () => void;
  cancelEditNote: () => void;
  startEditNote: (n: DisplayNote) => void;
  deleteNote: (n: DisplayNote) => void;
  saving: boolean;
}) {
  const {
    note,
    isEditing,
    editingContent,
    setEditingContent,
    saveEditNote,
    cancelEditNote,
    startEditNote,
    deleteNote,
    saving,
  } = props;

  const [expanded, setExpanded] = useState(false);

  const classes = note.isNew
    ? 'border-emerald-200 bg-emerald-50'
    : note.isEdited
    ? 'border-amber-200 bg-amber-50'
    : 'border-slate-200 bg-white';

  const isLong = note.content.length > 100;
  const displayContent = expanded || !isLong ? note.content : `${note.content.slice(0, 100)}…`;

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${classes}`}>
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={3}
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            maxLength={10000}
            disabled={saving}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={cancelEditNote} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveEditNote}
              disabled={saving || !editingContent.trim()}
            >
              Apply
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap text-slate-800">{displayContent}</p>
            {isLong && (
              <button
                type="button"
                className="mt-1 text-xs font-medium text-purple-600 hover:text-purple-700"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Show Less' : 'Load More'}
              </button>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {note.isNew
                ? 'New note (unsaved)'
                : note.isEdited
                ? 'Edited (unsaved)'
                : `${note.authorEmail ?? 'Unknown'} · ${
                    note.createdAt ? new Date(note.createdAt).toLocaleString() : ''
                  }`}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="text-xs text-slate-600 hover:text-slate-900"
              onClick={() => startEditNote(note)}
              disabled={saving}
            >
              Edit
            </button>
            <button
              type="button"
              className="text-xs text-red-600 hover:text-red-800"
              onClick={() => deleteNote(note)}
              disabled={saving}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddNote(props: {
  newNoteContent: string;
  setNewNoteContent: (v: string) => void;
  addNote: () => void;
  saving: boolean;
}) {
  const { newNoteContent, setNewNoteContent, addNote, saving } = props;
  return (
    <div className="space-y-2">
      <textarea
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        rows={2}
        placeholder="Add a note…"
        value={newNoteContent}
        onChange={(e) => setNewNoteContent(e.target.value)}
        maxLength={10000}
        disabled={saving}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={addNote}
          disabled={saving || !newNoteContent.trim()}
        >
          Add note
        </Button>
      </div>
    </div>
  );
}
