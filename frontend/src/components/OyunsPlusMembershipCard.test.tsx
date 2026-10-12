import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OyunsPlusMembershipCard } from "./OyunsPlusMembershipCard";
import { LangProvider } from "../i18n/useLang";

function renderCard(onDetailsOpen = vi.fn()) {
  localStorage.setItem("oyuns_lang", "mn");
  render(<LangProvider><OyunsPlusMembershipCard cardHolder="Тэмүүлэн Очирбат" points={10000} earnedPoints={12500} spentPoints={2500} referralCode="NJAGR10R" invitedCount={15} onDetailsOpen={onDetailsOpen} /></LangProvider>);
  return document.querySelector('[data-slot="oyuns-plus-membership-card"]')!;
}

describe("OyunsPlusMembershipCard", () => {
  it("flips via the card surface and the face buttons", () => {
    const card = renderCard();
    expect(card).toHaveAttribute("data-flipped", "false");
    fireEvent.click(card);
    expect(card).toHaveAttribute("data-flipped", "true");
    fireEvent.click(screen.getByRole("button", { name: "Нүүр тал руу буцах", hidden: true }));
    expect(card).toHaveAttribute("data-flipped", "false");
    fireEvent.click(screen.getByRole("button", { name: "Картыг эргүүлэх" }));
    expect(card).toHaveAttribute("data-flipped", "true");
  });

  it("copies the referral code and opens details without flipping", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onDetailsOpen = vi.fn();
    const card = renderCard(onDetailsOpen);
    fireEvent.click(card);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Код хуулах" })); });
    expect(writeText).toHaveBeenCalledWith("NJAGR10R");
    expect(screen.getByRole("button", { name: "Код хуулагдлаа" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /15 хүн/ }));
    expect(onDetailsOpen).toHaveBeenCalledOnce();
    expect(card).toHaveAttribute("data-flipped", "true");
  });

  it("shows localized labels with earned and spent totals", () => {
    renderCard();
    expect(screen.getByText("Карт эзэмшигч")).toBeInTheDocument();
    expect(screen.getByText("Цуглуулсан")).toBeInTheDocument();
    expect(screen.getByText("+12,500")).toBeInTheDocument();
    expect(screen.getByText("Зарцуулсан −2,500")).toBeInTheDocument();
  });
});
