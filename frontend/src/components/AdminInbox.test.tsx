import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminInbox } from "./AdminInbox";

const mocks = vi.hoisted(() => ({
  fetchInbox: vi.fn(),
  adminAction: vi.fn(),
  requestPresign: vi.fn(),
  updateUserLabel: vi.fn(),
}));

vi.mock("../api", () => mocks);

vi.mock("../hooks/useAdminShift", () => ({
  useAdminShiftContext: () => ({
    data: {
      shift: { current_admin_id: 7 },
      admins: [{ id: 7, name: "Admin", is_active: true }],
    },
  }),
}));

const pendingTransaction = {
  invoice: "INV-PENDING",
  user_id: 101,
  amount: 1000,
  currency_from: "RUB",
  currency_to: "MNT",
  status: "pending",
  timestamp: "2026-09-15T08:00:00Z",
  rate: 44,
  direction: "buy",
  service_kind: "exchange" as const,
  bank_details: "Хаан банк,1234567890,Test User",
  bill_url: JSON.stringify(["https://example.com/tall-receipt.jpg"]),
};

const approvedTransaction = {
  ...pendingTransaction,
  invoice: "INV-APPROVED",
  amount: 2000,
  currency_from: "MNT",
  currency_to: "RUB",
  direction: "sell",
  status: "approved",
  bill_url: "https://example.com/approved-receipt.jpg",
};

describe("AdminInbox transaction review", () => {
  beforeEach(() => {
    mocks.fetchInbox.mockResolvedValue({ items: [pendingTransaction, approvedTransaction] });
    mocks.adminAction.mockResolvedValue({ ok: true });
  });

  it("opens receipt inspection in a body portal and closes nested viewers with Escape", async () => {
    render(<AdminInbox />);

    fireEvent.click(await screen.findByText("1,000 RUB"));

    const reviewDialog = screen.getByRole("dialog", { name: "Гүйлгээ шалгах" });
    const overlay = reviewDialog.closest('[data-slot="transaction-review-overlay"]');
    expect(overlay?.parentElement).toBe(document.body);
    expect(within(reviewDialog).getByRole("button", { name: "Гүйлгээний цонхыг хаах" })).toBeVisible();
    expect(within(reviewDialog).getByRole("button", { name: "Батлах" })).toBeVisible();

    fireEvent.click(within(reviewDialog).getByRole("button", { name: "Баримтыг бүтэн дэлгэцээр нээх" }));
    expect(screen.getByRole("dialog", { name: "Баримтын зураг бүтэн дэлгэцээр" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Баримтын зураг бүтэн дэлгэцээр" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Гүйлгээ шалгах" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Гүйлгээ шалгах" })).not.toBeInTheDocument());
  });

  it("opens approved transactions in review before the completion step", async () => {
    render(<AdminInbox />);

    fireEvent.click(await screen.findByText("2,000 MNT"));
    const reviewDialog = screen.getByRole("dialog", { name: "Гүйлгээ шалгах" });
    expect(screen.queryByRole("dialog", { name: "Гүйлгээг дуусгах" })).not.toBeInTheDocument();

    fireEvent.click(within(reviewDialog).getByRole("button", { name: "Гүйлгээ дуусгах" }));
    expect(screen.getByRole("dialog", { name: "Гүйлгээг дуусгах" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Гүйлгээ дуусгах цонхыг хаах" })).toBeVisible();
  });
});
