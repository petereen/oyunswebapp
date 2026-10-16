import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OyunsPlusMembershipCard } from "./OyunsPlusMembershipCard";
import { LangProvider } from "../i18n/useLang";

function renderCard(onDetailsOpen = vi.fn(), onReferralCopy = vi.fn()) {
  localStorage.setItem("oyuns_lang", "mn");
  render(<LangProvider><OyunsPlusMembershipCard cardHolder="Тэмүүлэн Очирбат" points={10000} referralCode="REF42" onReferralCopy={onReferralCopy} onDetailsOpen={onDetailsOpen} /></LangProvider>);
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

  it("shows the referral code and opens details from the back without flipping", () => {
    const onDetailsOpen = vi.fn();
    const card = renderCard(onDetailsOpen);
    fireEvent.click(card);
    expect(screen.queryByText("Нийт оноо")).not.toBeInTheDocument();
    expect(screen.getByText("REF42")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Дэлгэрэнгүй" }));
    expect(onDetailsOpen).toHaveBeenCalledOnce();
    expect(card).toHaveAttribute("data-flipped", "true");
  });

  it("copies the referral code without flipping the card", () => {
    const onReferralCopy = vi.fn();
    const card = renderCard(vi.fn(), onReferralCopy);
    fireEvent.click(card);
    fireEvent.click(screen.getByRole("button", { name: "Хуулах" }));
    expect(onReferralCopy).toHaveBeenCalledOnce();
    expect(card).toHaveAttribute("data-flipped", "true");
  });

  it("shows the card holder label on the front", () => {
    renderCard();
    expect(screen.getByText("Карт эзэмшигч")).toBeInTheDocument();
  });
});
