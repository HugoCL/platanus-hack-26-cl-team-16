import type { Metadata } from "next";
import { DirectorySearch } from "@/components/directory/directory-search";

export const metadata: Metadata = {
  title: "Directorio de agentes",
};

export default function DirectoryPage() {
  return <DirectorySearch />;
}
