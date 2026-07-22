import CoachingTool from "./components/CoachingTool";
import { redirect } from "next/navigation";
import { isAuthenticated } from "./auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  return <CoachingTool />;
}
