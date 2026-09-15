import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminUsersContainer } from "./AdminUsersContainer";

vi.mock("../AdminKyc", () => ({ AdminKyc: () => <div><label>KYC state<input aria-label="KYC state" defaultValue="expanded" /></label></div> }));
vi.mock("../AdminUserSearch", () => ({ AdminUserSearch: () => <div><label>Search state<input aria-label="Search state" defaultValue="saved query" /></label></div> }));

describe("AdminUsersContainer", () => {
  it("keeps both user subviews mounted after switching", () => {
    const { container } = render(<AdminUsersContainer />);
    fireEvent.click(screen.getByRole("tab", { name: "Хэрэглэгч хайх" }));
    expect(screen.getByDisplayValue("saved query")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Баталгаажуулалт (KYC)" }));
    expect(screen.getByDisplayValue("expanded")).toBeVisible();
    expect(container.querySelector("#admin-users-search-panel")).toHaveAttribute("hidden");
    expect(container.querySelector("#admin-users-kyc-panel")).not.toHaveAttribute("hidden");
  });
});
