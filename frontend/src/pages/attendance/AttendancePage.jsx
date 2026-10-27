import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import {
    CalendarIcon,
    CheckCircle2Icon,
    CheckIcon,
    ChevronDownIcon,
    ChevronLeftIcon,
    ClipboardCheckIcon,
    DownloadIcon,
    EyeIcon,
    GaugeIcon,
    HistoryIcon,
    Loader2Icon,
    ListIcon,
    PencilIcon,
    SaveIcon,
    SearchIcon,
    UsersIcon,
    XCircleIcon,
    XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SmartImage } from "@/components/shared/SmartImage";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync, useDebounced } from "@/hooks";
import { subscribeLiveNotification } from "@/lib/liveBus";
import { downloadCsv, toCsv } from "@/lib/csv";
import { PAYMENT_METHOD_LABELS, formatDateTime, titleCase } from "@/lib/format";
import { can } from "@/lib/permissions";
import { SLOT_GROUPS, groupSlotsByTime, slotGroupOf } from "@/lib/slots";
import { cn } from "@/lib/utils";
import { AttendanceCorrectionDialog } from "./AttendanceCorrectionDialog";
import { AttendanceHistoryContent } from "./AttendanceHistoryPage";

/** Status → label, dot colour, chip classes. */
const STATUS_META = {
    present: { label: "Present", short: "P", dot: "bg-success", chip: "border-success/40 bg-success/15 text-success dark:text-success", activeText: "text-success", activeRing: "border-success bg-success", hover: "hover:border-success/40 hover:bg-success/5 hover:text-success", tick: "border-success/40 bg-success/10 text-success", tickDot: "bg-success" },
    absent: { label: "Absent", short: "A", dot: "bg-destructive", chip: "border-destructive/40 bg-destructive/15 text-destructive dark:text-destructive-foreground", activeText: "text-destructive", activeRing: "border-destructive bg-destructive", hover: "hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive", tick: "border-destructive/40 bg-destructive/10 text-destructive", tickDot: "bg-destructive" },
    leave: { label: "Leave", short: "L", dot: "bg-amber-500", chip: "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400", activeText: "text-amber-600 dark:text-amber-400", activeRing: "border-amber-500 bg-amber-500", hover: "hover:border-amber-500/40 hover:bg-amber-500/5 hover:text-amber-600 dark:hover:text-amber-400", tick: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", tickDot: "bg-amber-500" },
    holiday: { label: "Holiday", short: "H", dot: "bg-sky-500", chip: "border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400", activeText: "text-sky-600 dark:text-sky-400", activeRing: "border-sky-500 bg-sky-500", hover: "hover:border-sky-500/40 hover:bg-sky-500/5 hover:text-sky-600 dark:hover:text-sky-400", tick: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400", tickDot: "bg-sky-500" },
};
const STATUS_ORDER = ["present", "absent", "leave", "holiday"];

function StatusChip({ status }) {
    const meta = STATUS_META[status];
    if (!meta) return <Badge variant="outline">—</Badge>;
    return (<Badge variant="outline" className={cn("gap-1 font-medium tabular-nums", meta.chip)}>
      <span className={cn("size-2 shrink-0 rounded-full", meta.dot)}/>
      {meta.short}
    </Badge>);
}

/** Reference-style saved-status chip: a filled tick-circle with the letter
 *  ("⓿ P" / "⓿ A") beside it. Purely presentational — the caller attaches
 *  the click handler (usually "start editing"). */
function StatusTick({ status }) {
    const meta = STATUS_META[status];
    if (!meta) return <Badge variant="outline">—</Badge>;
    return (<span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs tabular-nums sm:gap-1.5 sm:px-2.5 sm:py-1 sm:font-bold sm:text-[13px]", meta.tick)}>
      <span className={cn("inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-white sm:size-4", meta.tickDot)}>
        <CheckIcon className="size-2 sm:size-2.5" strokeWidth={3}/>
      </span>
      {meta.short}
    </span>);
}

/** Latest payment method chip (Cash / UPI / …). */
function PaymentChip({ method }) {
    if (!method) return <span className="text-xs text-muted-foreground">—</span>;
    return (<span className="rounded-full border border-border/70 bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
      {PAYMENT_METHOD_LABELS[method] ?? titleCase(method)}
    </span>);
}

/** Mark-tab roster fields (Slot · Time · Date · Search), shared by both
 *  layouts of the redesigned mobile view:
 *  - variant="chip": phones only — a compact wrapping pill row placed under
 *    the tab bar (slot-group chip, time chip, clickable date chip, search
 *    field), then the roster flows as plain student cards.
 *  - variant="inline": sm+ toolbar row — unchanged desktop flow, h-8 fields. */
function SlotFilters({ variant, slotsLoading, activeSlots, loadAll, slotGroup, slotPick, markDate, studentQuery, groupedSlots, currentGroupSlots, onSlotGroup, onSlotPick, onDate, onSearch }) {
    const chip = variant === "chip";
    const disabled = slotsLoading || activeSlots.length === 0 || loadAll;
    const groupOpts = (<>
      <option value="all">{chip ? "All" : "Slot: All"}</option>
      {SLOT_GROUPS.map((group) => {
        const gs = groupedSlots[group.key] ?? [];
        // Distinct students enroled across the group's slots (not a
        // record/slot count — one student in 2 slots = 1).
        const students = distinctStudentsOf(gs);
        return (<option key={group.key} value={group.key} disabled={gs.length === 0}>
          {group.label.replace(/\s+Slots$/, "")}{gs.length === 0 ? " (none)" : ` (${students})`}
        </option>);
      })}
    </>);
    const timeOpts = (<>
      <option value="" disabled>Slot Timings</option>
      <option value="__all__">
        Select All ({distinctStudentsOf(currentGroupSlots)})
      </option>
      {slotGroup === "all"
        ? SLOT_GROUPS.map((group) => {
            const gs = groupedSlots[group.key] ?? [];
            if (gs.length === 0) return null;
            return (<optgroup key={group.key} label={group.label.replace(/\s+Slots$/, "")}>
              {gs.map((s) => (<option key={s.id} value={s.id}>
                {fmtSlotTime(s.startTime)} – {fmtSlotTime(s.endTime)} ({s.enrolledCount ?? 0})
              </option>))}
            </optgroup>);
          })
        : currentGroupSlots.map((s) => (<option key={s.id} value={s.id}>
            {fmtSlotTime(s.startTime)} – {fmtSlotTime(s.endTime)} ({s.enrolledCount ?? 0})
          </option>))}
    </>);

    if (chip) {
      const pillCls = "h-8 w-full min-w-0 rounded-full border border-border/70 bg-secondary px-2 text-[11px] font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";
      return (<div className="grid grid-cols-2 gap-2 sm:hidden">
        <span className="relative inline-flex">
          <select aria-label="Slot group" className={`${pillCls} appearance-none pr-6`} disabled={disabled} value={slotGroup} onChange={(e) => onSlotGroup(e.target.value)}>{groupOpts}</select>
          <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
        </span>
        <span className="relative inline-flex">
          <select aria-label="Slot timing" className={`${pillCls} appearance-none pr-6`} disabled={disabled} value={slotPick} onChange={(e) => onSlotPick(e.target.value)}>{timeOpts}</select>
          <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
        </span>
        <label className="relative inline-flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-full border border-border/70 bg-secondary px-2 text-[11px] font-medium text-foreground" title="Change date">
          <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground"/>
          <span className="truncate">{format(new Date(`${markDate}T00:00:00`), "d-M-yyyy")}</span>
          <input
            type="date"
            aria-label="Session date"
            value={markDate}
            onChange={(e) => { if (e.target.value) onDate(e.target.value); }}
            onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* older browsers: focused input still opens on click */ } }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <div className="relative h-8">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
          <Input aria-label="Search student" placeholder="Search" value={studentQuery} onChange={(e) => onSearch(e.target.value)} className="h-8 w-full rounded-full border-input bg-secondary pl-7 pr-2 text-[11px]"/>
        </div>
      </div>);
    }

    return (<div className="hidden sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-1.5">
      <select
        aria-label="Slot"
        className="h-8 w-auto rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        disabled={disabled}
        value={slotGroup}
        onChange={(e) => onSlotGroup(e.target.value)}
      >
        {groupOpts}
      </select>
      <select
        aria-label="Slot Timings"
        className="h-8 w-auto rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 sm:max-w-52"
        disabled={disabled}
        value={slotPick}
        onChange={(e) => onSlotPick(e.target.value)}
      >
        {timeOpts}
      </select>
      <Input aria-label="Session date" type="date" value={markDate} onChange={(e) => onDate(e.target.value)} className="h-8 w-36 rounded-md bg-background text-xs"/>
      <div className="relative w-40">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
        <Input aria-label="Search student" placeholder="Search student" value={studentQuery} onChange={(e) => onSearch(e.target.value)} className="h-8 w-full rounded-md border-input bg-background pl-7 text-xs"/>
      </div>
    </div>);
}

