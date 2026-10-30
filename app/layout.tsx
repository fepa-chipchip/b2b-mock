import type { ReactNode } from "react";
import { Bell } from "lucide-react";
import { SideNav, MobileNav } from "./Nav";
import "./globals.css";

export const metadata = { title: "B2B Orders Test", description: "Test site for the B2B order agent (staging)" };
export const viewport = { width: "device-width", initialScale: 1 };

/** The ChipChip B2B dashboard shell: white left sidebar, white top bar, grey page. */
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen w-full bg-gray-50">
          <aside className="hidden md:flex w-64 flex-shrink-0 flex-col bg-white border-r border-gray-200 shadow-sm sticky top-0 h-screen">
            <div className="p-6 border-b border-gray-100 flex items-center gap-2">
              <div className="w-6 h-6 bg-red-600 rounded-md flex items-center justify-center">
                <span className="text-white font-bold text-xs">CC</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">ChipChip B2B</h1>
            </div>
            <SideNav />
            <div className="p-4 border-t border-gray-100 text-xs text-gray-500">Test site · የሙከራ ገጽ</div>
          </aside>

          <div className="flex-1 flex flex-col min-w-0">
            <header className="z-10 py-3 md:py-4 bg-white shadow-sm border-b border-gray-200">
              <div className="flex items-center justify-between gap-3 px-4 md:px-6">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="md:hidden w-6 h-6 bg-red-600 rounded-md flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-xs">CC</span>
                  </div>
                  <span className="md:hidden font-bold text-gray-900 truncate">ChipChip B2B</span>
                  <span className="badge bg-amber-100 text-amber-800">Test · ሙከራ</span>
                </div>
                <div className="flex items-center gap-3 md:gap-4">
                  <Bell className="h-5 w-5 text-gray-500" aria-hidden />
                  <div className="flex items-center">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-gray-700">S</div>
                    <div className="ml-2 text-sm hidden md:block">
                      <p className="font-medium">Simenesh</p>
                      <p className="text-xs text-gray-500">Operations Role</p>
                    </div>
                  </div>
                </div>
              </div>
            </header>
            <MobileNav />
            <main className="flex-1 w-full px-4 py-4 md:px-6 md:py-6">
              <div className="w-full max-w-6xl space-y-6">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
