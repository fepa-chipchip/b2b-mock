import { allTokens, handleExternalPaymentRequest } from "@/lib/erpPayments";
import { supabaseErpStore } from "@/lib/erpStore";
import committedTokens from "@/lib/erpMockTokens.json";

export const dynamic = "force-dynamic";

/**
 * Fake ChipChip ERP: /erp/functions/v1/external-payment-requests, the same calls, bodies, answers and errors as
 * https://<erp-project>.supabase.co/functions/v1/external-payment-requests (ERP guide v2, see lib/erpPayments.ts):
 * POST creates or (action "mark_paid") marks paid, GET lists or reads one. Any other method: 405.
 * Its own Bearer check (ERP_MOCK_TOKENS / ERP_MOCK_TOKEN, plus the hashes in lib/erpMockTokens.json), so middleware.ts
 * leaves /erp/functions/ alone.
 */
const handle = (req: Request) =>
  handleExternalPaymentRequest(req, { store: supabaseErpStore(), tokens: () => allTokens(process.env, committedTokens) });

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
