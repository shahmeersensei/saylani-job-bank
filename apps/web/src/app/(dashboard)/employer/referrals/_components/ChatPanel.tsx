'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Textarea } from '@/components/atoms';
import { toast } from '@/components/molecules';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import type { MessageView } from '@/domains/placement';

interface Props {
  applicationId: string;
  messages: MessageView[];
  currentUserRole: 'EMPLOYER' | 'APPLICANT';
}

export function ChatPanel({ applicationId, messages, currentUserRole }: Props) {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setLoading(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/messages`, {
        method: 'POST',
        body: { content: content.trim() },
      });
      setContent('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4">
      {messages.length === 0 ? (
        <p className="text-fg-muted text-sm">No messages yet.</p>
      ) : (
        <div className="grid max-h-96 gap-3 overflow-y-auto">
          {messages.map((msg) => {
            const isMe = msg.senderRole === currentUserRole;
            return (
              <div
                key={msg.id}
                className={`flex flex-col gap-1 rounded-xl px-4 py-3 text-sm ${isMe ? 'ml-8' : 'mr-8'}`}
                style={{
                  background: isMe ? 'var(--primary-soft)' : 'var(--surface-muted)',
                  color: isMe ? 'var(--primary-soft-fg)' : 'var(--fg)',
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                }}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-semibold">{msg.senderName}</span>
                  <span className="text-xs opacity-60">
                    {new Date(msg.createdAt).toLocaleString('en-PK', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSend} className="flex gap-2">
        <Textarea
          className="flex-1"
          placeholder="Write a message…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
        />
        <Button type="submit" disabled={loading || !content.trim()} className="self-end">
          {loading ? 'Sending…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
