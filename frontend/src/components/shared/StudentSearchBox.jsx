import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2Icon, PhoneIcon, SearchIcon, UserRoundIcon } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SmartImage } from "@/components/shared/SmartImage";
import { useDebounced } from "@/hooks";
import { cn } from "@/lib/utils";

/** Minimum characters before we hit the members API. */
const MIN_CHARS = 1;
/** Debounce so a fast typist only triggers one request per pause. */
const DEBOUNCE_MS = 250;
/** Keyboard hint shown while the box is empty. */
function KeyCap({ children }) {
    return (<kbd className="pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-background px-1 font-sans text-[11px] font-medium text-muted-foreground">
      {children}
    </kbd>);
}
/**
 * Topbar student search: type a name / phone / ID and matching students appear
 * in a live dropdown. Enter (or ↑/↓ + Enter) opens the highlighted student's
 * profile; a plain Enter with no highlight opens the first match.
 */
export function StudentSearchBox({ className }) {
    const { data } = useAuth();
    const navigate = useNavigate();
    const listId = useId();
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // -1 = nothing highlighted, so Enter falls through to the first result.
    const [highlighted, setHighlighted] = useState(-1);
    const wrapRef = useRef(null);
    const inputRef = useRef(null);
    const debounced = useDebounced(query.trim(), DEBOUNCE_MS);

    // Global shortcut: Ctrl/Cmd + K focuses the box from anywhere on the page.
    useEffect(() => {
        const onKeyDown = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                inputRef.current?.focus();
                inputRef.current?.select();
                setOpen(true);
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    // Fetch matches whenever the debounced term changes.
    useEffect(() => {
        if (debounced.length < MIN_CHARS) {
            setResults([]);
            setLoading(false);
            setError(null);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        data
            .listMembers({ search: debounced, pageSize: 6, sort: "name", dir: "asc" })
            .then((payload) => {
            if (cancelled)
                return;
            setResults(payload?.items ?? []);
            setHighlighted(-1);
        })
            .catch((err) => {
            if (cancelled)
                return;
            setResults([]);
            setError(err instanceof Error ? err.message : "Unable to search right now.");
        })
            .finally(() => {
            if (!cancelled)
                setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [data, debounced]);

    // Close when clicking/tapping anywhere outside the box.
    useEffect(() => {
        if (!open)
            return undefined;
        const onPointerDown = (event) => {
            if (!wrapRef.current?.contains(event.target))
                setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("touchstart", onPointerDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("touchstart", onPointerDown);
        };
    }, [open]);

    const showDropdown = open && query.trim().length >= MIN_CHARS;
    const openStudent = (memberId) => {
        setOpen(false);
        setQuery("");
        setResults([]);
        navigate(`/members/${memberId}`);
    };
    const handleSubmit = (event) => {
        event.preventDefault();
        const term = query.trim();
        if (!term)
            return;
        // Enter opens the highlighted student, else the first match.
        const target = results[highlighted] ?? results[0];
        if (target) {
            openStudent(target.id);
            return;
        }
        // Nothing matched → fall back to the full members list search.
        setOpen(false);
        navigate(`/members?search=${encodeURIComponent(term)}`);
    };
    const handleKeyDown = (event) => {
        if (!showDropdown || results.length === 0)
            return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((prev) => (prev + 1) % results.length);
        }
        else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
        }
        else if (event.key === "Escape") {
            setOpen(false);
        }
    };
    const activeDescendant = showDropdown && highlighted >= 0 ? `${listId}-${highlighted}` : undefined;
    return (<div ref={wrapRef} className={cn("group relative w-full", className)}>
      <form onSubmit={handleSubmit} role="search" className="relative flex items-center rounded-md border border-input bg-background transition-colors focus-within:border-km-gold/60 focus-within:ring-2 focus-within:ring-km-gold/20">
        <SearchIcon className="pointer-events-none absolute left-3 size-4 text-muted-foreground transition-colors group-focus-within:text-km-gold"/>
        <Input ref={inputRef} value={query} onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
        }} onFocus={() => setOpen(true)} onKeyDown={handleKeyDown} placeholder="Search students by name, phone or ID…" className="h-9 rounded-md border-0 bg-transparent pr-4 pl-10 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0 md:text-sm" role="combobox" aria-expanded={showDropdown} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeDescendant} aria-label="Search students" autoComplete="off"/>
      </form>
      {showDropdown ? (<div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-km-gold/25 bg-background shadow-xl">
          {/* Loading bar — thin gold shimmer across the top. */}
          {loading ? (<div className="h-0.5 w-full overflow-hidden bg-km-gold/10">
              <div className="h-full w-1/3 animate-pulse bg-km-gold/70"/>
            </div>) : null}

          {loading && results.length === 0 ? (<div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin text-km-gold"/> Searching…
            </div>) : error ? (<p className="px-4 py-4 text-sm text-destructive">{error}</p>) : results.length === 0 ? (<div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <UserRoundIcon className="size-6 text-muted-foreground/60"/>
              <p className="text-sm font-medium">No students found</p>
              <p className="text-xs text-muted-foreground">
                Nothing matched “{query.trim()}”. Press Enter to see all results.
              </p>
            </div>) : (<ul id={listId} role="listbox" aria-label="Student results" className="max-h-80 overflow-y-auto py-1.5">
              {results.map((member, index) => (<li key={member.id} id={`${listId}-${index}`} role="option" aria-selected={index === highlighted} onMouseEnter={() => setHighlighted(index)} onMouseDown={(event) => {
                // mousedown (not click) so it fires before the input blurs.
                event.preventDefault();
                openStudent(member.id);
            }} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors", index === highlighted ? "bg-km-gold/12" : "hover:bg-secondary/60")}>
                  <SmartImage src={member.photoUrl} name={member.fullName} className="size-9 shrink-0 rounded-full border border-km-gold/40 object-cover"/>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium leading-tight" title={member.fullName}>
                      {member.fullName}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                      <span className="truncate font-medium text-km-gold/90">{member.memberCode}</span>
                      {member.phone ? (<>
                          <span aria-hidden="true">·</span>
                          <PhoneIcon className="size-3 shrink-0"/>
                          <span className="truncate tabular-nums">{member.phone}</span>
                        </>) : null}
                    </span>
                  </span>
                  <StatusBadge status={member.effectiveStatus} className="shrink-0 text-[10px]"/>
                </li>))}
            </ul>)}

          {/* Footer hint — keyboard-first users. */}
          {results.length > 0 ? (<div className="flex items-center gap-3 border-t border-border/60 bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><KeyCap>↑</KeyCap><KeyCap>↓</KeyCap> navigate</span>
              <span className="inline-flex items-center gap-1"><KeyCap>Enter</KeyCap> open profile</span>
              <span className="ml-auto inline-flex items-center gap-1"><KeyCap>Esc</KeyCap> close</span>
            </div>) : null}
        </div>) : null}
    </div>);
}
