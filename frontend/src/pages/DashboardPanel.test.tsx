import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPanel } from "./DashboardPanel";

const mocks = vi.hoisted(() => ({
  verifyDashboardKey: vi.fn(),
  fetchDashboardData: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, verifyDashboardKey: mocks.verifyDashboardKey, fetchDashboardData: mocks.fetchDashboardData };
});

vi.mock("./BalanceProfitPage", () => ({
  BalanceProfitPage: ({ activePage }: { activePage: string }) => {
    const [draft, setDraft] = React.useState("");
    return (
      <section aria-label={`${activePage} workspace`}>
        <label>Finance draft<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      </section>
    );
  },
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const transaction = (index: number) => ({
  invoice: `INV-${index}`,
  timestamp: "2026-09-29T03:00:00Z",
  user_id: index,
  user_name: `User ${index}`,
  direction: "buy" as const,
  amount: 100,
  currency_from: "RUB",
  currency_to: "MNT",
  rate: 44,
  rub_equivalent: 100,
  status: "completed",
  promo_code: null,
  bank_details: null,
  completed_by_admin: 7,
  admin_name: "Admin 7",
  duration_minutes: 4,
});

const data = (transactions = [transaction(1)]): any => ({
  summary: {
    total_count: transactions.length,
    valid_count: transactions.length,
    completed_count: transactions.length,
    pending_count: 0,
    rejected_count: 0,
    waiting_edit_count: 0,
    total_volume_rub: 100,
    completed_volume_rub: 100,
    buy_count: transactions.length,
    sell_count: 0,
    buy_volume_rub: 100,
    sell_volume_rub: 0,
    unique_users: transactions.length,
    avg_transaction_rub: 100,
    avg_duration_minutes: 4,
  },
  status_breakdown: [],
  direction_breakdown: [],
  time_series: [],
  top_users: [],
  admin_stats: [],
  admins: [{ admin_id: 7, name: "Admin 7" }],
  transactions,
  row_count: transactions.length,
  window_count: transactions.length,
  truncated: false,
});

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(<QueryClientProvider client={client}><DashboardPanel /></QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  mocks.verifyDashboardKey.mockResolvedValue(true);
  mocks.fetchDashboardData.mockResolvedValue(data());
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("standalone finance dashboard", () => {
  it("logs in with the key, keeps finance drafts while switching areas, and logs out", async () => {
    renderDashboard();

    fireEvent.change(await screen.findByLabelText("Нэвтрэх түлхүүр"), { target: { value: "valid-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Нэвтрэх" }));

    expect(await screen.findByRole("heading", { name: "OYUNS Санхүү" })).toBeVisible();
    expect(mocks.verifyDashboardKey).toHaveBeenCalledTimes(1);
    const draft = screen.getByLabelText("Finance draft");
    fireEvent.change(draft, { target: { value: "unsaved balance" } });

    fireEvent.click(screen.getByRole("button", { name: "Ашиг" }));
    expect(screen.getByLabelText("Finance draft")).toHaveValue("unsaved balance");
    expect(window.location.search).toContain("dashboard-tab=profit");
    fireEvent.click(screen.getByRole("button", { name: "Гүйлгээ" }));
    fireEvent.click(screen.getByRole("button", { name: "Баланс" }));
    expect(screen.getByLabelText("Finance draft")).toHaveValue("unsaved balance");

    fireEvent.click(screen.getByRole("button", { name: "Гарах" }));
    expect(await screen.findByLabelText("Нэвтрэх түлхүүр")).toBeVisible();
    expect(localStorage.getItem("oyuns_dashboard_key")).toBeNull();
  });

  it("applies status/admin filters and exports matching loaded rows with accurate row limits", async () => {
    const transactions = Array.from({ length: 501 }, (_, index) => ({ ...transaction(index + 1), status: "rejected" }));
    mocks.fetchDashboardData.mockResolvedValue(data(transactions));
    localStorage.setItem("oyuns_dashboard_key", "valid-key");
    renderDashboard();

    await screen.findByRole("heading", { name: "OYUNS Санхүү" });
    fireEvent.click(screen.getByRole("button", { name: "Гүйлгээ" }));
    await screen.findByRole("heading", { name: "Гүйлгээний статистик" });
    expect(await screen.findByRole("heading", { name: "Гүйлгээний дүн (RUB) хугацаагаар" })).toBeVisible();
    await waitFor(() => expect(mocks.fetchDashboardData).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Төлөв"), { target: { value: "rejected" } });
    await waitFor(() => expect(mocks.fetchDashboardData).toHaveBeenLastCalledWith(expect.objectContaining({ status: "rejected" })));
    await screen.findByRole("option", { name: "Admin 7" });
    fireEvent.change(screen.getByLabelText("Админ"), { target: { value: "7" } });
    await waitFor(() => expect(mocks.fetchDashboardData).toHaveBeenLastCalledWith(expect.objectContaining({ admin_id: 7 })));

    expect(await screen.findByText(/Эхний 500 мөрийг харуулж байна/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Invoice ID, хэрэглэгч, админ эсвэл promo кодоор хайх"), { target: { value: "INV-501" } });
    await screen.findAllByText("INV-501");
    expect(screen.getAllByText("INV-501").length).toBeGreaterThan(0);
    expect(screen.queryByText("INV-500")).not.toBeInTheDocument();

    let exportedBlob: Blob | null = null;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => { exportedBlob = blob; return "blob:test"; }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "CSV татах · 1 мөр" }));
    expect(click).toHaveBeenCalled();
    expect(exportedBlob).toBeInstanceOf(Blob);
    expect(await exportedBlob!.text()).toContain("INV-501");

    fireEvent.change(screen.getByLabelText("Хугацаа"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Эхлэх огноо"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("Дуусах огноо"), { target: { value: "2026-09-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Эхлэх огноо дуусах огнооноос хойш байж болохгүй");
  });

  it("shows transaction read failures and recovers on retry", async () => {
    mocks.fetchDashboardData.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(data());
    localStorage.setItem("oyuns_dashboard_key", "valid-key");
    renderDashboard();
    await screen.findByRole("heading", { name: "OYUNS Санхүү" });
    fireEvent.click(screen.getByRole("button", { name: "Гүйлгээ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Мэдээлэл ачаалж чадсангүй");
    fireEvent.click(screen.getByRole("button", { name: "Дахин ачаалах" }));
    expect(await screen.findByRole("heading", { name: "Гүйлгээний дүн (RUB) хугацаагаар" })).toBeVisible();
  });
});
