import { TRPCError } from "@trpc/server";
import { PLAN_BY_ID, type PlanId } from "@shared/plans";
import { z } from "zod";
import * as db from "../db";
import {
  ensurePrice,
  getStripe,
  getStripeGenerationEntitlement,
} from "../billing";
import { hashPassword } from "../_core/password";
import { adminProcedure, router } from "../_core/trpc";

const userIdSchema = z.number().int().positive();
const planIdSchema = z.enum([
  "starter_monthly",
  "creator_monthly",
  "studio_monthly",
  "starter_yearly",
  "creator_yearly",
  "studio_yearly",
]);

function adminMutationError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const knownErrors: Record<
    string,
    { code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST"; message: string }
  > = {
    USER_NOT_FOUND: { code: "NOT_FOUND", message: "User not found." },
    LAST_ACTIVE_ADMIN: {
      code: "CONFLICT",
      message: "The last active administrator cannot be disabled or demoted.",
    },
    SELF_DISABLE: {
      code: "BAD_REQUEST",
      message: "You cannot disable your own account.",
    },
    SELF_DEMOTION: {
      code: "BAD_REQUEST",
      message: "You cannot remove your own administrator role.",
    },
    SELF_PASSWORD_RESET: {
      code: "BAD_REQUEST",
      message:
        "Administrators cannot replace their own password here. Use the normal password-change flow.",
    },
  };
  const known = knownErrors[message];
  if (known) throw new TRPCError(known);
  throw error;
}

