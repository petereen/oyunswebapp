import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OyunsPlusTab } from "./OyunsPlusTab";
import { LangProvider } from "../i18n/useLang";

const mocks = vi.hoisted(() => ({
  fetchSummary: vi.fn(),
  fetchBrands: vi.fn(),
  fetchBrandCoupons: vi.fn(),
  fetchHistory: vi.fn(),
}));
const { fetchSummary, fetchBrands, fetchBrandCoupons, fetchHistory } = mocks;

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchOyunsPlusSummary: mocks.fetchSummary,
    fetchOyunsPlusBrands: mocks.fetchBrands,
    fetchOyunsPlusBrandCoupons: mocks.fetchBrandCoupons,
    fetchOyunsPlusHistory: mocks.fetchHistory,
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><LangProvider><OyunsPlusTab userId={42} /></LangProvider></QueryClientProvider>);
}

describe("OyunsPlusTab brand-first catalog", () => {
  beforeEach(() => {
    fetchSummary.mockResolvedValue({ points_balance: 1000, referral_code: "REF42", invited_total: 0, invited_verified: 0 });
    fetchBrands.mockResolvedValue({ brands: [{ id: "brand-1", name: "Blue Coffee", description: "Daily coffee", logo_url: null, is_active: true, sort_order: 0, offer_count: 1 }] });
    fetchBrandCoupons.mockResolvedValue({
      brand: { id: "brand-1", name: "Blue Coffee", description: "Daily coffee", logo_url: null, is_active: true, sort_order: 0, offer_count: 1 },
      coupons: [{ id: "coupon-1", brand_id: "brand-1", name: "Latte", description: "One drink", value_type: "amount", discount_value: 1500, currency_code: "MNT", points_price: 100, country_code: "mn", purchase_count: 0, remaining_purchase_count: 2, total_purchase_limit: 2, is_sold_out: false, needs_review: false, is_active: true }],
    });
    fetchHistory.mockResolvedValue({ entries: [], current_balance: 1000 });
  });

  it("navigates from the single brand list to its coupon list and detail", async () => {
    renderPage();
    const brand = await screen.findByRole("button", { name: /Blue Coffee/ });
    fireEvent.click(brand);
    const coupon = await screen.findByRole("button", { name: /Latte/ });
    expect(coupon).toBeInTheDocument();
    fireEvent.click(coupon);
    expect(await screen.findByRole("heading", { name: "Latte" })).toBeInTheDocument();
    expect(screen.getByText("1,500 MNT")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("keeps sold-out coupons visible and disables purchase", async () => {
    fetchBrandCoupons.mockResolvedValueOnce({
      brand: { id: "brand-1", name: "Blue Coffee", description: "", logo_url: null, is_active: true, sort_order: 0, offer_count: 1 },
      coupons: [{ id: "coupon-1", brand_id: "brand-1", name: "Sold latte", description: "", value_type: "percentage", discount_value: 10, points_price: 100, country_code: "mn", purchase_count: 2, remaining_purchase_count: 0, total_purchase_limit: 2, is_sold_out: true, needs_review: false, is_active: true }],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Blue Coffee/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Sold latte/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Распродано/ })).toBeDisabled());
  });
});
