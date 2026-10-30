"use client";
import { usePathname } from "next/navigation";
import { ShoppingCart, HelpCircle, Users, Building2 } from "lucide-react";

// "Received" (the order bot's inbox, /received) is left out on purpose: it is our own check, not a page Simenesh
// knows from ChipChip B2B, so the tester only sees the two copied systems and the four questions.
const SECTIONS = [
  {
    title: "ChipChip B2B",
    items: [
      { href: "/b2b/orders", label: "Orders", am: "ትዕዛዞች", icon: ShoppingCart },
      { href: "/b2b/customers", label: "Customers", am: "ደንበኞች", icon: Users },
    ],
  },
  {
    title: "ChipChip Admin",
    items: [{ href: "/admin/dashboard/b2b", label: "B2B Customers", am: "ድርጅቶች", icon: Building2 }],
  },
  {
    title: "",
    items: [{ href: "/questions", label: "4 questions", am: "4 ጥያቄዎች", icon: HelpCircle }],
  },
];
const ITEMS = SECTIONS.flatMap((s) => s.items);

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

/** The left menu: the two copied systems, then the four questions. */
export function SideNav() {
  const path = usePathname() || "/";
  return (
    <nav className="flex-1 px-2 py-2 space-y-3 overflow-y-auto">
      {SECTIONS.map((s, i) => (
        <div key={i} className="space-y-1">
          {s.title && <div className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{s.title}</div>}
          {!s.title && <div className="mx-3 border-t border-gray-100" />}
          {s.items.map(({ href, label, am, icon: Icon }) => {
            const on = isActive(path, href);
            return (
              <a key={href} href={href}
                className={`flex items-center text-sm font-medium rounded-md px-3 py-2 transition-all duration-200 ${
                  on ? "bg-red-50 text-red-700 shadow-sm border-l-2 border-red-600" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 hover:shadow-sm"}`}>
                <Icon className={`h-4 w-4 mr-3 flex-shrink-0 ${on ? "text-red-600" : ""}`} />
                <span className="truncate">{label} <span className="text-xs font-normal text-gray-500">· {am}</span></span>
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** The same pages as a tab row on a phone, where the sidebar does not fit. */
export function MobileNav() {
  const path = usePathname() || "/";
  return (
    <nav className="md:hidden grid grid-cols-4 bg-white border-b border-gray-200">
      {ITEMS.map(({ href, label, am, icon: Icon }) => {
        const on = isActive(path, href);
        return (
          <a key={href} href={href}
            className={`flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] leading-tight text-center font-medium border-b-2 ${
              on ? "border-red-600 text-red-700 bg-red-50" : "border-transparent text-gray-600"}`}>
            <Icon className={`h-4 w-4 ${on ? "text-red-600" : ""}`} />
            <span>{label}</span>
            <span className="font-normal text-gray-500">{am}</span>
          </a>
        );
      })}
    </nav>
  );
}
