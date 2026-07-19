import type { ConversationTurn } from "@/domain/types";

export const TEAM_BILLING_SCENARIO_ID = "team_billing" as const;

export interface PreparedDecision {
  id: string;
  label: string;
  preparedAnswer: string;
  audioSrc: string;
}

export const teamBillingDecisions: readonly PreparedDecision[] = [
  {
    id: "TURN-INITIAL",
    label: "Initial request",
    preparedAnswer: "We need team billing for our SaaS.",
    audioSrc: "/demo-audio/00-initial-request.mp3",
  },
  {
    id: "TURN-PERMISSIONS",
    label: "Permissions",
    preparedAnswer:
      "The Workspace Owner creates billing, changes the plan, assigns Billing Admins, and cancels. Billing Admins update payment and billing details and view or download invoices. Members have no billing access. An Owner must transfer ownership before removal while billing is active.",
    audioSrc: "/demo-audio/01-permissions.mp3",
  },
  {
    id: "TURN-BILLING-BASIS",
    label: "Billing basis",
    preparedAnswer:
      "Charge monthly in US dollars per active seat on one team plan. Owners and Billing Admins count as seats. Suspended users and unaccepted invited users do not count. Exclude usage, annual, volume-discount, and fixed-plan variants.",
    audioSrc: "/demo-audio/02-pricing-basis.mp3",
  },
  {
    id: "TURN-SEAT-CHANGES",
    label: "Seat changes",
    preparedAnswer:
      "Invites are free until acceptance. Acceptance adds a prorated seat immediately. Removal or suspension revokes access immediately, but the billing reduction applies at renewal with no mid-cycle refund. Show current active and scheduled renewal seat counts.",
    audioSrc: "/demo-audio/03-seat-changes.mp3",
  },
  {
    id: "TURN-FAILED-PAYMENT",
    label: "Failed payment",
    preparedAnswer:
      "Allow a seven-day fully usable grace period with in-app and email notices to Owners and Billing Admins while the provider retries. Successful payment clears the status automatically. After seven days the workspace becomes read-only while billing controls remain usable. Never delete data automatically. Cancel after 30 unpaid days; retention is handled separately.",
    audioSrc: "/demo-audio/04-failed-payment.mp3",
  },
  {
    id: "TURN-PROVIDER",
    label: "Provider",
    preparedAnswer:
      "Use Stripe Billing, Checkout, Customer Portal, and server-verified webhooks. App authorization must precede hosted session creation. Price IDs and webhook secrets remain server-only. Exclude coupons, credits, multiple currencies, manual invoices, and alternative providers.",
    audioSrc: "/demo-audio/05-provider.mp3",
  },
  {
    id: "TURN-SUCCESS",
    label: "First-release success",
    preparedAnswer:
      "Target 90 percent of pilot Owners self-serving without support, no seat or subscription mismatch unresolved beyond 15 minutes, and 99 percent of Stripe-confirmed changes appearing within 60 seconds. Members must fail every billing authorization test, payment repair must restore access within 60 seconds, and no critical billing or authorization defect may remain at pilot completion.",
    audioSrc: "/demo-audio/06-success.mp3",
  },
  {
    id: "TURN-TAX",
    label: "Tax",
    preparedAnswer:
      "Use Stripe Tax automatic calculation based on billing location. Finance will configure registrations before launch as a confirmed Next Action.",
    audioSrc: "/demo-audio/07-tax.mp3",
  },
] as const;

export function preparedTurnAt(index: number, createdAt = new Date(0).toISOString()): ConversationTurn {
  const decision = teamBillingDecisions[index];
  if (!decision) throw new RangeError(`No prepared decision at index ${index}`);
  return {
    id: decision.id,
    promptId: index === 0 ? "PROMPT-INITIAL" : `PROMPT-${teamBillingDecisions[index].label.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "-")}`,
    type: "confirmed_answer",
    text: decision.preparedAnswer,
    createdAt,
  };
}
