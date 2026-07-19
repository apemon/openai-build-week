import { getPublicRuntimeConfig } from "@/lib/env.server";
import { SpecGrillApp } from "./SpecGrillApp";

export default function Home() {
  const { liveEnabled } = getPublicRuntimeConfig();
  return <SpecGrillApp liveEnabled={liveEnabled} />;
}
