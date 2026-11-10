"use client";

import { useMemo } from "react";

import { platformContext } from "../admin/fleet-api";
import { FleetCalendar } from "../admin/fleet-calendar";
import { VehicleCalendar } from "../admin/vehicle-calendar";
import { VehicleForm } from "../admin/vehicle-form";
import { VehicleList } from "../admin/vehicle-list";

/**
 * Fleet screens of the superadmin in one company: the shared panel components with the platform context (nested API of
 * that company). The context is memoized per company, so a screen never refetches because of a new object, and a
 * different company id remounts the screen (the page passes it as key).
 */
const usePlatformContext = (organizationId: string) => useMemo(() => platformContext(organizationId), [organizationId]);

export function PlatformVehicleList({ organizationId, title }: { organizationId: string; title: string }) {
  return <VehicleList context={usePlatformContext(organizationId)} title={title} />;
}
export function PlatformVehicleForm({ organizationId, vehicleId, title }: { organizationId: string; vehicleId?: string; title: string }) {
  return <VehicleForm context={usePlatformContext(organizationId)} vehicleId={vehicleId} title={title} />;
}
export function PlatformVehicleCalendar({ organizationId, vehicleId, today, title }: { organizationId: string; vehicleId: string; today: string; title: string }) {
  return <VehicleCalendar context={usePlatformContext(organizationId)} vehicleId={vehicleId} today={today} title={title} />;
}
export function PlatformFleetCalendar({ organizationId, today, title }: { organizationId: string; today: string; title: string }) {
  return <FleetCalendar context={usePlatformContext(organizationId)} today={today} title={title} />;
}
