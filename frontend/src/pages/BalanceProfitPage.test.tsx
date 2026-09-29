import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BalanceProfitPage } from "./BalanceProfitPage";

const mocks = vi.hoisted(() => ({
  fetchBalanceSummary: vi.fn(), fetchBalanceHistory: vi.fn(), fetchDashboardAdminBankAccounts: vi.fn(),
  fetchProfit: vi.fn(), fetchProfitTransactions: vi.fn(), fetchPlaneTicketSales: vi.fn(),
  fetchCostRates: vi.fn(), fetchBlackRates: vi.fn(), updateTreasuryAccount: vi.fn(),
  deleteTreasuryAccount: vi.fn(),
  createBalanceAdjustment: vi.fn(), deleteBalanceAdjustment: vi.fn(), createPlaneTicketSale: vi.fn(),
  deletePlaneTicketSale: vi.fn(), saveCostRate: vi.fn(), saveCostRatePeriodUsd: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, ...mocks };
});

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null, Cell: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null,
}));

const account = {
  id: "account-1", name: "Main RUB", admin_id: 7, admin_name: "Admin 7", admin_bank_id: null,
  admin_bank_name: null, admin_bank_owner: null, admin_bank_currency: "RUB", prev_balance: 800,
  rub_to_mnt: 400, mnt_to_rub: 100, adjustment: 50, adjustment_total: 50, entered_balance: 1050,
  calculated_balance: 1100, discrepancy: 50, balance_date: "2026-09-29", currency: "RUB", is_active: true, display_order: 0,
};
const balance = {
  date: "2026-09-29", admins: [{ admin_id: 7, name: "Admin 7" }], selected_admin_id: 7,
  accounts: [account], daily_balances: [], adjustments: [{ id: "adj-1", admin_id: 7, admin_name: "Admin 7", treasury_account_id: "account-1", account_name: "Main RUB", balance_date: "2026-09-29", amount: 50, tag: "Fee", description: "Bank fee" }],
  rub_to_mnt_rub: 400, mnt_to_rub_rub: 100, prev_balance_total: 800, adjustment_total: 50,
  total_balance: 1100, entered_balance_total: 1050, difference_total: 50, missing_entered_balance_count: 0,
};
const profit = {
  total_profit: 1200, buy_profit: 700, sell_profit: 300, ticket_profit: 200, currency: "MNT",
  counted: 3, ticket_count: 1, by_day: [{ date: "2026-09-29", profit: 1200, count: 3 }], missing_rate_dates: [],
};

