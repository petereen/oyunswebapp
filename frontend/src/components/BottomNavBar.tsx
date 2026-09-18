import { Home, ArrowLeftRight, LayoutGrid, BarChart3, Repeat2 } from "lucide-react";
import LiquidGlass from "liquid-glass-react";
import { OYUNS_PLUS_LOGO_DEFAULT_URL } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  activeTab: number;
  onTabChange: (tab: number) => void;
  isAdmin?: boolean;
  isAdminView?: boolean;
  onSwitchView?: () => void;
}

const tabKeys = [
  { key: "nav.home", icon: Home, useLogo: false },
  { key: "nav.transaction", icon: ArrowLeftRight, useLogo: false },
  { key: "nav.services", icon: LayoutGrid, useLogo: false },
  { key: "nav.oyuns_plus", icon: null, useLogo: true },
  { key: "nav.stats", icon: BarChart3, useLogo: false },
];

export function BottomNavBar({ activeTab, onTabChange, isAdmin = false, isAdminView = false, onSwitchView }: Props) {
  const { t } = useLang();
  const tabs = tabKeys.map(tk => ({ label: t(tk.key), icon: tk.icon, useLogo: tk.useLogo }));
  const showViewSwitcher = isAdmin && onSwitchView;
  return (
    <nav data-slot="bottom-navigation" className="liquid-nav fixed bottom-0 left-0 right-0 z-50 px-3 pb-safe" aria-label="Primary navigation">
      <div data-slot="bottom-navigation-surface" className="liquid-nav-stage max-w-lg mx-auto mb-3">
        <LiquidGlass
          className="liquid-nav-glass"
          displacementScale={42}
          blurAmount={0.22}
          saturation={150}
          aberrationIntensity={1.2}
          elasticity={0.12}
          cornerRadius={28}
          padding="0"
          mode="standard"
          style={{ position: "absolute", top: "50%", left: "50%", width: "100%" }}
        >
          <div className="liquid-nav__items">
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              const isActive = activeTab === index;
              return (
                <button
                  key={tabKeys[index].key}
                  type="button"
                  data-slot="bottom-navigation-item"
                  onClick={() => onTabChange(index)}
                  className={`liquid-nav__item ${isActive ? "is-active" : ""}`}
                  aria-label={tab.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span data-slot="bottom-navigation-indicator" className="liquid-nav__active-glow" aria-hidden="true" />
                  <span data-slot="bottom-navigation-icon" className={`liquid-nav__icon ${tab.useLogo ? "liquid-nav__icon--logo" : ""}`} aria-hidden="true">
                    {tab.useLogo ? (
                      <img
                        src={OYUNS_PLUS_LOGO_DEFAULT_URL}
                        alt={tab.label}
                        className="h-5 w-5 object-contain"
                      />
                    ) : (
                      Icon && <Icon className="h-[19px] w-[19px]" strokeWidth={isActive ? 2.5 : 2} />
                    )}
                  </span>
                  <span data-slot="bottom-navigation-label" className="liquid-nav__label">
                    {tab.label}
                  </span>
                </button>
              );
            })}
            {showViewSwitcher && (
              <button
                type="button"
                data-slot="bottom-navigation-item"
                onClick={onSwitchView}
                className="liquid-nav__item liquid-nav__item--switch"
                aria-label={isAdminView ? t("app.user") : t("app.admin")}
              >
                <span data-slot="bottom-navigation-icon" className="liquid-nav__icon" aria-hidden="true">
                  <Repeat2 className="h-[19px] w-[19px]" strokeWidth={2.2} />
                </span>
                <span data-slot="bottom-navigation-label" className="liquid-nav__label">
                  {isAdminView ? t("app.user") : t("app.admin")}
                </span>
              </button>
            )}
          </div>
        </LiquidGlass>
      </div>
    </nav>
  );
}
