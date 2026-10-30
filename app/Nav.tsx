"use client";
import { usePathname } from "next/navigation";
import { ShoppingCart, Inbox, HelpCircle, Users } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Orders", am: "ትዕዛዞች", icon: ShoppingCart },
  { href: "/received", label: "Received", am: "የደረሱ", icon: Inbox },
  { href: "/questions", label: "4 questions", am: "4 ጥያቄዎች", icon: HelpCircle },
  { href: "/customers", label: "Customers", am: "ደንበኞች", icon: Users },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** The left menu, as in ChipChip B2B's sidebar (red highlight on the open page). */
export function SideNav() {
  const path = usePathname() || "/";
  return (
    <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
      {ITEMS.map(({ href, label, am, icon: Icon }) => {
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
    </nav>
  );
}

/** The same four pages as a tab row on a phone, where the sidebar does not fit. */
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
