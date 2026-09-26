import { SharedReportPage } from "@/components/SharedReportPage";
import { notFound } from "next/navigation";

export default function SharePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SharedReportPage />;
}
