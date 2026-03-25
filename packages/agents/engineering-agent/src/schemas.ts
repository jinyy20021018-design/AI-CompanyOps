import { z } from "zod";

export const EngineeringArtifactSchema = z.object({
  architecture: z.string().min(1),
  components: z.array(z.string()).min(1),
  dataFlows: z.array(z.string()).min(1),
  apiSurface: z.array(z.string()).default([]),
  risksAndConstraints: z.array(z.string()).min(1)
});
