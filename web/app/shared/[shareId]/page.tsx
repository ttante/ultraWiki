import SharedPackView from '../../../components/shared-pack-view';

export const dynamic = 'force-dynamic';

export default async function SharedPackPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;

  return <SharedPackView shareId={shareId} />;
}
