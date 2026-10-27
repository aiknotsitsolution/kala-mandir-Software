import { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { BarChart3Icon, Building2Icon, CalendarCheckIcon, CalendarDaysIcon, CreditCardIcon, LayoutDashboardIcon, Music2Icon, PanelLeftCloseIcon, PanelLeftOpenIcon, SettingsIcon, TagsIcon, UsersIcon, UserSquare2Icon, XIcon, } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthProvider";
import { can } from "@/lib/permissions";
export const NAV_ITEMS = [
    { to: "/", label: "Dashboard", icon: LayoutDashboardIcon, end: true },
    { to: "/members", label: "Students", icon: UsersIcon, capability: "members.view" },
    { to: "/attendance", label: "Attendance", icon: CalendarCheckIcon, capability: "attendance.view", activeWhen: ["/attendance", "/attendance/history"] },
    { to: "/plans", label: "Membership Plans", icon: TagsIcon, capability: "plans.view" },
    { to: "/payments", label: "Payments & Fees", icon: CreditCardIcon, capability: "payments.view" },
    { to: "/staff", label: "Trainers & Staff", icon: UserSquare2Icon, capability: "staff.view" },
    { to: "/classes", label: "Classes & Schedule", icon: CalendarDaysIcon, capability: "classes.view" },
    { to: "/reports", label: "Reports & Analytics", icon: BarChart3Icon, capability: "reports.view" },
    { to: "/notifications", label: "Notifications", icon: Music2Icon, capability: "notifications.view" },
    { to: "/manage-gym", label: "Manage Institute", icon: Building2Icon, capability: "settings.manage", end: true },
    { to: "/settings", label: "Settings", icon: SettingsIcon, capability: "settings.view" },
];
/** Gold arch-and-flame studio mark. */
function KMEmblem({ className }) {
    return (<svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <path d="M24 4C14 4 8 11 8 21v23h32V21C40 11 34 4 24 4z" stroke="currentColor" strokeWidth="2.4"/>
      <path d="M24 15c-3.6 2.7-5.5 6-5.5 9.8 0 3.3 1.9 5.7 4.2 6.6-1.2 1.3-2 2.7-2 4.4h6.6c0-1.7-.8-3.1-2-4.4 2.3-.9 4.2-3.3 4.2-6.6 0-3.8-1.9-7.1-5.5-9.8z" fill="currentColor"/>
      <circle cx="24" cy="25" r="1.8" fill="#310d20"/>
    </svg>);
}
/** Ornate palace-arch band with a central classical dancer — a richer take on
 *  the login page's arch motif, anchoring the sidebar bottom. */
function SidebarArchArt({ className }) {
    return (<svg viewBox="0 0 320 200" fill="none" aria-hidden="true" className={className}>
      {/* base rails */}
      <path d="M6 182h308M6 189h308" stroke="currentColor" strokeWidth="1" opacity="0.45"/>
      {/* side arches (ogee) */}
      <g stroke="currentColor" opacity="0.5">
        <path d="M16 180V130c0-22 12-38 29-45 17 7 29 23 29 45v50" strokeWidth="1.2"/>
        <path d="M27 180v-46c0-16 8-28 18-33 10 5 18 17 18 33v46" strokeWidth="0.75"/>
        <path d="M229 180V130c0-22 12-38 29-45 17 7 29 23 29 45v50" strokeWidth="1.2"/>
        <path d="M240 180v-46c0-16 8-28 18-33 10 5 18 17 18 33v46" strokeWidth="0.75"/>
      </g>
      {/* central ogee arch (double-line) */}
      <g stroke="currentColor">
        <path d="M102 180V118c0-30 22-52 58-64 36 12 58 34 58 64v62" strokeWidth="1.4"/>
        <path d="M114 180v-56c0-24 18-42 46-52 28 10 46 28 46 52v56" strokeWidth="0.85"/>
      </g>
      {/* finials + hanging lamps */}
      <g fill="currentColor">
        <path d="M160 34l3.5 7h-7l3.5-7z"/>
        <circle cx="160" cy="48" r="1.6" opacity="0.85"/>
        <circle cx="60" cy="78" r="1.4" opacity="0.6"/>
        <circle cx="260" cy="78" r="1.4" opacity="0.6"/>
      </g>
      {/* central dancer silhouette */}
      <g opacity="0.82">
        <g fill="currentColor">
          <circle cx="160" cy="88" r="7"/>
          <circle cx="149.5" cy="83.5" r="3"/>
          <path d="M160 96c-6 0-9.5 4-9.5 10l-2 10-11 4 2 5 10-3-1 9-18 16c-20 18-29 25-29 31h101c0-6-9-13-29-31l-18-16-1 9 10 3 2-5-11-4-2-10c0-6-3.5-10-9.5-10z"/>
        </g>
        <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M152 102c-6-7-9-18-6-28"/>
          <path d="M168 106c10 0 20 4 28 9"/>
        </g>
        <g fill="currentColor">
          <circle cx="145" cy="72" r="2.4"/>
          <circle cx="198" cy="116" r="2.4"/>
        </g>
      </g>
    </svg>);
}
export function SidebarContent({ onNavigate, collapsed = false, onToggleCollapse, }) {
    const { session } = useAuth();
    const role = session?.profile.role;
    const location = useLocation();
    const items = useMemo(() => NAV_ITEMS.filter((item) => !item.capability || can(role, item.capability)), [role]);
    return (<div className="relative flex h-full flex-col">
      {/* Ornate palace-arch band with dancer anchoring the sidebar bottom */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-56 overflow-hidden text-km-gold lg:h-64">
        <SidebarArchArt className="absolute inset-x-0 bottom-0 h-full w-full object-fill opacity-40 [mask-image:linear-gradient(to_top,black_60%,transparent)]"/>
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/25 to-transparent"/>
      </div>

      {/* Brand header — centred crest lockup (emblem, wordmark, rule, subtitle). */}
      <div className={cn("relative border-b border-sidebar-border/60 transition-[padding] duration-300", collapsed ? "px-3 py-5" : "px-4 py-6")}>
        {!collapsed ? (<div className="flex flex-col items-center gap-2.5 text-center">
            <span className="gold-halo flex shrink-0 items-center justify-center rounded-xl border border-km-gold/35 bg-km-gold/10 text-km-gold transition-all duration-300 size-11">
              <KMEmblem className="transition-all duration-300 size-[22px]"/>
            </span>
            <p className="km-brand-name whitespace-nowrap">
              KALA MANDIR
            </p>
            <span className="km-brand-rule" aria-hidden="true">
              <span className="km-brand-lozenge"/>
            </span>
            <p className="km-brand-sub">
              Dance n Art Studio
            </p>
          </div>) : (<div className="flex justify-center">
            <span className="gold-halo flex shrink-0 items-center justify-center rounded-xl border border-km-gold/35 bg-km-gold/10 text-km-gold transition-all duration-300 size-10">
              <KMEmblem className="transition-all duration-300 size-5"/>
            </span>
          </div>)}
        {/* Collapse toggle (desktop only) — overlays the corner so the
            wordmark keeps the full column width. */}
        {onToggleCollapse ? (<button type="button" onClick={onToggleCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className={cn("absolute hidden rounded-md p-1.5 text-km-ivory/55 transition-colors hover:bg-sidebar-accent hover:text-km-gold lg:block", collapsed
                ? "top-4 -right-3 border border-sidebar-border bg-sidebar"
                : "top-3 right-3")}>
            {collapsed ? <PanelLeftOpenIcon className="size-4"/> : <PanelLeftCloseIcon className="size-4"/>}
          </button>) : null}
      </div>

      <nav className="relative flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-4" aria-label="Primary">
        {items.map((item) => {
            const active = item.activeWhen
                ? item.activeWhen.includes(location.pathname)
                : item.end
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to);
            return (<NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} title={collapsed ? item.label : undefined} className={cn("group relative flex items-center rounded-xl text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", collapsed ? "size-11 justify-center" : "gap-3 px-3 py-2.5", active
                    ? "bg-km-gold/12 text-km-ivory"
                    : "text-km-ivory/60 hover:bg-sidebar-accent hover:text-km-ivory")} aria-current={active ? "page" : "false"}>
              {/* Gold active indicator — reliable fade-in (no fragile cross-item layoutId handoff) */}
              {active ? (<motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: "easeOut" }} className={cn("absolute rounded-full bg-km-gold", collapsed
                    ? "inset-x-3 bottom-1 h-[3px]"
                    : "left-0 top-1/2 h-6 w-[3px] -translate-y-1/2")} aria-hidden/>) : null}
              <item.icon className={cn("size-[18px] shrink-0 transition-colors", active ? "text-km-gold" : "text-km-ivory/55 group-hover:text-km-gold")}/>
              {!collapsed ? (<span className={cn("truncate font-medium", active && "text-km-ivory")}>{item.label}</span>) : null}
            </NavLink>);
        })}
      </nav>
    </div>);
}
export function MobileSidebar({ open, onClose }) {
    return (<div className={cn("fixed inset-0 z-50 lg:hidden", open ? "" : "pointer-events-none")} aria-hidden={!open}>
      <div onClick={onClose} className={cn("absolute inset-0 bg-black/60 transition-opacity", open ? "opacity-100" : "opacity-0")}/>
      <aside className={cn("absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar transition-transform duration-300", open ? "translate-x-0" : "-translate-x-full")}>
        <button type="button" onClick={onClose} aria-label="Close navigation" className="absolute top-4 right-4 z-10 rounded-md p-1.5 text-km-ivory/70 transition-colors hover:bg-sidebar-accent hover:text-km-gold">
          <XIcon className="size-4"/>
        </button>
        <SidebarContent onNavigate={onClose}/>
      </aside>
    </div>);
}