export const adminRouter = router({
  listUsers: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(20),
        search: z.string().trim().max(120).optional(),
      })
    )
    .query(async ({ input }) => {
      if (input.search && /^\d+$/.test(input.search)) {
        const details = await db.getUserDetailsForAdmin(Number(input.search));
        if (!details) return { rows: [], total: 0 };
        return {
          rows: [
            {
              id: details.user.id,
              openId: details.user.openId,
              name: details.user.name,
              email: details.user.email,
              loginMethod: details.user.loginMethod,
              emailVerified: details.user.emailVerified,
              role: details.user.role,
              accountStatus: details.user.accountStatus,
              mustChangePassword: details.user.mustChangePassword,
              createdAt: details.user.createdAt,
              updatedAt: details.user.updatedAt,
              lastSignedIn: details.user.lastSignedIn,
              subscriptionPlan: details.subscription?.plan ?? null,
              subscriptionStatus: details.subscription?.status ?? null,
            },
          ],
          total: 1,
        };
      }
      return db.listUsersForAdmin(input);
    }),

  userDetails: adminProcedure
    .input(z.object({ userId: userIdSchema }))
    .query(async ({ input }) => {
      let usageWindowStart: Date | undefined;
      try {
        usageWindowStart = (await getStripeGenerationEntitlement(input.userId))
          ?.usageWindowStart;
      } catch (error) {
        console.warn("[Admin] Could not resolve Stripe usage window", error);
      }
      const details = await db.getUserDetailsForAdmin(
        input.userId,
        usageWindowStart
      );
      if (!details)
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      return details;
    }),

  setAccountStatus: adminProcedure
    .input(
      z.object({
        userId: userIdSchema,
        status: z.enum(["active", "disabled"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await db.setUserAccountStatusByAdmin({
          adminId: ctx.user.id,
          targetUserId: input.userId,
          status: input.status,
        });
        return { success: true } as const;
      } catch (error) {
        adminMutationError(error);
      }
    }),

  setRole: adminProcedure
    .input(
      z.object({
        userId: userIdSchema,
        role: z.enum(["user", "admin"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await db.setUserRoleByAdmin({
          adminId: ctx.user.id,
          targetUserId: input.userId,
          role: input.role,
        });
        return { success: true } as const;
      } catch (error) {
        adminMutationError(error);
      }
    }),

  revokeSessions: adminProcedure
    .input(z.object({ userId: userIdSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await db.revokeUserSessionsByAdmin(ctx.user.id, input.userId);
        return { success: true } as const;
      } catch (error) {
        adminMutationError(error);
      }
    }),

  changePlan: adminProcedure
    .input(z.object({ userId: userIdSchema, planId: planIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const stored = await db.getSubscription(input.userId);
      if (!stored?.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This user does not have a Stripe subscription to change.",
        });
      }
      if (stored.plan === input.planId) {
        return { success: true, unchanged: true } as const;
      }

      await db.createAdminAudit({
        adminId: ctx.user.id,
        targetUserId: input.userId,
        action: "user.subscription_plan_change_requested",
        metadata: {
          from: stored.plan,
          to: input.planId,
          billing: "stripe",
          proration: "immediate",
        },
      });

      try {
        const stripe = getStripe();
        const subscription = await stripe.subscriptions.retrieve(
          stored.stripeSubscriptionId
        );
        const item = subscription.items.data[0];
        if (!item || subscription.items.data.length !== 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Only subscriptions with one plan item can be changed here.",
          });
        }

        const priceId = await ensurePrice(input.planId as PlanId);
        const updated = await stripe.subscriptions.update(subscription.id, {
          items: [{ id: item.id, price: priceId, quantity: 1 }],
          proration_behavior: "create_prorations",
          payment_behavior: "error_if_incomplete",
          metadata: {
            ...subscription.metadata,
            user_id: input.userId.toString(),
            plan_id: input.planId,
            changed_by_admin_id: ctx.user.id.toString(),
          },
        });
        const periodEnd = updated.items.data[0]?.current_period_end;
        try {
          await db.createAdminAudit({
            adminId: ctx.user.id,
            targetUserId: input.userId,
            action: "user.subscription_plan_changed_in_stripe",
            metadata: {
              from: stored.plan,
              to: input.planId,
              billing: "stripe",
              proration: "immediate",
            },
          });
        } catch (auditError) {
          console.error(
            "[Admin] Stripe succeeded but external-success audit failed:",
            auditError
          );
        }

        try {
          await db.upsertSubscription(input.userId, {
            plan: input.planId,
            status: updated.status,
            ...(periodEnd
              ? { currentPeriodEnd: new Date(periodEnd * 1000) }
              : {}),
          });
          await db.createAdminAudit({
            adminId: ctx.user.id,
            targetUserId: input.userId,
            action: "user.subscription_plan_changed",
            metadata: {
              from: stored.plan,
              to: input.planId,
              billing: "stripe",
              proration: "immediate",
              amountUsd: PLAN_BY_ID[input.planId].totalPrice,
            },
          });
          return {
            success: true,
            unchanged: false,
            syncPending: false,
          } as const;
        } catch (syncError) {
          console.error(
            "[Admin] Stripe changed the plan but local sync is pending:",
            syncError
          );
          try {
            await db.createAdminAudit({
              adminId: ctx.user.id,
              targetUserId: input.userId,
              action: "user.subscription_plan_sync_pending",
              metadata: {
                from: stored.plan,
                to: input.planId,
                billing: "stripe",
              },
            });
          } catch (auditError) {
            console.error(
              "[Admin] Failed to record pending subscription sync:",
              auditError
            );
          }
          return {
            success: true,
            unchanged: false,
            syncPending: true,
          } as const;
        }
      } catch (error) {
        console.error("[Admin] Stripe plan change failed:", error);
        try {
          await db.createAdminAudit({
            adminId: ctx.user.id,
            targetUserId: input.userId,
            action: "user.subscription_plan_change_failed",
            metadata: {
              from: stored.plan,
              to: input.planId,
              billing: "stripe",
            },
          });
        } catch (auditError) {
          console.error(
            "[Admin] Failed to record Stripe plan failure:",
            auditError
          );
        }
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Stripe could not change this subscription. No local-only plan change was made.",
        });
      }
    }),

  adjustUsage: adminProcedure
    .input(
      z.object({
        userId: userIdSchema,
        delta: z
          .number()
          .int()
          .min(-100)
          .max(100)
          .refine(value => value !== 0),
        reason: z.string().trim().min(3).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const adjustment = await db.adjustUserUsageByAdmin({
          adminId: ctx.user.id,
          targetUserId: input.userId,
          delta: input.delta,
          reason: input.reason,
        });
        return { success: true, adjustment } as const;
      } catch (error) {
        adminMutationError(error);
      }
    }),

  issueTemporaryPassword: adminProcedure
    .input(
      z.object({
        userId: userIdSchema,
        temporaryPassword: z
          .string()
          .min(12, "Temporary passwords must contain at least 12 characters.")
          .max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await hashPassword(input.temporaryPassword);
      try {
        await db.issueTemporaryPasswordByAdmin({
          adminId: ctx.user.id,
          targetUserId: input.userId,
          passwordHash,
        });
        return { success: true, mustChangePassword: true } as const;
      } catch (error) {
        adminMutationError(error);
      }
    }),
});
