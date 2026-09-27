import { ok, apiHandler } from "@/lib/api";
import { destroySession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — deletes the session row and clears the cookie. */
export const POST = apiHandler(async () => {
  await destroySession();
  return ok({ loggedOut: true });
});
