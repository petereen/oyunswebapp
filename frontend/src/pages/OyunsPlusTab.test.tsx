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
    window.localStorage.clear();
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
    expect(document.querySelector('[data-slot="oyuns-plus-membership-card"]')).not.toBeInTheDocument();
    const coupon = await screen.findByRole("button", { name: /Latte/ });
    expect(coupon).toBeInTheDocument();
    fireEvent.click(coupon);
    expect(await screen.findByRole("heading", { name: "Latte" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="oyuns-plus-membership-card"]')).not.toBeInTheDocument();
    expect(screen.getByText("1,500 ₮")).toBeInTheDocument();
    expect(screen.getAllByText("100")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "100" })).toBeInTheDocument();
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

  it("highlights brand pills only when the cheapest available coupon is affordable", async () => {
    fetchBrands.mockResolvedValueOnce({ brands: [
      { id: "brand-1", name: "Cheap Cafe", description: "", is_active: true, sort_order: 0, offer_count: 3, available_count: 2, min_points_price: 100, max_points_price: 500 },
      { id: "brand-2", name: "Fancy Spa", description: "", is_active: true, sort_order: 1, offer_count: 1, available_count: 1, min_points_price: 5000, max_points_price: 5000 },
    ] });
    renderPage();
    const cheap = await screen.findByRole("button", { name: /Cheap Cafe/ });
    const fancy = screen.getByRole("button", { name: /Fancy Spa/ });
    expect(cheap).not.toHaveClass("oyuns-plus-brand-tile--muted");
    expect(cheap).toHaveTextContent("100–500");
    expect(fancy).toHaveClass("oyuns-plus-brand-tile--muted");
  });

  it("shows the brand profile tabs and hides empty contact rows", async () => {
    fetchBrandCoupons.mockResolvedValueOnce({
      brand: { id: "brand-1", name: "Blue Coffee", description: "Best coffee", category: "Кофе шоп, Хоол", website_url: "https://blue.mn", is_active: true, sort_order: 0, offer_count: 0 },
      coupons: [],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Blue Coffee/ }));
    expect(await screen.findByRole("tab", { name: /Купоны/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Кофе шоп")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /О компании/ }));
    expect(await screen.findByText("Best coffee")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /blue\.mn/ })).toHaveAttribute("href", "https://blue.mn");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("switches coupons between grid and list and greys out unaffordable ones", async () => {
    fetchBrandCoupons.mockResolvedValueOnce({
      brand: { id: "brand-1", name: "Blue Coffee", description: "", is_active: true, sort_order: 0, offer_count: 2 },
      coupons: [
        { id: "c-1", brand_id: "brand-1", name: "Latte", description: "", badge_label: "Хэмнэлт 10%", value_type: "amount", discount_value: 5000, points_price: 100, country_code: "mn", purchase_count: 0, is_sold_out: false, needs_review: false, is_active: true },
        { id: "c-2", brand_id: "brand-1", name: "Cake", description: "", value_type: "amount", discount_value: 20000, points_price: 5000, country_code: "mn", purchase_count: 0, is_sold_out: false, needs_review: false, is_active: true },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Blue Coffee/ }));
    const latte = await screen.findByRole("button", { name: /Latte/ });
    expect(latte).toHaveClass("oyuns-plus-coupon-card", "oyuns-plus-coupon--available");
    expect(latte).toHaveTextContent("Хэмнэлт 10%");
    expect(screen.getByRole("button", { name: /Cake/ })).toHaveClass("oyuns-plus-coupon--locked");
    fireEvent.click(screen.getByRole("radio", { name: "Список" }));
    expect(screen.getByRole("button", { name: /Latte/ })).toHaveClass("oyuns-plus-coupon-item");
    expect(window.localStorage.getItem("oyuns-plus-coupon-view")).toBe("list");
  });
});
