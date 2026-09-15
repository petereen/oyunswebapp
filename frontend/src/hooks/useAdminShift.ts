import { useQuery } from "@tanstack/react-query";
import {
  AdminUser,
  fetchAdminUsers,
  fetchCurrentShift,
  ShiftResponse,
} from "../api";
import { queryKeys } from "../queryKeys";

export type AdminShiftContext = {
  shift: ShiftResponse;
  admins: AdminUser[];
};

export function useAdminShiftContext() {
  return useQuery<AdminShiftContext>({
    queryKey: queryKeys.admin.shiftContext,
    queryFn: async () => {
      const [shift, users] = await Promise.all([
        fetchCurrentShift(),
        fetchAdminUsers(),
      ]);
      return { shift, admins: users.admins || [] };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
}
