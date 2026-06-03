import { initTRPC, TRPCError } from "@trpc/server";
import { Context } from "../types.js";
import { z } from "zod";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    if (error.cause instanceof z.ZodError) {
      console.error("tRPC Zod ValidationError (Path: " + shape.data?.path + "):", JSON.stringify(error.cause.flatten(), null, 2));
    } else {
      console.error("tRPC Error:", error);
    }
    return shape;
  }
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ 
      code: "UNAUTHORIZED", 
      message: "Authentifizierung erforderlich" 
    });
  }
  return next({
    ctx: {
      ...ctx,
      tenantId: ctx.session.user.id,
    } as Context,
  });
});
