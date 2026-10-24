import { WriteupsAdmin, WriteupAdminDetail } from "./admin/Writeups";
import { Route, Routes, useParams } from "react-router-dom";
import { useUser } from "@/App";
import { StatusPage } from "@/components/status-page";
import { useMonitor } from "@/lib/contest-monitor";
import {
  Registrations,
  RegistrationDetail,
} from "./admin/ContestRegistrations";
import { MonitorList, IntegrityDetail } from "./admin/ContestMonitor";
export function ContestManagement() {
  const user = useUser(),
    { id } = useParams();
  const live = useMonitor(id!, user?.role === "admin");
  if (user?.role !== "admin") return <StatusPage status={403} />;
  return (
    <Routes>
      <Route path="writeups" element={<WriteupsAdmin />} />
      <Route path="writeups/:team" element={<WriteupAdminDetail />} />
      <Route path="teams" element={<Registrations />} />
      <Route path="teams/:team" element={<RegistrationDetail />} />
      <Route path="activity" element={<MonitorList live={live} />} />
      <Route path="integrity" element={<MonitorList integrity live={live} />} />
      <Route path="integrity/:event" element={<IntegrityDetail />} />
      <Route path="*" element={<StatusPage status={404} />} />
    </Routes>
  );
}
