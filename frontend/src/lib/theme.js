/**
 * Institute-wide theming.
 *
 * The source of truth lives on the Gym document (`themeMode` + `themeAccent`),
 * set by admins in Manage Institute. `applyTheme` projects that onto the
 * document (`data-mode`, `data-accent`, plus a `.dark` class for the shadcn
 * `dark:` variant) and caches a copy in localStorage so the login screen and
 * the first paint can use it before the session loads.
 *
 * "system" resolves to "light"/"dark" using `prefers-color-scheme`, and a
 * matchMedia listener keeps it in sync while the tab is open.
 */
export const THEME_MODES = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
];

export const THEME_ACCENTS = [
    { id: "burgundy", label: "Royal Burgundy", swatch: ["#310d20", "#c6a45b"] },
    { id: "emerald", label: "Jade Emerald", swatch: ["#0e3b2f", "#5cc3a0"] },
    { id: "indigo", label: "Royal Indigo", swatch: ["#221f57", "#6f66d6"] },
    { id: "rose", label: "Rose Gold", swatch: ["#6b1338", "#e59fb4"] },
    { id: "terracotta", label: "Terracotta", swatch: ["#5c2a17", "#d99a4e"] },
    { id: "ocean", label: "Ocean Teal", swatch: ["#0a3446", "#57bcd6"] },
];

export const DEFAULT_THEME = { mode: "light", accent: "burgundy" };
const STORAGE_KEY = "kalamandir.theme";

const MODE_IDS = new Set(THEME_MODES.map((m) => m.id));
const ACCENT_IDS = new Set(THEME_ACCENTS.map((a) => a.id));

export function normalizeTheme(input) {
    const mode = MODE_IDS.has(input?.mode) ? input.mode : DEFAULT_THEME.mode;
    const accent = ACCENT_IDS.has(input?.accent) ? input.accent : DEFAULT_THEME.accent;
    return { mode, accent };
}

export function isThemeMode(value) {
    return MODE_IDS.has(value);
}
export function isThemeAccent(value) {
    return ACCENT_IDS.has(value);
}

export function readCachedTheme() {
    if (typeof window === "undefined")
        return DEFAULT_THEME;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return DEFAULT_THEME;
        return normalizeTheme(JSON.parse(raw));
    }
    catch {
        return DEFAULT_THEME;
    }
}

export function cacheTheme(theme) {
    if (typeof window === "undefined")
        return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTheme(theme)));
    }
    catch {
        /* ignore — private mode / quota */
    }
}

export function resolveMode(mode) {
    if (mode !== "system")
        return mode;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
        return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let mediaQuery = null;
let mediaListener = null;
let currentMode = null;

function ensureMediaListener() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
        return;
    if (mediaQuery)
        return;
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaListener = () => {
        // Only matters when the chosen mode is "system".
        if (currentMode === "system")
            applyTheme({ mode: "system", accent: document.documentElement.dataset.accent || DEFAULT_THEME.accent });
    };
    mediaQuery.addEventListener("change", mediaListener);
}

export function applyTheme(input) {
    const { mode, accent } = normalizeTheme(input);
    currentMode = mode;
    const resolved = resolveMode(mode);
    const root = document.documentElement;
    root.dataset.mode = resolved;
    root.dataset.accent = accent;
    root.dataset.themeMode = mode;
    if (resolved === "dark")
        root.classList.add("dark");
    else
        root.classList.remove("dark");
    cacheTheme({ mode, accent });
    ensureMediaListener();
    return { mode, accent, resolved };
}