/** Paid-class quota chip for the register — "4 left".
 *  Colour rule: 4+ left green · 3–2 yellow · 1 or 0 red. Rounded pill corners. */
function ClassLeftChip({ quota }) {
    if (!quota) return <span className="text-xs text-muted-foreground">—</span>;
    const tone = quota.remaining >= 4
        ? "border-success/40 bg-success/15 text-success dark:text-success"
        : quota.remaining >= 2
            ? "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400";
    return (<Badge variant="outline" className={cn("rounded-full font-semibold tabular-nums", tone)}>
      {quota.remaining} left
      {quota.exceeded > 0 ? ` · ${quota.exceeded} over` : ""}
    </Badge>);
}

/** A stat card for the header strip (Total Students / Present / Absent / Rate). */
function StatCard({ label, value, icon, tone }) {
    const tones = {
        neutral: "bg-primary/15 text-primary",
        present: "bg-success text-white",
        absent: "bg-destructive text-white",
        rate: "bg-info text-white",
    };
    return (<Card className="graphite-surface border-border/70 py-0">
      <CardContent className="flex items-center justify-between gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[9px] font-medium leading-tight tracking-wide text-muted-foreground sm:text-[10px]">{label}</p>
          <p className="text-base font-bold leading-tight tracking-tight tabular-nums sm:text-lg sm:font-semibold">{value}</p>
        </div>
        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full sm:size-6 sm:rounded-md", tones[tone] ?? tones.neutral)}>
          {icon}
        </span>
      </CardContent>
    </Card>);
}

const ymdOf = (d) => format(d, "yyyy-MM-dd");

