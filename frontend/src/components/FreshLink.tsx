"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

// A full page load. The app router can restore a page's old state, but account pages
// must always show fresh data and a retake must start from the first page.
export function FreshLink({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  return (
    <Link
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        window.location.assign(href);
      }}
    />
  );
}
