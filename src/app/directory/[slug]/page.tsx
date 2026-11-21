import { AgentDetail } from "@/components/directory/agent-detail";

export default async function AgentPage({
  params,
}: PageProps<"/directory/[slug]">) {
  const { slug } = await params;
  return <AgentDetail slug={slug} />;
}
