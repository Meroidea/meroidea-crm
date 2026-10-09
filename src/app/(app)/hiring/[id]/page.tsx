import { redirect } from 'next/navigation';

/** A hire's contract now lives on their staff profile; old links keep working. */
export default async function HirePage({ params }: PageProps<'/hiring/[id]'>) {
  const { id } = await params;
  redirect(`/staff/${encodeURIComponent(id)}?section=contract`);
}