function renderPage(activePage: "balance" | "profit" = "balance") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(<QueryClientProvider client={client}><BalanceProfitPage activePage={activePage} dashboardTimeZone="moscow" /></QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oyuns_dashboard_balance_admin_id", "7");
  mocks.fetchBalanceSummary.mockResolvedValue(balance);
  mocks.fetchBalanceHistory.mockResolvedValue({ days: ["2026-09-29"], rows: [{
    row_key: "history-1", balance_date: "2026-09-29", scope_type: "admin", admin_id: 7, admin_name: "Admin 7",
    opening_balance: 800, rub_to_mnt_rub: 400, mnt_to_rub_rub: 100, adjustment_total: 50,
    calculated_balance: 1100, entered_balance: 1050, discrepancy: 50,
  }] });
  mocks.fetchDashboardAdminBankAccounts.mockResolvedValue({ accounts: [] });
  mocks.fetchProfit.mockResolvedValue(profit);
  mocks.fetchProfitTransactions.mockResolvedValue({ count: 2, items: [
    { invoice_id: "INV-B", transaction_type: "exchange", timestamp: "2026-09-29T10:00:00Z", direction: "buy", amount: 100, currency_from: "RUB", currency_to: "MNT", rate: 44, cost_rate: 45, rub_equivalent: 100, profit_mnt: 100, status: "completed" },
    { invoice_id: "INV-A", transaction_type: "exchange", timestamp: "2026-09-28T10:00:00Z", direction: "sell", amount: 4400, currency_from: "MNT", currency_to: "RUB", rate: 44, cost_rate: 45, rub_equivalent: 100, profit_mnt: 100, status: "completed" },
  ] });
  mocks.fetchPlaneTicketSales.mockResolvedValue({ sales: [{
    id: "sale-1", sale_date: "2026-09-29", sold_price_mnt: 100000, exchange_rate: 44,
    cost_rate: 2, rub_equivalent: 2273, profit_mnt: 95454, note: "fixture sale",
  }], summary: { count: 1, total_profit: 95454, total_sold_price_mnt: 100000 } });
  mocks.fetchCostRates.mockResolvedValue([{ rate_date: "2026-09-28", usd_rate: 90, black_rate: 45, cost_rate: 2 }]);
  mocks.fetchBlackRates.mockResolvedValue({ configured: true, rates: { "2026-09-29": 45 } });
  mocks.updateTreasuryAccount.mockResolvedValue({ account });
  mocks.deleteTreasuryAccount.mockResolvedValue({});
  mocks.createBalanceAdjustment.mockResolvedValue({ adjustment: {} });
  mocks.deleteBalanceAdjustment.mockResolvedValue({});
  mocks.createPlaneTicketSale.mockResolvedValue({ sale: {} });
  mocks.deletePlaneTicketSale.mockResolvedValue({});
  mocks.saveCostRate.mockResolvedValue({});
  mocks.saveCostRatePeriodUsd.mockResolvedValue({ updated_count: 3 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("finance balance and profit workspaces", () => {
  it("shows the reconciliation, loads history, and saves balance and adjustment changes", async () => {
    renderPage();
    await screen.findByText("Өдрийн баланс");
    await screen.findAllByText("Main RUB");
    expect(screen.getAllByText("1,100 ₽")[0]).toBeVisible();
    fireEvent.click(screen.getByText("Балансын тооцоолол"));
    expect(screen.getByText(/энэ томьёонд орохгүй/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Өдрийн тооцооны түүх нээх" }));
    await waitFor(() => expect(mocks.fetchBalanceHistory).toHaveBeenCalledWith({ days: 60, tz: "moscow" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "CSV" })).toBeEnabled());
    let historyBlob: Blob | null = null;
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn((blob: Blob) => { historyBlob = blob; return "blob:history"; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    expect(await historyBlob!.text()).toContain("calculated_balance");
    expect(await historyBlob!.text()).toContain("1100");

    fireEvent.change(screen.getAllByLabelText("“Main RUB” оруулсан баланс")[0], { target: { value: "1060" } });
    fireEvent.click(screen.getAllByRole("button", { name: "“Main RUB” дансны үлдэгдэл хадгалах" })[0]);
    await waitFor(() => expect(mocks.updateTreasuryAccount).toHaveBeenCalledWith("account-1", expect.objectContaining({ entered_balance: 1060, tz: "moscow" })));

    fireEvent.change(screen.getByLabelText("Дүн (₽)"), { target: { value: "75" } });
    fireEvent.change(screen.getByLabelText("Таг"), { target: { value: "Commission" } });
    fireEvent.click(screen.getByRole("button", { name: "Нэмэх" }));
    await waitFor(() => expect(mocks.createBalanceAdjustment).toHaveBeenCalledWith(expect.objectContaining({ admin_id: 7, amount: 75, tag: "Commission" })));

    fireEvent.click(screen.getByRole("button", { name: "“Fee” орлого/зарлагын мөр устгах" }));
    await waitFor(() => expect(mocks.deleteBalanceAdjustment).toHaveBeenCalledWith("adj-1"));

    fireEvent.click(screen.getAllByRole("button", { name: "“Main RUB” данс устгах" })[0]);
    await waitFor(() => expect(mocks.deleteTreasuryAccount).toHaveBeenCalledWith("account-1"));
  });

  it("sorts profit details, creates ticket sales, and saves daily and period cost rates", async () => {
    renderPage("profit");
    expect(await screen.findByText("1,200 ₮")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Жагсаалт харах" }));
    expect(await screen.findByRole("dialog", { name: "Ашгийн дэлгэрэнгүй жагсаалт" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Invoice ID" }));
    expect(screen.getAllByText("INV-A")[0]).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText("Огноо")[0], { target: { value: "2026-09-29" } });
    fireEvent.change(screen.getByLabelText("Зарагдсан үнэ (₮)"), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Ханш"), { target: { value: "44" } });
    fireEvent.click(screen.getByRole("button", { name: "Борлуулалт нэмэх" }));
    await waitFor(() => expect(mocks.createPlaneTicketSale).toHaveBeenCalledWith(expect.objectContaining({ sale_date: "2026-09-29", sold_price_mnt: 200000, exchange_rate: 44 })));
    fireEvent.click(screen.getAllByRole("button", { name: "2026-09-29 өдрийн тийзийн борлуулалт устгах" })[0]);
    await waitFor(() => expect(mocks.deletePlaneTicketSale).toHaveBeenCalledWith("sale-1"));

    fireEvent.change(screen.getAllByLabelText("Эхлэх огноо")[0], { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getAllByLabelText("Дуусах огноо")[0], { target: { value: "2026-09-03" } });
    fireEvent.change(screen.getAllByLabelText("USD ханш").at(-1)!, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Period USD хадгалах" }));
    await waitFor(() => expect(mocks.saveCostRatePeriodUsd).toHaveBeenCalledWith(expect.objectContaining({ start: "2026-09-01", end: "2026-09-03", usd_rate: 90, tz: "moscow" })));

    fireEvent.click(screen.getByRole("button", { name: "Google Sheets-ээс black ханш татах" }));
    await waitFor(() => expect(mocks.fetchBlackRates).toHaveBeenCalled());

    fireEvent.change(screen.getAllByLabelText("USD ханш")[0], { target: { value: "92" } });
    fireEvent.change(screen.getByLabelText("Black ханш (Sheets)"), { target: { value: "46" } });
    fireEvent.click(screen.getByRole("button", { name: "Өртөг ханш хадгалах" }));
    await waitFor(() => expect(mocks.saveCostRate).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-09-29", usd_rate: 92, black_rate: 46 })));

    fireEvent.change(screen.getAllByLabelText("USD ханш")[0], { target: { value: "96" } });
    fireEvent.change(screen.getByLabelText("Black ханш (Sheets)"), { target: { value: "48" } });
    await waitFor(() => expect(mocks.saveCostRate).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-09-29", usd_rate: 96, black_rate: 48 })), { timeout: 2000 });

    fireEvent.click(screen.getAllByRole("button", { name: "2026-09-28 өдрийн USD ханш засах" })[0]);
    fireEvent.change(screen.getAllByLabelText("2026-09-28 өдрийн USD ханш")[0], { target: { value: "95" } });
    fireEvent.click(screen.getAllByRole("button", { name: "2026-09-28 өдрийн USD ханш хадгалах" })[0]);
    await waitFor(() => expect(mocks.saveCostRate).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-09-28", usd_rate: 95, black_rate: 45 })));
  });
});
