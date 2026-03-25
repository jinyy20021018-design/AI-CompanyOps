import { z } from "zod";

export const ProductArtifactSchema = z.object({
  productVision: z.string().min(1),
  userSegment: z.string().min(1),
  coreFeatures: z.array(z.string()).min(1),
  successCriteria: z.array(z.string()).min(1),
  acceptanceCriteria: z.array(z.string()).min(1)
});
