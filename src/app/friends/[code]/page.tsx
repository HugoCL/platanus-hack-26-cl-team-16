import { FriendInvite } from "@/components/friends-list";

export default async function FriendInvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <>
      <h1 className="text-title font-semibold tracking-tight text-balance">
        Invitación de amistad
      </h1>
      <FriendInvite code={code} />
    </>
  );
}
