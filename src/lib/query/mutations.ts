import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { sessionsApi } from "@/lib/api";
import type { DeleteSessionOptions } from "@/lib/api/sessions";
import { extractErrorMessage } from "@/utils/errorUtils";

export const useDeleteSessionMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (options: DeleteSessionOptions) => {
      await sessionsApi.delete(options);
      return options;
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({
        queryKey: ["sessionMessages", variables.providerId, variables.sourcePath],
      });

      toast.success(
        t("sessionManager.deleteSuccess", {
          defaultValue: "会话已删除",
        }),
      );
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(
        t("sessionManager.deleteFailed", {
          defaultValue: "删除会话失败: {{error}}",
          error: detail,
        }),
      );
    },
  });
};
