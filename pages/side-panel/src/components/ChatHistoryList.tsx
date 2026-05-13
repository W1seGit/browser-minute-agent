/* eslint-disable react/prop-types */
import { BsBookmark } from 'react-icons/bs';
import { FiClock, FiMessageSquare, FiTrash2 } from 'react-icons/fi';
import { t } from '@extension/i18n';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  visible: boolean;
  isDarkMode?: boolean;
}

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  visible,
}) => {
  if (!visible) return null;

  const groups = groupSessionsByDate(sessions);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="h-full overflow-y-auto bg-bma-bg px-3 py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div className="px-1">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-zinc-500">
            <FiClock className="size-3.5 text-orange-300" />
            {t('chat_history_title')}
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-[#111113] p-6 text-center text-sm text-zinc-500">
            <div className="mx-auto mb-3 grid size-10 place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-500">
              <FiMessageSquare className="size-5" />
            </div>
            <p>{t('chat_history_empty')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map(group => (
              <section key={group.label} className="space-y-2">
                <div className="sticky top-0 z-10 flex items-center gap-3 bg-bma-bg/95 px-1 py-1.5 backdrop-blur">
                  <h3 className="shrink-0 text-xs font-semibold uppercase tracking-normal text-zinc-500">
                    {group.label}
                  </h3>
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>

                <div className="space-y-2">
                  {group.sessions.map(session => {
                    const timestamp = getSessionTimestamp(session);

                    return (
                      <div
                        key={session.id}
                        className="group relative rounded-lg border border-zinc-800 bg-[#111113] p-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/80">
                        <button
                          onClick={() => onSessionSelect(session.id)}
                          className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-3 pr-16 text-left"
                          type="button">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-zinc-100">{session.title}</span>
                            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                              <span>{formatDate(timestamp)}</span>
                              <span className="text-zinc-700">/</span>
                              <span>{formatTime(timestamp)}</span>
                            </span>
                          </span>
                        </button>

                        {onSessionBookmark && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onSessionBookmark(session.id);
                            }}
                            className="absolute right-10 top-3 grid size-8 cursor-pointer place-items-center rounded-md border border-transparent text-zinc-500 opacity-0 transition-colors hover:border-orange-300/30 hover:bg-orange-300/10 hover:text-orange-300 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-orange-300/50 focus-visible:opacity-100 group-hover:opacity-100"
                            aria-label={t('chat_history_bookmark')}
                            title={t('chat_history_bookmark')}
                            type="button">
                            <BsBookmark size={14} />
                          </button>
                        )}

                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onSessionDelete(session.id);
                          }}
                          className="absolute right-2 top-3 grid size-8 cursor-pointer place-items-center rounded-md border border-transparent text-zinc-500 opacity-0 transition-colors hover:border-rose-400/30 hover:bg-rose-400/10 hover:text-rose-300 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-rose-300/50 focus-visible:opacity-100 group-hover:opacity-100"
                          aria-label={t('chat_history_delete')}
                          title={t('chat_history_delete')}
                          type="button">
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function getSessionTimestamp(session: ChatSession) {
  return session.updatedAt || session.createdAt || Date.now();
}

function groupSessionsByDate(sessions: ChatSession[]) {
  const groups: Array<{ label: string; sessions: ChatSession[] }> = [];
  const labels = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'];

  labels.forEach(label => groups.push({ label, sessions: [] }));

  const now = new Date();
  const today = startOfDay(now).getTime();
  const yesterday = today - DAY_MS;
  const previous7Days = today - 7 * DAY_MS;
  const previous30Days = today - 30 * DAY_MS;

  sessions.forEach(session => {
    const timestamp = getSessionTimestamp(session);
    const bucket =
      timestamp >= today
        ? 'Today'
        : timestamp >= yesterday
          ? 'Yesterday'
          : timestamp >= previous7Days
            ? 'Previous 7 Days'
            : timestamp >= previous30Days
              ? 'Previous 30 Days'
              : 'Older';

    groups.find(group => group.label === bucket)?.sessions.push(session);
  });

  return groups.filter(group => group.sessions.length > 0);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export default ChatHistoryList;
