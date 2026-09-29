import { z } from "zod";

export const assessmentIdParamSchema = z.object({
  applicationId: z.uuid(),
  assessmentId: z.uuid(),
});
