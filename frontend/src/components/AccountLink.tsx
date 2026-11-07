"use client";

import { FreshLink } from "@/components/FreshLink";
import { useIsLoggedIn } from "@/lib/account";

export function AccountLink() {
  const loggedIn = useIsLoggedIn();
  return (
    <FreshLink href={loggedIn ? "/dashboard" : "/login"} className="hover:text-gold-deep">
      {loggedIn ? "Dashboard" : "Log in"}
    </FreshLink>
  );
}
