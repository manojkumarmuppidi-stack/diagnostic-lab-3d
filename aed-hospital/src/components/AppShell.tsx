"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  BedDouble,
  BookCheck,
  CalendarCheck,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Pill,
  Plus,
  Receipt,
  Salad,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  Upload,
  Users,
  X,
  Database,
  Presentation,
} from "lucide-react";
import type { PermissionCode } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";
import { apiFetch, cn } from "@/lib/client";
import { MastersProvider, SessionProvider, useCan, useSession, type SessionUser } from "./session";
import { ToastProvider } from "./ui";
import { TransactionForm } from "./TransactionForm";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  perm: PermissionCode;
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
  { href: "/daily-accounts", label: "Daily Accounts", icon: CalendarCheck, perm: "accounts.view" },
  { href: "/opd", label: "OPD", icon: Stethoscope, perm: "opd.view" },
  { href: "/ipd", label: "IPD", icon: BedDouble, perm: "ipd.view" },
  { href: "/lab", label: "Laboratory", icon: FlaskConical, perm: "lab.view" },
  { href: "/pharmacy", label: "Pharmacy", icon: Pill, perm: "pharmacy.view" },
  { href: "/diet", label: "Diet & Nutrition", icon: Salad, perm: "diet.view" },
  { href: "/expenses", label: "Expenses", icon: Receipt, perm: "expense.view" },
  { href: "/accounting", label: "Accounting & Reconciliation", icon: BookCheck, perm: "accounts.view" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, perm: "analytics.view" },
  { href: "/meeting", label: "Board Meeting", icon: Presentation, perm: "analytics.view" },
  { href: "/reports", label: "Reports", icon: ClipboardList, perm: "reports.view" },
  { href: "/import", label: "Excel Import", icon: Upload, perm: "import.run" },
  { href: "/export", label: "Excel Export", icon: Download, perm: "reports.export" },
  { href: "/masters", label: "Master Data", icon: Database, perm: "masters.manage" },
  { href: "/users", label: "Users & Permissions", icon: Users, perm: "users.manage" },
  { href: "/audit", label: "Audit Log", icon: ShieldCheck, perm: "audit.view" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "settings.manage" },
];

