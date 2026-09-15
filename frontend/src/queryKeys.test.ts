import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "./queryKeys";

describe("queryKeys", () => {
  it("keeps shared resource keys stable and user resources isolated", () => {
    expect(queryKeys.rates).toEqual(["rates"]);
    expect(queryKeys.serviceStatus).toEqual(["service-status"]);
    expect(queryKeys.profile(101)).not.toEqual(queryKeys.profile(202));
    expect(queryKeys.oyunsPlus.summary(101)).not.toEqual(queryKeys.oyunsPlus.summary(202));
    expect(queryKeys.trackers.transactions(101)).not.toEqual(queryKeys.trackers.gifts(101));
  });

  it("deduplicates concurrent fetches for one cache key", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi.fn(async () => ({ user: { id: 101 } }));
    const key = queryKeys.profile(101);

    await Promise.all([
      client.fetchQuery({ queryKey: key, queryFn: fetcher }),
      client.fetchQuery({ queryKey: key, queryFn: fetcher }),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(key)).toEqual({ user: { id: 101 } });
  });

  it("invalidates only the selected user profile", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.profile(101), { user: { id: 101 } });
    client.setQueryData(queryKeys.profile(202), { user: { id: 202 } });

    await client.invalidateQueries({ queryKey: queryKeys.profile(101), refetchType: "none" });

    expect(client.getQueryState(queryKeys.profile(101))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.profile(202))?.isInvalidated).toBe(false);
  });
});
