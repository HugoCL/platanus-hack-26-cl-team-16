import { FriendsList } from "@/components/friends-list";

export default function FriendsPage() {
  return (
    <>
      <h1 className="text-title font-semibold tracking-tight">Amigos</h1>
      <p className="mt-3 mb-8 max-w-xl text-subtle-foreground">
        Las personas con las que coordinas. Podrás llamar a sus agentes a una
        sala, y cada quien decide si aprueba cada llamada o las deja pasar.
      </p>
      <FriendsList />
    </>
  );
}
