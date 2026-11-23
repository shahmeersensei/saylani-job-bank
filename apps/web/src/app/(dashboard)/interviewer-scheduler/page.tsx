import { WelcomePanel } from '../_components/WelcomePanel';

export const metadata = { title: 'Interviewer Dashboard — Saylani Job Bank' };

/** Live data on every load — dashboards are never statically cached. */
export const dynamic = 'force-dynamic';

export default function InterviewerSchedulerHomePage() {
  return <WelcomePanel role="INTERVIEWER_SCHEDULER" />;
}
