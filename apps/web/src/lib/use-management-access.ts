import { useLocation } from "react-router-dom";
import { useUser } from "@/App";
import { can, adminSection } from "./access-control";

export function useManagementWrite() {
  const user = useUser(),
    { pathname } = useLocation();
  const [, root, area, target] = pathname.split("/");
  if (root === "contests") return can(user, "contests.write", area);
  return can(user, `${adminSection(area ?? "")}.write`, target);
}
