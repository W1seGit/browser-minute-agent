/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { FiArrowDown, FiArrowLeft, FiCheck, FiClock, FiCopy, FiSettings } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import {
  type Message,
  Actors,
  AgentNameEnum,
  chatHistoryStore,
  agentModelStore,
  generalSettingsStore,
  llmProviderStore,
} from '@extension/storage';
import favoritesStorage from '@extension/storage/lib/prompt/favorites';
import { t } from '@extension/i18n';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import ChatHistoryList from './components/ChatHistoryList';
import ModelSelector from './components/ModelSelector';
import { EventType, type AgentEvent, ExecutionState } from './types/event';
import './SidePanel.css';

// Declare chrome API types
declare global {
  interface Window {
    chrome: typeof chrome;
  }
}

const TOOL_MESSAGE_PREFIX = '__bma_tool_call__:';
const REASONING_MESSAGE_PREFIX = '__bma_reasoning__:';

function MinuteAgentLogo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8" role="img" aria-label="Minute Agent logo">
      <rect width="32" height="32" rx="8" fill="#09090b" />
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#111113" stroke="#3f3f46" strokeWidth="1.5" />
      <path d="M16 7.5a8.5 8.5 0 1 0 8.5 8.5" fill="none" stroke="#fdba74" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M16 16V10.8" stroke="#f4f4f5" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M16 16l4 2.6" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2" fill="#fdba74" />
    </svg>
  );
}

type ParsedToolDetails = {
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type AiSpaceTabAccessRequest = {
  tabId: number;
  title: string;
  url: string;
  reason: string;
};

type PendingAiSpaceRequest = {
  requestId: string;
  request: AiSpaceTabAccessRequest;
};

function parseToolMessageContent(content: string) {
  if (!content.startsWith(TOOL_MESSAGE_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(TOOL_MESSAGE_PREFIX.length)) as {
      id?: string;
      name: string;
      state: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      rawText?: string;
    };
  } catch {
    return null;
  }
}

function createToolMessageContent(
  state: ExecutionState.ACT_START | ExecutionState.ACT_OK | ExecutionState.ACT_FAIL,
  details = '',
) {
  if (isDoneAction(details)) return null;

  const toolState =
    state === ExecutionState.ACT_START
      ? 'input-streaming'
      : state === ExecutionState.ACT_FAIL
        ? 'output-error'
        : 'output-available';
  const parsed = parseToolDetails(details);
  if (!parsed) return null;

  return `${TOOL_MESSAGE_PREFIX}${JSON.stringify({
    name: parsed.name,
    id: parsed.id,
    state: toolState,
    input: parsed.input,
    output: toolState === 'output-available' ? parsed.output : undefined,
    errorText: toolState === 'output-error' ? parsed.errorText : undefined,
    rawText: details,
  })}`;
}

function createReasoningMessageContent(text: string) {
  return `${REASONING_MESSAGE_PREFIX}${JSON.stringify({ text })}`;
}

function isDoneAction(details: string) {
  const trimmed = details.trim().toLowerCase();
  return (
    trimmed === 'done' ||
    trimmed === 'done completed' ||
    trimmed === 'done failed' ||
    trimmed.startsWith('done:') ||
    trimmed.startsWith('done ')
  );
}

function parseToolDetails(details: string): ParsedToolDetails | null {
  const match = details.match(/^([a-zA-Z_][\w-]*):\s*([\s\S]+)$/);
  if (match) {
    const [, name, rawPayload] = match;
    try {
      return {
        name,
        ...normalizeToolPayload(JSON.parse(rawPayload)),
      };
    } catch {
      return {
        name,
        input: { details: rawPayload.trim() },
        output: undefined,
        errorText: undefined,
      };
    }
  }

  const completed = details.match(/^([a-zA-Z_][\w-]*) completed$/);
  if (completed) {
    return {
      name: completed[1],
      input: undefined,
      output: { status: details },
      errorText: undefined,
    };
  }

  const failed = details.match(/^([a-zA-Z_][\w-]*) failed$/);
  if (failed) {
    return {
      name: failed[1],
      input: undefined,
      output: undefined,
      errorText: details,
    };
  }

  return null;
}

function normalizeToolPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return {
      input: payload,
      output: undefined,
      errorText: undefined,
    };
  }

  const record = payload as Record<string, unknown>;
  const legacyInput =
    record.input === undefined && record.result === undefined && record.error === undefined
      ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'toolCallId'))
      : undefined;

  return {
    id: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
    input:
      record.input && typeof record.input === 'object'
        ? (record.input as Record<string, unknown>)
        : legacyInput && Object.keys(legacyInput).length > 0
          ? legacyInput
          : undefined,
    output: record.result !== undefined ? { result: record.result } : undefined,
    errorText: typeof record.error === 'string' ? record.error : undefined,
  };
}

