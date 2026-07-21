import SquadPlanner from "./components/SquadPlanner";
import { redirect } from "next/navigation";
import { isAuthenticated } from "./auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  return <SquadPlanner />;
}
