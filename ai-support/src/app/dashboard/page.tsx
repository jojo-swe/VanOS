import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MissionControl } from "@/components/dashboard/MissionControl";
import { isSection } from "@/components/dashboard/sections";
import { isDemoMode } from "@/lib/security/config";
import { getDashboardData } from "@/lib/dashboard/data";
import { elapsedSince, frameworkStatus, logPageView } from "@/lib/security/access-log";
import { dashboardReadAuthorized } from "@/lib/security/dashboard-auth";
import { refuseEdgePage } from "@/lib/security/edge-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string | string[] }>;
}) {
  const { s } = await searchParams;
  const initialSection = isSection(s) ? s : "overview";
  const h = await headers();
  const started = elapsedSince();
  const view = {
    method: "GET",
    path: "/dashboard",
    socketIp: h.get("x-vanos-socket-ip"),
    forwardedFor: h.get("x-forwarded-for"),
  };
  let data;
  try {
    refuseEdgePage();
    if (!dashboardReadAuthorized(h)) notFound();
    data = await getDashboardData();
  } catch (err) {
    const flow = frameworkStatus(err);
    logPageView({
      ...view,
      status: flow ?? 500,
      durMs: elapsedSince(started),
    });
    throw err;
  }
  logPageView({ ...view, status: 200, durMs: elapsedSince(started) });
  return (
    <MissionControl
      initialData={data}
      initialSection={initialSection}
      demo={isDemoMode()}
    />
  );
}