function formatMessageForClipboard(message: Message) {
  const tool = parseToolMessageContent(message.content);
  if (tool) {
    const lines = [`[tool:${tool.name}] ${tool.state}`];
    if (tool.input !== undefined) lines.push(`input: ${JSON.stringify(tool.input)}`);
    if (tool.output !== undefined) lines.push(`output: ${JSON.stringify(tool.output)}`);
    if (tool.errorText) lines.push(`error: ${tool.errorText}`);
    return lines.join('\n');
  }

  if (message.content.startsWith(REASONING_MESSAGE_PREFIX)) {
    try {
      const parsed = JSON.parse(message.content.slice(REASONING_MESSAGE_PREFIX.length)) as { text?: string };
      return `[thinking]\n${parsed.text ?? ''}`;
    } catch {
      return '[thinking]';
    }
  }

  return message.content;
}

function formatChatHistoryForClipboard(messages: Message[]) {
  return messages
    .map(message => {
      const time = new Date(message.timestamp).toLocaleString();
      return `## ${message.actor} - ${time}\n${formatMessageForClipboard(message)}`;
    })
    .join('\n\n');
}

function getTabDisplayName(tab: chrome.tabs.Tab) {
  return tab.title || tab.url || 'Current tab';
}

const SidePanel = () => {
  const progressMessage = 'Showing progress...';
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEnabled, setInputEnabled] = useState(true);
  const [showStopButton, setShowStopButton] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; createdAt: number }>>([]);
  const [isFollowUpMode, setIsFollowUpMode] = useState(false);
  const [isHistoricalSession, setIsHistoricalSession] = useState(false);
  const [hasProviders, setHasProviders] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [replayEnabled, setReplayEnabled] = useState(false);
  const [autoFollowMessages, setAutoFollowMessages] = useState(true);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [currentTabTitle, setCurrentTabTitle] = useState('');
  const [pendingAiSpaceRequest, setPendingAiSpaceRequest] = useState<PendingAiSpaceRequest | null>(null);
  const [aiSpaceDecisionMode, setAiSpaceDecisionMode] = useState<'once' | 'alwaysAllow' | 'alwaysDeny'>('once');
  const sessionIdRef = useRef<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const streamingMessageRef = useRef<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const persistMessagesQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workingTabIdRef = useRef<number | null>(null);

  // Check if providers are configured. The model itself is selected from the side panel.
  const checkModelConfiguration = useCallback(async () => {
    try {
      const providers = await llmProviderStore.getAllProviders();
      setHasProviders(Object.keys(providers).length > 0);
    } catch (error) {
      console.error('Error checking provider configuration:', error);
      setHasProviders(false);
    }
  }, []);

  // Load general settings to check if replay is enabled
  const loadGeneralSettings = useCallback(async () => {
    try {
      const settings = await generalSettingsStore.getSettings();
      setReplayEnabled(settings.replayHistoricalTasks);
    } catch (error) {
      console.error('Error loading general settings:', error);
      setReplayEnabled(false);
    }
  }, []);

  // Check model configuration on mount
  useEffect(() => {
    checkModelConfiguration();
    loadGeneralSettings();
  }, [checkModelConfiguration, loadGeneralSettings]);

  useEffect(() => {
    const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (
        tabId === workingTabIdRef.current &&
        (changeInfo.title || changeInfo.url || changeInfo.status === 'complete')
      ) {
        setCurrentTabTitle(getTabDisplayName(tab));
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // Re-check model configuration when the side panel becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Panel became visible, re-check configuration and settings
        checkModelConfiguration();
        loadGeneralSettings();
      }
    };

    const handleFocus = () => {
      // Panel gained focus, re-check configuration and settings
      checkModelConfiguration();
      loadGeneralSettings();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfiguration, loadGeneralSettings]);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const persistMessagesSnapshot = useCallback((sessionId: string | null | undefined, nextMessages: Message[]) => {
    if (!sessionId) return;

    const messagesToPersist = nextMessages.filter(message => message.content !== progressMessage);
    persistMessagesQueueRef.current = persistMessagesQueueRef.current
      .catch(() => undefined)
      .then(() => chatHistoryStore.replaceMessages(sessionId, messagesToPersist))
      .catch(err => console.error('Failed to save messages to history:', err));
  }, []);

  const appendMessage = useCallback(
    (newMessage: Message, sessionId?: string | null) => {
      // Don't save progress messages
      const newToolMessage = parseToolMessageContent(newMessage.content);
      const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;

      setMessages(prev => {
        const filteredMessages = prev.filter(
          (msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1),
        );
        let nextMessages: Message[];

        if (newToolMessage) {
          let replaceIndex = -1;
          for (let index = filteredMessages.length - 1; index >= 0; index -= 1) {
            const existingToolMessage = parseToolMessageContent(filteredMessages[index].content);
            const sameToolCall =
              newToolMessage.id && existingToolMessage?.id
                ? existingToolMessage.id === newToolMessage.id
                : existingToolMessage?.name === newToolMessage.name && existingToolMessage.state === 'input-streaming';
            if (sameToolCall) {
              replaceIndex = index;
              break;
            }
          }

          if (replaceIndex >= 0) {
            const existingToolMessage = parseToolMessageContent(filteredMessages[replaceIndex].content);
            const mergedMessage =
              existingToolMessage && newToolMessage
                ? {
                    ...newMessage,
                    content: `${TOOL_MESSAGE_PREFIX}${JSON.stringify({
                      ...newToolMessage,
                      input: newToolMessage.input ?? existingToolMessage.input,
                    })}`,
                  }
                : newMessage;
            nextMessages = [
              ...filteredMessages.slice(0, replaceIndex),
              mergedMessage,
              ...filteredMessages.slice(replaceIndex + 1),
            ];
            persistMessagesSnapshot(effectiveSessionId, nextMessages);
            return nextMessages;
          }
        }
        nextMessages = [...filteredMessages, newMessage];
        persistMessagesSnapshot(effectiveSessionId, nextMessages);
        return nextMessages;
      });

      console.log('sessionId', effectiveSessionId);
    },
    [persistMessagesSnapshot],
  );

  const appendReasoningDelta = useCallback(
    (actor: Actors, delta: string, timestamp: number) => {
      if (!delta) return;

      setMessages(prev => {
        const filteredMessages = prev.filter(
          (msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1),
        );
        const lastMessage = filteredMessages[filteredMessages.length - 1];
        let nextMessages: Message[];

        if (lastMessage?.actor === actor && lastMessage.content.startsWith(REASONING_MESSAGE_PREFIX)) {
          try {
            const parsed = JSON.parse(lastMessage.content.slice(REASONING_MESSAGE_PREFIX.length)) as { text?: string };
            nextMessages = [
              ...filteredMessages.slice(0, -1),
              {
                ...lastMessage,
                content: createReasoningMessageContent(`${parsed.text ?? ''}${delta}`),
                timestamp,
              },
            ];
            persistMessagesSnapshot(sessionIdRef.current, nextMessages);
            return nextMessages;
          } catch {
            return filteredMessages;
          }
        }

        nextMessages = [
          ...filteredMessages,
          {
            actor,
            content: createReasoningMessageContent(delta),
            timestamp,
          },
        ];
        persistMessagesSnapshot(sessionIdRef.current, nextMessages);
        return nextMessages;
      });
    },
    [persistMessagesSnapshot],
  );

  const appendStreamDelta = useCallback(
    (actor: Actors, delta: string, timestamp: number) => {
      if (!delta) return;

      setMessages(prev => {
        const filteredMessages = prev.filter(
          (msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1),
        );
        const lastMessage = filteredMessages[filteredMessages.length - 1];
        const previousContent =
          lastMessage?.actor === actor && lastMessage.content === streamingMessageRef.current
            ? streamingMessageRef.current
            : '';
        const content = previousContent + delta;
        let nextMessages: Message[];
        streamingMessageRef.current = content;

        if (lastMessage?.actor === actor && lastMessage.content === previousContent) {
          nextMessages = [
            ...filteredMessages.slice(0, -1),
            {
              ...lastMessage,
              content,
              timestamp,
            },
          ];
          persistMessagesSnapshot(sessionIdRef.current, nextMessages);
          return nextMessages;
        }

        nextMessages = [
          ...filteredMessages,
          {
            actor,
            content,
            timestamp,
          },
        ];
        persistMessagesSnapshot(sessionIdRef.current, nextMessages);
        return nextMessages;
      });
    },
    [persistMessagesSnapshot],
  );

  const finalizeStreamingMessage = useCallback((actor: Actors, _content: string, _timestamp: number) => {
    const streamedContent = streamingMessageRef.current;
    streamingMessageRef.current = '';

    if (!streamedContent) return false;

    setMessages(prev => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage?.actor === actor && lastMessage.content === streamedContent) {
        return prev;
      }
      return prev;
    });

    return true;
  }, []);

  const setWorkingTab = useCallback(async (tabId: number) => {
    const tab = await chrome.tabs.get(tabId);
    workingTabIdRef.current = tabId;
    setCurrentTabTitle(getTabDisplayName(tab));
  }, []);

  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      const { actor, state, timestamp, data } = event;
      const content = data?.details;
      let skip = true;
      let displayProgress = false;

      switch (actor) {
        case Actors.SYSTEM:
          switch (state) {
            case ExecutionState.TASK_START:
              // Reset historical session flag when a new task starts
              setIsHistoricalSession(false);
              streamingMessageRef.current = '';
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              if (finalizeStreamingMessage(actor, content, timestamp)) return;
              skip = !content;
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = !content;
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = !content;
              break;
            case ExecutionState.TASK_PAUSE:
              break;
            case ExecutionState.TASK_RESUME:
              break;
            default:
              console.error('Invalid task state', state);
              return;
          }
          break;
        case Actors.USER:
          break;
        case Actors.NAVIGATOR:
          switch (state) {
            case ExecutionState.TASK_START:
              setIsHistoricalSession(false);
              streamingMessageRef.current = '';
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              if (finalizeStreamingMessage(actor, content, timestamp)) return;
              skip = !content;
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = !content;
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = !content;
              break;
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              displayProgress = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              displayProgress = false;
              break;
            case ExecutionState.STEP_CANCEL:
              displayProgress = false;
              break;
            case ExecutionState.ACT_START:
              if (content !== 'cache_content' && content !== 'done') {
                const parsed = parseToolDetails(content);
                const tabId =
                  parsed?.name === 'switch_tab' &&
                  parsed.input &&
                  typeof parsed.input === 'object' &&
                  typeof (parsed.input as { tab_id?: unknown }).tab_id === 'number'
                    ? (parsed.input as { tab_id: number }).tab_id
                    : null;
                if (tabId !== null) {
                  void setWorkingTab(tabId);
                }
                const toolMessage = createToolMessageContent(state, content);
                if (toolMessage) {
                  appendMessage({
                    actor,
                    content: toolMessage,
                    timestamp,
                  });
                }
              }
              return;
            case ExecutionState.ACT_OK:
              if (content && content !== 'done') {
                const toolMessage = createToolMessageContent(state, content);
                if (toolMessage) {
                  appendMessage({
                    actor,
                    content: toolMessage,
                    timestamp,
                  });
                }
              }
              return;
            case ExecutionState.ACT_FAIL:
              {
                const toolMessage = createToolMessageContent(state, content);
                if (toolMessage) {
                  appendMessage({
                    actor,
                    content: toolMessage,
                    timestamp,
                  });
                }
              }
              return;
            case ExecutionState.STREAM_THINKING:
              appendReasoningDelta(actor, content, timestamp);
              return;
            case ExecutionState.STREAM_TEXT:
              appendStreamDelta(actor, content, timestamp);
              return;
            default:
              console.error('Invalid action', state);
              return;
          }
          break;
        case Actors.VALIDATOR:
          // Handle legacy validator events from historical messages
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            default:
              console.error('Invalid validation', state);
              return;
          }
          break;
        default:
          console.error('Unknown actor', actor);
          return;
      }

      if (!skip) {
        appendMessage({
          actor,
          content: content || '',
          timestamp: timestamp,
        });
      }

      if (displayProgress) {
        appendMessage({
          actor,
          content: progressMessage,
          timestamp: timestamp,
        });
      }
    },
    [appendMessage, appendReasoningDelta, appendStreamDelta, finalizeStreamingMessage, setWorkingTab],
  );

  // Stop heartbeat and close connection
  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      portRef.current.disconnect();
      portRef.current = null;
    }
  }, []);

  // Setup connection management
  const setupConnection = useCallback(() => {
    // Only setup if no existing connection
    if (portRef.current) {
      return;
    }

    try {
      portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });

      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      portRef.current.onMessage.addListener((message: any) => {
        // Add type checking for message
        if (message && message.type === EventType.EXECUTION) {
          handleTaskState(message);
        } else if (message && message.type === 'error') {
          // Handle error messages from service worker
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('errors_unknown'),
            timestamp: Date.now(),
          });
          setInputEnabled(true);
          setShowStopButton(false);
        } else if (message && message.type === 'speech_to_text_result') {
          // Handle speech-to-text result
          if (message.text && setInputTextRef.current) {
            setInputTextRef.current(message.text);
          }
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'speech_to_text_error') {
          // Handle speech-to-text error
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('chat_stt_recognitionFailed'),
            timestamp: Date.now(),
          });
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'heartbeat_ack') {
          console.log('Heartbeat acknowledged');
        } else if (message && message.type === 'ai_space_tab_access_request') {
          setPendingAiSpaceRequest({
            requestId: message.requestId,
            request: message.request,
          });
          setAiSpaceDecisionMode('once');
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.log('Connection disconnected', error ? `Error: ${error.message}` : '');
        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setInputEnabled(true);
        setShowStopButton(false);
      });

      // Setup heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === 'side-panel-connection') {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('Heartbeat failed:', error);
            stopConnection(); // Stop connection if heartbeat fails
          }
        } else {
          stopConnection(); // Stop if port is invalid
        }
      }, 25000);
    } catch (error) {
      console.error('Failed to establish connection:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_conn_serviceWorker'),
        timestamp: Date.now(),
      });
      // Clear any references since connection failed
      portRef.current = null;
    }
  }, [handleTaskState, appendMessage, stopConnection]);

  // Add safety check for message sending
  const sendMessage = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    (message: any) => {
      if (portRef.current?.name !== 'side-panel-connection') {
        throw new Error('No valid connection available');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        console.error('Failed to send message:', error);
        stopConnection(); // Stop connection when message sending fails
        throw error;
      }
    },
    [stopConnection],
  );

  // Handle replay command
  const handleReplay = async (historySessionId: string): Promise<void> => {
    try {
      // Check if replay is enabled in settings
      if (!replayEnabled) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_disabled'),
          timestamp: Date.now(),
        });
        return;
      }

      // Check if history exists using loadAgentStepHistory
      const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
      if (!historyData) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_noHistory', historySessionId.substring(0, 20)),
          timestamp: Date.now(),
        });
        return;
      }

      // Get current tab ID
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }
      await setWorkingTab(tabId);

      // Clear messages if we're in a historical session
      if (isHistoricalSession) {
        setMessages([]);
      }

      // Create a new chat session for this replay task
      const newSession = await chatHistoryStore.createSession(`Replay of ${historySessionId.substring(0, 20)}...`);
      console.log('newSession for replay', newSession);

      // Store the new session ID in both state and ref
      const newTaskId = newSession.id;
      setCurrentSessionId(newTaskId);
      sessionIdRef.current = newTaskId;

      // Send replay command to background
      setInputEnabled(false);
      setShowStopButton(true);

      // Reset follow-up mode and historical session flags
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);

      const userMessage = {
        actor: Actors.USER,
        content: `/replay ${historySessionId}`,
        timestamp: Date.now(),
      };

      // Add the user message to the new session
      appendMessage(userMessage, sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send replay command to background with the task from history
      portRef.current?.postMessage({
        type: 'replay',
        taskId: newTaskId,
        tabId: tabId,
        historySessionId: historySessionId,
        task: historyData.task, // Add the task from history
      });

      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_starting', historyData.task),
        timestamp: Date.now(),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_failed', errorMessage),
        timestamp: Date.now(),
      });
    }
  };

  // Handle chat commands that start with /
  const handleCommand = async (command: string): Promise<boolean> => {
    try {
      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Handle different commands
      if (command === '/state') {
        portRef.current?.postMessage({
          type: 'state',
        });
        return true;
      }

      if (command === '/nohighlight') {
        portRef.current?.postMessage({
          type: 'nohighlight',
        });
        return true;
      }

      if (command.startsWith('/replay ')) {
        // Parse replay command: /replay <historySessionId>
        // Handle multiple spaces by filtering out empty strings
        const parts = command.split(' ').filter(part => part.trim() !== '');
        if (parts.length !== 2) {
          appendMessage({
            actor: Actors.SYSTEM,
            content: t('chat_replay_invalidArgs'),
            timestamp: Date.now(),
          });
          return true;
        }

        const historySessionId = parts[1];
        await handleReplay(historySessionId);
        return true;
      }

      // Unsupported command
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_cmd_unknown', command),
        timestamp: Date.now(),
      });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Command error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      return true;
    }
  };

  const handleSendMessage = async (text: string, displayText?: string) => {
    console.log('handleSendMessage', text);

    // Trim the input text first
    const trimmedText = text.trim();

    if (!trimmedText) return;

    // Check if the input is a command (starts with /)
    if (trimmedText.startsWith('/')) {
      // Process command and return if it was handled
      const wasHandled = await handleCommand(trimmedText);
      if (wasHandled) return;
    }

    // Block sending messages in historical sessions
    if (isHistoricalSession) {
      console.log('Cannot send messages in historical sessions');
      return;
    }

    try {
      const hasSelectedModel = await agentModelStore.hasAgentModel(AgentNameEnum.MinAgent);
      if (!hasSelectedModel) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: 'Select a model before sending a message.',
          timestamp: Date.now(),
        });
        return;
      }

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }
      await setWorkingTab(tabId);

      setInputEnabled(false);
      setShowStopButton(true);

      // Create a new chat session for this task if not in follow-up mode
      if (!isFollowUpMode) {
        // Use display text for session title if available, otherwise use full text
        const titleText = displayText || text;
        const newSession = await chatHistoryStore.createSession(
          titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''),
        );
        console.log('newSession', newSession);

        // Store the session ID in both state and ref
        const sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
      }

      const userMessage = {
        actor: Actors.USER,
        content: displayText || text, // Use display text for chat UI, full text for background service
        timestamp: Date.now(),
      };

      // Pass the sessionId directly to appendMessage
      appendMessage(userMessage, sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send message using the utility function
      if (isFollowUpMode) {
        // Send as follow-up task
        await sendMessage({
          type: 'follow_up_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('follow_up_task sent', text, tabId, sessionIdRef.current);
      } else {
        // Send as new task
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('new_task sent', text, tabId, sessionIdRef.current);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };

  const handleStopTask = async () => {
    try {
      portRef.current?.postMessage({
        type: 'cancel_task',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('cancel_task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
    }
    setInputEnabled(true);
    setShowStopButton(false);
  };

  const handleNewChat = () => {
    // Clear messages and start a new chat
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    workingTabIdRef.current = null;
    setCurrentTabTitle('');
    setInputEnabled(true);
    setShowStopButton(false);
    setIsFollowUpMode(false);
    setIsHistoricalSession(false);

    // Disconnect any existing connection
    stopConnection();
  };

  const handleCopyChatHistory = async () => {
    if (messages.length === 0) return;

    try {
      await navigator.clipboard.writeText(formatChatHistoryForClipboard(messages));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: `Failed to copy chat history: ${errorMessage}`,
        timestamp: Date.now(),
      });
    }
  };

  const respondToAiSpaceRequest = async (approved: boolean) => {
    if (!pendingAiSpaceRequest) return;

    const remember = aiSpaceDecisionMode === 'once' ? undefined : aiSpaceDecisionMode;
    if (remember) {
      await generalSettingsStore.updateSettings({ aiSpaceTabAccess: remember });
    }

    portRef.current?.postMessage({
      type: 'ai_space_tab_access_response',
      requestId: pendingAiSpaceRequest.requestId,
      approved: aiSpaceDecisionMode === 'alwaysDeny' ? false : approved,
      remember,
    });
    setPendingAiSpaceRequest(null);
    setAiSpaceDecisionMode('once');
  };

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata();
      setChatSessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  }, []);

  const handleLoadHistory = async () => {
    await loadChatSessions();
    setShowHistory(true);
  };

  const handleBackToChat = (reset = false) => {
    setShowHistory(false);
    if (reset) {
      setCurrentSessionId(null);
      setMessages([]);
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);
      workingTabIdRef.current = null;
      setCurrentTabTitle('');
    }
  };

  const handleSessionSelect = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);
      if (fullSession && fullSession.messages.length > 0) {
        setCurrentSessionId(fullSession.id);
        setMessages(fullSession.messages);
        setIsFollowUpMode(false);
        setIsHistoricalSession(true); // Mark this as a historical session
        workingTabIdRef.current = null;
        setCurrentTabTitle('');
        console.log('history session selected', sessionId);
      }
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const handleSessionDelete = async (sessionId: string) => {
    try {
      await chatHistoryStore.deleteSession(sessionId);
      await loadChatSessions();
      if (sessionId === currentSessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleSessionBookmark = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);

      if (fullSession && fullSession.messages.length > 0) {
        // Get the session title
        const sessionTitle = fullSession.title;
        // Get the first 8 words of the title
        const title = sessionTitle.split(' ').slice(0, 8).join(' ');

        // Get the first message content (the task)
        const taskContent = fullSession.messages[0]?.content || '';

        // Add to favorites storage
        await favoritesStorage.addPrompt(title, taskContent);

        // Update favorites in the UI
        await favoritesStorage.getAllPrompts();

        // Return to chat view after pinning
        handleBackToChat(true);
      }
    } catch (error) {
      console.error('Failed to pin session to favorites:', error);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop recording if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear recording timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopConnection();
    };
  }, [stopConnection]);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const element = messagesScrollRef.current;
    if (!element) return;

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setAutoFollowMessages(distanceFromBottom < 96);
  }, []);

  useEffect(() => {
    if (autoFollowMessages) {
      scrollMessagesToBottom('smooth');
    }
  }, [autoFollowMessages, messages, scrollMessagesToBottom]);

  const handleMicClick = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear the timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      // First check if permission is already granted
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

      if (permissionStatus.state === 'denied') {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_stt_microphone_permissionDenied'),
          timestamp: Date.now(),
        });
        return;
      }

      // If permission is not granted, open permission page
      if (permissionStatus.state !== 'granted') {
        const permissionUrl = chrome.runtime.getURL('permission/index.html');

        // Open permission page in a new window
        chrome.windows.create(
          {
            url: permissionUrl,
            type: 'popup',
            width: 500,
            height: 600,
          },
          createdWindow => {
            if (createdWindow?.id) {
              // Listen for window close to check permission status
              chrome.windows.onRemoved.addListener(function onWindowClose(windowId) {
                if (windowId === createdWindow.id) {
                  chrome.windows.onRemoved.removeListener(onWindowClose);
                  // Check permission status after window closes
                  setTimeout(async () => {
                    try {
                      const newPermissionStatus = await navigator.permissions.query({
                        name: 'microphone' as PermissionName,
                      });
                      // Only retry if permission was granted
                      if (newPermissionStatus.state === 'granted') {
                        handleMicClick();
                      }
                      // If denied or prompt, do nothing - let user manually try again
                    } catch (error) {
                      console.error('Failed to check permission status:', error);
                    }
                  }, 500);
                }
              });
            }
          },
        );
        return;
      }

      // Permission granted - proceed with recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Clear previous audio chunks
      audioChunksRef.current = [];

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // Handle data available event
      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle stop event
      mediaRecorder.onstop = async () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        if (audioChunksRef.current.length > 0) {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

          // Convert blob to base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Audio = reader.result as string;

            // Setup connection if not exists
            if (!portRef.current) {
              setupConnection();
            }

            // Send audio to backend for speech-to-text conversion
            try {
              setIsProcessingSpeech(true);
              portRef.current?.postMessage({
                type: 'speech_to_text',
                audio: base64Audio,
              });
            } catch (error) {
              console.error('Failed to send audio for speech-to-text:', error);
              appendMessage({
                actor: Actors.SYSTEM,
                content: t('chat_stt_processingFailed'),
                timestamp: Date.now(),
              });
              setIsRecording(false);
              setIsProcessingSpeech(false);
            }
          };
          reader.readAsDataURL(audioBlob);
        }
      };

      // Set up 2-minute duration limit
      const maxDuration = 2 * 60 * 1000;
      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setIsProcessingSpeech(true);
        recordingTimerRef.current = null;
      }, maxDuration);

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);

      let errorMessage = t('chat_stt_microphone_accessFailed');
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage += t('chat_stt_microphone_grantPermission');
        } else if (error.name === 'NotFoundError') {
          errorMessage += t('chat_stt_microphone_notFound');
        } else {
          errorMessage += error.message;
        }
      }

      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setIsRecording(false);
    }
  };

  return (
    <div className="bg-bma-bg text-bma-text">
      <div className="side-panel-shell flex h-screen flex-col overflow-hidden bg-bma-bg text-bma-text">
        <header className="header relative">
          <div className="header-logo min-w-0 flex-1 gap-3">
            {showHistory ? (
              <button
                type="button"
                onClick={() => handleBackToChat(false)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
                aria-label={t('nav_back_a11y')}>
                <FiArrowLeft className="size-4" />
                {t('nav_back').replace(/^←\s*/, '')}
              </button>
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                <div className="shrink-0">
                  <MinuteAgentLogo />
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">Minute</span>
                  <span className="rounded-full border border-orange-300/30 bg-orange-300/10 px-2 py-0.5 text-[11px] font-medium text-orange-200">
                    Agent
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="header-icons">
            {!showHistory && (
              <>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={handleCopyChatHistory}
                    onKeyDown={e => e.key === 'Enter' && handleCopyChatHistory()}
                    className="header-icon"
                    aria-label="Copy entire chat history"
                    title="Copy chat history"
                    tabIndex={0}>
                    {copyState === 'copied' ? <FiCheck size={20} /> : <FiCopy size={20} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleNewChat}
                  onKeyDown={e => e.key === 'Enter' && handleNewChat()}
                  className="header-icon"
                  aria-label={t('nav_newChat_a11y')}
                  tabIndex={0}>
                  <PiPlusBold size={20} />
                </button>
                <button
                  type="button"
                  onClick={handleLoadHistory}
                  onKeyDown={e => e.key === 'Enter' && handleLoadHistory()}
                  className="header-icon"
                  aria-label={t('nav_loadHistory_a11y')}
                  tabIndex={0}>
                  <GrHistory size={20} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => chrome.runtime.openOptionsPage()}
              onKeyDown={e => e.key === 'Enter' && chrome.runtime.openOptionsPage()}
              className="header-icon"
              aria-label={t('nav_settings_a11y')}
              tabIndex={0}>
              <FiSettings size={20} />
            </button>
          </div>
        </header>
        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              onSessionBookmark={handleSessionBookmark}
              visible={true}
              isDarkMode={true}
            />
          </div>
        ) : (
          <>
            {/* Show loading state while checking model configuration */}
            {hasProviders === null && (
              <div className="flex flex-1 items-center justify-center p-8 text-bma-muted">
                <div className="text-center">
                  <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-zinc-800 border-t-orange-300"></div>
                  <p>{t('status_checkingConfig')}</p>
                </div>
              </div>
            )}

            {/* Show setup message when no models are configured */}
            {hasProviders === false && (
              <div className="flex flex-1 items-center justify-center p-6 text-bma-muted">
                <div className="max-w-md rounded-xl border border-zinc-800 bg-[#111113] p-5 text-center shadow-xl shadow-black/20">
                  <h3 className="mb-2 text-lg font-semibold text-zinc-100">Add a provider</h3>
                  <p className="mb-4 text-sm text-zinc-400">
                    Connect a provider in settings, then pick a model next to the input.
                  </p>
                  <button
                    onClick={() => chrome.runtime.openOptionsPage()}
                    className="my-2 cursor-pointer rounded-md bg-orange-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-orange-200">
                    Open settings
                  </button>
                </div>
              </div>
            )}

            {/* Show normal chat interface when models are configured */}
            {hasProviders === true && (
              <>
                {messages.length === 0 && (
                  <div className="flex flex-1 items-center justify-center bg-bma-bg p-4">
                    <div className="w-full max-w-2xl">
                      <div className="mb-5 text-center">
                        <div className="mx-auto mb-3 grid size-11 place-items-center rounded-lg border border-zinc-800 bg-[#111113] text-orange-300">
                          <FiClock className="size-5" />
                        </div>
                        <h1 className="text-xl font-semibold text-zinc-100">What should the browser do?</h1>
                        <p className="mt-1 text-sm text-zinc-500">
                          Tool calls and page actions will appear as structured run cards.
                        </p>
                      </div>
                      <ChatInput
                        onSendMessage={handleSendMessage}
                        onStopTask={handleStopTask}
                        onMicClick={handleMicClick}
                        isRecording={isRecording}
                        isProcessingSpeech={isProcessingSpeech}
                        disabled={!inputEnabled || isHistoricalSession}
                        showStopButton={showStopButton}
                        setContent={setter => {
                          setInputTextRef.current = setter;
                        }}
                        historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                        onReplay={handleReplay}
                        currentTabTitle={currentTabTitle}
                        modelSelector={<ModelSelector onModelConfigured={checkModelConfiguration} />}
                      />
                    </div>
                  </div>
                )}
                {messages.length > 0 && (
                  <div
                    ref={messagesScrollRef}
                    onScroll={handleMessagesScroll}
                    className="scrollbar-gutter-stable relative flex-1 overflow-x-hidden overflow-y-scroll scroll-smooth bg-bma-bg">
                    <MessageList messages={messages} isWorking={showStopButton} />
                    <div ref={messagesEndRef} />
                    {!autoFollowMessages && showStopButton && (
                      <button
                        type="button"
                        onClick={() => {
                          setAutoFollowMessages(true);
                          scrollMessagesToBottom();
                        }}
                        className="sticky bottom-4 left-1/2 z-20 mx-auto flex -translate-x-1/2 cursor-pointer items-center gap-2 overflow-hidden rounded-full border border-orange-300/30 bg-[#1a1410]/95 px-4 py-2 text-sm font-medium text-orange-100 shadow-lg shadow-black/30 transition-colors hover:border-orange-200/50 hover:bg-[#241a13]">
                        <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent motion-safe:animate-[shimmer_1.4s_infinite]" />
                        <FiArrowDown className="relative size-4" />
                        <span className="relative">Working...</span>
                      </button>
                    )}
                  </div>
                )}
                {messages.length > 0 && (
                  <div className="composer-dock border-t border-zinc-800 bg-bma-bg-soft p-3">
                    <ChatInput
                      onSendMessage={handleSendMessage}
                      onStopTask={handleStopTask}
                      onMicClick={handleMicClick}
                      isRecording={isRecording}
                      isProcessingSpeech={isProcessingSpeech}
                      disabled={!inputEnabled || isHistoricalSession}
                      showStopButton={showStopButton}
                      setContent={setter => {
                        setInputTextRef.current = setter;
                      }}
                      historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                      onReplay={handleReplay}
                      currentTabTitle={currentTabTitle}
                      modelSelector={<ModelSelector onModelConfigured={checkModelConfiguration} />}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
        {pendingAiSpaceRequest && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-lg border border-zinc-700 bg-[#111113] p-4 shadow-2xl shadow-black/40">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-zinc-100">Allow tab access?</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  The agent wants to use a tab outside AI Space. Approving will move it into AI Space.
                </p>
              </div>
              <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                <p className="truncate text-sm font-medium text-zinc-200">{pendingAiSpaceRequest.request.title}</p>
                <p className="mt-1 break-all text-xs text-zinc-500">{pendingAiSpaceRequest.request.url}</p>
                <p className="mt-2 text-xs text-zinc-400">{pendingAiSpaceRequest.request.reason}</p>
              </div>
              <label htmlFor="ai-space-decision" className="mb-1 block text-xs font-medium text-zinc-400">
                Decision
              </label>
              <select
                id="ai-space-decision"
                value={aiSpaceDecisionMode}
                onChange={event => setAiSpaceDecisionMode(event.target.value as 'once' | 'alwaysAllow' | 'alwaysDeny')}
                className="mb-4 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
                <option value="once">Only this time</option>
                <option value="alwaysAllow">Always approve</option>
                <option value="alwaysDeny">Always deny</option>
              </select>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => respondToAiSpaceRequest(false)}
                  className="rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06]">
                  Deny
                </button>
                <button
                  type="button"
                  onClick={() => respondToAiSpaceRequest(true)}
                  className="rounded-md bg-orange-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-orange-200">
                  Approve
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SidePanel;
