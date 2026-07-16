import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { PLANS, isPlanId, type PlanId } from "@shared/plans";
import type { TrpcContext } from "../_core/context";
import { hashPassword } from "../_core/password";
import { adminProcedure, router } from "../_core/trpc";
import {
  changeSubscriptionPlan,
  getStripeGenerationEntitlement,
} from "../billing";
import * as db from "../db";

function requestContext(ctx: TrpcContext) {
  const userAgent = ctx.req.headers["user-agent"];
  return {
    // Express derives this from trusted connection/proxy configuration.
    ipAddress: ctx.req.ip || ctx.req.socket.remoteAddress || null,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 1000) : null,
  };
}

function adminError(error: unknown): never {
  const message =
    error instanceof Error ? error.message : "The admin action failed";
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

const userIdInput = z.object({ userId: z.number().int().positive() });

async function refreshMissingSubscriptionPeriods(
  items: Array<{
    id: number;
    billingSource?: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodStart: Date | null;
  }>
): Promise<boolean> {
  let refreshed = false;
  await Promise.all(
    items
      .filter(
        item =>
          item.billingSource !== "admin" &&
          item.stripeSubscriptionId &&
          !item.currentPeriodStart
      )
      .map(async item => {
        try {
          const entitlement = await getStripeGenerationEntitlement(item.id);
          if (!entitlement) return;
          // Conditioned on the same Stripe subscription so a concurrent admin
          // grant is never overwritten with stale Stripe period dates.
          const applied = await db.refreshStripeSubscriptionPeriod(
            item.id,
            item.stripeSubscriptionId!,
            {
              currentPeriodStart: entitlement.periodStart,
              currentPeriodEnd: entitlement.periodEnd,
            }
          );
          if (applied) refreshed = true;
        } catch (error) {
          console.warn("[Admin] Could not refresh Stripe billing period", {
            userId: item.id,
            error,
          });
        }
      })
  );
  return refreshed;
}

export const adminRouter = router({
  overview: adminProcedure.query(async () => {
    const result = await db.listUsersForAdmin({ page: 1, pageSize: 1 });
    return result.overview;
  }),

  listUsers: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(50).default(20),
        search: z.string().trim().max(320).optional(),
        role: z.enum(["all", "user", "admin"]).default("all"),
        accountStatus: z.enum(["all", "active", "disabled"]).default("all"),
      })
    )
    .query(async ({ input }) => {
      const result = await db.listUsersForAdmin(input);
      return (await refreshMissingSubscriptionPeriods(result.items))
        ? db.listUsersForAdmin(input)
        : result;
    }),

  getUser: adminProcedure.input(userIdInput).query(async ({ input }) => {
    let user = await db.getUserForAdmin(input.userId);
    if (!user)
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    if (await refreshMissingSubscriptionPeriods([user])) {
      user = await db.getUserForAdmin(input.userId);
    }
    if (!user)
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    return user;
  }),

  listAuditLogs: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(100).default(30),
      })
    )
    .query(({ input }) => db.listAdminAuditLogs(input)),

  availablePlans: adminProcedure.query(() =>
    PLANS.map(plan => ({
      id: plan.id,
      name: plan.name,
      interval: plan.interval,
      priceLabel: plan.priceLabel,
      videoAllowance: plan.videoAllowance,
    }))
  ),

  setAccountDisabled: adminProcedure
    .input(userIdInput.extend({ disabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await db.setAccountDisabledByAdmin({
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          disabled: input.disabled,
          context: requestContext(ctx),
        });
        return { ok: true } as const;
      } catch (error) {
        adminError(error);
      }
    }),

  setRole: adminProcedure
    .input(userIdInput.extend({ role: z.enum(["user", "admin"]) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await db.setUserRoleByAdmin({
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          role: input.role,
          context: requestContext(ctx),
        });
        return { ok: true } as const;
      } catch (error) {
        adminError(error);
      }
    }),

  resetPassword: adminProcedure
    .input(userIdInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const temporaryPassword = `ET-${nanoid(20)}`;
        await db.resetUserPasswordByAdmin({
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          passwordHash: await hashPassword(temporaryPassword),
          context: requestContext(ctx),
        });
        return {
          ok: true,
          temporaryPassword,
          message:
            "Share this one-time password securely. It will not be shown again.",
        } as const;
      } catch (error) {
        adminError(error);
      }
    }),

  revokeSessions: adminProcedure
    .input(userIdInput)
    .mutation(async ({ ctx, input }) => {
      try {
        await db.revokeUserSessionsByAdmin({
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          context: requestContext(ctx),
        });
        return { ok: true } as const;
      } catch (error) {
        adminError(error);
      }
    }),

  setUsageAdjustment: adminProcedure
    .input(
      userIdInput.extend({ adjustment: z.number().int().min(-1000).max(10000) })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await db.setUsageAdjustmentByAdmin({
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          adjustment: input.adjustment,
          context: requestContext(ctx),
        });
        return { ok: true } as const;
      } catch (error) {
        adminError(error);
      }
    }),

  changePlan: adminProcedure
    .input(userIdInput.extend({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!isPlanId(input.planId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unknown subscription plan",
        });
      }
      const context = requestContext(ctx);
      const existing = await db.getSubscription(input.userId);
      const hasLiveStripeSubscription = Boolean(
        existing?.billingSource === "stripe" &&
        existing.stripeSubscriptionId &&
        !["inactive", "canceled", "incomplete_expired"].includes(
          existing.status
        )
      );
      const source = hasLiveStripeSubscription ? "stripe" : "admin";
      // Persist intent before touching Stripe or granting access so every
      // privileged billing mutation has an immutable audit record.
      await db.createAdminAuditLog({
        actorUserId: ctx.user.id,
        targetUserId: input.userId,
        action: "subscription.plan_change_requested",
        details: { planId: input.planId, source },
        context,
      });
      try {
        if (source === "stripe") {
          await changeSubscriptionPlan(input.userId, input.planId as PlanId);
        } else {
          await db.setAdminManagedPlan({
            targetUserId: input.userId,
            planId: input.planId as PlanId,
          });
        }
        await db.createAdminAuditLog({
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          action: "subscription.plan_change_completed",
          details: { planId: input.planId, source },
          context,
        });
        return { ok: true, source } as const;
      } catch (error) {
        await db
          .createAdminAuditLog({
            actorUserId: ctx.user.id,
            targetUserId: input.userId,
            action: "subscription.plan_change_failed",
            details: {
              planId: input.planId,
              source,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown billing error",
            },
            context,
          })
          .catch(() => undefined);
        adminError(error);
      }
    }),
});
