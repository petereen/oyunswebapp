import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../i18n/useLang";
import { BottomNavBar } from "./BottomNavBar";

vi.mock("liquid-glass-react", () => ({
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className} data-testid="liquid-glass">{children}</div>
  ),
}));

describe("BottomNavBar", () => {
  it("exposes the active destination and changes tabs", () => {
    const onTabChange = vi.fn();
    render(
      <LangProvider>
        <BottomNavBar activeTab={0} onTabChange={onTabChange} />
      </LangProvider>,
    );

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const tabs = Array.from(navigation.querySelectorAll<HTMLButtonElement>("button"));

    expect(screen.getByTestId("liquid-glass")).toBeInTheDocument();
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    expect(tabs[1]).not.toHaveAttribute("aria-current");

    fireEvent.click(tabs[2]);
    expect(onTabChange).toHaveBeenCalledWith(2);
  });
});
