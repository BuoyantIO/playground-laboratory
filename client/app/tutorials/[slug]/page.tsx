import { notFound } from 'next/navigation';
import { AnnouncementBar } from '../../components/AnnouncementBar';
import { Nav } from '../../components/Nav';
import { TutorialView } from '../../components/TutorialView';
import { findTutorial, tutorials } from '../../lib/tutorials';
import { loadTutorialContent } from '../../lib/tutorials.server';

export function generateStaticParams() {
  return tutorials.map(t => ({ slug: t.slug }));
}

export default async function TutorialDetail({
  params,
}: {
  params: { slug: string };
}) {
  const meta = findTutorial(params.slug);
  if (!meta) notFound();

  const content = await loadTutorialContent(meta.slug);
  const idx = tutorials.findIndex(t => t.slug === meta.slug);
  const prev = idx > 0 ? tutorials[idx - 1] : undefined;
  const next = idx < tutorials.length - 1 ? tutorials[idx + 1] : undefined;

  return (
    <div className="min-h-screen bg-white text-navy">
      <Nav />
      <AnnouncementBar />
      <TutorialView meta={meta} content={content} prev={prev} next={next} />
    </div>
  );
}
