import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Schema } from "../amplify/data/resource";
import { generateClient } from "aws-amplify/data";
import { getUrl, remove, uploadData } from "aws-amplify/storage";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

const client = generateClient<Schema>();
// The Date model requires a signed-in user (allow.authenticated()).
const AUTH = { authMode: "userPool" as const };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const PHASES = [
  "Assessment (Design Phase)",
  "Preconstruction",
  "During Construction",
  "After Construction",
];

function iso(year: number, month0: number, day: number) {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

function todayISO() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

// Date the app opens on (calendar view + selected date). Data spans 2014-2015,
// so start here to land on a month that has entries.
const START_DATE = "2015-01-01";

// Uploads land here; the S3 key is then stored on the Location record itself,
// so the link survives renaming a task and duplicate rows own their own files.
const MEDIA_ROOT = "location-media";

type MediaItem = { path: string; url: string; kind: "image" | "video" | "file" };

// crypto.randomUUID only exists in a secure context, so a phone hitting the
// dev server over plain http would otherwise throw here.
function uid() {
  const c = globalThis.crypto;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mediaKeyFor(date: string, file: File) {
  return `${MEDIA_ROOT}/${date}/${uid()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
}

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

type Attachment = { key: string; note: string };

// Attachments for a row. Prefers `photos` (key + note); falls back to the
// legacy bare-key `media` list for entries saved before notes existed.
function attachmentsOf(l: Schema["Location"]["type"]): Attachment[] {
  const photos = (l.photos ?? [])
    .filter((p): p is { key: string; note?: string | null } => !!p?.key)
    .map((p) => ({ key: p.key, note: p.note ?? "" }));
  if (photos.length > 0) return photos;
  return (l.media ?? [])
    .filter((k): k is string => !!k)
    .map((k) => ({ key: k, note: "" }));
}

function mediaKind(path: string): MediaItem["kind"] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp"].includes(ext))
    return "image";
  if (["mp4", "mov", "webm", "m4v", "avi"].includes(ext)) return "video";
  return "file";
}

// list() returns a single page (100 rows by default), so follow nextToken to
// be sure every saved row is loaded.
async function listAll<T>(
  fetchPage: (nextToken?: string) => Promise<{
    data: T[];
    nextToken?: string | null;
  }>
): Promise<T[]> {
  const all: T[] = [];
  let token: string | undefined;
  do {
    const page = await fetchPage(token);
    all.push(...page.data);
    token = page.nextToken ?? undefined;
  } while (token);
  return all;
}

// The Equipment field is a flat comma-separated list, so an inserted entry is
// a run of several parts rather than a single one.
function splitParts(value: string) {
  return value
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

// Is `addition` already in `current` as a contiguous run of parts?
function hasParts(current: string, addition: string) {
  const cur = splitParts(current);
  const add = splitParts(addition);
  if (add.length === 0) return false;
  return cur.some((_, i) => add.every((a, j) => cur[i + j] === a));
}

type CalendarProps = {
  selected: string;
  highlighted: Set<string>;
  onSelect: (date: string) => void;
};

function Calendar({ selected, highlighted, onSelect }: CalendarProps) {
  const [year, mon] = selected.split("-").map(Number);
  const [view, setView] = useState({ year, month: mon - 1 });

  const first = new Date(view.year, view.month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

  const cells: Array<number | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function shift(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return {
        year: v.year + Math.floor(m / 12),
        month: ((m % 12) + 12) % 12,
      };
    });
  }

  return (
    <div className="calendar">
      <div className="calendar-header">
        <button
          type="button"
          className="cal-nav"
          onClick={() => shift(-1)}
          aria-label="Previous month"
        >
          &#8249;
        </button>
        <span className="calendar-title">
          {MONTHS[view.month]} {view.year}
        </span>
        <button
          type="button"
          className="cal-nav"
          onClick={() => shift(1)}
          aria-label="Next month"
        >
          &#8250;
        </button>
      </div>

      <div className="calendar-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-weekday">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e${i}`} className="cal-empty" />;
          const date = iso(view.year, view.month, day);
          const classes = ["cal-day"];
          if (highlighted.has(date)) classes.push("cal-day--has-entry");
          if (date === selected) classes.push("cal-day--selected");
          if (date === todayISO()) classes.push("cal-day--today");
          return (
            <button
              key={date}
              type="button"
              className={classes.join(" ")}
              onClick={() => onSelect(date)}
            >
              {day}
            </button>
          );
        })}
      </div>

      <p className="calendar-legend">
        <span className="legend-dot" /> Date has entries
      </p>
    </div>
  );
}

// Textarea that grows with its content so long text stays fully visible.
function AutoGrowTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

const DEFAULT_FORM = {
  weather: "",
  hight: "",
  lowt: "",
  supervisor: "Jeff Jiang",
  inspector: "Gregory Mullenski",
  labor: "",
  observation: "",
  equipment: "",
  // Location fields (date shared with the selected date above).
  task: "",
  phase: "During Construction",
  description: "",
};