/** "HH:mm" → minutes since midnight (NaN on junk). */
const toMin = (hhmm) => {
    const [h, m] = String(hhmm ?? "").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

/** Format a plain "HH:mm" studio time as "8:00 AM" (12-hour clock + AM/PM). */
function fmtSlotTime(hhmm) {
    const m = toMin(hhmm);
    if (!Number.isFinite(m)) return "";
    const h24 = Math.floor(m / 60);
    const mins = String(m % 60).padStart(2, "0");
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${mins} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Distinct students across a list of slots (not a record count — a student
 *  enrolled in 2 slots = 1). Prefers the API's enrolledMemberIds, falls back
 *  to enrolment counts when the ids aren't shipped. */
const distinctStudentsOf = (list) => {
    const ids = new Set();
    let fallback = 0;
    for (const s of list) {
        if (Array.isArray(s?.enrolledMemberIds) && s.enrolledMemberIds.length > 0) {
            s.enrolledMemberIds.forEach((mid) => ids.add(String(mid)));
        } else {
            fallback += s?.enrolledCount ?? 0;
        }
    }
    return ids.size || fallback;
};

/** Dot colour per time-of-day group, so a student's batch reads at a glance. */
const GROUP_DOT = {
    morning: "bg-amber-500",
    afternoon: "bg-orange-500",
    evening: "bg-sky-500",
};

/**
 * Pick the slot to preselect for marking: the one running RIGHT NOW,
 * else the next one to start later today, else the first active slot.
 * Returns null when there are no active slots.
 */
function pickLiveSlot(activeSlots, now = new Date()) {
    if (!activeSlots.length) return null;
    const weekday = now.getDay();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today = activeSlots.filter((s) => Array.isArray(s.weekdays) && s.weekdays.includes(weekday));
    // Currently running: start <= now < end.
    const running = today.find((s) => toMin(s.startTime) <= nowMin && nowMin < toMin(s.endTime));
    if (running) return running;
    // Next to start today (after now).
    const upcoming = today
        .filter((s) => toMin(s.startTime) > nowMin)
        .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    if (upcoming.length) return upcoming[0];
    return activeSlots[0];
}

export function AttendancePage() {
    const data = useData();
    const { session } = useAuth();
    const canCorrect = can(session?.profile.role, "attendance.correct");

    /* --------------------- tab state (mark | view | history) ------------------ */
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get("tab");
    const activeTab = tabParam === "view" || tabParam === "history" || tabParam === "all" ? tabParam : "mark";
    const setTab = (value) => {
        const next = new URLSearchParams(searchParams);
        if (value === "mark") next.delete("tab"); else next.set("tab", value);
        setSearchParams(next, { replace: true });
    };

    /* Mark-tab filter handlers — shared by the mobile grid and the sm+ toolbar. */
    const handleSlotGroup = (value) => {
        setLoadAll(false);
        setSlotGroup(value);
        setSlotPick("");
    };
    const handleSlotPick = (value) => {
        if (value === "") { setSlotPick(""); return; }
        setLoadAll(false);
        setSlotPick(value);
    };

    /* ------------------------------ header stats ----------------------------- */
    const [summaryDate] = useState(() => ymdOf(new Date()));
    const summary = useAsync(() => data.getClassDaySummary(summaryDate), [data, summaryDate]);

    /* ------------------------------ mark section ----------------------------- */
    const slots = useAsync(() => data.listClassSlots(), [data]);
    const activeSlots = useMemo(() => (slots.data ?? []).filter((s) => s.isActive), [slots.data]);

    // One two-level "Slot" dropdown (Morning / Afternoon / Evening → that
    // group's time slots). Only one group can be open at a time. Within it the
    // pick is either "__all__" (Select All Slots) or a single class-slot id.
    const [slotGroup, setSlotGroup] = useState("all"); // "all"|"morning"|"afternoon"|"evening"
    const [slotPick, setSlotPick] = useState(""); // slotId | "__all__" | ""
    const [loadAll, setLoadAll] = useState(false); // Load All → every active slot's students
    const [markDate, setMarkDate] = useState(() => ymdOf(new Date()));
    const [loadedQuery, setLoadedQuery] = useState(null); // { slotIds: [], date }

    const groupedSlots = useMemo(() => groupSlotsByTime(activeSlots, "startTime"), [activeSlots]);
    /* Two cascading dropdowns: "Slot" (All/Morning/Afternoon/Evening) and
       "Slot Timings" (that scope's time slots). */
    const currentGroupSlots = slotGroup === "all" ? activeSlots : (groupedSlots[slotGroup] ?? []);
    const activeGroup = slotGroup === "all" ? null : (SLOT_GROUPS.find((g) => g.key === slotGroup) ?? null);

    // Which class slots the current pick resolves to.
    const selectedSlotIds = useMemo(() => {
        if (loadAll) return activeSlots.map((s) => s.id);
        if (!slotPick) return [];
        const list = slotGroup === "all" ? activeSlots : (groupedSlots[slotGroup] ?? []);
        if (slotPick === "__all__") return list.map((s) => s.id);
        return list.some((s) => s.id === slotPick) ? [slotPick] : [];
    }, [loadAll, slotGroup, slotPick, groupedSlots, activeSlots]);
    const [statuses, setStatuses] = useState({}); // memberId -> attendance status (local, unsaved)
    const [savedStatuses, setSavedStatuses] = useState({}); // last persisted statuses
    const [savingId, setSavingId] = useState(null); // single-row save (edit mode)
    const [savingAll, setSavingAll] = useState(false); // bulk Save button
    const [editingId, setEditingId] = useState(null); // saved row being edited
    const [studentQuery, setStudentQuery] = useState("");

    // Auto-select the live (or next) slot ONCE so the panel opens on whichever
    // class is running right now. A ref guard keeps it from re-picking after
    // the admin clears the selection (that made the Clear button look broken).
    const autoPickedRef = useRef(false);
    useEffect(() => {
        if (autoPickedRef.current || activeSlots.length === 0) return;
        const pick = pickLiveSlot(activeSlots);
        autoPickedRef.current = true;
        if (pick) {
            setSlotGroup(slotGroupOf(pick.startTime) ?? "morning");
            setSlotPick(pick.id);
        }
        // Only on first load — never after a manual Clear.
    }, [activeSlots]);

    // Load the roster automatically whenever the selection/date changes.
    const selectedKey = selectedSlotIds.join(",");
    useEffect(() => {
        if (!selectedKey) {
            setLoadedQuery(null);
            return;
        }
        setLoadedQuery({ slotIds: selectedKey.split(","), date: markDate });
    }, [selectedKey, markDate]);

    // Combined roster: fetch every selected slot's roster in parallel and merge
    // students (deduped by member), tagging each with the slot they belong to
    // so Save marks every student in their OWN slot.
    const roster = useAsync(async () => {
        if (!loadedQuery || loadedQuery.slotIds.length === 0) return null;
        if (loadedQuery.slotIds.length === 1) {
            const single = await data.getClassRoster(loadedQuery.slotIds[0], loadedQuery.date);
            if (!single) return single;
            return {
                ...single,
                students: (single.students ?? []).map((s) => ({ ...s, slotId: loadedQuery.slotIds[0] })),
            };
        }
        const results = await Promise.all(loadedQuery.slotIds.map((id) => data.getClassRoster(id, loadedQuery.date)));
        // Every slot now returns the full studio roster — keep one row per
        // student, preferring the slot they are actually enrolled in so Save
        // attributes the mark to the right batch.
        const byId = new Map();
        results.forEach((result, index) => {
            const slotId = loadedQuery.slotIds[index];
            for (const s of result.students ?? []) {
                const prev = byId.get(s.memberId);
                if (!prev || (s.enrolled && !prev.enrolled)) {
                    byId.set(s.memberId, { ...s, slotId });
                }
            }
        });
        return { students: [...byId.values()], date: loadedQuery.date };
    }, [data, loadedQuery], { enabled: !!loadedQuery && loadedQuery.slotIds.length > 0 });

    // Seed the status map from the roster whenever it loads.
    useEffect(() => {
        if (!roster.data?.students) return;
        const next = {};
        for (const s of roster.data.students) next[s.memberId] = s.attendanceStatus ?? null;
        setStatuses(next);
        setSavedStatuses(next);
        setEditingId(null);
    }, [roster.data]);

    // Only students actually ENROLLED in one of the selected slots — the
    // backend returns the full studio roster for every slot, so without this
    // filter a group/"Load All" pick drags evening/other-batch students into
    // a morning roster. Filtering here (not at display) also keeps walk-in
    // search honest: an evening kid typed into the search shows up as a
    // walk-in instead of echoing a hidden roster row.
    const students = useMemo(() => (roster.data?.students ?? []).filter((s) => s.enrolled), [roster.data]);
    // Filter the loaded roster by student name or ID.
    const filteredStudents = useMemo(() => {
        const q = studentQuery.trim().toLowerCase();
        if (!q) return students;
        return students.filter((s) => (s.fullName ?? "").toLowerCase().includes(q) ||
            (s.memberCode ?? "").toLowerCase().includes(q));
    }, [students, studentQuery]);

    /* ------------------------------ walk-in students ------------------------- */
    // Students from OTHER slots who show up at a different time: search finds
    // them outside the loaded roster and the admin can mark them present/absent
    // for this session directly.
    const debouncedQuery = useDebounced(studentQuery, 300);
    const walkInSearch = useAsync(() => (debouncedQuery.trim()
        ? data.listMembers({ search: debouncedQuery.trim(), pageSize: 5 })
        : Promise.resolve({ items: [] })), [data, debouncedQuery], { enabled: debouncedQuery.trim().length > 0 });
    const rosterIds = useMemo(() => new Set(students.map((s) => s.memberId)), [students]);
    const walkIns = useMemo(() => (walkInSearch.data?.items ?? []).filter((m) => !rosterIds.has(m.id) && m.status === "active"), [walkInSearch.data, rosterIds]);
    const [walkInSavingId, setWalkInSavingId] = useState(null);
    const markWalkIn = async (memberId, status) => {
        // Walk-ins land in the first selected slot of the active group.
        const slotId = loadedQuery?.slotIds?.[0];
        if (!slotId) return;
        setWalkInSavingId(memberId);
        try {
            const result = await data.markClassAttendance({ slotId, date: markDate, memberId, method: "class" });
            if (result.status === "ok") {
                toast.success(`Marked ${status}`);
                roster.reload();
            }
            else {
                toast.error(result.message ?? "Could not mark attendance.");
            }
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to mark attendance.");
        }
        setWalkInSavingId(null);
    };

    const persist = async (marks) => {
        try {
            // A combined roster spans several class slots — group each student's
            // mark by their own slot and commit one request per slot.
            const bySlot = new Map();
            const slotOf = new Map(students.map((s) => [s.memberId, s.slotId ?? loadedQuery?.slotIds?.[0]]));
            for (const m of marks) {
                const sid = slotOf.get(m.memberId) ?? loadedQuery?.slotIds?.[0];
                if (!sid) continue;
                if (!bySlot.has(sid)) bySlot.set(sid, []);
                bySlot.get(sid).push(m);
            }
            let total = 0;
            for (const [sid, slotMarks] of bySlot) {
                const result = await data.markRosterAttendance({ slotId: sid, date: loadedQuery.date, marks: slotMarks });
                if (result.status !== "ok") {
                    toast.error(result.message ?? "Could not save attendance.");
                    return false;
                }
                total += result.marked ?? slotMarks.length;
            }
            toast.success(`Saved ${total} ${total === 1 ? "student" : "students"}`);
            roster.reload(); // seed effect re-syncs statuses + savedStatuses from the server
            summary.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save attendance.");
            return false;
        }
    };

    // Rows whose local selection differs from the last saved state.
    const pendingCount = students.filter((s) => statuses[s.memberId] && (statuses[s.memberId] ?? null) !== (savedStatuses[s.memberId] ?? null)).length;
    const hasChanges = pendingCount > 0;

    // Clicking a status before saving = local selection only (no API call).
    const selectStatus = (memberId, status) => {
        setStatuses((prev) => ({ ...prev, [memberId]: status }));
    };

    // Bulk Save — persists every pending mark at once.
    const saveAll = async () => {
        setSavingAll(true);
        const marks = students
            .filter((s) => statuses[s.memberId])
            .map((s) => ({ memberId: s.memberId, status: statuses[s.memberId] }));
        if (marks.length > 0) await persist(marks);
        setSavingAll(false);
    };

    // Independent per-student edit (after a save) — persists that one row immediately.
    const saveStudent = async (memberId, status) => {
        setStatuses((prev) => ({ ...prev, [memberId]: status }));
        setSavingId(memberId);
        const ok = await persist([{ memberId, status }]);
        setSavingId(null);
        if (ok) setEditingId(null);
    };

    // The class slots behind the current pick (1 for a single slot, many for Select All).
    const selectedSlots = useMemo(() => selectedSlotIds
        .map((id) => activeSlots.find((s) => s.id === id))
        .filter(Boolean), [selectedSlotIds, activeSlots]);

    /* ------------------------------- view section ---------------------------- */
    const [viewSlotId, setViewSlotId] = useState("all");
    const [viewDate, setViewDate] = useState(() => ymdOf(new Date()));
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState(null); // attendance record being corrected

    const dayRange = useMemo(() => {
        const [y, m, d] = viewDate.split("-").map(Number);
        const start = new Date(y, m - 1, d);
        return { from: start.toISOString(), to: new Date(start.getTime() + 86_399_999).toISOString() };
    }, [viewDate]);

    const list = useAsync(() => data.listAttendance({ from: dayRange.from, to: dayRange.to, page: 1, pageSize: 100 }), [data, dayRange]);

    /* --------- View All: attendance by day — one date chip, no filters ------- */
    const [viewAllDate, setViewAllDate] = useState(() => ymdOf(new Date()));
    const viewAllRange = useMemo(() => {
        const [y, m, d] = viewAllDate.split("-").map(Number);
        const start = new Date(y, m - 1, d);
        return { from: start.toISOString(), to: new Date(start.getTime() + 86_399_999).toISOString() };
    }, [viewAllDate]);
    const viewAllList = useAsync(() => data.listAttendance({ from: viewAllRange.from, to: viewAllRange.to, page: 1, pageSize: 100 }), [data, viewAllRange]);
    const viewAllRows = useMemo(() => (viewAllList.data?.items ?? []).filter((r) => r.attendanceStatus), [viewAllList.data]);
    const viewAllLabel = format(new Date(`${viewAllDate}T00:00:00`), "EEE, d MMM yyyy");

    // Class-attendance rows only (those carry an attendanceStatus).
    const classRows = useMemo(() => {
        const rows = (list.data?.items ?? []).filter((r) => r.attendanceStatus);
        return rows;
    }, [list.data]);

    const filteredRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return classRows.filter((r) => {
            if (viewSlotId !== "all" && String(r.classSlotId ?? "") !== viewSlotId) return false;
            if (q && !(`${r.memberName ?? ""} ${r.memberCode ?? ""}`.toLowerCase().includes(q))) return false;
            return true;
        });
    }, [classRows, viewSlotId, search]);

    /* Live refresh — students can scan the studio QR from the door and mark
       themselves present server-side. The Topbar broadcasts every newly
       polled notification; a burst reloads the roster, register and state
       cards so the page updates in real time (never over staff's unsaved
       local P/L/A picks, and throttled so one burst = one reload). */
    const hasUnsavedMarks = useMemo(() => students.some((s) => (statuses[s.memberId] ?? null) !== (savedStatuses[s.memberId] ?? null)), [students, statuses, savedStatuses]);
    const lastLiveReloadRef = useRef(0);
    useEffect(() => subscribeLiveNotification(() => {
        const now = Date.now();
        if (hasUnsavedMarks || now - lastLiveReloadRef.current < 2500)
            return;
        lastLiveReloadRef.current = now;
        summary.reload();
        roster.reload();
        list.reload();
    }), [hasUnsavedMarks, summary.reload, roster.reload, list.reload]);

    /** slotId → slot lookup, so a row can show its class time ("7:00 AM – 8:15 AM").
     *  Uses the FULL slot list (not just active) so archived slots still resolve. */
    const slotById = useMemo(() => new Map((slots.data ?? []).map((s) => [String(s.id), s])), [slots.data]);
    /** "HH:mm-HH:mm" → slot, so a student's preferred slot still resolves even
     *  when they aren't formally enrolled in a batch yet. */
    const slotByTime = useMemo(
        () => new Map((slots.data ?? []).map((s) => [`${s.startTime}-${s.endTime}`, s])),
        [slots.data],
    );

    /** DISTINCT students enroled across a set of slots — a student in two
     *  morning batches counts once ("Morning (5)", not "(11)"). Sums the
     *  per-slot counts only as a fallback for cached API responses that
     *  predate `enrolledMemberIds`. */
    const slotTimeOf = (row) => {
        const start = row.slotStartTime;
        const end = row.slotEndTime;
        if (start && end) return `${fmtSlotTime(start)} – ${fmtSlotTime(end)}`;
        const slot = slotById.get(String(row.classSlotId ?? row.meta?.slotId ?? ""));
        if (!slot?.startTime || !slot?.endTime) return null;
        return `${fmtSlotTime(slot.startTime)} – ${fmtSlotTime(slot.endTime)}`;
    };

    /** Format one batch as "Morning · 8:00 AM – 9:00 AM" (or just its time). */
    const formatSlot = (slot) => {
        const group = SLOT_GROUPS.find((g) => g.key === slotGroupOf(slot.startTime));
        const time = slot.startTime && slot.endTime
            ? `${fmtSlotTime(slot.startTime)} – ${fmtSlotTime(slot.endTime)}`
            : "";
        if (!group) return time || slot.name || "Class";
        const short = group.label.replace(/\s+Slots$/, "");
        return time ? `${short} · ${time}` : short;
    };

    /** Which batch a roster student belongs to → { key, text, count, extras }.
     *  e.g. { key: "morning", text: "Morning · 8:00 AM – 9:00 AM", count: 2, extras: "…" }.
     *  Prefers their actual enrolments, falling back to their preferred slot.
     *  `count`/`extras` power the "+N" hover that lists the other batches. */
    const slotLabelOf = (s) => {
        const ids = Array.isArray(s?.enrolledSlotIds) && s.enrolledSlotIds.length > 0
            ? s.enrolledSlotIds
            : (s?.slotId ? [s.slotId] : []);
        const preferred = s?.preferredSlot ? slotByTime.get(String(s.preferredSlot)) ?? null : null;
        const primary = slotById.get(String(ids[0] ?? "")) ?? preferred;
        if (!primary) return null;
        const extras = ids.slice(1).map((id) => slotById.get(String(id))).filter(Boolean).map(formatSlot);
        const extrasText = extras.length > 0 ? `Also enrolled:\n${extras.join("\n")}` : "";
        return {
            key: slotGroupOf(primary.startTime) ?? null,
            text: formatSlot(primary),
            count: extras.length,
            extras: extrasText,
        };
    };


    const handleExport = () => {
        if (filteredRows.length === 0) {
            toast.info("Nothing to export for this day.");
            return;
        }
        const indexed = filteredRows.map((row, index) => ({ row, index }));
        downloadCsv(`attendance-${viewDate}`, toCsv(indexed, [
            { header: "Sr. no.", accessor: (r) => r.index + 1 },
            { header: "Student", accessor: (r) => r.row.memberName ?? "" },
            { header: "Student ID", accessor: (r) => r.row.memberCode ?? "" },
            { header: "Payment Mode", accessor: (r) => (r.row.paymentMethod ? PAYMENT_METHOD_LABELS[r.row.paymentMethod] ?? titleCase(r.row.paymentMethod) : "") },
            { header: "Classes", accessor: (r) => (r.row.quota ? `${r.row.quota.attended}/${r.row.quota.quota}` : "") },
            { header: "Class Left", accessor: (r) => (r.row.quota ? r.row.quota.remaining : "") },
            { header: "Slot Time", accessor: (r) => slotTimeOf(r.row) ?? "" },
            { header: "Date", accessor: (r) => r.row.sessionDate ?? "" },
            { header: "Status", accessor: (r) => STATUS_META[r.row.attendanceStatus]?.label ?? "" },
            { header: "Marked By", accessor: (r) => r.row.scannerName ?? "" },
        ]));
        toast.success(`Exported ${filteredRows.length} records`);
    };

    const summaryData = summary.data;

    return (<div className="space-y-8">
      {/* ------------------------------- Header ------------------------------- */}
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-1 sm:space-y-2">
          <div className="flex items-center gap-1.5 text-km-gold sm:gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-km-gold/30 bg-km-gold/10 sm:size-6">
              <ChevronLeftIcon className="size-3 sm:size-3.5"/>
            </span>
            <span className="text-xs font-medium sm:text-sm">Attendance</span>
          </div>
          <h1 className="font-sans text-lg font-bold tracking-tight sm:text-3xl sm:font-semibold">Manage Attendance</h1>
          <p className="max-w-xl text-xs text-muted-foreground sm:text-sm">
            Mark attendance for students and view past records — all in one place.
          </p>
        </div>
        <div className="grid w-full grid-cols-4 gap-1.5 sm:gap-3 xl:w-auto">
          <StatCard label="Total Students" value={summaryData?.totalStudents ?? 0} icon={<UsersIcon className="size-4"/>} tone="neutral"/>
          <StatCard label="Present Today" value={summaryData?.presentToday ?? 0} icon={<CheckCircle2Icon className="size-4"/>} tone="present"/>
          <StatCard label="Absent Today" value={summaryData?.absentToday ?? 0} icon={<XCircleIcon className="size-4"/>} tone="absent"/>
          <StatCard label="Attendance Rate" value={`${summaryData?.attendanceRate ?? 0}%`} icon={<GaugeIcon className="size-4"/>} tone="rate"/>
        </div>
      </div>

      {/* ------------- Tabs: Mark | View | Attendance history ------------- */}
      <Tabs defaultValue="mark" value={activeTab} onValueChange={setTab} className="space-y-6">
      <TabsList className="h-auto w-full rounded-full justify-start gap-1 bg-muted p-1.5" style={{ height: "auto" }}>
          <TabsTrigger value="mark" className="h-11 flex-1 rounded-full px-2 py-0 text-[11px] font-medium [&>svg]:text-foreground/80 data-[state=active]:font-semibold data-[state=active]:[&>svg]:text-primary sm:h-auto sm:flex-none sm:px-4 sm:py-1 sm:text-sm">
            <ClipboardCheckIcon className="size-4"/>
            <span className="sm:hidden">Mark</span>
            <span className="hidden sm:inline">Mark Attendance</span>
          </TabsTrigger>
          <span aria-hidden="true" className="h-5 w-px shrink-0 self-center bg-foreground/15"/>
          <TabsTrigger value="view" className="h-11 flex-1 rounded-full px-2 py-0 text-[11px] font-medium [&>svg]:text-foreground/80 data-[state=active]:font-semibold data-[state=active]:[&>svg]:text-primary sm:h-auto sm:flex-none sm:px-4 sm:py-1 sm:text-sm">
            <EyeIcon className="size-4"/>
            <span className="sm:hidden">View</span>
            <span className="hidden sm:inline">View Attendance</span>
          </TabsTrigger>
          <span aria-hidden="true" className="h-5 w-px shrink-0 self-center bg-foreground/15"/>
          <TabsTrigger value="history" className="h-11 flex-1 rounded-full px-2 py-0 text-[11px] font-medium [&>svg]:text-foreground/80 data-[state=active]:font-semibold data-[state=active]:[&>svg]:text-primary sm:h-auto sm:flex-none sm:px-4 sm:py-1 sm:text-sm">
            <HistoryIcon className="size-4"/>
            <span className="sm:hidden">History</span>
            <span className="hidden sm:inline">Attendance History</span>
          </TabsTrigger>
          <span aria-hidden="true" className="h-5 w-px shrink-0 self-center bg-foreground/15"/>
          <TabsTrigger value="all" className="h-11 flex-1 rounded-full px-2 py-0 text-[11px] font-medium [&>svg]:text-foreground/80 data-[state=active]:font-semibold data-[state=active]:[&>svg]:text-primary sm:h-auto sm:flex-none sm:px-4 sm:py-1 sm:text-sm">
            <ListIcon className="size-4"/>
            <span>View All</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mark">
        {/* Mobile: roster filters sit right under the tab bar, outside the
            card — the roster below is its own card (mobile-first spec). */}
        <div className="mb-3 sm:hidden">
          <SlotFilters
            variant="chip"
            slotsLoading={slots.loading}
            activeSlots={activeSlots}
            loadAll={loadAll}
            slotGroup={slotGroup}
            slotPick={slotPick}
            markDate={markDate}
            studentQuery={studentQuery}
            groupedSlots={groupedSlots}
            currentGroupSlots={currentGroupSlots}
            onSlotGroup={handleSlotGroup}
            onSlotPick={handleSlotPick}
            onDate={setMarkDate}
            onSearch={setStudentQuery}
          />
        </div>
      <Card className="rounded-none border-0 bg-transparent py-0 shadow-none sm:rounded-xl sm:border sm:border-border/70 sm:bg-card sm:py-6 sm:shadow-sm">
        <CardContent className="space-y-2.5 p-2 sm:space-y-5 sm:p-5">

          {(loadAll || slotPick) ? (() => {
            const instructorNames = [...new Set(selectedSlots
              .map((s) => s.instructorName)
              .filter(Boolean))];
            const slotCountText = loadAll || slotPick === "__all__"
              ? `${selectedSlots.length} slots`
              : `${selectedSlots.length} slot`;
            const detailText = loadAll
              ? `${selectedSlots.length} slots — every student loaded, each saved to their own slot`
              : slotPick === "__all__"
                ? `${selectedSlots.length} slots selected — each student is saved to their own slot`
                : `${selectedSlots.length} slot selected`;
            return (<>
              {/* Mobile: small compact chips (the long explanation rides as a tooltip) */}
              <div className="flex flex-wrap items-center gap-1.5 sm:hidden">
                <span className="inline-flex items-center rounded-full border border-border/70 bg-secondary px-2 py-0.5 text-[10px] font-medium text-foreground" title={detailText}>
                  {slotCountText}
                </span>
                {instructorNames.length > 0 ? (<Badge variant="outline" className="max-w-32 gap-1 border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <UsersIcon className="size-2.5 shrink-0"/> <span className="truncate">{instructorNames.join(", ")}</span>
                  </Badge>) : (<span className="text-[10px] text-muted-foreground">No instructor</span>)}
                <Button size="sm" variant="ghost" className="h-6 gap-0.5 rounded-full px-1.5 text-[10px]" aria-label="Clear slot selection" onClick={() => {
                  setLoadAll(false);
                  setSlotGroup("all");
                  setSlotPick("");
                }}>
                  <XIcon className="size-2.5"/> Clear
                </Button>
              </div>
              {/* sm+: descriptive info row */}
              <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex">
                <span className="font-semibold text-foreground">{loadAll ? "Load All:" : slotGroup === "all" ? "All Slots:" : `${activeGroup?.label}:`}</span>
                {detailText}
                {instructorNames.length > 0 ? (<Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 px-2 py-0 font-medium text-primary">
                    <UsersIcon className="size-3"/> {instructorNames.join(", ")}
                  </Badge>) : (<span>No instructor assigned</span>)}
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" aria-label="Clear slot selection" onClick={() => {
                  setLoadAll(false);
                  setSlotGroup("all");
                  setSlotPick("");
                }}>
                  <XIcon className="size-3"/> Clear
                </Button>
              </div>
            </>);
          })() : null}

          {/* Students panel — mobile: the "Students (n)" row hides (chips +
              info line carry the context); sm+ shows the boxed roster with
              its heading and inline filters. */}
          <div className="rounded-none border-0 sm:rounded-xl sm:border sm:border-border/70">
            <div className="hidden flex-wrap items-center justify-between gap-3 sm:flex sm:border-b sm:border-border/70 sm:px-4 sm:py-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UsersIcon className="size-4 text-muted-foreground"/>
                Students{" "}
                <span className="text-muted-foreground">
                  ({filteredStudents.length === students.length
                    ? students.length
                    : `${filteredStudents.length}/${students.length}`})
                </span>
              </div>
              {/* Compact filters: Slot | Slot Timings | Date | Search student.
                  Mobile: a labelled 2×2 grid (mockup layout); sm+ keeps the
                  inline row. The <label> wrappers collapse via sm:contents so
                  the sm+ flow is byte-identical to before. */}
              <SlotFilters
                variant="inline"
                slotsLoading={slots.loading}
                activeSlots={activeSlots}
                loadAll={loadAll}
                slotGroup={slotGroup}
                slotPick={slotPick}
                markDate={markDate}
                studentQuery={studentQuery}
                groupedSlots={groupedSlots}
                currentGroupSlots={currentGroupSlots}
                onSlotGroup={handleSlotGroup}
                onSlotPick={handleSlotPick}
                onDate={setMarkDate}
                onSearch={setStudentQuery}
              />
            </div>

            {!loadedQuery ? (<div className="flex flex-col items-center gap-2 px-2 py-5 text-center sm:px-4 sm:py-12">
                <span className="flex size-12 items-center justify-center rounded-full border border-km-gold/30 bg-km-gold/10 text-km-gold">
                  <UsersIcon className="size-5"/>
                </span>
                <p className="text-sm font-medium">Pick a slot timing to load students</p>
                <p className="text-xs text-muted-foreground">Students will appear here to mark their attendance.</p>
              </div>) : roster.loading ? (<div className="px-2 py-5 text-center text-sm text-muted-foreground sm:px-4 sm:py-8">Loading students…</div>) : students.length === 0 ? (<div className="px-2 py-5 text-center text-sm text-muted-foreground sm:px-4 sm:py-8">
                No student in this slot.
              </div>) : filteredStudents.length === 0 ? (<div className="px-2 py-5 text-center text-sm text-muted-foreground sm:px-4 sm:py-8">
                No students match “{studentQuery.trim()}”.
              </div>) : (<ul className="space-y-2 p-0 sm:space-y-0 sm:divide-y sm:divide-border/60 sm:p-0">
                {filteredStudents.map((s) => {
              const saved = savedStatuses[s.memberId] ?? null;
              const isEditing = editingId === s.memberId;
              const isSaved = Boolean(saved) && !isEditing;
              const enrolled = slotLabelOf(s);
              return (<li key={s.memberId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:rounded-none sm:border-0 sm:px-4 sm:py-3 sm:shadow-none">
                    <div className="flex min-w-0 items-center gap-3">
                      <SmartImage src={s.photoUrl} name={s.fullName ?? "Student"} className="size-8 shrink-0"/>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{s.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="block truncate sm:inline">{s.memberCode ?? "—"}</span>
                          {/* Quota chips beside the ID — mirrors the students-page
                              tone rule (4+ left green · 2–3 yellow · 0–1 red). */}
                          {s.quota && s.quota.status !== "none" ? (() => {
                            const tone = s.quota.status === "exceeded" || s.quota.status === "expired" || s.quota.remaining < 2
                              ? "border-destructive/30 bg-destructive/10 text-destructive"
                              : s.quota.remaining < 4
                                ? "border-warning/30 bg-warning/10 text-warning"
                                : "border-success/30 bg-success/10 text-success";
                            const left = s.quota.status === "exceeded"
                              ? `${s.quota.exceeded} over`
                              : s.quota.status === "expired"
                                ? "0 left"
                                : `${s.quota.remaining} left`;
                            return (<span className="inline-flex flex-wrap items-center gap-1 align-middle sm:mx-0.5">
                              <span className="rounded border border-border/60 bg-muted px-1 py-px text-[9px] font-medium leading-tight tabular text-muted-foreground sm:text-[10px]">
                                Classes {s.quota.quota ?? "—"}
                              </span>
                              <span className={cn("rounded border px-1 py-px text-[9px] font-medium leading-tight tabular sm:text-[10px]", tone)}>
                                {left}
                              </span>
                            </span>);
                          })() : null}
                          {enrolled ? (<span className="inline-flex items-center gap-1.5 align-middle whitespace-nowrap sm:ml-1.5">
                              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", GROUP_DOT[enrolled.key] ?? "bg-muted-foreground/40")}/>
                              <span>{enrolled.text}</span>
                              {enrolled.count > 0 ? (<span className="cursor-help text-muted-foreground/70" title={enrolled.extras}>+{enrolled.count}</span>) : null}
                            </span>) : null}
                          {s.trainerName ? (<span className="inline-flex items-center gap-1 align-middle whitespace-nowrap text-[11px] sm:ml-1.5" title={`Assigned teacher: ${s.trainerName}`}>
                              <UsersIcon className="size-3 shrink-0"/>
                              {s.trainerName}
                            </span>) : null}
                        </p>
                      </div>
                      {savingId === s.memberId ? <Loader2Icon className="size-3.5 animate-spin text-muted-foreground"/> : null}
                    </div>
                    {isSaved ? (<div className="flex items-center gap-1.5">
                        <button type="button" className="cursor-pointer transition-opacity hover:opacity-80" aria-label={`Edit attendance for ${s.fullName}`} onClick={() => {
                setEditingId(s.memberId);
                setStatuses((prev) => ({ ...prev, [s.memberId]: saved }));
            }}>
                          <StatusTick status={saved}/>
                        </button>
                        <Button size="sm" variant="outline" className="h-7 w-7 rounded-full p-0 text-xs text-muted-foreground hover:text-emerald-600" aria-label={`Edit attendance for ${s.fullName}`} onClick={() => {
                setEditingId(s.memberId);
                setStatuses((prev) => ({ ...prev, [s.memberId]: saved }));
            }}>
                          <PencilIcon className="size-3"/>
                        </Button>
                      </div>) : (<div className="flex items-center gap-1.5">
                        {STATUS_ORDER.map((st) => {
                const meta = STATUS_META[st];
                const active = statuses[s.memberId] === st;
                return (<Button key={st} size="sm" variant={active ? "secondary" : "outline"} aria-label={meta.label} title={meta.label} aria-pressed={active} className={cn("h-8 gap-1 rounded-full px-2 text-xs whitespace-nowrap transition-colors sm:h-9 sm:gap-1.5 sm:px-2.5 sm:font-bold sm:text-[13px]", active ? meta.activeText : cn("text-muted-foreground", meta.hover))} onClick={() => isEditing ? saveStudent(s.memberId, st) : selectStatus(s.memberId, st)}>
                              <span className={cn("inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 text-white transition-colors sm:size-4", active ? meta.activeRing : "border-border/60")}>
                                {active ? (<CheckIcon className="size-2 sm:size-2.5" strokeWidth={3}/>) : null}
                              </span>
                              {meta.short}
                            </Button>);
            })}
                        {isEditing ? (<Button size="sm" variant="ghost" className="h-7 w-7 rounded-full p-0 text-muted-foreground hover:text-emerald-600" aria-label="Cancel edit" onClick={() => setEditingId(null)}>
                            <XIcon className="size-3.5"/>
                          </Button>) : null}
                      </div>)}
                  </li>);
            })}
              </ul>)}

          {/* Walk-in students (search-only, outside the slot roster) — shown when
              the search matches students not enrolled in this slot. */}
          {studentQuery.trim() && walkIns.length > 0 ? (<div className="border-t border-border/70 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Walk-in · not in this slot</p>
              <ul className="mt-2 space-y-2">
                {walkIns.map((m) => (<li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <SmartImage src={m.photoUrl} name={m.fullName ?? "Student"} className="size-8 shrink-0"/>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.memberCode ?? "—"}{m.planName ? ` · ${m.planName}` : ""}</p>
                      </div>
                    </div>
                    {walkInSavingId === m.id ? <Loader2Icon className="size-4 animate-spin text-muted-foreground"/> : (<div className="flex items-center gap-1.5">
                        <Button size="sm" variant="outline" className="h-8 gap-1 rounded-full px-2 text-xs text-success hover:border-success hover:bg-success/10 transition-colors sm:h-9 sm:gap-1.5 sm:px-2.5 sm:font-bold sm:text-[13px]" onClick={() => markWalkIn(m.id, "present")}>
                          <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 border-success/40 transition-colors group-hover:border-success sm:size-4"/>
                          P
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1 rounded-full px-2 text-xs text-destructive hover:border-destructive hover:bg-destructive/10 transition-colors sm:h-9 sm:gap-1.5 sm:px-2.5 sm:font-bold sm:text-[13px]" onClick={() => markWalkIn(m.id, "absent")}>
                          <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 border-destructive/40 transition-colors sm:size-4"/>
                          A
                        </Button>
                      </div>)}
                  </li>))}
              </ul>
            </div>) : null}

          {/* Save bar — Load All + bulk commit at the bottom of the sheet.
              Mobile: only the two buttons (no box/status line); sm+ keeps the
              full-width footer with the status text. */}
          <div className="flex flex-wrap items-center justify-end gap-2 sm:w-full sm:flex-nowrap sm:items-center sm:justify-between sm:border-t sm:border-border/70 sm:px-4 sm:py-3">
              <p className="hidden text-xs text-muted-foreground sm:block">
                {students.length === 0
                  ? "No students loaded — pick a slot or Load All."
                  : hasChanges
                    ? `${pendingCount} ${pendingCount === 1 ? "change" : "changes"} unsaved`
                    : "All changes saved"}
              </p>
              <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5 px-3 sm:flex-none" disabled={slots.loading || activeSlots.length === 0 || loadAll} onClick={() => {
                setLoadAll(true);
                setSlotGroup("all");
                setSlotPick("");
              }}>
                  <UsersIcon className="size-3.5"/> Load All
                </Button>
                <Button size="sm" className="h-8 flex-1 gap-1.5 px-4 sm:flex-none" disabled={students.length === 0 || !hasChanges || savingAll} onClick={saveAll}>
                  {savingAll ? <Loader2Icon className="size-3.5 animate-spin"/> : <SaveIcon className="size-3.5"/>}
                  Save{pendingCount > 0 ? ` (${pendingCount})` : ""}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      </TabsContent>

      {/* ------------------------------ View section ---------------------------- */}
      <TabsContent value="view">
      <Card className="graphite-surface border-border/70">
        <CardContent className="space-y-5 p-5">

          {/* Register table */}
          <div className="rounded-xl border border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ClipboardCheckIcon className="size-4 text-muted-foreground"/>
                Register{" "}
                <span className="text-muted-foreground">
                  ({filteredRows.length === classRows.length
                    ? classRows.length
                    : `${filteredRows.length}/${classRows.length}`})
                </span>
              </div>
              {/* Compact filters: Slot | Date | Search student | Export */}
              <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
                <select
                  aria-label="Class Slot"
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 sm:w-auto sm:max-w-56"
                  value={viewSlotId}
                  onChange={(e) => setViewSlotId(e.target.value)}
                >
                  <option value="all">Slot: All Classes</option>
                  {SLOT_GROUPS.map((group) => {
                    const groupSlots = groupedSlots[group.key] ?? [];
                    if (groupSlots.length === 0) return null;
                    return (<optgroup key={group.key} label={group.label}>
                      {groupSlots.map((s) => {
                        const timeText = `${fmtSlotTime(s.startTime)} - ${fmtSlotTime(s.endTime)}`;
                        // Slot names are usually auto-generated from the same
                        // times — as "8:00 AM – 9:00 AM" (12h) or "12:00 – 13:00"
                        // (24h, from the gym-import batches). Skip the name
                        // whenever it is just a time range, in any format.
                        const isTimeName = /^\d{1,2}:\d{2}\s*(AM|PM)?\s*[–-]\s*\d{1,2}:\d{2}\s*(AM|PM)?$/i
                          .test((s.name ?? "").trim());
                        const label = s.name && !isTimeName ? `${s.name} · ${timeText}` : timeText;
                        return (<option key={s.id} value={s.id}>{label}</option>);
                      })}
                    </optgroup>);
                  })}
                </select>
                <Input aria-label="Date" type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} className="h-8 w-full text-xs sm:w-36"/>
                <div className="relative w-full sm:w-40">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
                  <Input aria-label="Search student" placeholder="Search student" className="h-8 w-full pl-7 text-xs" value={search} onChange={(e) => setSearch(e.target.value)}/>
                </div>
                <Button size="sm" variant="outline" className="ml-auto h-8 gap-1 px-2.5 text-xs" onClick={handleExport} disabled={list.loading}>
                  {list.loading ? <Loader2Icon className="size-3.5 animate-spin"/> : <DownloadIcon className="size-3.5"/>}
                  Export
                </Button>
              </div>
            </div>

            {list.loading ? (<div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading attendance…</div>) : filteredRows.length === 0 ? (<div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No attendance recorded for {formatDateTime(new Date(`${viewDate}T00:00:00`)).split(",")[0]}.
              </div>) : (<div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Sr. no.</TableHead>
                      <TableHead>Student Name</TableHead>
                      <TableHead>Payment Mode</TableHead>
                      <TableHead>Classes</TableHead>
                      <TableHead>Class Left</TableHead>
                      <TableHead>Slot Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row, index) => (<TableRow key={row.id}>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">{index + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <SmartImage src={row.memberPhoto} name={row.memberName ?? "Student"} className="size-8 shrink-0"/>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{row.memberName ?? "Student"}</p>
                              <p className="truncate text-xs text-muted-foreground">{row.memberCode ?? "—"}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><PaymentChip method={row.paymentMethod}/></TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {row.quota ? `${row.quota.attended}/${row.quota.quota}` : "—"}
                        </TableCell>
                        <TableCell><ClassLeftChip quota={row.quota}/></TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {slotTimeOf(row) ?? "—"}
                        </TableCell>
                        <TableCell><StatusChip status={row.attendanceStatus}/></TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="icon-xs" variant="ghost" aria-label={`Open ${row.memberName ?? "student"}'s profile`} asChild>
                              <Link to={`/members/${row.memberId}`}>
                                <EyeIcon/>
                              </Link>
                            </Button>
                            {canCorrect ? (<Button size="icon-xs" variant="ghost" aria-label={`Correct attendance for ${row.memberName ?? "student"}`} onClick={() => setEditing(row)}>
                                <PencilIcon/>
                              </Button>) : null}
                          </div>
                        </TableCell>
                      </TableRow>))}
                  </TableBody>
                </Table>
              </div>)}
          </div>
        </CardContent>
      </Card>
      </TabsContent>

      {/* ------------------------- Attendance history ------------------------- */}
      <TabsContent value="history">
        <AttendanceHistoryContent/>
      </TabsContent>

      {/* ------- View All: aaj ki attendance — no filters, one date chip ------- */}
      <TabsContent value="all">
        <div className="flex flex-col gap-4">
          <label className="relative inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border/70 bg-secondary px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary/70" title="Change date">
            <CalendarIcon className="size-3.5 text-muted-foreground"/>
            {viewAllLabel}
            <input
              type="date"
              aria-label="Attendance date"
              value={viewAllDate}
              onChange={(e) => { if (e.target.value) setViewAllDate(e.target.value); }}
              onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* older browsers: fall back to focusing the input */ } }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          {viewAllList.loading ? (<p className="py-10 text-center text-sm text-muted-foreground">Loading attendance…</p>)
            : viewAllRows.length === 0 ? (<p className="py-10 text-center text-sm text-muted-foreground">No attendance recorded yet.</p>)
            : (<ul className="space-y-2 sm:space-y-0 sm:rounded-xl sm:border sm:border-border/60 sm:divide-y sm:divide-border/60">
                {viewAllRows.map((row) => (<li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:rounded-none sm:border-0 sm:px-4 sm:py-3 sm:shadow-none">
                  <div className="flex min-w-0 items-center gap-3">
                    <SmartImage src={row.memberPhoto} name={row.memberName ?? "Student"} className="size-8 shrink-0"/>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.memberName ?? "Student"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.memberCode ?? "—"}
                        {slotTimeOf(row) ? ` · ${slotTimeOf(row)}` : ""}
                      </p>
                    </div>
                  </div>
                  <StatusChip status={row.attendanceStatus}/>
                </li>))}
              </ul>)}
        </div>
      </TabsContent>
      </Tabs>

      <AttendanceCorrectionDialog record={editing} open={editing !== null} onOpenChange={(open) => {
            if (!open)
                setEditing(null);
        }} onSaved={() => {
            list.reload();
            summary.reload();
        }}/>
    </div>);
}
