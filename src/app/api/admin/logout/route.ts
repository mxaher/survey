import { signOutAdmin } from "@/lib/admin-auth";
import { ok, apiHandler } from "@/lib/api";

export const POST = apiHandler(async () => {
  await signOutAdmin();
  return ok({ loggedOut: true });
});
