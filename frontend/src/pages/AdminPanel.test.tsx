import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminPanel } from "./AdminPanel";

vi.mock("../components/admin/AdminShiftBar", () => ({ AdminShiftBar: () => <div data-testid="admin-shift-bar">shift-bar</div> }));
vi.mock("../components/AdminInbox", () => ({ AdminInbox: () => <div>inbox-panel</div> }));
vi.mock("../components/AdminKyc", () => ({ AdminKyc: () => <div>kyc-panel</div> }));
vi.mock("../components/AdminUserSearch", () => ({ AdminUserSearch: () => <div>search-panel</div> }));
vi.mock("../components/AdminBankAccounts", () => ({ AdminBankAccounts: () => <div>accounts-panel</div> }));
vi.mock("../components/AdminHistory", () => ({ AdminHistory: () => <div>history-panel</div> }));
vi.mock("../components/AdminGifts", () => ({ AdminGifts: () => <div>gifts-panel</div> }));
vi.mock("../components/admin/AdminSettings", () => ({ AdminSettings: () => <div>settings-panel</div> }));
vi.mock("../components/AdminManualTransaction", () => ({ AdminManualTransaction: ({ onOpenInbox }: { onOpenInbox: () => void }) => <div><span>manual-panel</span><button onClick={onOpenInbox}>manual back to inbox</button></div> }));

describe("AdminPanel", () => {
  it("exposes the new seven-tab hierarchy and keeps visited panels mounted", () => {
    const { container } = render(<AdminPanel />);
    expect(screen.getByTestId("admin-shift-bar")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(screen.queryByRole("tab", { name: "Хайлт" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Данс" }));
    expect(screen.getByText("accounts-panel")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Гүйлгээ" }));
    expect(screen.getByText("inbox-panel")).toBeVisible();
    expect(container.querySelector("#admin-panel-accounts")).toHaveAttribute("hidden");
    expect(screen.getByTestId("admin-shift-bar")).toBeInTheDocument();
  });

  it("returns from manual creation to the inbox without losing the inbox panel", () => {
    render(<AdminPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Гараар үүсгэх" }));
    fireEvent.click(screen.getByRole("button", { name: "manual back to inbox" }));
    expect(screen.getByText("inbox-panel")).toBeVisible();
  });
});
