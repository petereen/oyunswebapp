import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOyunsPlusCards } from "./AdminOyunsPlusCards";

const mocks = vi.hoisted(() => ({
  fetchAdminOyunsPlusBrands: vi.fn(),
  fetchAdminOyunsPlusBrandCoupons: vi.fn(),
  fetchAdminOyunsPlusPartnerConfig: vi.fn(),
  createAdminOyunsPlusCoupon: vi.fn(),
}));
vi.mock("../../api", async () => ({ ...await vi.importActual<typeof import("../../api")>("../../api"), ...mocks }));

async function openCoupons() {
  render(<AdminOyunsPlusCards />);
  fireEvent.click(await screen.findByRole("button", { name: /Partner VPN/ }));
  await screen.findByText("Шинэ купон");
  await waitFor(() => expect(mocks.fetchAdminOyunsPlusPartnerConfig).toHaveBeenCalled());
}

describe("partner automatic coupon settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAdminOyunsPlusBrands.mockResolvedValue({ brands: [{ id: "partner-brand", name: "Partner VPN", is_active: true, offer_count: 0 }] });
    mocks.fetchAdminOyunsPlusBrandCoupons.mockResolvedValue({ coupons: [] });
    mocks.fetchAdminOyunsPlusPartnerConfig.mockResolvedValue({ brand_id: "partner-brand", enabled: true });
    mocks.createAdminOyunsPlusCoupon.mockResolvedValue({ id: "coupon-1" });
  });

  it("defaults to manual and saves automatic tier/validity in the existing coupon form", async () => {
    await openCoupons();
    const mode = screen.getByRole("combobox", { name: "Код олгох төрөл" });
    expect(mode).toHaveValue("manual");
    expect(screen.queryByLabelText("SKU tier")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "Automatic" })).toBeEnabled());
    fireEvent.change(mode, { target: { value: "automatic" } });
    fireEvent.change(screen.getByLabelText("SKU tier"), { target: { value: "vpn_premium_3m" } });
    fireEvent.change(screen.getByLabelText("Код хүчинтэй хоног"), { target: { value: "60" } });
    fireEvent.change(screen.getByPlaceholderText("Купоны нэр"), { target: { value: "Premium 3 months" } });
    fireEvent.change(screen.getByPlaceholderText("Хөнгөлөлтийн дүн"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("OYUNS+ үнэ"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Үүсгэх" }));
    await waitFor(() => expect(mocks.createAdminOyunsPlusCoupon).toHaveBeenCalledWith(expect.objectContaining({
      brand_id: "partner-brand", issuance_mode: "automatic", sku_tier: "vpn_premium_3m", validity_days: 60, points_price: 100,
    })));
  });

  it("disables automatic issuance for another brand", async () => {
    mocks.fetchAdminOyunsPlusPartnerConfig.mockResolvedValue({ brand_id: "another-brand", enabled: true });
    await openCoupons();
    expect(screen.getByRole("option", { name: "Automatic" })).toBeDisabled();
  });

  it("disables automatic issuance when partner configuration is missing", async () => {
    mocks.fetchAdminOyunsPlusPartnerConfig.mockResolvedValue({ brand_id: null, enabled: false });
    await openCoupons();
    expect(screen.getByRole("option", { name: "Automatic" })).toBeDisabled();
  });
});
