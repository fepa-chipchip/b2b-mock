import { handleExternalPaymentRequest, loadTokens } from "@/lib/erpPayments";
import { supabaseErpStore } from "@/lib/erpStore";

export const dynamic = "force-dynamic";

/**
 * Fake ChipChip ERP: POST /erp/functions/v1/external-payment-requests, the same call, body, answers and errors as
 * https://<erp-project>.supabase.co/functions/v1/external-payment-requests (see lib/erpPayments.ts). Any other method: 405.
 * Its own Bearer check (ERP_MOCK_TOKENS / ERP_MOCK_TOKEN), so middleware.ts leaves /erp/functions/ alone.
 */
const handle = (req: Request) => handleExternalPaymentRequest(req, { store: supabaseErpStore(), tokens: () => loadTokens() });

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
