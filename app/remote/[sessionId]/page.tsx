import RemotePlayer from "@/components/remote-player"

export default async function RemotePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  return <RemotePlayer key={sessionId} sessionId={sessionId} />
}
