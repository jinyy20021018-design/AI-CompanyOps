import Fastify from "fastify";
import { ZodError } from "zod";
import { reviewQaRequest } from "../../../packages/agents/qa-agent/src/index.js";
import type { AppEnv } from "./loadEnv.js";

export function buildServer(env: AppEnv) {
  const app = Fastify({ logger: false });

  app.post("/qa/review", async (request, reply) => {
    try {
      const report = await reviewQaRequest(request.body, env);
      return reply.code(200).send(report);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          message: "Invalid review request.",
          issues: error.issues
        });
      }

      request.log.error(error);
      return reply.code(500).send({ message: "Internal server error." });
    }
  });

  return app;
}
