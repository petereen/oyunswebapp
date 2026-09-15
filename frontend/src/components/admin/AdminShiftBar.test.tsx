import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AdminShiftBar } from "./AdminShiftBar";

const mocks = vi.hoisted(() => ({
  fetchCurrentShift: vi.fn().mockResolvedValue({ current_admin_id: null, current_admin_name: null, last_updated: null, is_shift_active: false }),
  fetchAdminUsers: vi.fn().mockResolvedValue({ admins: [{ id: 7, name: "Anuujin", is_active: true }] }),
  openShift: vi.fn().mockResolvedValue({ ok: true }),
  transferShift: vi.fn().mockResolvedValue({ ok: true }),
  closeShift: vi.fn().mockResolvedValue({ ok: true }),
  fetchWorkingHours: vi.fn().mockResolvedValue({ start_hour_moscow: 4, end_hour_moscow: 23, start_time_moscow: "04:00", end_time_moscow: "23:00", start_time_ub: "09:00", end_time_ub: "04:00", is_enabled: true, updated_at: null }),
  updateWorkingHours: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return { ...actual, ...mocks };
});

function renderBar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><AdminShiftBar /></QueryClientProvider>);
}

describe("AdminShiftBar", () => {
  it("uses the existing open-shift API arguments and refreshes the shared query", async () => {
    renderBar();
    await screen.findByText("Ээлж эхлүүлэх");
    fireEvent.click(screen.getByText("Ээлж эхлүүлэх"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Ээлж эхлүүлэх/ }));
    await waitFor(() => expect(mocks.openShift).toHaveBeenCalledWith(7, "Anuujin"));
    await waitFor(() => expect(mocks.fetchCurrentShift).toHaveBeenCalledTimes(2));
  });
});
