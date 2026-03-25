import { z } from "zod";

export const CeoTaskTargetSchema = z.enum(["product", "engineering", "finance", "qa"]);

export const CeoTaskSchema = z.object({
  id: z.string().min(1),
  targetAgent: CeoTaskTargetSchema,
  objective: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  context: z.record(z.unknown()).default({})
});

export const CeoPlanSchema = z.object({
  userRequest: z.string().min(1),
  tasks: z.array(CeoTaskSchema).min(1),
  successCriteria: z.array(z.string()).default([])
});
