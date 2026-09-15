import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConverterSkeleton, HomeBannerSkeleton, QuickActionsSkeleton, ServicesGridSkeleton, Skeleton } from "./Skeleton";

describe("skeleton geometry", () => {
  it("exposes the shared shimmer primitive as decorative content", () => {
    const { container } = render(<Skeleton className="h-4 w-8 rounded-xl" />);
    const node = container.firstElementChild as HTMLElement;
    expect(node).toHaveAttribute("aria-hidden", "true");
    expect(node).toHaveClass("skeleton", "h-4", "w-8", "rounded-xl");
  });

  it("matches the announcement banner aspect ratio", () => {
    const { container } = render(<HomeBannerSkeleton />);
    expect(container.firstElementChild).toHaveClass("aspect-[3/1]", "rounded-3xl", "w-full");
  });

  it("keeps quick actions and service grid container geometry", () => {
    const quick = render(<QuickActionsSkeleton />).container.firstElementChild as HTMLElement;
    expect(quick.children).toHaveLength(3);
    expect(quick.children[0]).toHaveClass("h-14", "rounded-2xl");
    expect(quick.children[2]).toHaveClass("w-14", "h-14");

    const services = render(<ServicesGridSkeleton />).container.firstElementChild as HTMLElement;
    expect(services).toHaveClass("grid-cols-2", "gap-3");
    expect(services.children).toHaveLength(4);
    expect(services.children[0]).toHaveClass("h-[132px]", "p-5", "rounded-3xl");
  });

  it("preserves converter card geometry", () => {
    const { container } = render(<ConverterSkeleton />);
    expect(container.firstElementChild).toHaveClass("p-5", "rounded-3xl", "space-y-4");
    expect(container.querySelectorAll(".rounded-xl")).toHaveLength(3);
  });
});
