import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { SidebarContent, MobileSidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "km.sidebar.collapsed";

export function AppShell() {
    const [mobileOpen, setMobileOpen] = useState(false);
    // Desktop collapse preference, remembered between visits.
    const [collapsed, setCollapsed] = useState(() => {
        try {
            return window.localStorage.getItem(SIDEBAR_KEY) === "1";
        }
        catch {
            return false;
        }
    });
    const reduceMotion = useReducedMotion();
    const location = useLocation();
    useEffect(() => {
        setMobileOpen(false);
    }, [location.pathname]);
    useEffect(() => {
        document.title = "Kala Mandir — Dance N Art Studio";
    }, []);
    useEffect(() => {
        try {
            window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
        }
        catch {
            /* storage may be unavailable — collapse just won't persist */
        }
    }, [collapsed]);
    return (<div className="min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className={cn("fixed inset-y-0 left-0 z-40 hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-out lg:block", collapsed ? "w-20" : "w-64")}>
        <SidebarContent collapsed={collapsed} onToggleCollapse={() => setCollapsed((value) => !value)}/>
      </aside>

      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)}/>

      <div className={cn("transition-[padding] duration-300 ease-out", collapsed ? "lg:pl-20" : "lg:pl-64")}>
        <Topbar onOpenMenu={() => setMobileOpen(true)}/>
        <main className="mx-auto w-full max-w-[1400px] px-[18px] py-3 sm:px-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={location.pathname} initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }} transition={{ duration: reduceMotion ? 0.12 : 0.22, ease: [0.22, 1, 0.36, 1] }}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>);
}
