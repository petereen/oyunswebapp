import { Home, ArrowLeftRight, LayoutGrid, BarChart3 } from "lucide-react";

interface Props {
  activeTab: number;
  onTabChange: (tab: number) => void;
}

const tabs = [
  { label: "Нүүр", icon: Home },
  { label: "Гүйлгээ", icon: ArrowLeftRight },
  { label: "Үйлчилгээ", icon: LayoutGrid },
  { label: "Статистик", icon: BarChart3 },
];

export function BottomNavBar({ activeTab, onTabChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-safe">
      <div className="max-w-lg mx-auto mb-3">
        <div className="bg-white/95 dark:bg-dark-800/95 backdrop-blur-xl rounded-2xl shadow-nav dark:shadow-nav-dark border border-silver/50 dark:border-dark-600/50">
          <div className="flex items-center justify-around h-[60px]">
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              const isActive = activeTab === index;
              return (
                <button
                  key={index}
                  onClick={() => onTabChange(index)}
                  className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all duration-300 relative"
                  aria-label={tab.label}
                >
                  <div className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-300 ${isActive ? "bg-maroon-600 shadow-btn scale-100" : "scale-90"}`}>
                    <Icon className={`w-[18px] h-[18px] transition-colors duration-300 ${isActive ? "text-white" : "text-dark-600 dark:text-ivory-300"}`} />
                  </div>
                  <span className={`text-[10px] leading-none font-semibold transition-all duration-300 ${isActive ? "text-maroon-600 dark:text-maroon-400 opacity-100" : "text-dark-600 dark:text-ivory-300 opacity-70"}`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
