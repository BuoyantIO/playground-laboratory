import { AnnouncementBar } from '../components/AnnouncementBar';
import { Nav } from '../components/Nav';
import { TutorialList } from '../components/TutorialList';
import { tutorials } from '../lib/tutorials';

export default function TutorialsPage() {
  return (
    <div className="min-h-screen bg-white text-navy">
      <Nav />
      <AnnouncementBar />
      <TutorialList tutorials={tutorials} />
    </div>
  );
}
