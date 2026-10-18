import type { ReactNode } from "react";
import { refuseEdgePage } from "@/lib/security/edge-page";

export const dynamic = "force-dynamic";

export default function SupportLayout({ children }: { children: ReactNode }) {
  refuseEdgePage();
  return children;
}
