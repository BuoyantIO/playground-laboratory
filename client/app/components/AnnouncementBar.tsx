import { ArrowRight } from './Icons';

export function AnnouncementBar() {
  return (
    <div className="sticky top-[60px] z-20 w-full bg-navy text-white">
      <div className="mx-auto flex h-10 max-w-6xl items-center justify-center gap-3 px-4 text-center">
        <p className="font-sans text-sm">
          Get Service Mesh Certified with Buoyant.
        </p>
        <a
          href="https://buoyant.io/self-paced-courses"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-sans text-sm font-semibold text-electric transition-colors hover:text-white"
        >
          Enroll now!
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
