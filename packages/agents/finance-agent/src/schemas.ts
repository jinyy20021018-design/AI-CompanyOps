import { z } from "zod";

export const FinanceArtifactSchema = z.object({
  targetMarket: z.string().min(1),
  costDrivers: z.array(z.string()).min(1),
  revenueAssumptions: z.array(z.string()).min(1),
  pricingStrategy: z.string().min(1),
  roiOrBreakEven: z.string().min(1)
});