function Workspace() {
  const [selected, setSelected] = useState(START_DATE);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dateDays, setDateDays] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<Array<Schema["Date"]["type"]>>([]);
  const [taskRows, setTaskRows] = useState<Array<Schema["Task"]["type"]>>([]);
  const [equipmentRows, setEquipmentRows] = useState<
    Array<Schema["Equipment"]["type"]>
  >([]);
  const [locationRows, setLocationRows] = useState<
    Array<Schema["Location"]["type"]>
  >([]);

  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [applyingLocation, setApplyingLocation] = useState(false);
  // Row currently open for editing in the Location list, plus its draft values.
  const [editingLocationId, setEditingLocationId] = useState<string | null>(
    null
  );
  const [locationEdit, setLocationEdit] = useState({
    task: "",
    phase: "",
    description: "",
  });
  const [savingLocationEdit, setSavingLocationEdit] = useState(false);
  // Signed URLs for the media keys held by the visible Location rows.
  const [mediaUrls, setMediaUrls] = useState<Record<string, MediaItem>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Per-row attach: which Location row the hidden input is acting for.
  const rowInput = useRef<HTMLInputElement>(null);
  const rowTarget = useRef<string | null>(null);
  const [rowUploading, setRowUploading] = useState<string | null>(null);
  // Row awaiting delete confirmation, and the one currently being deleted.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Open lightbox: which Location row, and which of its media we're on.
  const [viewer, setViewer] = useState<{
    locationId: string;
    index: number;
  } | null>(null);
  const [deletingMedia, setDeletingMedia] = useState(false);
  // Draft note for the photo open in the lightbox.
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savingEquipment, setSavingEquipment] = useState(false);
  const [equipForm, setEquipForm] = useState({
    primeSub: "",
    model: "",
    equipment: "",
  });
  // Row currently open for editing in the Equipment table, plus its draft values.
  const [editingEquipId, setEditingEquipId] = useState<string | null>(null);
  const [equipEdit, setEquipEdit] = useState({
    primeSub: "",
    model: "",
    equipment: "",
  });
  const [savingEquipEdit, setSavingEquipEdit] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [taskForm, setTaskForm] = useState({ taskid: "", task: "" });
  // Row currently open for editing in the Task table, plus its draft values.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskEdit, setTaskEdit] = useState({ taskid: "", task: "" });
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  // Table visibility switches (both off on startup).
  const [showTask, setShowTask] = useState(false);
  const [showEquipment, setShowEquipment] = useState(false);
  // Equipment picker selection. Only lands in the form when Insert is clicked.
  const [equipPick, setEquipPick] = useState("");
  const update = (key: keyof typeof DEFAULT_FORM, value: string) =>
    setForm((s) => ({ ...s, [key]: value }));

  // Voice dictation for the Observation/Description fields (Web Speech API).
  const [listeningField, setListeningField] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const speechSupported =
    typeof window !== "undefined" &&
    !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );

  function toggleDictation(field: keyof typeof DEFAULT_FORM) {
    if (!speechSupported) return;
    if (listeningField) {
      recognitionRef.current?.stop();
      return;
    }
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results)
        .map((r: any) => r[0].transcript)
        .join(" ")
        .trim();
      setForm((s) => ({
        ...s,
        [field]: s[field] ? `${s[field]} ${text}` : text,
      }));
    };
    rec.onend = () => setListeningField(null);
    rec.onerror = () => setListeningField(null);
    recognitionRef.current = rec;
    setListeningField(field);
    rec.start();
  }

  // Every date that has at least one Date entry -> highlighted on the calendar.
  const loadDateDays = useCallback(async () => {
    const data = await listAll((nextToken) =>
      client.models.Date.list({ ...AUTH, nextToken })
    );
    setDateDays(new Set(data.map((d) => d.date).filter(Boolean) as string[]));
  }, []);

  // All Date entries, newest first.
  const loadEntries = useCallback(async () => {
    const data = await listAll((nextToken) =>
      client.models.Date.list({ ...AUTH, nextToken })
    );
    setEntries(
      [...data].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    );
  }, []);

  // All Task entries, sorted by Task ID.
  const loadTasks = useCallback(async () => {
    const data = await listAll((nextToken) =>
      client.models.Task.list({ ...AUTH, nextToken })
    );
    const sorted = [...data].sort((a, b) =>
      (a.taskid ?? "").localeCompare(b.taskid ?? "")
    );
    setTaskRows(sorted);
    // Default the Location form's task to the first entry (lowest taskid, 001).
    setForm((s) => ({ ...s, task: s.task || sorted[0]?.task || "" }));
  }, []);

  // All Equipment entries; also seeds the Equipment dropdown.
  const loadEquipment = useCallback(async () => {
    const data = await listAll((nextToken) =>
      client.models.Equipment.list({ ...AUTH, nextToken })
    );
    setEquipmentRows(
      [...data].sort((a, b) =>
        (a.primeSub ?? "").localeCompare(b.primeSub ?? "")
      )
    );
  }, []);

  // Location entries, so Apply can find the one to update.
  const loadLocations = useCallback(async () => {
    const data = await listAll((nextToken) =>
      client.models.Location.list({ ...AUTH, nextToken })
    );
    setLocationRows(data);
  }, []);

  useEffect(() => {
    loadDateDays();
    loadEntries();
    loadTasks();
    loadEquipment();
    loadLocations();
  }, [loadDateDays, loadEntries, loadTasks, loadEquipment, loadLocations]);


  // Equipment picker options, one per Equipment entry. Shown slash-separated;
  // Insert writes the comma-separated form. Derived from the rows so edits
  // and sorting flow through. Keyed by label so duplicates collapse.
  const equipmentOptions = Array.from(
    new Map(
      equipmentRows
        .map((eq) => {
          const fields = [eq.primeSub, eq.model, eq.equipment]
            .map((v) => v?.trim())
            .filter((v): v is string => !!v);
          return { label: fields.join(" / "), value: fields.join(", ") };
        })
        .filter((o) => o.label !== "")
        .map((o) => [o.label, o] as const)
    ).values()
  );

  // The saved record for the selected date, if there is one. Drives Apply.
  const currentEntry = entries.find((d) => d.date === selected);

  // Every Location saved under the selected date, listed by task.
  const dayLocations = locationRows
    .filter((l) => l.date === selected)
    .sort((a, b) => (a.task ?? "").localeCompare(b.task ?? ""));

  // Media keys held by the rows on screen. Joined into a stable string so the
  // effect below re-runs only when the set of keys actually changes.
  const visibleMediaKeys = dayLocations
    .flatMap((l) => attachmentsOf(l).map((a) => a.key))
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const keys = visibleMediaKeys ? visibleMediaKeys.split("|") : [];
    if (keys.length === 0) {
      setMediaUrls({});
      return;
    }
    (async () => {
      try {
        const resolved = await Promise.all(
          keys.map(
            async (k) =>
              [
                k,
                {
                  path: k,
                  url: (await getUrl({ path: k })).url.toString(),
                  kind: mediaKind(k),
                },
              ] as const
          )
        );
        if (!cancelled) setMediaUrls(Object.fromEntries(resolved));
      } catch {
        if (!cancelled) setMediaUrls({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleMediaKeys]);

  // Lightbox contents, derived from the row it was opened on so it stays in
  // step with the record after an attach or a delete.
  const viewerRow = viewer
    ? locationRows.find((l) => l.id === viewer.locationId)
    : undefined;
  const viewerAttachments = viewerRow ? attachmentsOf(viewerRow) : [];
  const viewerKeys = viewerAttachments.map((a) => a.key);
  const viewerItem = viewer ? mediaUrls[viewerKeys[viewer.index]] : undefined;
  const viewerNote = viewer ? viewerAttachments[viewer.index]?.note ?? "" : "";

  const count = viewerKeys.length;
  const stepViewer = useCallback(
    (delta: number) => {
      setViewer((v) =>
        !v || count === 0
          ? null
          : { ...v, index: (v.index + delta + count) % count }
      );
    },
    [count]
  );

  // Arrow keys cycle, Escape closes.
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      else if (e.key === "ArrowRight") stepViewer(1);
      else if (e.key === "ArrowLeft") stepViewer(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, stepViewer]);

  // Load the shown photo's note into the editor whenever the slide changes.
  useEffect(() => {
    setNoteDraft(viewerNote);
  }, [viewerNote, viewer?.index, viewer?.locationId]);

  async function saveNote() {
    if (!viewerRow || !viewer) return;
    const key = viewerKeys[viewer.index];
    if (!key) return;
    setSavingNote(true);
    try {
      await client.models.Location.update(
        {
          id: viewerRow.id,
          photos: viewerAttachments.map((a) =>
            a.key === key ? { ...a, note: noteDraft } : a
          ),
          media: [],
        },
        AUTH
      );
      setMediaError(null);
      await loadLocations();
    } catch (err) {
      setMediaError(`Saving note failed: ${errText(err)}`);
    } finally {
      setSavingNote(false);
    }
  }

  // Detach the shown file from the record, then delete it from S3.
  async function deleteViewerMedia() {
    if (!viewerRow || !viewer) return;
    const key = viewerKeys[viewer.index];
    if (!key) return;
    setDeletingMedia(true);
    try {
      const remaining = viewerAttachments.filter((a) => a.key !== key);
      await client.models.Location.update(
        { id: viewerRow.id, photos: remaining, media: [] },
        AUTH
      );
      await remove({ path: key }).catch(() => undefined);
      setMediaError(null);
      await loadLocations();
      setViewer((v) =>
        !v || remaining.length === 0
          ? null
          : { ...v, index: Math.min(v.index, remaining.length - 1) }
      );
    } catch (err) {
      setMediaError(`Delete failed: ${errText(err)}`);
    } finally {
      setDeletingMedia(false);
    }
  }

  // The saved Location for this date and task. Drives the Description Apply.
  const currentLocation = locationRows.find(
    (l) => l.date === selected && (l.task ?? "") === form.task
  );

  const pickedOption = equipmentOptions.find((o) => o.label === equipPick);
  // Already in the box? Then Insert is a no-op and the button is disabled.
  const pickedAlreadyAdded =
    !!pickedOption && hasParts(form.equipment, pickedOption.value);

  // Append the picked entry to whatever the Equipment box already holds,
  // skipping it if that entry is already listed.
  function insertEquipment() {
    if (!pickedOption) return;
    setForm((s) =>
      hasParts(s.equipment, pickedOption.value)
        ? s
        : {
            ...s,
            equipment: s.equipment
              ? `${s.equipment}, ${pickedOption.value}`
              : pickedOption.value,
          }
    );
  }

  // Mirror the selected day's saved entry into the form inputs.
  // Days with no entry fall back to the blank/default form.
  useEffect(() => {
    const entry = entries.find((d) => d.date === selected);
    const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setForm((s) => ({
      ...s,
      weather: str(entry?.weather),
      hight: str(entry?.hight),
      lowt: str(entry?.lowt),
      supervisor: entry ? str(entry.supervisor) : DEFAULT_FORM.supervisor,
      inspector: entry ? str(entry.inspector) : DEFAULT_FORM.inspector,
      labor: str(entry?.labor),
      observation: str(entry?.observation),
      equipment: str(entry?.equipment),
    }));
  }, [selected, entries]);

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
      await client.models.Date.create(
        {
          date: selected,
          weather: form.weather || undefined,
          hight: num(form.hight),
          lowt: num(form.lowt),
          supervisor: form.supervisor || undefined,
          inspector: form.inspector || undefined,
          labor: num(form.labor),
          observation: form.observation || undefined,
          equipment: form.equipment || undefined,
        },
        AUTH
      );
      setForm({ ...DEFAULT_FORM, task: taskRows[0]?.task ?? "" });
      await Promise.all([loadEntries(), loadDateDays()]);
    } finally {
      setSaving(false);
    }
  }

  // Save the form back onto the selected date's existing Date record.
  // Blank inputs are sent as null so clearing a box actually clears the field.
  async function applyEntry() {
    if (!currentEntry) return;
    setApplying(true);
    try {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      await client.models.Date.update(
        {
          id: currentEntry.id,
          weather: form.weather || null,
          hight: num(form.hight),
          lowt: num(form.lowt),
          supervisor: form.supervisor || null,
          inspector: form.inspector || null,
          labor: num(form.labor),
          observation: form.observation || null,
          equipment: form.equipment || null,
        },
        AUTH
      );
      await Promise.all([loadEntries(), loadDateDays()]);
    } finally {
      setApplying(false);
    }
  }

  // Location entry shares the selected date; phase defaults to "During Construction".
  async function addLocation() {
    setSavingLocation(true);
    try {
      await client.models.Location.create(
        {
          date: selected,
          task: form.task || undefined,
          description: form.description || undefined,
          phase: form.phase,
        },
        AUTH
      );
      setForm((s) => ({
        ...s,
        task: taskRows[0]?.task ?? "",
        description: "",
      }));
      await loadLocations();
    } finally {
      setSavingLocation(false);
    }
  }

  // Save the form back onto the Location already saved for this date + task.
  async function applyLocation() {
    if (!currentLocation) return;
    setApplyingLocation(true);
    try {
      await client.models.Location.update(
        {
          id: currentLocation.id,
          task: form.task || null,
          description: form.description || null,
          phase: form.phase,
          // media is deliberately omitted: an omitted field is left unchanged,
          // so Apply can never disturb a row's attachments.
        },
        AUTH
      );
      await loadLocations();
    } finally {
      setApplyingLocation(false);
    }
  }

  // Attach files straight onto one saved Location row, by id. Independent of
  // the form above, so it works whatever the Task dropdown happens to show.
  function pickRowMedia(id: string) {
    rowTarget.current = id;
    rowInput.current?.click();
  }

  async function handleRowUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const id = rowTarget.current;
    rowTarget.current = null;
    const row = locationRows.find((l) => l.id === id);
    if (!id || !row || files.length === 0) return;
    setRowUploading(id);
    try {
      const keys: string[] = [];
      for (const file of files) {
        const path = mediaKeyFor(row.date, file);
        await uploadData({
          path,
          data: file,
          options: { contentType: file.type || undefined },
        }).result;
        keys.push(path);
      }
      // Only attachments are sent, so task/phase/description stay untouched.
      // Writing `photos` folds in any legacy `media` keys and clears them.
      await client.models.Location.update(
        {
          id,
          photos: [
            ...attachmentsOf(row),
            ...keys.map((key) => ({ key, note: "" })),
          ],
          media: [],
        },
        AUTH
      );
      setMediaError(null);
      await loadLocations();
    } catch (err) {
      setMediaError(`Attach failed: ${errText(err)}`);
    } finally {
      setRowUploading(null);
    }
  }

  // Removes the record, then best-effort deletes its attachments so they
  // don't linger in S3 unreachable. A failed file delete won't block the row.
  async function deleteLocation(l: Schema["Location"]["type"]) {
    setDeletingId(l.id);
    try {
      await client.models.Location.delete({ id: l.id }, AUTH);
      const keys = (l.media ?? []).filter((k): k is string => !!k);
      await Promise.all(
        keys.map((path) => remove({ path }).catch(() => undefined))
      );
      setConfirmDeleteId(null);
      setMediaError(null);
      await loadLocations();
    } catch (err) {
      setMediaError(`Delete failed: ${errText(err)}`);
    } finally {
      setDeletingId(null);
    }
  }

  function startEditLocation(l: Schema["Location"]["type"]) {
    setEditingLocationId(l.id);
    setLocationEdit({
      task: l.task ?? "",
      phase: l.phase ?? PHASES[0],
      description: l.description ?? "",
    });
  }

  function cancelEditLocation() {
    setEditingLocationId(null);
  }

  async function saveEditLocation() {
    if (!editingLocationId) return;
    setSavingLocationEdit(true);
    try {
      await client.models.Location.update(
        {
          id: editingLocationId,
          task: locationEdit.task || null,
          description: locationEdit.description || null,
          phase: locationEdit.phase,
        },
        AUTH
      );
      setEditingLocationId(null);
      await loadLocations();
    } finally {
      setSavingLocationEdit(false);
    }
  }

  async function addEquipment(event: React.FormEvent) {
    event.preventDefault();
    setSavingEquipment(true);
    try {
      await client.models.Equipment.create(
        {
          primeSub: equipForm.primeSub || undefined,
          model: equipForm.model || undefined,
          equipment: equipForm.equipment || undefined,
        },
        AUTH
      );
      setEquipForm({ primeSub: "", model: "", equipment: "" });
      await loadEquipment();
    } finally {
      setSavingEquipment(false);
    }
  }

  function startEditEquipment(eq: Schema["Equipment"]["type"]) {
    setEditingEquipId(eq.id);
    setEquipEdit({
      primeSub: eq.primeSub ?? "",
      model: eq.model ?? "",
      equipment: eq.equipment ?? "",
    });
  }

  function cancelEditEquipment() {
    setEditingEquipId(null);
  }

  async function saveEditEquipment() {
    if (!editingEquipId) return;
    setSavingEquipEdit(true);
    try {
      await client.models.Equipment.update(
        {
          id: editingEquipId,
          primeSub: equipEdit.primeSub || undefined,
          model: equipEdit.model || undefined,
          equipment: equipEdit.equipment || undefined,
        },
        AUTH
      );
      setEditingEquipId(null);
      await loadEquipment();
    } finally {
      setSavingEquipEdit(false);
    }
  }

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    setSavingTask(true);
    try {
      await client.models.Task.create(
        {
          taskid: taskForm.taskid || undefined,
          task: taskForm.task || undefined,
        },
        AUTH
      );
      setTaskForm({ taskid: "", task: "" });
      await loadTasks();
    } finally {
      setSavingTask(false);
    }
  }

  function startEditTask(t: Schema["Task"]["type"]) {
    setEditingTaskId(t.id);
    setTaskEdit({ taskid: t.taskid ?? "", task: t.task ?? "" });
  }

  function cancelEditTask() {
    setEditingTaskId(null);
  }

  async function saveEditTask() {
    if (!editingTaskId) return;
    setSavingTaskEdit(true);
    try {
      await client.models.Task.update(
        {
          id: editingTaskId,
          taskid: taskEdit.taskid || undefined,
          task: taskEdit.task || undefined,
        },
        AUTH
      );
      setEditingTaskId(null);
      await loadTasks();
    } finally {
      setSavingTaskEdit(false);
    }
  }

  return (
    <main>
      <div className="toggle-bar">
        <label className="switch-field">
          <input
            type="checkbox"
            checked={showTask}
            onChange={(e) => setShowTask(e.target.checked)}
          />
          <span className="switch-slider" />
          <span>Task table</span>
        </label>
        <label className="switch-field">
          <input
            type="checkbox"
            checked={showEquipment}
            onChange={(e) => setShowEquipment(e.target.checked)}
          />
          <span className="switch-slider" />
          <span>Equipment table</span>
        </label>
      </div>

      <section className="card">
        <div className="section-header">
          <h2 className="section-title">Date</h2>
          <button
            type="submit"
            form="date-form"
            className="submit-button"
            disabled={saving}
          >
            {saving ? "Adding…" : "+ Add Date"}
          </button>
        </div>

        <form id="date-form" className="date-form" onSubmit={addEntry}>
          <div className="form-row form-row--1">
          <label className="field field--date">
            <span>Date</span>
            <button
              type="button"
              className="date-trigger"
              aria-expanded={calendarOpen}
              onClick={() => setCalendarOpen((open) => !open)}
            >
              <span>{selected}</span>
              <span className="date-trigger-caret">
                {calendarOpen ? "▲" : "▼"}
              </span>
            </button>
            {calendarOpen && (
              <div className="calendar-popover">
                <Calendar
                  selected={selected}
                  highlighted={dateDays}
                  onSelect={(date) => {
                    setSelected(date);
                    setCalendarOpen(false);
                  }}
                />
              </div>
            )}
          </label>

          <label className="field">
            <span>Weather</span>
            <input
              value={form.weather}
              onChange={(e) => update("weather", e.target.value)}
            />
          </label>
          <label className="field field--high">
            <span>High</span>
            <input
              type="number"
              step="any"
              value={form.hight}
              onChange={(e) => update("hight", e.target.value)}
            />
          </label>
          <label className="field field--low">
            <span>Low</span>
            <input
              type="number"
              step="any"
              value={form.lowt}
              onChange={(e) => update("lowt", e.target.value)}
            />
          </label>
          </div>

          <div className="form-row form-row--2">
          <label className="field">
            <span>Supervisor</span>
            <input
              value={form.supervisor}
              onChange={(e) => update("supervisor", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Inspector</span>
            <input
              value={form.inspector}
              onChange={(e) => update("inspector", e.target.value)}
            />
          </label>
          <label className="field field--labor">
            <span>Labor</span>
            <input
              type="number"
              step="any"
              value={form.labor}
              onChange={(e) => update("labor", e.target.value)}
            />
          </label>
          </div>

          <label className="field field--equipment">
            <span>Equipment</span>
            <input
              value={form.equipment}
              onChange={(e) => update("equipment", e.target.value)}
            />
            {/* Picker below the box: Insert appends it, Clear empties the box. */}
            <div className="input-with-action">
              <select
                value={equipPick}
                onChange={(e) => setEquipPick(e.target.value)}
              >
                <option value="">—</option>
                {equipmentOptions.map((o) => (
                  <option key={o.label} value={o.label}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="submit-button"
                onClick={insertEquipment}
                disabled={!pickedOption || pickedAlreadyAdded}
                title={
                  pickedAlreadyAdded
                    ? "Already listed in the Equipment field"
                    : undefined
                }
              >
                {pickedAlreadyAdded ? "Added" : "Insert"}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => update("equipment", "")}
                disabled={!form.equipment}
              >
                Clear
              </button>
            </div>
          </label>

          <div className="field field--observation">
            <span>Observation</span>
            <div className="input-with-action">
              <AutoGrowTextarea
                value={form.observation}
                onChange={(e) => update("observation", e.target.value)}
              />
              <button
                type="button"
                className={`mic-button${listeningField === "observation" ? " mic-button--on" : ""}`}
                onClick={() => toggleDictation("observation")}
                disabled={!speechSupported}
                aria-pressed={listeningField === "observation"}
                title={
                  speechSupported
                    ? listeningField === "observation"
                      ? "Stop dictation"
                      : "Dictate to Observation"
                    : "Voice input is not supported in this browser"
                }
              >
                {listeningField === "observation" ? "■" : "\u{1F3A4}"}
              </button>
              <button
                type="button"
                className="submit-button"
                onClick={applyEntry}
                disabled={!currentEntry || applying}
                title={
                  currentEntry
                    ? "Save these values onto this date's entry"
                    : "No entry saved for this date yet — use + Add Date"
                }
              >
                {applying ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>

          <div className="form-row form-row--3">
            <label className="field field--task">
              <span>Task</span>
              <select
                value={form.task}
                required
                onChange={(e) => update("task", e.target.value)}
              >
                {taskRows.map((t) => (
                  <option key={t.id} value={t.task ?? ""}>
                    {t.taskid ? `${t.taskid} - ${t.task}` : t.task}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--phase">
              <span>Phase</span>
              <select
                value={form.phase}
                required
                onChange={(e) => update("phase", e.target.value)}
              >
                {PHASES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field field--description">
            <span>Description</span>
            <div className="input-with-action">
              <AutoGrowTextarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
              />
              <button
                type="button"
                className={`mic-button${listeningField === "description" ? " mic-button--on" : ""}`}
                onClick={() => toggleDictation("description")}
                disabled={!speechSupported}
                aria-pressed={listeningField === "description"}
                title={
                  speechSupported
                    ? listeningField === "description"
                      ? "Stop dictation"
                      : "Dictate to Description"
                    : "Voice input is not supported in this browser"
                }
              >
                {listeningField === "description" ? "■" : "\u{1F3A4}"}
              </button>
              <button
                type="button"
                className="submit-button"
                onClick={addLocation}
                disabled={savingLocation}
              >
                {savingLocation ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                className="submit-button"
                onClick={applyLocation}
                disabled={!currentLocation || applyingLocation}
                title={
                  currentLocation
                    ? "Save these values onto this date's saved entry for this task"
                    : "Nothing saved yet for this date and task — use Add"
                }
              >
                {applyingLocation ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>

        </form>

        {mediaError && <p className="media-note">{mediaError}</p>}

        {/* Shared by every row's "+ Photo" button; pickRowMedia sets the target. */}
        <input
          ref={rowInput}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={handleRowUpload}
        />

        {dayLocations.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Phase</th>
                  <th>Description</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {dayLocations.map((l) =>
                  editingLocationId === l.id ? (
                    <tr key={l.id}>
                      <td>
                        <select
                          value={locationEdit.task}
                          onChange={(e) =>
                            setLocationEdit((s) => ({
                              ...s,
                              task: e.target.value,
                            }))
                          }
                        >
                          {taskRows.map((t) => (
                            <option key={t.id} value={t.task ?? ""}>
                              {t.taskid ? `${t.taskid} - ${t.task}` : t.task}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={locationEdit.phase}
                          onChange={(e) =>
                            setLocationEdit((s) => ({
                              ...s,
                              phase: e.target.value,
                            }))
                          }
                        >
                          {PHASES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="cell-wrap">
                        <AutoGrowTextarea
                          value={locationEdit.description}
                          onChange={(e) =>
                            setLocationEdit((s) => ({
                              ...s,
                              description: e.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="submit-button"
                          onClick={saveEditLocation}
                          disabled={savingLocationEdit}
                        >
                          {savingLocationEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={cancelEditLocation}
                          disabled={savingLocationEdit}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <Fragment key={l.id}>
                      <tr>
                        <td>{l.task}</td>
                        <td>{l.phase}</td>
                        <td className="cell-wrap cell-wrap--lines">
                          {l.description}
                        </td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="submit-button"
                            onClick={() => pickRowMedia(l.id)}
                            disabled={rowUploading !== null}
                            title="Attach a photo or video to this entry"
                          >
                            {rowUploading === l.id ? "Adding…" : "+ Photo"}
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => startEditLocation(l)}
                            disabled={editingLocationId !== null}
                          >
                            Edit
                          </button>
                          {confirmDeleteId === l.id ? (
                            <>
                              <button
                                type="button"
                                className="submit-button danger-button"
                                onClick={() => deleteLocation(l)}
                                disabled={deletingId !== null}
                                title={
                                  (l.media ?? []).length > 0
                                    ? "Deletes this entry and its attachments"
                                    : "Deletes this entry"
                                }
                              >
                                {deletingId === l.id
                                  ? "Deleting…"
                                  : "Confirm delete"}
                              </button>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={deletingId !== null}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => setConfirmDeleteId(l.id)}
                              disabled={
                                editingLocationId !== null ||
                                confirmDeleteId !== null
                              }
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                      {attachmentsOf(l).length > 0 && (
                        <tr className="media-row">
                          <td colSpan={4}>
                            <div className="media-grid">
                              {attachmentsOf(l)
                                .map((a, i) => [a, i] as const)
                                .filter(([a]) => mediaUrls[a.key])
                                .map(([a, i]) => {
                                  const m = mediaUrls[a.key];
                                  return (
                                    <figure className="media-item" key={a.key}>
                                      <button
                                        type="button"
                                        className="media-thumb"
                                        onClick={() =>
                                          setViewer({
                                            locationId: l.id,
                                            index: i,
                                          })
                                        }
                                        title={a.note || "Open"}
                                      >
                                        {m.kind === "image" ? (
                                          <img
                                            src={m.url}
                                            alt={a.note}
                                            loading="lazy"
                                          />
                                        ) : m.kind === "video" ? (
                                          <video src={m.url} muted />
                                        ) : (
                                          <span className="media-file">
                                            {m.path.split("/").pop()}
                                          </span>
                                        )}
                                      </button>
                                      {a.note && (
                                        <figcaption className="media-caption">
                                          {a.note}
                                        </figcaption>
                                      )}
                                    </figure>
                                  );
                                })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showTask && (
      <section className="card">
        <div className="section-header">
          <h2 className="section-title">Task</h2>
        </div>

        <form className="task-form" onSubmit={addTask}>
          <label className="field field--taskid">
            <span>Task ID</span>
            <input
              value={taskForm.taskid}
              onChange={(e) =>
                setTaskForm((s) => ({ ...s, taskid: e.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Task</span>
            <input
              value={taskForm.task}
              onChange={(e) =>
                setTaskForm((s) => ({ ...s, task: e.target.value }))
              }
            />
          </label>
          <button
            type="submit"
            className="submit-button task-add"
            disabled={savingTask}
          >
            {savingTask ? "Adding…" : "Add"}
          </button>
        </form>

        {taskRows.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task ID</th>
                  <th>Task</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {taskRows.map((t) =>
                  editingTaskId === t.id ? (
                    <tr key={t.id}>
                      <td>
                        <input
                          value={taskEdit.taskid}
                          onChange={(e) =>
                            setTaskEdit((s) => ({
                              ...s,
                              taskid: e.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="cell-wrap">
                        <input
                          value={taskEdit.task}
                          onChange={(e) =>
                            setTaskEdit((s) => ({ ...s, task: e.target.value }))
                          }
                        />
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="submit-button"
                          onClick={saveEditTask}
                          disabled={savingTaskEdit}
                        >
                          {savingTaskEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={cancelEditTask}
                          disabled={savingTaskEdit}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={t.id}>
                      <td>{t.taskid}</td>
                      <td className="cell-wrap">{t.task}</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => startEditTask(t)}
                          disabled={editingTaskId !== null}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-note">No entries yet.</p>
        )}
      </section>
      )}

      {showEquipment && (
      <section className="card">
        <div className="section-header">
          <h2 className="section-title">Equipment</h2>
        </div>

        <form className="equipment-form" onSubmit={addEquipment}>
          <label className="field">
            <span>Prime Sub</span>
            <input
              value={equipForm.primeSub}
              onChange={(e) =>
                setEquipForm((s) => ({ ...s, primeSub: e.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={equipForm.model}
              onChange={(e) =>
                setEquipForm((s) => ({ ...s, model: e.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Equipment</span>
            <input
              value={equipForm.equipment}
              onChange={(e) =>
                setEquipForm((s) => ({ ...s, equipment: e.target.value }))
              }
            />
          </label>
          <button
            type="submit"
            className="submit-button equipment-add"
            disabled={savingEquipment}
          >
            {savingEquipment ? "Adding…" : "Add"}
          </button>
        </form>

        {equipmentRows.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Prime Sub</th>
                  <th>Model</th>
                  <th>Equipment</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {equipmentRows.map((eq) =>
                  editingEquipId === eq.id ? (
                    <tr key={eq.id}>
                      <td>
                        <input
                          value={equipEdit.primeSub}
                          onChange={(e) =>
                            setEquipEdit((s) => ({
                              ...s,
                              primeSub: e.target.value,
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={equipEdit.model}
                          onChange={(e) =>
                            setEquipEdit((s) => ({
                              ...s,
                              model: e.target.value,
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={equipEdit.equipment}
                          onChange={(e) =>
                            setEquipEdit((s) => ({
                              ...s,
                              equipment: e.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="submit-button"
                          onClick={saveEditEquipment}
                          disabled={savingEquipEdit}
                        >
                          {savingEquipEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={cancelEditEquipment}
                          disabled={savingEquipEdit}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={eq.id}>
                      <td>{eq.primeSub}</td>
                      <td>{eq.model}</td>
                      <td>{eq.equipment}</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => startEditEquipment(eq)}
                          disabled={editingEquipId !== null}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-note">No entries yet.</p>
        )}
      </section>
      )}

      {viewer && viewerItem && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setViewer(null)}
        >
          {/* Stop clicks inside the frame from closing the overlay. */}
          <div className="lightbox-frame" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-stage">
              {viewerItem.kind === "video" ? (
                <video src={viewerItem.url} controls autoPlay />
              ) : viewerItem.kind === "image" ? (
                <img src={viewerItem.url} alt="" />
              ) : (
                <a href={viewerItem.url} target="_blank" rel="noreferrer">
                  {viewerItem.path.split("/").pop()}
                </a>
              )}

              {count > 1 && (
                <>
                  <button
                    type="button"
                    className="lightbox-nav lightbox-nav--prev"
                    onClick={() => stepViewer(-1)}
                    aria-label="Previous"
                  >
                    &#8249;
                  </button>
                  <button
                    type="button"
                    className="lightbox-nav lightbox-nav--next"
                    onClick={() => stepViewer(1)}
                    aria-label="Next"
                  >
                    &#8250;
                  </button>
                </>
              )}
            </div>

            <div className="lightbox-note">
              <AutoGrowTextarea
                value={noteDraft}
                placeholder="Add a note for this photo…"
                onChange={(e) => setNoteDraft(e.target.value)}
              />
              <button
                type="button"
                className="submit-button"
                onClick={saveNote}
                disabled={savingNote || noteDraft === viewerNote}
              >
                {savingNote ? "Saving…" : "Save note"}
              </button>
            </div>

            <div className="lightbox-bar">
              <span className="lightbox-count">
                {viewer.index + 1} / {count}
              </span>
              <button
                type="button"
                className="submit-button danger-button"
                onClick={deleteViewerMedia}
                disabled={deletingMedia}
              >
                {deletingMedia ? "Deleting…" : "Delete photo"}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => setViewer(null)}
                disabled={deletingMedia}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="app-shell">
          <header className="app-bar">
            <span className="app-user">{user?.signInDetails?.loginId}</span>
            <button type="button" className="link-button" onClick={signOut}>
              Sign out
            </button>
          </header>
          <Workspace />
        </div>
      )}
    </Authenticator>
  );
}

export default App;
