import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminBankAccounts } from "../AdminBankAccounts";
import { AdminSettings } from "./AdminSettings";

const mocks = vi.hoisted(() => ({
  fetchAllAdminBankAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
  fetchAdminUsers: vi.fn().mockResolvedValue({ admins: [] }),
  fetchAppSettings: vi.fn().mockResolvedValue({ min_rub_amount: 2000, min_rub_buy: 2000, oyuns_plus_enabled: 1, oyuns_plus_threshold_rub: 10000, oyuns_plus_points_per_threshold: 10, oyuns_plus_referral_reward_points: 50, oyuns_plus_referral_max_uses: 5, home_banner_enabled: 0, home_banner_image_url: "", home_banner_link_url: "", email_verification_enabled: 1 }),
  fetchExchangeGroupSettings: vi.fn().mockResolvedValue({ mnt_to_rub_enabled: 0, rub_to_mnt_enabled: 0, telegram_group_id: null }),
}));

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return { ...actual, ...mocks };
});

describe("admin settings/account boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads account CRUD data without loading system settings", async () => {
    render(<AdminBankAccounts />);
    await screen.findByText("Банкны дансны удирдлага");
    expect(mocks.fetchAllAdminBankAccounts).toHaveBeenCalled();
    expect(mocks.fetchAdminUsers).toHaveBeenCalled();
    expect(mocks.fetchAppSettings).not.toHaveBeenCalled();
    expect(mocks.fetchExchangeGroupSettings).not.toHaveBeenCalled();
  });

  it("loads system settings without loading account rows", async () => {
    render(<AdminSettings />);
    await screen.findByText("Системийн тохиргоо");
    await waitFor(() => expect(mocks.fetchAppSettings).toHaveBeenCalled());
    expect(mocks.fetchExchangeGroupSettings).toHaveBeenCalled();
    expect(mocks.fetchAllAdminBankAccounts).not.toHaveBeenCalled();
  });
});
