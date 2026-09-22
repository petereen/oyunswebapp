import { useState } from "react";
import { Archive, BellRing, ChevronDown, Clock3, CreditCard, LogOut, Settings2, UserRoundCog } from "lucide-react";
import { AdminBankAccounts } from "../AdminBankAccounts";
import { AdminShiftBar } from "./AdminShiftBar";
import { AdminSettings } from "./AdminSettings";
import { AdminOyunsPlusCards } from "./AdminOyunsPlusCards";
import { AdminBroadcasts } from "./AdminBroadcasts";

type SettingsSection = "shift" | "hours" | "accounts" | "system" | "oyuns-plus-cards" | "broadcasts";

const SETTINGS_SECTIONS: Array<{
  key: SettingsSection;
  label: string;
  description: string;
  icon: typeof UserRoundCog;
}> = [
  { key: "shift", label: "Ээлжийн админ", description: "Ээлж нээх, шилжүүлэх, хаах", icon: UserRoundCog },
  { key: "hours", label: "Ажлын цаг", description: "Үйлчилгээ ажиллах цагийн хуваарь", icon: Clock3 },
  { key: "accounts", label: "Данс", description: "Банкны дансны удирдлага", icon: CreditCard },
  { key: "system", label: "Системийн тохиргоо", description: "Лимит, Telegram болон OYUNS Plus", icon: Settings2 },
  { key: "oyuns-plus-cards", label: "OYUNS+ брэнд ба купон", description: "Брэнд, лого, купон удирдах", icon: Archive },
  { key: "broadcasts", label: "Broadcast management", description: "Manual, automated болон илгээсэн түүх", icon: BellRing },
];

function SettingsDropdown({
  section,
  open,
  onToggle,
}: {
  section: (typeof SETTINGS_SECTIONS)[number];
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = section.icon;

  return (
    <section data-slot="settings-accordion" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-dark-600 dark:bg-dark-800/80">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`admin-settings-panel-${section.key}`}
        data-slot="settings-accordion-trigger"
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-maroon-400 dark:hover:bg-dark-700"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-[1.1rem] ${open ? "bg-maroon-100 text-maroon-700 dark:bg-maroon-900/30 dark:text-gold-400" : "bg-slate-100 text-slate-500 dark:bg-dark-700 dark:text-ivory-300"}`}>
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-slate-800 dark:text-ivory-200">{section.label}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-ivory-400">{section.description}</span>
          </span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={`admin-settings-panel-${section.key}`} hidden={!open}>
        <div className="border-t border-slate-200/80 p-4 dark:border-dark-600">
          {section.key === "shift" && <AdminShiftBar mode="shift" />}
          {section.key === "hours" && <AdminShiftBar mode="working-hours" />}
          {section.key === "accounts" && <AdminBankAccounts />}
          {section.key === "system" && <AdminSettings />}
          {section.key === "oyuns-plus-cards" && <AdminOyunsPlusCards />}
          {section.key === "broadcasts" && <AdminBroadcasts />}
        </div>
      </div>
    </section>
  );
}

export function AdminSettingsContainer({ onExit }: { onExit?: () => void }) {
  const [openSections, setOpenSections] = useState<Set<SettingsSection>>(() => new Set(["shift"]));

  const toggleSection = (section: SettingsSection) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3" aria-label="Тохиргооны хэсгүүд">
      {SETTINGS_SECTIONS.map((section) => (
        <SettingsDropdown
          key={section.key}
          section={section}
          open={openSections.has(section.key)}
          onToggle={() => toggleSection(section.key)}
        />
      ))}
      {onExit && (
        <button type="button" onClick={onExit} data-slot="admin-logout" className="admin-radio admin-radio--logout w-full justify-start border-dashed">
          <LogOut className="h-4 w-4" />
          Гарах
        </button>
      )}
    </div>
  );
}
