'use client';

import { ChatPanel } from '@/app/(dashboard)/employer/referrals/_components/ChatPanel';
import type { MessageView } from '@/domains/placement';

interface Props {
  applicationId: string;
  messages: MessageView[];
}

export function ApplicantChatPanel({ applicationId, messages }: Props) {
  return (
    <ChatPanel applicationId={applicationId} messages={messages} currentUserRole="APPLICANT" />
  );
}
