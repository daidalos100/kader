import CoachingTool from "./components/CoachingTool";
import { redirect } from "next/navigation";
import { currentTrainer, isAuthenticated } from "./auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  const trainer = await currentTrainer();
  return <CoachingTool trainerName={trainer?.name ?? "Trainer:in"} />;
}
