// POST /api/facts/dismiss: "Not today" on the dashboard's fact strip (#126).
// A plain form posts the fact's id; the answer sets a cookie holding it for two
// days and sends the browser back to the dashboard, which shows no fact whose
// id the cookie holds. Tomorrow's fact is another id, so one press ends facts
// for the day and nothing has to expire at midnight. A cookie, not
// localStorage, because the server makes the pick. Writes nothing to the
// database.

import { NextResponse } from "next/server";
import { BASE_PATH } from "@/lib/base-path";
import { FACT_DISMISS_COOKIE, FACT_DISMISS_MAX_AGE_S, FACT_ID } from "@/lib/facts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const id = String((await req.formData().catch(() => null))?.get("id") ?? "");
  // 303: the browser follows with a GET, so a reload of the dashboard never posts again.
  const res = new NextResponse(null, { status: 303, headers: { location: `${BASE_PATH}/` } });
  if (FACT_ID.test(id)) res.cookies.set(FACT_DISMISS_COOKIE, id, { maxAge: FACT_DISMISS_MAX_AGE_S, path: BASE_PATH || "/", sameSite: "lax", httpOnly: true });
  return res;
}