const QUICK: { module: ModuleKey; label: string; perm: PermissionCode; icon: typeof Plus }[] = [
  { module: "opd", label: "OPD", perm: "opd.write", icon: Stethoscope },
  { module: "ipd", label: "IPD", perm: "ipd.write", icon: BedDouble },
  { module: "lab", label: "Lab", perm: "lab.write", icon: FlaskConical },
  { module: "pharmacy-sale", label: "Pharmacy", perm: "pharmacy.write", icon: Pill },
  { module: "expense", label: "Expense", perm: "expense.write", icon: Receipt },
  { module: "diet", label: "Diet", perm: "diet.write", icon: Salad },
];

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <SessionProvider user={user}>
      <MastersProvider>
        <ToastProvider>
          <Shell>{children}</Shell>
        </ToastProvider>
      </MastersProvider>
    </SessionProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const user = useSession();
  const can = useCan();
  const path = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickModule, setQuickModule] = useState<ModuleKey | null>(null);
  const [q, setQ] = useState("");
  const items = NAV.filter((n) => can(n.perm));
  const quick = QUICK.filter((x) => can(x.perm));
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  };
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const navList = (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={() => setDrawer(false)}
          className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition", active(n.href) ? "font-semibold" : "text-2 hover:opacity-80")}
          style={active(n.href) ? { background: "color-mix(in srgb, var(--brand) 12%, transparent)", color: "var(--brand)" } : undefined}
          aria-current={active(n.href) ? "page" : undefined}
        >
          <n.icon className="h-4 w-4 shrink-0" aria-hidden />
          {n.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="app-root min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r lg:flex no-print" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 border-b px-4 py-4" style={{ borderColor: "var(--border)" }}>
          <Activity className="h-6 w-6" style={{ color: "var(--brand)" }} aria-hidden />
          <div>
            <p className="text-sm font-bold leading-tight">{user.hospitalName}</p>
            <p className="text-xs muted">Finance & Analytics</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{navList}</div>
        <div className="border-t p-3 text-xs" style={{ borderColor: "var(--border)" }}>
          <p className="font-medium">{user.name}</p>
          <p className="muted">{user.roleName}</p>
          <div className="mt-2 flex gap-2">
            <Link href="/change-password" className="btn btn-ghost btn-sm">
              Password
            </Link>
            <button onClick={logout} className="btn btn-ghost btn-sm">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] no-print sm:px-6" style={{ background: "color-mix(in srgb, var(--surface) 92%, transparent)", borderColor: "var(--border)", backdropFilter: "blur(8px)" }}>
          <button className="btn btn-ghost lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <p className="truncate text-sm font-semibold lg:hidden">{user.hospitalName}</p>
          {can("search.use") && (
            <form onSubmit={search} className="ml-auto flex max-w-md flex-1 items-center" role="search">
              <label htmlFor="global-search" className="sr-only">
                Search patients, invoices, tests, expenses
              </label>
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 muted" aria-hidden />
                <input id="global-search" className="input !pl-9" placeholder="Search patient, invoice, test, expense…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </form>
          )}
          {quick.length > 0 && (
            <div className="relative hidden lg:block">
              <button className="btn btn-primary" onClick={() => setQuickOpen((o) => !o)} aria-expanded={quickOpen}>
                <Plus className="h-4 w-4" /> Quick add
              </button>
              {quickOpen && (
                <div className="card absolute right-0 mt-2 w-48 p-1 shadow-lg">
                  {quick.map((x) => (
                    <button
                      key={x.module}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:opacity-80"
                      onClick={() => {
                        setQuickModule(x.module);
                        setQuickOpen(false);
                      }}
                    >
                      <x.icon className="h-4 w-4" /> + {x.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </header>

        <main className="safe-bottom mx-auto w-full max-w-[1500px] flex-1 px-3 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="h-full w-72 overflow-y-auto shadow-xl" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="text-sm font-semibold">{user.name}</p>
                <p className="text-xs muted">{user.roleName}</p>
              </div>
              <button className="btn btn-ghost" onClick={() => setDrawer(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {navList}
            <div className="border-t p-2" style={{ borderColor: "var(--border)" }}>
              <Link href="/change-password" className="btn btn-ghost w-full justify-start" onClick={() => setDrawer(false)}>
                Change password
              </Link>
              <button onClick={logout} className="btn btn-ghost w-full justify-start">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom navigation with central quick-add */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] lg:hidden no-print" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Quick navigation">
        {[items.find((i) => i.href === "/dashboard"), items.find((i) => i.href === "/daily-accounts") ?? items[1]].map((n, i) =>
          n ? (
            <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active(n.href) ? "font-semibold" : "muted")} style={active(n.href) ? { color: "var(--brand)" } : undefined}>
              <n.icon className="h-5 w-5" aria-hidden />
              {n.label.split(" ")[0]}
            </Link>
          ) : (
            <span key={i} />
          ),
        )}
        <div className="flex items-center justify-center">
          {quick.length > 0 && (
            <button onClick={() => setQuickOpen(true)} className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full shadow-lg" style={{ background: "var(--brand)", color: "#fff" }} aria-label="Quick add">
              <Plus className="h-7 w-7" />
            </button>
          )}
        </div>
        <Link href="/search" className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active("/search") ? "font-semibold" : "muted")}>
          <Search className="h-5 w-5" aria-hidden />
          Search
        </Link>
        <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] muted">
          <Menu className="h-5 w-5" aria-hidden />
          Menu
        </button>
      </nav>

      {/* Mobile quick-add sheet */}
      {quickOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 lg:hidden" onClick={() => setQuickOpen(false)}>
          <div className="w-full rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold">Quick add</p>
            <div className="grid grid-cols-3 gap-3">
              {quick.map((x) => (
                <button
                  key={x.module}
                  className="card flex flex-col items-center gap-2 py-4 text-sm font-medium active:scale-95"
                  onClick={() => {
                    setQuickOpen(false);
                    setQuickModule(x.module);
                  }}
                >
                  <x.icon className="h-6 w-6" style={{ color: "var(--brand)" }} />+ {x.label}
                </button>
              ))}
            </div>
            <Link href="/import" className="btn btn-secondary mt-3 w-full" onClick={() => setQuickOpen(false)}>
              <FileSpreadsheet className="h-4 w-4" /> Upload Excel
            </Link>
          </div>
        </div>
      )}

      {quickModule && (
        <TransactionForm
          module={quickModule}
          open
          onClose={() => setQuickModule(null)}
          onSaved={() => {
            router.refresh();
            window.dispatchEvent(new CustomEvent("aed:tx-saved", { detail: quickModule }));
          }}
        />
      )}
    </div>
  );
}
