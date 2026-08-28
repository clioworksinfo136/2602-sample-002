import { useCallback, useEffect, useRef, useState } from "react";
import type { Schema } from "../amplify/data/resource";
import { generateClient } from "aws-amplify/data";
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
  const [selected, setSelected] = useState(todayISO());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dateDays, setDateDays] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<Array<Schema["Date"]["type"]>>([]);
  const [taskRows, setTaskRows] = useState<Array<Schema["Task"]["type"]>>([]);
  const [equipmentRows, setEquipmentRows] = useState<
    Array<Schema["Equipment"]["type"]>
  >([]);

  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [savingEquipment, setSavingEquipment] = useState(false);
  const [equipForm, setEquipForm] = useState({
    primeSub: "",
    model: "",
    equipment: "",
  });
  const [savingTask, setSavingTask] = useState(false);
  const [taskForm, setTaskForm] = useState({ taskid: "", task: "" });
  // Table visibility switches (both off on startup).
  const [showTask, setShowTask] = useState(false);
  const [showEquipment, setShowEquipment] = useState(false);
  // Equipment dropdown options, seeded from the Equipment model.
  const [equipmentOptions, setEquipmentOptions] = useState<string[]>([]);
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
    const { data } = await client.models.Date.list(AUTH);
    setDateDays(new Set(data.map((d) => d.date).filter(Boolean) as string[]));
  }, []);

  // All Date entries, newest first.
  const loadEntries = useCallback(async () => {
    const { data } = await client.models.Date.list(AUTH);
    setEntries(
      [...data].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    );
  }, []);

  // All Task entries, sorted by Task ID.
  const loadTasks = useCallback(async () => {
    const { data } = await client.models.Task.list(AUTH);
    const sorted = [...data].sort((a, b) =>
      (a.taskid ?? "").localeCompare(b.taskid ?? "")
    );
    setTaskRows(sorted);
    // Default the Location form's task to the first entry (lowest taskid, 001).
    setForm((s) => ({ ...s, task: s.task || sorted[0]?.task || "" }));
  }, []);

  // All Equipment entries; also seeds the Equipment dropdown.
  const loadEquipment = useCallback(async () => {
    const { data } = await client.models.Equipment.list(AUTH);
    setEquipmentRows(data);
    const names = data
      .map((e) => e.equipment)
      .filter((n): n is string => !!n);
    setEquipmentOptions(Array.from(new Set(names)));
  }, []);

  useEffect(() => {
    loadDateDays();
    loadEntries();
    loadTasks();
    loadEquipment();
  }, [loadDateDays, loadEntries, loadTasks, loadEquipment]);

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
    } finally {
      setSavingLocation(false);
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

        {entries.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Weather</th>
                  <th>High</th>
                  <th>Low</th>
                  <th>Supervisor</th>
                  <th>Inspector</th>
                  <th>Labor</th>
                  <th>Observation</th>
                  <th>Equipment</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((d) => (
                  <tr key={d.id}>
                    <td>{d.date}</td>
                    <td>{d.weather}</td>
                    <td>{d.hight}</td>
                    <td>{d.lowt}</td>
                    <td>{d.supervisor}</td>
                    <td>{d.inspector}</td>
                    <td>{d.labor}</td>
                    <td>{d.observation}</td>
                    <td>{d.equipment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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

          <label className="field field--equipment">
            <span>Equipment</span>
            <select
              value={form.equipment}
              onChange={(e) => update("equipment", e.target.value)}
            >
              <option value="">—</option>
              {equipmentOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          </div>

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
                <option value="Assessment (Design Phase)">
                  Assessment (Design Phase)
                </option>
                <option value="Preconstruction">Preconstruction</option>
                <option value="During Construction">During Construction</option>
                <option value="After Construction">After Construction</option>
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
            </div>
          </div>
        </form>
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
                </tr>
              </thead>
              <tbody>
                {taskRows.map((t) => (
                  <tr key={t.id}>
                    <td>{t.taskid}</td>
                    <td className="cell-wrap">{t.task}</td>
                  </tr>
                ))}
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
                </tr>
              </thead>
              <tbody>
                {equipmentRows.map((eq) => (
                  <tr key={eq.id}>
                    <td>{eq.primeSub}</td>
                    <td>{eq.model}</td>
                    <td>{eq.equipment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-note">No entries yet.</p>
        )}
      </section>
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
